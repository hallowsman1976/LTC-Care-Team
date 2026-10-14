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

export function dashboardSummary(actor: Actor): Record<string, number> {
  const today = isoDateInBangkok();
  const visits = listAll('VisitSchedules', (row) => visitVisibleTo(actor, row));
  const dueToday = visits.filter((row) => String(row.visitDateTime).slice(0, 10) === today && !['VERIFIED', 'CANCELLED'].includes(String(row.status))).length;
  const overdue = visits.filter((row) => String(row.visitDateTime).slice(0, 10) < today && !['VERIFIED', 'CANCELLED'].includes(String(row.status))).length;
  const reviewQueue = actor.role === 'CG' ? 0 : listAll('VisitEncounters', (row) => String(row.status) === 'SUBMITTED').length;
  const highRiskAlerts = actor.role === 'CG' ? 0 : listAll('Alerts', (row) => String(row.severity) === 'HIGH' && String(row.status) !== 'CLOSED').length;
  const drafts = 0;
  return { dueToday, overdue, reviewQueue, highRiskAlerts, drafts };
}

export function listVisits(actor: Actor): Page<RowRecord> {
  requireCapability(actor, 'patients:read');
  const page = pageOf('VisitSchedules', (row) => visitVisibleTo(actor, row), 50);
  // Caregivers work by name, not episode id: resolve names for this page only.
  const episodeIds = new Set(page.items.map((row) => String(row.episodeId)));
  const patientOfEpisode = new Map(listAll('CareEpisodes', (row) => episodeIds.has(String(row.episodeId)))
    .map((row) => [String(row.episodeId), String(row.patientId)]));
  const patientIds = new Set(patientOfEpisode.values());
  const nameOfPatient = new Map(listAll('Patients', (row) => patientIds.has(String(row.patientId)))
    .map((row) => [String(row.patientId), String(row.fullName)]));
  return mapPage(page, (row) => ({
    visitId: row.visitId, episodeId: row.episodeId, visitDateTime: row.visitDateTime,
    expectedEndTime: row.expectedEndTime, visitType: row.visitType, status: row.status,
    patientName: nameOfPatient.get(patientOfEpisode.get(String(row.episodeId)) ?? '') ?? ''
  }));
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
  return mapPage(pageOf('VisitEncounters', (row) => String(row.status) === 'SUBMITTED', 50), (row) => ({
    encounterId: row.encounterId, visitId: row.visitId, performerId: row.performerId,
    endedAt: row.endedAt, status: row.status, recordVersion: row.recordVersion
  }));
}
