import type { Actor } from '@smart-ltc/shared';
import type { Env } from './env';
import { sha256Hex } from './crypto';

export interface Session {
  sessionId: string;
  actor: Actor;
  authTime: number;
  expiresAt: number;
  idleExpiresAt: number;
}

export function readCookie(request: Request, name: string): string | null {
  const match = request.headers.get('Cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function sessionCookie(token: string, maxAgeSeconds = 28_800): string {
  return `__Host-ltc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function expiredSessionCookie(): string {
  return '__Host-ltc_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

export async function loadSession(request: Request, env: Env): Promise<Session | null> {
  const token = readCookie(request, '__Host-ltc_session');
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.SECURITY_DB.prepare(
    'SELECT session_json FROM sessions WHERE token_hash = ? AND revoked_at IS NULL'
  ).bind(tokenHash).first<{ session_json: string }>();
  if (!row) return null;
  const session = JSON.parse(row.session_json) as Session;
  const now = Date.now();
  if (session.expiresAt <= now || session.idleExpiresAt <= now) return null;
  session.idleExpiresAt = Math.min(session.expiresAt, now + 30 * 60_000);
  await env.SECURITY_DB.prepare('UPDATE sessions SET session_json = ? WHERE token_hash = ?')
    .bind(JSON.stringify(session), tokenHash).run();
  return session;
}

export async function createSession(actor: Actor, env: Env): Promise<{ token: string; session: Session }> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBytes, (value) => value.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const session: Session = {
    sessionId: crypto.randomUUID(), actor, authTime: now,
    expiresAt: now + 8 * 60 * 60_000,
    idleExpiresAt: now + 30 * 60_000
  };
  await env.SECURITY_DB.prepare(
    'INSERT INTO sessions (session_id, token_hash, session_json, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)'
  ).bind(session.sessionId, await sha256Hex(token), JSON.stringify(session), new Date(now).toISOString()).run();
  return { token, session };
}

export async function revokeSession(request: Request, env: Env): Promise<void> {
  const token = readCookie(request, '__Host-ltc_session');
  if (!token) return;
  await env.SECURITY_DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
    .bind(new Date().toISOString(), await sha256Hex(token)).run();
}

