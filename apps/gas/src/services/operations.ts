import type { Actor, Page } from '@smart-ltc/shared';
import { listAll, pageOf, type RowRecord } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';

function isoDateInBangkok(date = new Date()): string {
  return Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
}

function mapPage(page: Page<RowRecord>, project: (row: RowRecord) => RowRecord): Page<RowRecord> {
  return { items: page.items.map(project), hasMore: page.hasMore };
}

function visitVisibleTo(actor: Actor, row: Record<string, unknown>): boolean {
  return actor.role !== 'CG' || String(row.assignedStaffId) === actor.userId;
}

/** Caregivers work by name, not episode id: resolves names for the given rows only. */
function visitProjector(visits: RowRecord[]): (row: RowRecord) => RowRecord {
  const episodeIds = new Set(visits.map((row) => String(row.episodeId)));
  const patientOfEpisode = new Map(listAll('CareEpisodes', (row) => episodeIds.has(String(row.episodeId)))
    .map((row) => [String(row.episodeId), String(row.patientId)]));
  const patientIds = new Set(patientOfEpisode.values());
  const nameOfPatient = new Map(listAll('Patients', (row) => patientIds.has(String(row.patientId)))
    .map((row) => [String(row.patientId), String(row.fullName)]));
  return (row) => ({
    visitId: row.visitId, episodeId: row.episodeId, visitDateTime: row.visitDateTime,
    expectedEndTime: row.expectedEndTime, visitType: row.visitType, status: row.status,
    patientName: nameOfPatient.get(patientOfEpisode.get(String(row.episodeId)) ?? '') ?? ''
  });
}

const FOLLOW_UP_VISIT_LIMIT = 5;

export function dashboardSummary(actor: Actor): Record<string, number | RowRecord[]> {
  const today = isoDateInBangkok();
  const openVisits = listAll('VisitSchedules', (row) => visitVisibleTo(actor, row) && !['VERIFIED', 'CANCELLED'].includes(String(row.status)));
  const dueToday = openVisits.filter((row) => String(row.visitDateTime).slice(0, 10) === today).length;
  const overdue = openVisits.filter((row) => String(row.visitDateTime).slice(0, 10) < today).length;
  // Oldest first across every open visit: a page of the sheet could leave out what is most overdue.
  const followUp = actor.capabilities.includes('patients:read')
    ? [...openVisits].sort((left, right) => String(left.visitDateTime).localeCompare(String(right.visitDateTime))).slice(0, FOLLOW_UP_VISIT_LIMIT)
    : [];
  const followUpVisits = followUp.map(visitProjector(followUp));
  const reviewQueue = actor.role === 'CG' ? 0 : listAll('VisitEncounters', (row) => String(row.status) === 'SUBMITTED').length;
  const highRiskAlerts = actor.role === 'CG' ? 0 : listAll('Alerts', (row) => String(row.severity) === 'HIGH' && String(row.status) !== 'CLOSED').length;
  const drafts = 0;
  return { dueToday, overdue, reviewQueue, highRiskAlerts, drafts, followUpVisits };
}

export function listVisits(actor: Actor): Page<RowRecord> {
  requireCapability(actor, 'patients:read');
  const page = pageOf('VisitSchedules', (row) => visitVisibleTo(actor, row), 50);
  return mapPage(page, visitProjector(page.items));
}

export function listAlerts(actor: Actor): Page<RowRecord> {
  requireCapability(actor, 'patients:read');
  if (actor.role === 'CG') return { items: [], hasMore: false };
  return mapPage(pageOf('Alerts', (row) => String(row.status) !== 'CLOSED', 50), (row) => ({
    alertId: row.alertId, severity: row.severity, alertType: row.alertType,
    eventAt: row.eventAt, status: row.status
  }));
}

export function listReviews(actor: Actor): Page<RowRecord> {
  requireCapability(actor, 'encounter:review');
  const page = pageOf('VisitEncounters', (row) => String(row.status) === 'SUBMITTED', 50);
  // Everything the CM needs to decide, resolved for this page only.
  const ids = (column: string) => new Set(page.items.map((row) => String(row[column])));
  const encounterIds = ids('encounterId');
  const visits = byId(listAll('VisitSchedules', (row) => ids('visitId').has(String(row.visitId))), 'visitId');
  const episodes = byId(listAll('CareEpisodes', (row) => ids('episodeId').has(String(row.episodeId))), 'episodeId');
  const patientIds = new Set([...episodes.values()].map((row) => String(row.patientId)));
  const patients = byId(listAll('Patients', (row) => patientIds.has(String(row.patientId))), 'patientId');
  const performers = byId(listAll('Users', (row) => ids('performerId').has(String(row.userId))), 'userId');
  const urgent = new Set(listAll('Alerts', (row) => encounterIds.has(String(row.encounterId)) && String(row.alertType) === 'CG_URGENT_FLAG')
    .map((row) => String(row.encounterId)));
  return mapPage(page, (row) => {
    const visit = visits.get(String(row.visitId));
    const patient = patients.get(String(episodes.get(String(row.episodeId))?.patientId ?? ''));
    return {
      encounterId: row.encounterId, visitId: row.visitId, performerId: row.performerId,
      performerName: performers.get(String(row.performerId))?.displayName ?? '',
      patientName: patient?.fullName ?? '', visitType: visit?.visitType ?? '', visitDateTime: visit?.visitDateTime ?? '',
      startedAt: row.startedAt, endedAt: row.endedAt, notes: row.notes, vitalsJson: row.vitalsJson,
      urgentFlag: urgent.has(String(row.encounterId)), status: row.status, recordVersion: row.recordVersion
    };
  });
}

function byId(rows: RowRecord[], column: string): Map<string, RowRecord> {
  return new Map(rows.map((row) => [String(row[column]), row]));
}
