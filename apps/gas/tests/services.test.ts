import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGas, installFakeGas, parseOutput, records, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';
import { runScheduler } from '../src/jobs/schedule';
import { derivePasswordHash } from '../src/security/password';

const post = (action: string, subject: string, payload: Record<string, unknown>) => parseOutput(doPost(signedEvent(action, subject, payload)));
const future = '2099-01-01T00:00:00.000Z';

beforeEach(() => {
  installFakeGas();
  seed('Users', [
    { userId: 'usr-cm', identitySubject: 'google-sub-cm', role: 'CM', enabled: 'true' },
    { userId: 'usr-cg', identitySubject: 'google-sub-cg', role: 'CG', enabled: 'true' }
  ]);
  seed('StaffProfiles', [{ staffId: 'st-cm', userId: 'usr-cm', credentialVerifiedAt: '2026-01-01', qualificationExpiry: future }]);
});
afterEach(() => { vi.useRealTimers(); });

describe('gateway identity', () => {
  it('resolves the actor from the userId the gateway sends after login', () => {
    expect(post('visit.list', 'usr-cg', {})).toMatchObject({ ok: true });
  });

  it('does not accept an identity-provider subject in place of a userId', () => {
    expect(post('visit.list', 'google-sub-cg', {})).toMatchObject({ ok: false, code: 'ACTOR_NOT_ALLOWED' });
  });

  it('still resolves Google subjects for auth.resolveIdentity', () => {
    expect(post('auth.resolveIdentity', 'anonymous', { subject: 'google-sub-cm' })).toMatchObject({ ok: true, data: { userId: 'usr-cm', role: 'CM' } });
  });
});

describe('password verification', () => {
  function enrol(userId: string, identifier: string, password: string) {
    const saltBase64 = Buffer.from('salt-for-test').toString('base64');
    seed('AuthCredentials', [{ credentialId: `cred-${userId}`, userId, identifierNormalized: identifier, saltBase64, iterations: 5, status: 'ACTIVE',
      derivedHashBase64: derivePasswordHash(password, saltBase64, 'pepper', 5) }]);
  }

  it('applies the same clinical-credential check as Google sign-in', () => {
    enrol('usr-cm', 'cm', 'correct horse battery');
    expect(post('auth.passwordVerify', 'anonymous', { identifier: 'cm', password: 'correct horse battery' })).toMatchObject({ ok: true, data: { role: 'CM' } });
    fakeGas.sheets.get('StaffProfiles')!.rows[1]![5] = '2020-01-01T00:00:00.000Z';
    expect(post('auth.passwordVerify', 'anonymous', { identifier: 'cm', password: 'correct horse battery' })).toMatchObject({ ok: false, code: 'CLINICAL_CREDENTIAL_INVALID' });
  });
});

function seedEpisode(patientId = 'pt-1', episodeId = 'ep-1') {
  seed('Patients', [{ patientId, hn: `HN-${patientId}`, fullName: 'ผู้ป่วยจำลอง', birthDate: '1950-01-01', status: 'ACTIVE' }]);
  seed('CareEpisodes', [{ episodeId, patientId, status: 'ACTIVE', legalBasis: 'PUBLIC_HEALTH' }]);
}

describe('clinical actions resolve their own context', () => {
  const items = { feeding: 1, grooming: 0, transfer: 1, toiletUse: 1, mobility: 1, dressing: 1, stairs: 0, bathing: 0, bowels: 1, bladder: 1 };

  it('attaches an ADL assessment to the patient’s active episode', () => {
    seedEpisode();
    expect(post('adl.create', 'usr-cm', { patientId: 'pt-1', assessmentDate: '2026-10-13', items })).toMatchObject({ ok: true, data: { episodeId: 'ep-1', totalScore: 7 } });
  });

  it('refuses when the patient has no single active episode', () => {
    seed('Patients', [{ patientId: 'pt-2' }]);
    expect(post('adl.create', 'usr-cm', { patientId: 'pt-2', assessmentDate: '2026-10-13', items })).toMatchObject({ ok: false, code: 'ACTIVE_EPISODE_REQUIRED' });
    seed('CareEpisodes', [{ episodeId: 'ep-a', patientId: 'pt-2', status: 'ACTIVE' }, { episodeId: 'ep-b', patientId: 'pt-2', status: 'ACTIVE' }]);
    expect(post('adl.create', 'usr-cm', { patientId: 'pt-2', assessmentDate: '2026-10-13', items })).toMatchObject({ ok: false, code: 'MULTIPLE_ACTIVE_EPISODES' });
  });

  it('confirms a classification against the latest approved ADL and ignores smuggled fields', () => {
    seedEpisode();
    seed('ADLAssessments', [
      { assessmentId: 'adl-old', episodeId: 'ep-1', assessmentDate: '2026-01-01', totalScore: 15, status: 'APPROVED', createdAt: '2026-01-01T00:00:00Z' },
      { assessmentId: 'adl-new', episodeId: 'ep-1', assessmentDate: '2026-10-01', totalScore: 3, status: 'APPROVED', createdAt: '2026-10-01T00:00:00Z' }
    ]);
    const result = post('classification.confirm', 'usr-cm', {
      patientId: 'pt-1', groupNumber: 4, rationale: 'ผู้ป่วยติดเตียงและแพทย์ยืนยันระยะท้าย',
      observation: { mobilityStatus: 'DEPENDENT', cognitiveStatus: 'DISTURBANCE', terminalStatus: 'CONFIRMED', classId: 'attacker-id' },
      classId: 'attacker-id'
    });
    expect(result).toMatchObject({ ok: true, data: { episodeId: 'ep-1', assessmentId: 'adl-new', adlTotal: 3, suggestedGroup: 4, groupNumber: 4 } });
    expect(records('LTCClassifications').map((row) => row.classId)).not.toContain('attacker-id');
  });

  it('rejects a classification without observations instead of crashing', () => {
    seedEpisode();
    expect(post('classification.confirm', 'usr-cm', { patientId: 'pt-1', groupNumber: 1, rationale: 'เหตุผลที่ยาวพอสมควร' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('creates the care plan intervention with its validated schedule', () => {
    seedEpisode();
    const result = post('carePlan.create', 'usr-cm', {
      patientId: 'pt-1', rulesetId: 'rs-1', effectiveFrom: '2026-10-01', effectiveTo: '2026-12-31', goalsSummary: 'คงความสามารถในการเคลื่อนไหว',
      intervention: { serviceType: 'PHYSIO', instructions: 'ฝึกยืนและเดินโดยมีผู้ช่วย', schedulePattern: { unit: 'WEEK', count: 1, weekdays: [3], windowStart: '09:00', windowEnd: '11:00' } }
    });
    expect(result).toMatchObject({ ok: true, data: { episodeId: 'ep-1', status: 'DRAFT' } });
    const [intervention] = records('CarePlanInterventions');
    expect(intervention).toMatchObject({ carePlanId: (result.data as { carePlanId: string }).carePlanId, serviceType: 'PHYSIO', count: 1, unit: 'WEEK' });
    expect(JSON.parse(String(intervention!.schedulePatternJson))).toMatchObject({ weekdays: [3] });
  });
});

describe('visit submission', () => {
  const submission = (overrides: Record<string, unknown> = {}) => ({
    visitId: 'vs-1', submissionId: '7d1b8d4e-6f0a-4a43-9c55-1f0b0f6b9a11', source: 'ONLINE', startedAt: '2026-10-13T09:00', endedAt: '2026-10-13T10:00',
    activityCompleted: true, urgentFlag: false, notes: '', vitals: {}, ...overrides
  });

  beforeEach(() => {
    seed('VisitSchedules', [{ visitId: 'vs-1', episodeId: 'ep-1', assignedStaffId: 'usr-cg', status: 'ASSIGNED' }]);
  });

  it('checks the idempotency receipt inside the same lock as the write', () => {
    const lockStateAtWrite: number[] = [];
    let acquisitionsBefore = 0;
    fakeGas.onWrite = (sheet) => { if (sheet === 'VisitEncounters' || sheet === 'SyncReceipts') lockStateAtWrite.push(fakeGas.lockAcquisitions - acquisitionsBefore); };
    acquisitionsBefore = fakeGas.lockAcquisitions + 1; // the nonce check takes the first lock
    expect(post('visit.submit', 'usr-cg', submission())).toMatchObject({ ok: true });
    // Both writes belong to the single acquisition that also performed the receipt lookup.
    expect(lockStateAtWrite).toEqual([1, 1]);
    expect(post('visit.submit', 'usr-cg', submission())).toMatchObject({ ok: true });
    expect(records('VisitEncounters')).toHaveLength(1);
  });

  it('raises a high-severity alert for the CM when the caregiver flags something urgent', () => {
    expect(post('visit.submit', 'usr-cg', submission({ urgentFlag: true }))).toMatchObject({ ok: true });
    expect(records('Alerts')).toEqual([expect.objectContaining({ episodeId: 'ep-1', severity: 'HIGH', alertType: 'CG_URGENT_FLAG', status: 'OPEN' })]);
  });
});

describe('file upload', () => {
  it('accepts files larger than the old 100 KB request ceiling', () => {
    seed('VisitEncounters', [{ encounterId: 'enc-1', performerId: 'usr-cg', status: 'SUBMITTED' }]);
    seed('PatientConsents', [{ consentId: 'con-1', patientId: 'pt-1', revokedAt: '' }]);
    const base64 = Buffer.alloc(300 * 1024, 1).toString('base64');
    expect(post('file.upload', 'usr-cg', { encounterId: 'enc-1', consentRef: 'con-1', mimeType: 'image/png', base64 })).toMatchObject({ ok: true, data: { scanStatus: 'PENDING_SCAN' } });
  });
});

describe('list limits', () => {
  it('pages UI lists with hasMore and exports every patient', () => {
    for (let index = 0; index < 60; index += 1) {
      seedEpisode(`pt-${index}`, `ep-${index}`);
      seed('StaffAssignments', [{ assignmentId: `as-${index}`, episodeId: `ep-${index}`, staffId: 'usr-cg', role: 'CG', status: 'ACTIVE' }]);
    }
    expect(post('patient.list', 'usr-cg', { limit: 50 })).toMatchObject({ ok: true, data: { hasMore: true } });
    expect((post('patient.list', 'usr-cg', { limit: 50 }).data as { items: unknown[] }).items).toHaveLength(50);
    expect((post('patient.export', 'usr-cm', {}).data as { items: unknown[] }).items).toHaveLength(60);
  });
});

describe('visit scheduler', () => {
  function seedActivePlan(pattern: Record<string, unknown>, effectiveTo = '2099-12-31') {
    seed('ServiceRuleSets', [{ rulesetId: 'rs-1', status: 'APPROVED' }]);
    seed('CarePlans', [{ carePlanId: 'cp-1', episodeId: 'ep-1', version: 1, rulesetId: 'rs-1', status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo }]);
    seed('StaffAssignments', [{ assignmentId: 'as-1', episodeId: 'ep-1', staffId: 'usr-cg', role: 'CG', status: 'ACTIVE' }]);
    seed('CarePlanInterventions', [{ interventionId: 'iv-1', carePlanId: 'cp-1', serviceType: 'VISIT', schedulePatternJson: JSON.stringify(pattern) }]);
  }

  it('does not duplicate visits when it runs again on a later day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T01:00:00Z')); // Tuesday in Bangkok
    seedActivePlan({ unit: 'WEEK', count: 2, weekdays: [1, 4], windowStart: '09:00', windowEnd: '10:00' });
    runScheduler();
    vi.setSystemTime(new Date('2026-10-17T01:00:00Z'));
    runScheduler();
    const dates = records('VisitSchedules').map((row) => String(row.visitDateTime).slice(0, 10));
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('stays inside the plan’s effective dates and skips invalid patterns', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T01:00:00Z'));
    seedActivePlan({ unit: 'WEEK', count: 7, weekdays: [1, 2, 3, 4, 5, 6, 7], windowStart: '09:00', windowEnd: '10:00' }, '2026-10-15');
    seed('CarePlanInterventions', [{ interventionId: 'iv-bad', carePlanId: 'cp-1', schedulePatternJson: '{"unit":"WEEK","count":3,"weekdays":[1]}' }]);
    runScheduler();
    expect(records('VisitSchedules').map((row) => String(row.visitDateTime).slice(0, 10))).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
  });
});
