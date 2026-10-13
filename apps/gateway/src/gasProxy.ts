import { requireSecret, type Env } from './env';
import { hmacBase64, sha256Hex } from './crypto';

export async function callGas(
  env: Env,
  subject: string,
  action: string,
  payload: Record<string, unknown>
): Promise<Response> {
  requireSecret(env, 'GATEWAY_ASSERTION_SECRET');
  if (!env.GAS_EXEC_URL) throw new Error('MISSING_CONFIG:GAS_EXEC_URL');
  const requestId = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60;
  const canonicalPayload = JSON.stringify(payload);
  const bodyHash = await sha256Hex(canonicalPayload);
  const canonical = [action, subject, String(iat), String(exp), nonce, bodyHash].join('\n');
  const signature = await hmacBase64(requireSecret(env, 'GATEWAY_ASSERTION_SECRET'), canonical);
  const envelope = {
    apiVersion: 'v1', action, requestId,
    auth: { subject, iat, exp, nonce, bodyHash, signature },
    payload
  };
  return fetch(env.GAS_EXEC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
    redirect: 'follow'
  });
}

