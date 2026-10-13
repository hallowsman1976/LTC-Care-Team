import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { totpCode } from '../src/auth';
import { encryptText } from '../src/crypto';
import { makeEnv, request, stubGas } from './fakes';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

const call = (req: Request, env: ReturnType<typeof makeEnv>) => worker.fetch(req, env as never);
const body = async (response: Response) => response.json() as Promise<{ ok: boolean; code: string; data: unknown }>;
const json = (value: unknown) => JSON.stringify(value);

const cmActor = { userId: 'usr-cm', role: 'CM', capabilities: ['patients:read', 'patients:write', 'adl:approve', 'classification:confirm', 'carePlan:approve', 'encounter:review', 'export:phi'] };
const cgActor = { userId: 'usr-cg', role: 'CG', capabilities: ['patients:read'] };

async function loginAs(env: ReturnType<typeof makeEnv>, actor: typeof cmActor | typeof cgActor): Promise<string> {
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

  it('asks for MFA enrolment with 403 instead of a server error', async () => {
    const env = makeEnv();
    stubGas(() => cmActor);
    const response = await call(request('/auth/password/login', { method: 'POST', body: json({ identifier: 'usr-cm', password: 'correct horse battery', totpCode: '123456' }) }), env);
    expect(response.status).toBe(403);
    expect((await body(response)).code).toBe('MFA_ENROLLMENT_REQUIRED');
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
