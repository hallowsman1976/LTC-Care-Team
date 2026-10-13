import type { Actor } from '@smart-ltc/shared';
import { listAll, listPage } from '../repositories/sheets';
import { requireCapability } from '../security/rbac';

function isoDateInBangkok(date = new Date()): string {
  return Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
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

export function listVisits(actor: Actor): Record<string, unknown>[] {
  requireCapability(actor, 'patients:read');
  return listPage('VisitSchedules', (row) => visitVisibleTo(actor, row), 50).map((row) => ({
    visitId: row.visitId, episodeId: row.episodeId, visitDateTime: row.visitDateTime,
    expectedEndTime: row.expectedEndTime, visitType: row.visitType, status: row.status
  }));
}

export function listAlerts(actor: Actor): Record<string, unknown>[] {
  requireCapability(actor, 'patients:read');
  if (actor.role === 'CG') return [];
  return listPage('Alerts', (row) => String(row.status) !== 'CLOSED', 50).map((row) => ({
    alertId: row.alertId, severity: row.severity, alertType: row.alertType,
    eventAt: row.eventAt, status: row.status
  }));
}

export function listReviews(actor: Actor): Record<string, unknown>[] {
  requireCapability(actor, 'encounter:review');
  return listPage('VisitEncounters', (row) => String(row.status) === 'SUBMITTED', 50).map((row) => ({
    encounterId: row.encounterId, visitId: row.visitId, performerId: row.performerId,
    endedAt: row.endedAt, status: row.status, recordVersion: row.recordVersion
  }));
}
