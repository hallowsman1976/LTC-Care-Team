import { appendLog } from '../repositories/sheets';

export function audit(actorId: string, action: string, entityType: string, entityId: string, outcome: string, reason = ''): void {
  appendLog('AuditLogs', {
    auditId: Utilities.getUuid(), actorId, action, entityType, entityId,
    timestamp: new Date().toISOString(), outcome, reason,
    changeSummaryRedacted: ''
  });
}

