import { getAppMode, getRequiredProperty, requireOperationalMode } from './config';
import { verifyGatewayRequest } from './security/verifyGateway';
import { resolveActor } from './security/rbac';
import { createAdlAssessment } from './services/adl';
import { confirmClassification } from './services/ltc';
import { submitVisit } from './services/visits';
import { createPatient, exportPatients, listPatients } from './services/patients';
import { createCarePlan, activateCarePlan } from './services/carePlans';
import { reviewEncounter } from './services/reviews';
import { uploadQuarantinedFile } from './services/files';
import { resolveIdentity, verifyPassword } from './services/auth';
import { envelope, jsonOutput } from './utils/responses';
import { initializeDemoWorkbook as initialize } from './initializer';
import { runScheduler } from './jobs/schedule';
import { dashboardSummary, listAlerts, listReviews, listVisits } from './services/operations';

type Handler = (actor: ReturnType<typeof resolveActor>, payload: Record<string, unknown>) => unknown;
const ACTIONS: Record<string, Handler> = {
  'patient.create': createPatient,
  'patient.list': listPatients,
  'patient.export': exportPatients,
  'dashboard.summary': dashboardSummary,
  'visit.list': listVisits,
  'alert.list': listAlerts,
  'review.list': listReviews,
  'adl.create': createAdlAssessment,
  'classification.confirm': confirmClassification,
  'carePlan.create': createCarePlan,
  'carePlan.activate': activateCarePlan,
  'visit.submit': submitVisit,
  'encounter.review': reviewEncounter,
  'file.upload': uploadQuarantinedFile
};

const ANONYMOUS_ACTIONS: Record<string, (payload: Record<string, unknown>) => unknown> = {
  'auth.passwordVerify': verifyPassword,
  'auth.resolveIdentity': resolveIdentity
};

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const fallbackRequestId = Utilities.getUuid();
  try {
    requireOperationalMode();
    const raw = e?.postData?.contents;
    if (!raw || raw.length > 100_000) throw new Error('INVALID_REQUEST');
    const trusted = verifyGatewayRequest(JSON.parse(raw) as unknown);
    if (trusted.action === 'auth.passwordVerify' && getAppMode() !== 'DEMO') throw new Error('PASSWORD_AUTH_DISABLED');
    const anonymousHandler = ANONYMOUS_ACTIONS[trusted.action];
    if (anonymousHandler) {
      const data = anonymousHandler(trusted.payload);
      return jsonOutput(envelope(true, 'OK', '', data, trusted.requestId));
    }
    const handler = ACTIONS[trusted.action];
    if (!handler) throw new Error('UNKNOWN_ACTION');
    const actor = resolveActor(trusted.subject);
    const data = handler(actor, trusted.payload);
    return jsonOutput(envelope(true, 'OK', '', data, trusted.requestId));
  } catch (error) {
    const internalCode = error instanceof Error ? error.message : 'REQUEST_DENIED';
    console.warn(JSON.stringify({ requestId: fallbackRequestId, code: internalCode }));
    return jsonOutput(envelope(false, internalCode, 'ไม่สามารถดำเนินการได้', null, fallbackRequestId));
  }
}

export function initializeDemoWorkbook(): { created: string[] } {
  return initialize();
}

export function initializePilotWorkbook(): { created: string[] } {
  requireOperationalMode();
  if (getAppMode() !== 'PILOT') throw new Error('PILOT_MODE_REQUIRED');
  return initialize(false);
}

export function runVisitScheduler(): { generated: number; horizonDays: number } {
  requireOperationalMode();
  if (getAppMode() === 'PILOT' && getRequiredProperty('SCHEDULER_ENABLED') !== 'true') throw new Error('SCHEDULER_NOT_APPROVED');
  return runScheduler();
}

