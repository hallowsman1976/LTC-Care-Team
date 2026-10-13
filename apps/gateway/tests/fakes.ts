import type { Env } from '../src/env';

// Minimal in-memory stand-ins for the D1/KV bindings and the GAS web app.
// Only the SQL statements the gateway actually issues are understood.

interface Row { [column: string]: unknown }

export class FakeD1 {
  sessions = new Map<string, Row>();
  securityEvents: Row[] = [];
  userSecurity = new Map<string, Row>();

  prepare(sql: string) {
    const db = this;
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>(): Promise<T | null> {
            if (sql.startsWith('SELECT session_json FROM sessions')) {
              const row = db.sessions.get(String(args[0]));
              return (row && row.revoked_at === null ? { session_json: row.session_json } : null) as T | null;
            }
            if (sql.startsWith('SELECT totp_secret_ciphertext FROM user_security')) {
              const row = db.userSecurity.get(String(args[0]));
              return (row && row.mfa_enabled === 1 ? { totp_secret_ciphertext: row.totp_secret_ciphertext } : null) as T | null;
            }
            throw new Error(`FakeD1: unsupported query ${sql}`);
          },
          async run(): Promise<void> {
            if (sql.startsWith('INSERT INTO sessions')) {
              db.sessions.set(String(args[1]), { session_id: args[0], session_json: args[2], created_at: args[3], revoked_at: null });
            } else if (sql.startsWith('UPDATE sessions SET session_json')) {
              const row = db.sessions.get(String(args[1]));
              if (row) row.session_json = args[0];
            } else if (sql.startsWith('UPDATE sessions SET revoked_at')) {
              const row = db.sessions.get(String(args[1]));
              if (row) row.revoked_at = args[0];
            } else if (sql.startsWith('INSERT INTO security_events')) {
              db.securityEvents.push({ event_id: args[0], actor_id: args[1], event_type: args[2], reason: args[3] });
            } else {
              throw new Error(`FakeD1: unsupported statement ${sql}`);
            }
          }
        };
      }
    };
  }
}

export class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.store.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

export interface GasCall { action: string; subject: string; payload: Record<string, unknown> }

/** Replaces global fetch with a GAS stub. The handler returns the envelope `data`, or throws to return `ok:false` with that code. */
export function stubGas(handler: (call: GasCall) => unknown): GasCall[] {
  const calls: GasCall[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { action: string; auth: { subject: string }; payload: Record<string, unknown> };
    const call = { action: body.action, subject: body.auth.subject, payload: body.payload };
    calls.push(call);
    try {
      return Response.json({ ok: true, code: 'OK', message: '', data: handler(call), requestId: 'gas' });
    } catch (error) {
      return Response.json({ ok: false, code: (error as Error).message, message: 'ไม่สามารถดำเนินการได้', data: null, requestId: 'gas' });
    }
  }) as typeof fetch;
  return calls;
}

export function makeEnv(overrides: Partial<Env> = {}): Env & { SECURITY_DB: FakeD1 & D1Database; SECURITY_KV: FakeKV & KVNamespace } {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  return {
    APP_MODE: 'DEMO',
    GAS_EXEC_URL: 'https://script.google.com/macros/s/test/exec',
    GATEWAY_ASSERTION_SECRET: 's'.repeat(32),
    CID_ENCRYPTION_KEY_BASE64: key,
    CID_LOOKUP_SECRET: 'l'.repeat(32),
    MFA_ENCRYPTION_KEY_BASE64: key,
    GOOGLE_CLIENT_ID: 'test-client',
    SECURITY_DB: new FakeD1() as unknown as FakeD1 & D1Database,
    SECURITY_KV: new FakeKV() as unknown as FakeKV & KVNamespace,
    ...overrides
  } as Env & { SECURITY_DB: FakeD1 & D1Database; SECURITY_KV: FakeKV & KVNamespace };
}

export function request(path: string, init: RequestInit & { origin?: string } = {}): Request {
  const { origin = 'https://ltc-demo.example.org', ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.method && rest.method !== 'GET') headers.set('x-ltc-request', '1');
  return new Request(`${origin}/api/v1${path}`, { ...rest, headers });
}
