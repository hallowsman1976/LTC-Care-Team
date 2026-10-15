export interface Env {
  APP_MODE: 'DEMO' | 'PILOT';
  APP_ORIGIN?: string;
  GAS_EXEC_URL: string;
  GATEWAY_ASSERTION_SECRET: string;
  CID_ENCRYPTION_KEY_BASE64: string;
  CID_LOOKUP_SECRET: string;
  MFA_ENCRYPTION_KEY_BASE64: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_HOSTED_DOMAIN?: string;
  /** PILOT without Google Workspace: username/password sign-in with TOTP for every role. */
  PASSWORD_AUTH_ENABLED?: 'true' | 'false';
  PHI_EXPORT_ENABLED?: 'true' | 'false';
  /** Local development only: honour the x-demo-role header for requests addressed to localhost. */
  DEMO_IMPERSONATION?: 'true' | 'false';
  SECURITY_DB: D1Database;
  SECURITY_KV: KVNamespace;
}

const placeholders = ['replace-me', 'replace-with-', 'example.go.th', 'REPLACE_ME'];

function assertSecret(name: string, value: string, minimumLength = 32): void {
  if (!value || value.length < minimumLength || placeholders.some((placeholder) => value.includes(placeholder))) {
    throw new Error(`INVALID_CONFIG:${name}`);
  }
}

type SecretName = 'GATEWAY_ASSERTION_SECRET' | 'CID_ENCRYPTION_KEY_BASE64' | 'CID_LOOKUP_SECRET' | 'MFA_ENCRYPTION_KEY_BASE64';

/** Returns a Worker secret or throws a code that names it (logged, never shown to the client). */
export function requireSecret(env: Env, name: SecretName): string {
  const value = env[name];
  if (!value) throw new Error(`MISSING_SECRET:${name}`);
  return value;
}

export function isDemoMode(env: Env): boolean {
  return env.APP_MODE === 'DEMO';
}

/** DEMO always signs in with a password; PILOT only when PASSWORD_AUTH_ENABLED=true. */
export function isPasswordAuthEnabled(env: Env): boolean {
  return isDemoMode(env) || env.PASSWORD_AUTH_ENABLED === 'true';
}

/** Google sign-in needs a client id, and in PILOT also the Workspace domain it is limited to. */
export function isGoogleAuthEnabled(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID) && (isDemoMode(env) || Boolean(env.GOOGLE_HOSTED_DOMAIN));
}

/** With real data every role proves a second factor; the DEMO keeps it to ADMIN and CM. */
export function requiresTotp(env: Env, role: string): boolean {
  return !isDemoMode(env) || role === 'ADMIN' || role === 'CM';
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True only for `wrangler dev` with DEMO_IMPERSONATION=true in .dev.vars. A deployed Worker is never
 * addressed as localhost, so a stray flag in production cannot turn the role header into a bypass.
 */
export function isLocalDemo(request: Request, env: Env): boolean {
  return isDemoMode(env) && env.DEMO_IMPERSONATION === 'true' && LOCAL_HOSTS.has(new URL(request.url).hostname);
}

export function assertOperationalMode(env: Env): void {
  if (!['DEMO', 'PILOT'].includes(env.APP_MODE)) throw new Error('UNSUPPORTED_APP_MODE');
  if (env.APP_MODE === 'DEMO') return;

  if (!env.APP_ORIGIN?.startsWith('https://')) throw new Error('INVALID_CONFIG:APP_ORIGIN');
  const gasUrl = new URL(env.GAS_EXEC_URL);
  if (gasUrl.protocol !== 'https:' || gasUrl.hostname !== 'script.google.com' || !gasUrl.pathname.endsWith('/exec')) {
    throw new Error('INVALID_CONFIG:GAS_EXEC_URL');
  }
  assertSecret('GATEWAY_ASSERTION_SECRET', env.GATEWAY_ASSERTION_SECRET);
  assertSecret('CID_LOOKUP_SECRET', env.CID_LOOKUP_SECRET);
  assertSecret('CID_ENCRYPTION_KEY_BASE64', env.CID_ENCRYPTION_KEY_BASE64, 40);
  assertSecret('MFA_ENCRYPTION_KEY_BASE64', env.MFA_ENCRYPTION_KEY_BASE64, 40);
  if (env.PASSWORD_AUTH_ENABLED === 'true' && !env.GOOGLE_CLIENT_ID) return;
  // Google sign-in: configured completely and limited to the organisation's Workspace domain.
  if (!env.GOOGLE_HOSTED_DOMAIN || placeholders.includes(env.GOOGLE_HOSTED_DOMAIN)) {
    throw new Error('INVALID_CONFIG:GOOGLE_HOSTED_DOMAIN');
  }
  if (!env.GOOGLE_CLIENT_ID || placeholders.some((placeholder) => env.GOOGLE_CLIENT_ID?.includes(placeholder))) {
    throw new Error('INVALID_CONFIG:GOOGLE_CLIENT_ID');
  }
}

