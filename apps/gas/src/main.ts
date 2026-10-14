import { getAppMode, getRequiredProperty, requireOperationalMode } from './config';
import { verifyGatewayRequest } from './security/verifyGateway';
import { resolveActorByUserId } from './security/rbac';
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
import { setDemoCredential as setCredential } from './admin/credentials';
import { diagnoseDemoLogin as diagnoseLogin } from './admin/diagnose';
import { seedDemoData as seedDemo } from './admin/demoData';
import { runLoadProbe as probe, seedLoadTestData as seedLoad, type LoadTestOptions } from './admin/loadTest';
import { archiveAuditLogs as archiveAudit, installAuditArchiveTrigger as installArchiveTrigger } from './jobs/auditArchive';
import { dashboardSummary, listAlerts, listReviews, listVisits } from './services/operations';
import { createCaregiver, importPatients, listAssignments, listCaregivers, setAssignment } from './services/admin';
import { submitVisitRecord, uploadVisitImage, visitContext } from './services/visitRecords';

// A 5 MB upload is ~6.7 MB as base64, plus the envelope.
const MAX_REQUEST_CHARS = 7_500_000;

type Handler = (actor: ReturnType<typeof resolveActorByUserId>, payload: Record<string, unknown>) => unknown;
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
  'file.upload': uploadQuarantinedFile,
  'visit.context': visitContext,
  'visitImage.upload': uploadVisitImage,
  'visitRecord.submit': submitVisitRecord,
  'caregiver.list': listCaregivers,
  'caregiver.create': createCaregiver,
  'assignment.list': listAssignments,
  'assignment.set': setAssignment,
  'patient.import': importPatients
};

const ANONYMOUS_ACTIONS: Record<string, (payload: Record<string, unknown>) => unknown> = {
  'auth.passwordVerify': verifyPassword,
  'auth.resolveIdentity': resolveIdentity
};

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const fallbackRequestId = Utilities.getUuid();
  let verified = false;
  try {
    requireOperationalMode();
    const raw = e?.postData?.contents;
    if (!raw || raw.length > MAX_REQUEST_CHARS) throw new Error('INVALID_REQUEST');
    const trusted = verifyGatewayRequest(JSON.parse(raw) as unknown);
    verified = true;
    if (trusted.action === 'auth.passwordVerify' && getAppMode() !== 'DEMO') throw new Error('PASSWORD_AUTH_DISABLED');
    const anonymousHandler = ANONYMOUS_ACTIONS[trusted.action];
    if (anonymousHandler) {
      const data = anonymousHandler(trusted.payload);
      return jsonOutput(envelope(true, 'OK', '', data, trusted.requestId));
    }
    const handler = ACTIONS[trusted.action];
    if (!handler) throw new Error('UNKNOWN_ACTION');
    // After sign-in the gateway session identifies users by our own userId, never the IdP subject.
    const actor = resolveActorByUserId(trusted.subject);
    const data = handler(actor, trusted.payload);
    return jsonOutput(envelope(true, 'OK', '', data, trusted.requestId));
  } catch (error) {
    const internalCode = error instanceof Error ? (error.name === 'ZodError' ? 'VALIDATION_FAILED' : error.message) : 'REQUEST_DENIED';
    console.warn(JSON.stringify({ requestId: fallbackRequestId, code: internalCode, verified }));
    // The web app is reachable by anyone. Until the gateway signature checks out, reveal nothing
    // about configuration or validation; the real reason is in the Executions log above.
    const code = verified ? internalCode : 'REQUEST_REJECTED';
    return jsonOutput(envelope(false, code, 'ไม่สามารถดำเนินการได้', null, fallbackRequestId));
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

export function runVisitScheduler(): ReturnType<typeof runScheduler> {
  requireOperationalMode();
  if (getAppMode() === 'PILOT' && getRequiredProperty('SCHEDULER_ENABLED') !== 'true') throw new Error('SCHEDULER_NOT_APPROVED');
  return runScheduler();
}


export function setDemoCredential(userId: string, identifier: string, password: string): ReturnType<typeof setCredential> {
  return setCredential(userId, identifier, password);
}

export function archiveAuditLogs(): ReturnType<typeof archiveAudit> {
  requireOperationalMode();
  return archiveAudit();
}

export function installAuditArchiveTrigger(): string {
  return installArchiveTrigger();
}

export function seedLoadTestData(options?: LoadTestOptions): ReturnType<typeof seedLoad> {
  return seedLoad(options);
}

export function runLoadProbe(repeats = 3): ReturnType<typeof probe> {
  return probe(doPost, repeats);
}

export function diagnoseDemoLogin(identifier: string, password?: string): ReturnType<typeof diagnoseLogin> {
  return diagnoseLogin(identifier, password);
}

export function seedDemoData(cgIdentifier?: string): ReturnType<typeof seedDemo> {
  return seedDemo(cgIdentifier);
}
