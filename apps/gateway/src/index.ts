import { DEMO_ACTORS, patientCreateSchema, READ_ROUTES, WRITE_ROUTES, type Actor, type Capability, type Page } from '@smart-ltc/shared';
import type { Env } from './env';
import { assertOperationalMode, isDemoMode, isLocalDemo } from './env';
import { isSupportedBrowser } from './browser';
import { failure, json } from './responses';
import { createSession, expiredSessionCookie, loadSession, revokeSession, sessionCookie } from './session';
import { callGas } from './gasProxy';
import { enforceLoginRateLimit, resetLoginRateLimit, verifyGoogleToken, verifyPasswordAtGas, verifyTotp } from './auth';
import { decryptCid, encryptCid, hmacBase64 } from './crypto';
import { errorResponse, gasData, readGasEnvelope, relayGas } from './errors';

function routePath(request: Request): string {
  return new URL(request.url).pathname.replace(/^\/api\/v1/, '');
}

function assertTrustedMutation(request: Request, env: Env): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('x-ltc-request') !== '1') throw new Error('CSRF_CHECK_FAILED');
  if (isLocalDemo(request, env)) return;
  // PILOT always requires APP_ORIGIN (see assertOperationalMode); a deployed DEMO enforces it when set.
  if (!env.APP_ORIGIN && isDemoMode(env)) return;
  if (request.headers.get('origin') !== env.APP_ORIGIN) throw new Error('ORIGIN_NOT_ALLOWED');
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

const ok = <T>(data: T, requestId: string, headers?: HeadersInit) => json(200, { ok: true, code: 'OK', message: '', data, requestId }, headers);
const has = (actor: Actor, capability: Capability) => actor.capabilities.includes(capability);

async function handle(request: Request, env: Env): Promise<Response> {
  assertOperationalMode(env);
  assertTrustedMutation(request, env);
  const requestId = crypto.randomUUID();
  const path = routePath(request);
  const localDemo = isLocalDemo(request, env);

  if (path === '/health') return ok({ mode: env.APP_MODE }, requestId);
  if (path === '/browser-support') return ok({ supported: isSupportedBrowser(request.headers.get('user-agent') ?? '') }, requestId);

  if (path === '/auth/password/login' && request.method === 'POST') {
    if (!isDemoMode(env)) return failure(404, 'NOT_FOUND', 'ไม่พบรายการที่ร้องขอ', requestId);
    const body = await request.json<{ identifier?: string; password?: string; totpCode?: string }>();
    const identifier = String(body.identifier ?? '').trim();
    await enforceLoginRateLimit(request, identifier, env);
    const actor = await verifyPasswordAtGas(identifier, String(body.password ?? ''), env);
    if (['ADMIN', 'CM'].includes(actor.role) && !await verifyTotp(actor.userId, String(body.totpCode ?? ''), env)) {
      throw new Error('MFA_INVALID');
    }
    await resetLoginRateLimit(request, identifier, env);
    const created = await createSession(actor, env);
    return ok(actor, requestId, { 'set-cookie': sessionCookie(created.token) });
  }
  if (path === '/auth/google' && request.method === 'POST') {
    const body = await request.json<{ idToken?: string }>();
    const subject = await verifyGoogleToken(String(body.idToken ?? ''), env);
    const envelope = await readGasEnvelope<Actor>(await callGas(env, 'anonymous', 'auth.resolveIdentity', { subject }));
    if (!envelope.ok || !envelope.data) return failure(401, 'IDENTITY_NOT_ALLOWED', 'บัญชีนี้ไม่ได้รับอนุญาต', requestId);
    const created = await createSession(envelope.data, env);
    await env.SECURITY_DB.prepare('INSERT INTO security_events (event_id, actor_id, event_type, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), envelope.data.userId, 'LOGIN_GOOGLE', env.GOOGLE_HOSTED_DOMAIN ?? '', new Date().toISOString()).run();
    return ok(envelope.data, requestId, { 'set-cookie': sessionCookie(created.token) });
  }

  const demoRole = localDemo ? request.headers.get('x-demo-role')?.toLowerCase() : undefined;
  const demoActor = demoRole ? DEMO_ACTORS[demoRole] : undefined;
  const session = demoActor ? { actor: demoActor, authTime: Date.now() } : await loadSession(request, env);
  if (!session) return failure(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ', requestId);
  const { actor } = session;

  if (path === '/auth/logout' && request.method === 'POST') {
    await revokeSession(request, env);
    return ok({ loggedOut: true }, requestId, { 'set-cookie': expiredSessionCookie() });
  }
  if (path === '/auth/me' && request.method === 'GET') return ok(actor, requestId);

  const read = READ_ROUTES[path];
  if (read && request.method === 'GET') {
    if (read.capability && !has(actor, read.capability)) return failure(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', requestId);
    if (localDemo) return ok(read.demo(actor), requestId);
    return ok(await gasData<unknown>(await callGas(env, actor.userId, read.action, read.payload ?? {})), requestId);
  }

  const write = WRITE_ROUTES[path];
  if (write && request.method === 'POST') {
    if (!has(actor, write.capability)) return failure(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', requestId);
    const input = write.schema.parse(await request.json());
    if (localDemo) return ok({ demo: true, ...write.demo(input) }, requestId);
    return relayGas(await callGas(env, actor.userId, write.action, input), requestId);
  }

  if (path === '/patients' && request.method === 'POST') {
    if (actor.role !== 'CM' || !has(actor, 'patients:write')) return failure(403, 'FORBIDDEN', 'ไม่มีสิทธิ์เพิ่มผู้รับบริการ', requestId);
    const input = patientCreateSchema.parse(await request.json());
    if (localDemo) return ok({ demo: true, status: 'CREATED', patient: { patientId: crypto.randomUUID(), localCode: input.localCode } }, requestId);
    if (!isDemoMode(env) && (!input.legalBasis || !input.privacyNoticeVersion)) {
      return failure(400, 'LEGAL_BASIS_REQUIRED', 'ต้องระบุฐานกฎหมายและเวอร์ชันประกาศความเป็นส่วนตัว', requestId);
    }
    const cidCiphertext = await encryptCid(input.cid, env.CID_ENCRYPTION_KEY_BASE64);
    const cidLookupHash = await hmacBase64(env.CID_LOOKUP_SECRET, input.cid);
    const { cid: _discarded, ...safeInput } = input;
    return relayGas(await callGas(env, actor.userId, 'patient.create', { ...safeInput, cidCiphertext, cidLookupHash }), requestId);
  }

  if (path === '/exports/patients.csv' && request.method === 'POST') {
    if (env.PHI_EXPORT_ENABLED !== 'true') return failure(403, 'EXPORT_DISABLED', 'ยังไม่เปิดใช้งานการส่งออกข้อมูล', requestId);
    if (actor.role !== 'CM' || !has(actor, 'export:phi')) return failure(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ส่งออกข้อมูล', requestId);
    // There is no step-up endpoint yet (deferred to Phase F); a fresh login resets authTime.
    if (Date.now() - session.authTime > 5 * 60_000) {
      return failure(401, 'REAUTH_REQUIRED', 'การส่งออกต้องยืนยันตัวตนภายใน 5 นาที กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ จากนั้นส่งออกทันที', requestId);
    }
    const reason = request.headers.get('x-export-reason')?.trim() ?? '';
    if (reason.length < 10) return failure(400, 'EXPORT_REASON_REQUIRED', 'กรุณาระบุเหตุผล', requestId);
    const rows = await gasData<Page<Record<string, unknown>>>(await callGas(env, actor.userId, 'patient.export', {}));
    const lines = ['HN,CID,Full Name,Birth Date'];
    const escape = (value: string) => {
      const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
      return `"${neutralized.replace(/"/g, '""')}"`;
    };
    for (const row of rows.items) {
      const cid = await decryptCid(String(row.cidCiphertext), env.CID_ENCRYPTION_KEY_BASE64);
      lines.push([row.hn, cid, row.fullName, row.birthDate].map((value) => escape(String(value ?? ''))).join(','));
    }
    await env.SECURITY_DB.prepare('INSERT INTO security_events (event_id, actor_id, event_type, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), actor.userId, 'PATIENT_EXPORT', reason, new Date().toISOString()).run();
    const label = isDemoMode(env) ? `# DEMO ONLY ${new Date().toISOString()}\r\n` : '';
    return new Response(`﻿${label}${lines.join('\r\n')}`, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="smart-ltc-patients.csv"', 'cache-control': 'no-store', ...(isDemoMode(env) ? { 'x-demo-only': 'true' } : {}) }
    });
  }
  return failure(404, 'NOT_FOUND', 'ไม่พบรายการที่ร้องขอ', requestId);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return secure(await handle(request, env));
    } catch (error) {
      return secure(errorResponse(error));
    }
  }
} satisfies ExportedHandler<Env>;

