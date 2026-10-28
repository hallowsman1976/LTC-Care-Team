import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { totpCode } from '../src/auth';
import { encryptCid, encryptText } from '../src/crypto';
import { makeEnv, request, stubGas } from './fakes';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

const call = (req: Request, env: ReturnType<typeof makeEnv>) => worker.fetch(req, env as never);
const body = async (response: Response) => response.json() as Promise<{ ok: boolean; code: string; data: unknown }>;
const json = (value: unknown) => JSON.stringify(value);

const cmActor = { userId: 'usr-cm', role: 'CM', capabilities: ['patients:read', 'patients:write', 'adl:approve', 'classification:confirm', 'carePlan:approve', 'encounter:review', 'export:phi', 'users:manage', 'assignments:manage', 'patients:import'] };
const cgActor = { userId: 'usr-cg', role: 'CG', capabilities: ['patients:read'] };
const adminActor = { userId: 'usr-admin', role: 'ADMIN', capabilities: ['patients:read', 'patients:write', 'users:manage', 'assignments:manage', 'patients:import', 'export:phi'] };

async function loginAs(env: ReturnType<typeof makeEnv>, actor: typeof cmActor | typeof cgActor | typeof adminActor): Promise<string> {
  const secret = 'JBSWY3DPEHPK3PXP';
  env.SECURITY_DB.userSecurity.set(actor.userId, {
    mfa_enabled: 1,
    totp_secret_ciphertext: await encryptText(secret, env.MFA_ENCRYPTION_KEY_BASE64, `smart-ltc:totp:${actor.userId}:v1`)
  });
  stubGas(() => actor);
  const response = await call(request('/auth/password/login', {
    method: 'POST',
    body: json({ identifier: actor.userId, password: 'correct horse battery', totpCode: await totpCode(secret, Math.floor(Date.now() / 30_000)) })
  }), env);
  expect(response.status).toBe(200);
  return /__Host-ltc_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';
}

describe('demo impersonation', () => {
  it('ignores x-demo-role on a deployed demo', async () => {
    const env = makeEnv({ DEMO_IMPERSONATION: 'true' });
    const response = await call(request('/auth/me', { headers: { 'x-demo-role': 'cm' } }), env);
    expect(response.status).toBe(401);
  });

  it('ignores x-demo-role on localhost unless the flag is set', async () => {
    const env = makeEnv();
    const response = await call(request('/auth/me', { origin: 'http://127.0.0.1:8787', headers: { 'x-demo-role': 'cm' } }), env);
    expect(response.status).toBe(401);
  });

  it('accepts x-demo-role on localhost with the flag and never reaches GAS', async () => {
    const env = makeEnv({ DEMO_IMPERSONATION: 'true' });
    const calls = stubGas(() => { throw new Error('UNEXPECTED'); });
    const me = await call(request('/auth/me', { origin: 'http://localhost:8787', headers: { 'x-demo-role': 'cg' } }), env);
    expect((await body(me)).data).toMatchObject({ role: 'CG' });
    const visits = await call(request('/visits', { origin: 'http://localhost:8787', headers: { 'x-demo-role': 'cg' } }), env);
    expect((await body(visits)).data).toMatchObject({ hasMore: false });
    const adl = await call(request('/adl-assessments', {
      origin: 'http://localhost:8787', method: 'POST', headers: { 'x-demo-role': 'cm' },
      body: json({ patientId: 'pt-demo-001', assessmentDate: '2026-10-13', items: { feeding: 2, grooming: 1, transfer: 3, toiletUse: 2, mobility: 3, dressing: 2, stairs: 2, bathing: 1, bowels: 2, bladder: 2 } })
    }), env);
    expect(adl.status).toBe(200);
    expect((await body(adl)).data).toMatchObject({ demo: true, totalScore: 20 });
    expect(calls).toHaveLength(0);
  });
});

describe('gas proxy surface', () => {
  it('no longer exposes the generic /internal/gas proxy', async () => {
    const env = makeEnv();
    const cookie = await loginAs(env, cmActor);
    const calls = stubGas(() => ({}));
    const response = await call(request('/internal/gas/auth.passwordVerify', {
      method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json({ identifier: 'x', password: 'y' })
    }), env);
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('checks capabilities at the gateway before calling GAS', async () => {
    const env = makeEnv();
    const cookie = await loginAs(env, cgActor);
    const calls = stubGas(() => ({}));
    const response = await call(request('/encounter-reviews', {
      method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` },
      body: json({ encounterId: 'enc-1', decision: 'VERIFIED', recordVersion: 1 })
    }), env);
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('validates the payload, forwards only known fields and uses the userId as subject', async () => {
    const env = makeEnv();
    const cookie = await loginAs(env, cmActor);
    const calls = stubGas(() => ({ encounterId: 'enc-1' }));
    const invalid = await call(request('/encounter-reviews', {
      method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json({ encounterId: 'enc-1', decision: 'RETURNED', recordVersion: 1 })
    }), env);
    expect(invalid.status).toBe(400);
    expect((await body(invalid)).code).toBe('VALIDATION_FAILED');
    const valid = await call(request('/encounter-reviews', {
      method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` },
      body: json({ encounterId: 'enc-1', decision: 'VERIFIED', recordVersion: 1, status: 'SMUGGLED' })
    }), env);
    expect(valid.status).toBe(200);
    expect(calls).toEqual([{ action: 'encounter.review', subject: 'usr-cm', payload: { encounterId: 'enc-1', decision: 'VERIFIED', reviewNotes: '', recordVersion: 1 } }]);
  });

  it('encrypts every CID before forwarding an import and lets only admins and CMs import', async () => {
    const env = makeEnv();
    const row = { line: 2, localCode: 'L-1', hn: 'HN-1', cid: '1100000000001', fullName: 'นางสมมติ ทดสอบ', birthDate: '1942-03-15', sex: 'FEMALE', address: 'บ้าน', village: '', phone: '' };
    const cgCookie = await loginAs(env, cgActor);
    const denied = await call(request('/admin/patients/import', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cgCookie}` }, body: json({ rows: [row] }) }), env);
    expect(denied.status).toBe(403);
    const cookie = await loginAs(env, adminActor);
    const calls = stubGas(() => ({ created: 1, skipped: [] }));
    const response = await call(request('/admin/patients/import', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json({ rows: [row] }) }), env);
    expect(response.status).toBe(200);
    expect(calls[0]!.action).toBe('patient.import');
    const forwarded = (calls[0]!.payload.rows as Array<Record<string, unknown>>)[0]!;
    expect(forwarded).not.toHaveProperty('cid');
    expect(forwarded).toMatchObject({ hn: 'HN-1', cidCiphertext: expect.any(String), cidLookupHash: expect.any(String) });
    expect(JSON.stringify(calls[0]!.payload)).not.toContain(row.cid);
  });

  it('encrypts a caregiver CID before forwarding', async () => {
    const env = makeEnv();
    const cookie = await loginAs(env, adminActor);
    const calls = stubGas(() => ({ userId: 'usr-new' }));
    const caregiver = {
      displayName: 'CG สมมติ', username: 'cg.new', password: 'long enough password', cid: '1100000000002', birthDate: '1980-05-01', phone: '0812345678',
      address: '12 ม.2 ต.ทดสอบ', email: '', education: 'BACHELOR', organization: { name: 'รพ.สต. ทดสอบ', type: 'HOSPITAL', serviceArea: '' }, trainings: []
    };
    const response = await call(request('/admin/caregivers', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json(caregiver) }), env);
    expect(response.status).toBe(200);
    expect(calls[0]).toMatchObject({ action: 'caregiver.create', payload: { username: 'cg.new', cidCiphertext: expect.any(String), cidLookupHash: expect.any(String) } });
    expect(JSON.stringify(calls[0]!.payload)).not.toContain(caregiver.cid);
  });

  it('shows only the last four CID digits when loading a caregiver for editing', async () => {
    const env = makeEnv();
    const cookie = await loginAs(env, adminActor);
    const cidCiphertext = await encryptCid('1100000000002', env.CID_ENCRYPTION_KEY_BASE64);
    stubGas(() => ({ userId: 'usr-cg', displayName: 'CG', cidCiphertext }));
    const response = await call(request('/admin/caregivers/get', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json({ userId: 'usr-cg' }) }), env);
    const data = (await body(response)).data as Record<string, unknown>;
    expect(data).toMatchObject({ userId: 'usr-cg', cidLast4: '0002' });
    expect(data).not.toHaveProperty('cidCiphertext');
    expect(JSON.stringify(data)).not.toContain('1100000000002');
  });

  it('shows only the last four CID digits of a patient and encrypts a replacement', async () => {
    const env = makeEnv();
    const cookie = await loginAs(env, cmActor);
    const cidCiphertext = await encryptCid('1100000000077', env.CID_ENCRYPTION_KEY_BASE64);
    const calls = stubGas((gasCall) => (gasCall.action === 'patient.get' ? { patientId: 'pt-1', hn: 'HN-1', cidCiphertext } : { patientId: 'pt-1', recordVersion: 2 }));
    const loaded = await call(request('/patients/get', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json({ patientId: 'pt-1' }) }), env);
    const data = (await body(loaded)).data as Record<string, unknown>;
    expect(data).toMatchObject({ hn: 'HN-1', cidLast4: '0077' });
    expect(JSON.stringify(data)).not.toMatch(/1100000000077|cidCiphertext/);
    const update = { patientId: 'pt-1', recordVersion: 1, status: 'ACTIVE', hn: 'HN-1', cid: '1100000000088', fullName: 'นางสมมติ', birthDate: '1945-03-15', sex: 'FEMALE', address: '12' };
    const saved = await call(request('/patients/update', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json(update) }), env);
    expect(saved.status).toBe(200);
    expect(calls[1]).toMatchObject({ action: 'patient.update', payload: { cidCiphertext: expect.any(String), cidLookupHash: expect.any(String) } });
    expect(JSON.stringify(calls[1]!.payload)).not.toContain('1100000000088');
  });

  it('lets an ADMIN register and edit patients but not a CG', async () => {
    const env = makeEnv();
    const patient = { localCode: 'L-1', hn: 'HN-1', cid: '1100000000001', fullName: 'นางสมมติ', birthDate: '1945-03-15', sex: 'FEMALE', address: '12', careManagerId: 'usr-cm', legalBasis: 'PUBLIC_HEALTH', privacyNoticeVersion: 'v1' };
    const cgCookie = await loginAs(env, cgActor);
    const denied = await call(request('/patients', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cgCookie}` }, body: json(patient) }), env);
    expect(denied.status).toBe(403);
    const cookie = await loginAs(env, adminActor);
    const calls = stubGas((gasCall) => (gasCall.action === 'patient.create' ? { status: 'CREATED', patient: { patientId: 'pt-1' } } : { patientId: 'pt-1', hn: 'HN-1' }));
    const created = await call(request('/patients', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json(patient) }), env);
    expect(created.status).toBe(200);
    const loaded = await call(request('/patients/get', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json({ patientId: 'pt-1' }) }), env);
    expect(loaded.status).toBe(200);
    expect(calls.map((gasCall) => gasCall.action)).toEqual(['patient.create', 'patient.get']);
  });

  it('maps GAS failures to meaningful statuses without leaking internal codes', async () => {
    const env = makeEnv();
    const cookie = await loginAs(env, cmActor);
    const review = { encounterId: 'enc-1', decision: 'VERIFIED', recordVersion: 1 };
    stubGas(() => { throw new Error('VERSION_CONFLICT'); });
    const conflict = await call(request('/encounter-reviews', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json(review) }), env);
    expect(conflict.status).toBe(409);
    stubGas(() => { throw new Error('SHEET_MISSING:VisitEncounters'); });
    const internal = await call(request('/encounter-reviews', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json(review) }), env);
    expect(internal.status).toBe(502);
    expect((await body(internal)).code).toBe('UPSTREAM_FAILED');
  });
});

describe('password login', () => {
  it('returns 400 for malformed JSON and 401 for wrong credentials', async () => {
    const env = makeEnv();
    const malformed = await call(request('/auth/password/login', { method: 'POST', body: '{' }), env);
    expect(malformed.status).toBe(400);
    stubGas(() => { throw new Error('INVALID_CREDENTIALS'); });
    const wrong = await call(request('/auth/password/login', { method: 'POST', body: json({ identifier: 'cg', password: 'wrong password!' }) }), env);
    expect(wrong.status).toBe(401);
    expect((await body(wrong)).code).toBe('INVALID_CREDENTIALS');
  });

  it('rate limits with 429 and resets the counter after a successful login', async () => {
    const env = makeEnv();
    stubGas(() => { throw new Error('INVALID_CREDENTIALS'); });
    const attempt = () => call(request('/auth/password/login', { method: 'POST', body: json({ identifier: 'usr-cg', password: 'wrong password!' }) }), env);
    for (let index = 0; index < 4; index += 1) expect((await attempt()).status).toBe(401);
    stubGas(() => cgActor);
    const ok = await call(request('/auth/password/login', { method: 'POST', body: json({ identifier: 'usr-cg', password: 'correct horse battery' }) }), env);
    expect(ok.status).toBe(200);
    stubGas(() => { throw new Error('INVALID_CREDENTIALS'); });
    for (let index = 0; index < 5; index += 1) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });

  it('rejects a TOTP code that was already used', async () => {
    const env = makeEnv();
    await loginAs(env, cmActor);
    const secret = 'JBSWY3DPEHPK3PXP';
    stubGas(() => cmActor);
    const replay = await call(request('/auth/password/login', {
      method: 'POST', body: json({ identifier: 'usr-cm', password: 'correct horse battery', totpCode: await totpCode(secret, Math.floor(Date.now() / 30_000)) })
    }), env);
    expect(replay.status).toBe(401);
    expect((await body(replay)).code).toBe('MFA_INVALID');
  });

  it('offers enrolment instead of a session when the user has no TOTP yet', async () => {
    const env = makeEnv();
    stubGas(() => cmActor);
    const response = await call(request('/auth/password/login', { method: 'POST', body: json({ identifier: 'cm.one', password: 'correct horse battery', totpCode: '123456' }) }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect((await body(response)).data).toMatchObject({ status: 'MFA_ENROLLMENT_REQUIRED', accountLabel: 'cm.one' });
    expect(env.SECURITY_DB.userSecurity.size).toBe(0);
  });
});

async function startEnrollment(env: ReturnType<typeof makeEnv>, actor: typeof cmActor | typeof cgActor) {
  stubGas(() => actor);
  const response = await call(request('/auth/password/login', { method: 'POST', body: json({ identifier: actor.userId, password: 'correct horse battery' }) }), env);
  return (await body(response)).data as { enrollmentToken: string; secret: string; otpauthUri: string };
}

describe('TOTP self-enrolment', () => {
  it('stores the secret and signs in once the user proves a current code', async () => {
    const env = makeEnv();
    const challenge = await startEnrollment(env, cmActor);
    expect(challenge.otpauthUri).toContain(`secret=${challenge.secret}`);
    const enroll = await call(request('/auth/mfa/enroll', { method: 'POST', body: json({ enrollmentToken: challenge.enrollmentToken, totpCode: await totpCode(challenge.secret, Math.floor(Date.now() / 30_000)) }) }), env);
    expect(enroll.status).toBe(200);
    expect(enroll.headers.get('set-cookie')).toContain('__Host-ltc_session=');
    expect(env.SECURITY_DB.userSecurity.get('usr-cm')).toMatchObject({ mfa_enabled: 1 });
    expect(env.SECURITY_DB.securityEvents.map((event) => event.event_type)).toContain('MFA_ENROLLED');
    // The token is single-use.
    const again = await call(request('/auth/mfa/enroll', { method: 'POST', body: json({ enrollmentToken: challenge.enrollmentToken, totpCode: '000000' }) }), env);
    expect((await body(again)).code).toBe('MFA_ENROLLMENT_EXPIRED');
  });

  it('drops the pending enrolment after five wrong codes', async () => {
    const env = makeEnv();
    const challenge = await startEnrollment(env, cmActor);
    const now = Math.floor(Date.now() / 30_000);
    const valid = new Set(await Promise.all([now - 1, now, now + 1].map((counter) => totpCode(challenge.secret, counter))));
    const wrong = ['000000', '111111', '222222', '333333'].find((code) => !valid.has(code))!;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await call(request('/auth/mfa/enroll', { method: 'POST', body: json({ enrollmentToken: challenge.enrollmentToken, totpCode: wrong }) }), env);
      expect((await body(response)).code).toBe('MFA_INVALID');
    }
    const late = await call(request('/auth/mfa/enroll', { method: 'POST', body: json({ enrollmentToken: challenge.enrollmentToken, totpCode: await totpCode(challenge.secret, now) }) }), env);
    expect((await body(late)).code).toBe('MFA_ENROLLMENT_EXPIRED');
    expect(env.SECURITY_DB.userSecurity.size).toBe(0);
  });

  it('never replaces a TOTP that was enrolled in the meantime', async () => {
    const env = makeEnv();
    const first = await startEnrollment(env, cmActor);
    const second = await startEnrollment(env, cmActor);
    const now = Math.floor(Date.now() / 30_000);
    await call(request('/auth/mfa/enroll', { method: 'POST', body: json({ enrollmentToken: first.enrollmentToken, totpCode: await totpCode(first.secret, now) }) }), env);
    const response = await call(request('/auth/mfa/enroll', { method: 'POST', body: json({ enrollmentToken: second.enrollmentToken, totpCode: await totpCode(second.secret, now) }) }), env);
    expect(response.status).toBe(409);
    expect((await body(response)).code).toBe('MFA_ALREADY_ENROLLED');
  });

  it("lets a user manager reset another user's TOTP and ends that user's sessions", async () => {
    const env = makeEnv();
    const cgCookie = await loginAs(env, cgActor);
    const cmCookie = await loginAs(env, cmActor);
    const reset = await call(request('/admin/users/mfa-reset', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cmCookie}` }, body: json({ userId: 'usr-cg' }) }), env);
    expect(reset.status).toBe(200);
    expect(env.SECURITY_DB.userSecurity.has('usr-cg')).toBe(false);
    const me = await call(request('/auth/me', { headers: { cookie: `__Host-ltc_session=${cgCookie}` } }), env);
    expect(me.status).toBe(401);
  });

  it('refuses a TOTP reset without users:manage', async () => {
    const env = makeEnv();
    const cookie = await loginAs(env, cgActor);
    const reset = await call(request('/admin/users/mfa-reset', { method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}` }, body: json({ userId: 'usr-cm' }) }), env);
    expect(reset.status).toBe(403);
  });
});

describe('PILOT with password sign-in', () => {
  const origin = 'https://ltc-demo.example.org';
  const pilot = () => makeEnv({ APP_MODE: 'PILOT', APP_ORIGIN: origin, PASSWORD_AUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: undefined });
  const pilotRequest = (path: string, init: RequestInit = {}) => request(path, { ...init, headers: { ...init.headers as Record<string, string>, origin } });

  it('starts without Google settings and reports the sign-in methods', async () => {
    const response = await call(pilotRequest('/health'), pilot());
    expect((await body(response)).data).toEqual({ mode: 'PILOT', passwordAuth: true, googleAuth: false });
  });

  it('starts with a GOOGLE_CLIENT_ID left over from the DEMO but keeps Google sign-in closed', async () => {
    const env = makeEnv({ APP_MODE: 'PILOT', APP_ORIGIN: origin, PASSWORD_AUTH_ENABLED: 'true' });
    expect((await body(await call(pilotRequest('/health'), env))).data).toEqual({ mode: 'PILOT', passwordAuth: true, googleAuth: false });
    expect((await call(pilotRequest('/auth/google', { method: 'POST', body: json({ idToken: 'x' }) }), env)).status).toBe(404);
  });

  it('requires TOTP from caregivers too', async () => {
    stubGas(() => cgActor);
    const response = await call(pilotRequest('/auth/password/login', { method: 'POST', body: json({ identifier: 'cg.one', password: 'correct horse battery' }) }), pilot());
    expect((await body(response)).data).toMatchObject({ status: 'MFA_ENROLLMENT_REQUIRED' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('keeps Google sign-in closed when it is not configured', async () => {
    const response = await call(pilotRequest('/auth/google', { method: 'POST', body: json({ idToken: 'x' }) }), pilot());
    expect(response.status).toBe(404);
  });

  it('closes password sign-in unless it is enabled', async () => {
    const env = makeEnv({ APP_MODE: 'PILOT', APP_ORIGIN: origin, GOOGLE_HOSTED_DOMAIN: 'org.example' });
    const response = await call(pilotRequest('/auth/password/login', { method: 'POST', body: json({ identifier: 'x', password: 'y' }) }), env);
    expect(response.status).toBe(404);
  });

  it('fails closed when neither sign-in method is configured', async () => {
    const env = makeEnv({ APP_MODE: 'PILOT', APP_ORIGIN: origin, GOOGLE_CLIENT_ID: undefined });
    const response = await call(pilotRequest('/health'), env);
    expect(response.status).toBe(500);
  });
});

describe('export re-authentication', () => {
  it('explains that a fresh login is the only way to re-authenticate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const env = makeEnv({ PHI_EXPORT_ENABLED: 'true' });
    const cookie = await loginAs(env, cmActor);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    const response = await call(request('/exports/patients.csv', {
      method: 'POST', headers: { cookie: `__Host-ltc_session=${cookie}`, 'x-export-reason': 'quarterly payer reconciliation' }
    }), env);
    expect(response.status).toBe(401);
    const result = await response.json() as { code: string; message: string };
    expect(result.code).toBe('REAUTH_REQUIRED');
    expect(result.message).toContain('เข้าสู่ระบบใหม่');
  });
});

describe('server-side failures', () => {
  it('answers a generic 500 but logs the real reason for the operator', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv({ GATEWAY_ASSERTION_SECRET: undefined as unknown as string });
    const calls = stubGas(() => ({}));
    const response = await call(request('/auth/password/login', { method: 'POST', body: json({ identifier: 'x', password: 'y'.repeat(12) }) }), env);
    expect(response.status).toBe(500);
    expect(await body(response)).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(calls).toHaveLength(0);
    expect(errors.mock.calls.map(([line]) => String(line)).join('\n')).toContain('MISSING_SECRET:GATEWAY_ASSERTION_SECRET');
    errors.mockRestore();
  });
});
