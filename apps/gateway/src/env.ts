export interface Env {
  APP_MODE: 'DEMO' | 'PILOT';
  APP_ORIGIN?: string;
  GAS_EXEC_URL: string;
  GATEWAY_ASSERTION_SECRET: string;
  CID_ENCRYPTION_KEY_BASE64: string;
  CID_LOOKUP_SECRET: string;
  MFA_ENCRYPTION_KEY_BASE64: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_HOSTED_DOMAIN?: string;
  PHI_EXPORT_ENABLED?: 'true' | 'false';
  SECURITY_DB: D1Database;
  SECURITY_KV: KVNamespace;
}

const placeholders = ['replace-me', 'replace-with-', 'example.go.th', 'REPLACE_ME'];

function assertSecret(name: string, value: string, minimumLength = 32): void {
  if (!value || value.length < minimumLength || placeholders.some((placeholder) => value.includes(placeholder))) {
    throw new Error(`INVALID_CONFIG:${name}`);
  }
}

export function isDemoMode(env: Env): boolean {
  return env.APP_MODE === 'DEMO';
}

export function assertOperationalMode(env: Env): void {
  if (!['DEMO', 'PILOT'].includes(env.APP_MODE)) throw new Error('UNSUPPORTED_APP_MODE');
  if (env.APP_MODE === 'DEMO') return;

  if (!env.APP_ORIGIN?.startsWith('https://')) throw new Error('INVALID_CONFIG:APP_ORIGIN');
  const gasUrl = new URL(env.GAS_EXEC_URL);
  if (gasUrl.protocol !== 'https:' || gasUrl.hostname !== 'script.google.com' || !gasUrl.pathname.endsWith('/exec')) {
    throw new Error('INVALID_CONFIG:GAS_EXEC_URL');
  }
  if (!env.GOOGLE_HOSTED_DOMAIN || placeholders.includes(env.GOOGLE_HOSTED_DOMAIN)) {
    throw new Error('INVALID_CONFIG:GOOGLE_HOSTED_DOMAIN');
  }
  assertSecret('GATEWAY_ASSERTION_SECRET', env.GATEWAY_ASSERTION_SECRET);
  assertSecret('CID_LOOKUP_SECRET', env.CID_LOOKUP_SECRET);
  assertSecret('CID_ENCRYPTION_KEY_BASE64', env.CID_ENCRYPTION_KEY_BASE64, 40);
  assertSecret('MFA_ENCRYPTION_KEY_BASE64', env.MFA_ENCRYPTION_KEY_BASE64, 40);
  if (!env.GOOGLE_CLIENT_ID || placeholders.some((placeholder) => env.GOOGLE_CLIENT_ID.includes(placeholder))) {
    throw new Error('INVALID_CONFIG:GOOGLE_CLIENT_ID');
  }
}

