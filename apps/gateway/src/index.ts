import type { Env } from './env';
import { assertOperationalMode, isDemoMode } from './env';
import { isSupportedBrowser } from './browser';
import { demoActors, demoDashboard, demoPatients } from './demo';
import { failure, json } from './responses';
import { expiredSessionCookie, loadSession, revokeSession } from './session';
import { callGas } from './gasProxy';
import { createSession, sessionCookie } from './session';
import { enforceLoginRateLimit, verifyGoogleToken, verifyPasswordAtGas, verifyTotp } from './auth';
import { decryptCid, encryptCid, hmacBase64 } from './crypto';
import { patientCreateSchema } from '@smart-ltc/shared';

function routePath(request: Request): string {
  return new URL(request.url).pathname.replace(/^\/api\/v1/, '');
}

function assertTrustedMutation(request: Request, env: Env): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('x-ltc-request') !== '1') throw new Error('CSRF_CHECK_FAILED');
  if (isDemoMode(env)) return;
  const origin = request.headers.get('origin');
  if (!origin || origin !== env.APP_ORIGIN) throw new Error('ORIGIN_NOT_ALLOWED');
}

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', headers.get('cache-control') ?? 'no-store');
  headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function gasData<T>(response: Response): Promise<T> {
  const result = await response.json() as import('@smart-ltc/shared').ApiEnvelope<T>;
  if (!result.ok || result.data === null) throw new Error(result.code || 'UPSTREAM_FAILED');
  return result.data;
}

async function handle(request: Request, env: Env): Promise<Response> {
  assertOperationalMode(env);
  assertTrustedMutation(request, env);
  const requestId = crypto.randomUUID();
  const path = routePath(request);

  if (path === '/health') return json(200, { ok: true, code: 'OK', message: '', data: { mode: env.APP_MODE }, requestId });
  if (path === '/browser-support') {
    return json(200, { ok: true, code: 'OK', message: '', data: { supported: isSupportedBrowser(request.headers.get('user-agent') ?? '') }, requestId });
  }
  if (path === '/auth/password/login' && request.method === 'POST') {
    if (!isDemoMode(env)) return failure(404, 'NOT_FOUND', 'ไม่พบรายการที่ร้องขอ', requestId);
    const body = await request.json<{ identifier?: string; password?: string; totpCode?: string }>();
    const identifier = String(body.identifier ?? '').trim();
    await enforceLoginRateLimit(request, identifier, env);
    const actor = await verifyPasswordAtGas(identifier, String(body.password ?? ''), env);
    if (['ADMIN', 'CM'].includes(actor.role) && !await verifyTotp(actor.userId, String(body.totpCode ?? ''), env)) {
      return failure(401, 'MFA_INVALID', 'รหัสยืนยันไม่ถูกต้อง', requestId);
    }
    const created = await createSession(actor, env);
    return json(200, { ok: true, code: 'OK', message: '', data: actor, requestId }, { 'set-cookie': sessionCookie(created.token) });
  }
  if (path === '/auth/google' && request.method === 'POST') {
    const body = await request.json<{ idToken?: string }>();
    const subject = await verifyGoogleToken(String(body.idToken ?? ''), env);
    const gasResponse = await callGas(env, 'anonymous', 'auth.resolveIdentity', { subject });
    const gasEnvelope = await gasResponse.json() as import('@smart-ltc/shared').ApiEnvelope<import('@smart-ltc/shared').Actor>;
    if (!gasEnvelope.ok || !gasEnvelope.data) return failure(401, 'IDENTITY_NOT_ALLOWED', 'บัญชีนี้ไม่ได้รับอนุญาต', requestId);
    const created = await createSession(gasEnvelope.data, env);
    await env.SECURITY_DB.prepare('INSERT INTO security_events (event_id, actor_id, event_type, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), gasEnvelope.data.userId, 'LOGIN_GOOGLE', env.GOOGLE_HOSTED_DOMAIN ?? '', new Date().toISOString()).run();
    return json(200, { ok: true, code: 'OK', message: '', data: gasEnvelope.data, requestId }, { 'set-cookie': sessionCookie(created.token) });
  }

  // Local demo identity is explicit and cannot be enabled outside APP_MODE=DEMO.
  const demoRole = isDemoMode(env) ? request.headers.get('x-demo-role')?.toLowerCase() : undefined;
  const demoActor = demoRole ? demoActors[demoRole] : undefined;
  const session = demoActor ? { actor: demoActor, authTime: Date.now() } : await loadSession(request, env);
  if (!session) return failure(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ', requestId);

  if (path === '/auth/logout' && request.method === 'POST') {
    await revokeSession(request, env);
    return json(200, { ok: true, code: 'OK', message: '', data: { loggedOut: true }, requestId }, { 'set-cookie': expiredSessionCookie() });
  }

  if (path === '/auth/me' && request.method === 'GET') {
    return json(200, { ok: true, code: 'OK', message: '', data: session.actor, requestId });
  }
  if (path === '/dashboard' && request.method === 'GET') {
    const data = isDemoMode(env)
      ? demoDashboard
      : await gasData<Record<string, number>>(await callGas(env, session.actor.userId, 'dashboard.summary', {}));
    return json(200, { ok: true, code: 'OK', message: '', data, requestId });
  }
  if (path === '/patients' && request.method === 'GET') {
    const visible = isDemoMode(env)
      ? (session.actor.role === 'CG' ? demoPatients.slice(0, 1) : demoPatients)
      : await gasData<Record<string, unknown>[]>(await callGas(env, session.actor.userId, 'patient.list', { limit: 50 }));
    return json(200, { ok: true, code: 'OK', message: '', data: visible, requestId });
  }
  if (path === '/visits' && request.method === 'GET') {
    const data = await gasData<Record<string, unknown>[]>(await callGas(env, session.actor.userId, 'visit.list', {}));
    return json(200, { ok: true, code: 'OK', message: '', data, requestId });
  }
  if (path === '/alerts' && request.method === 'GET') {
    const data = await gasData<Record<string, unknown>[]>(await callGas(env, session.actor.userId, 'alert.list', {}));
    return json(200, { ok: true, code: 'OK', message: '', data, requestId });
  }
  if (path === '/reviews' && request.method === 'GET') {
    const data = await gasData<Record<string, unknown>[]>(await callGas(env, session.actor.userId, 'review.list', {}));
    return json(200, { ok: true, code: 'OK', message: '', data, requestId });
  }
  if (path === '/patients' && request.method === 'POST') {
    if (session.actor.role !== 'CM' || !session.actor.capabilities.includes('patients:write')) return failure(403, 'FORBIDDEN', 'ไม่มีสิทธิ์เพิ่มผู้รับบริการ', requestId);
    const input = patientCreateSchema.parse(await request.json());
    if (!isDemoMode(env) && (!input.legalBasis || !input.privacyNoticeVersion)) {
      return failure(400, 'LEGAL_BASIS_REQUIRED', 'ต้องระบุฐานกฎหมายและเวอร์ชันประกาศความเป็นส่วนตัว', requestId);
    }
    const cidCiphertext = await encryptCid(input.cid, env.CID_ENCRYPTION_KEY_BASE64);
    const cidLookupHash = await hmacBase64(env.CID_LOOKUP_SECRET, input.cid);
    const { cid: _discarded, ...safeInput } = input;
    return callGas(env, session.actor.userId, 'patient.create', { ...safeInput, cidCiphertext, cidLookupHash });
  }
  if (path === '/exports/patients.csv' && request.method === 'POST') {
    if (env.PHI_EXPORT_ENABLED !== 'true') return failure(403, 'EXPORT_DISABLED', 'ยังไม่เปิดใช้งานการส่งออกข้อมูล', requestId);
    if (session.actor.role !== 'CM' || !session.actor.capabilities.includes('export:phi')) return failure(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ส่งออกข้อมูล', requestId);
    if (Date.now() - session.authTime > 5 * 60_000) return failure(401, 'REAUTH_REQUIRED', 'กรุณายืนยันตัวตนอีกครั้ง', requestId);
    const reason = request.headers.get('x-export-reason')?.trim() ?? '';
    if (reason.length < 10) return failure(400, 'EXPORT_REASON_REQUIRED', 'กรุณาระบุเหตุผล', requestId);
    const response = await callGas(env, session.actor.userId, 'patient.export', {});
    const result = await response.json() as import('@smart-ltc/shared').ApiEnvelope<Array<Record<string, unknown>>>;
    if (!result.ok || !result.data) return failure(502, 'EXPORT_FAILED', 'ไม่สามารถส่งออกข้อมูลได้', requestId);
    const lines = ['HN,CID,Full Name,Birth Date'];
    const escape = (value: string) => {
      const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
      return `"${neutralized.replace(/"/g, '""')}"`;
    };
    for (const row of result.data) {
      const cid = await decryptCid(String(row.cidCiphertext), env.CID_ENCRYPTION_KEY_BASE64);
      lines.push([row.hn, cid, row.fullName, row.birthDate].map((value) => escape(String(value ?? ''))).join(','));
    }
    await env.SECURITY_DB.prepare('INSERT INTO security_events (event_id, actor_id, event_type, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), session.actor.userId, 'PATIENT_EXPORT', reason, new Date().toISOString()).run();
    const label = isDemoMode(env) ? `# DEMO ONLY ${new Date().toISOString()}\r\n` : '';
    return new Response(`\uFEFF${label}${lines.join('\r\n')}`, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="smart-ltc-patients.csv"', 'cache-control': 'no-store', ...(isDemoMode(env) ? { 'x-demo-only': 'true' } : {}) }
    });
  }
  if (path.startsWith('/internal/gas/') && request.method === 'POST') {
    const action = path.slice('/internal/gas/'.length);
    const payload = await request.json<Record<string, unknown>>();
    return callGas(env, session.actor.userId, action, payload);
  }
  return failure(404, 'NOT_FOUND', 'ไม่พบรายการที่ร้องขอ', requestId);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return secure(await handle(request, env));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
      const safeCode = code.startsWith('INVALID_CONFIG:') || ['UNSUPPORTED_APP_MODE', 'CSRF_CHECK_FAILED', 'ORIGIN_NOT_ALLOWED'].includes(code) ? code : 'INTERNAL_ERROR';
      const status = ['CSRF_CHECK_FAILED', 'ORIGIN_NOT_ALLOWED'].includes(code) ? 403 : 500;
      return secure(failure(status, safeCode, 'ไม่สามารถดำเนินการได้'));
    }
  }
} satisfies ExportedHandler<Env>;

