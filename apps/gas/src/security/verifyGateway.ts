import { getRequiredProperty, getSpreadsheet } from '../config';
import { constantTimeEqual, bytesToHex } from '../utils/encoding';
import { apiRequestSchema } from '@smart-ltc/shared';

export interface TrustedRequest {
  action: string;
  requestId: string;
  subject: string;
  payload: Record<string, unknown>;
}

function canonicalPayload(payload: Record<string, unknown>): string {
  // The gateway and GAS accept only JSON-compatible payloads. Key order is preserved in transit.
  return JSON.stringify(payload);
}

export function verifyGatewayRequest(value: unknown): TrustedRequest {
  const request = apiRequestSchema.parse(value);
  const now = Math.floor(Date.now() / 1000);
  if (request.auth.exp <= now || request.auth.iat > now + 30 || request.auth.exp - request.auth.iat > 90) {
    throw new Error('EXPIRED_ASSERTION');
  }
  const payloadText = canonicalPayload(request.payload);
  const actualBodyHash = bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payloadText));
  if (!constantTimeEqual(actualBodyHash, request.auth.bodyHash)) throw new Error('BODY_BINDING_FAILED');
  const canonical = [request.action, request.auth.subject, String(request.auth.iat), String(request.auth.exp), request.auth.nonce, request.auth.bodyHash].join('\n');
  const expected = Utilities.base64Encode(Utilities.computeHmacSha256Signature(canonical, getRequiredProperty('GATEWAY_ASSERTION_SECRET')));
  if (!constantTimeEqual(expected, request.auth.signature)) throw new Error('INVALID_ASSERTION');
  consumeNonce(request.auth.nonce, request.auth.exp);
  return { action: request.action, requestId: request.requestId, subject: request.auth.subject, payload: request.payload };
}

function consumeNonce(nonce: string, expiresAt: number): void {
  const cache = CacheService.getScriptCache();
  if (cache.get(`nonce:${nonce}`)) throw new Error('REPLAYED_ASSERTION');
  const lock = LockService.getScriptLock();
  lock.waitLock(5_000);
  try {
    if (cache.get(`nonce:${nonce}`)) throw new Error('REPLAYED_ASSERTION');
    const sheet = getSpreadsheet().getSheetByName('GatewayNonces');
    if (!sheet) throw new Error('NONCE_STORE_MISSING');
    const values = sheet.getDataRange().getValues();
    const now = Math.floor(Date.now() / 1000);
    if (values.slice(1).some((row) => String(row[0]) === nonce && Number(row[1]) >= now)) throw new Error('REPLAYED_ASSERTION');
    sheet.appendRow([nonce, expiresAt, new Date().toISOString()]);
    if (sheet.getLastRow() > 1_000) {
      const expiredRows = values.slice(1).map((row, index) => ({ row: index + 2, expiresAt: Number(row[1]) }))
        .filter((entry) => entry.expiresAt < now).slice(0, 100).reverse();
      for (const entry of expiredRows) sheet.deleteRow(entry.row);
    }
    cache.put(`nonce:${nonce}`, '1', Math.max(60, expiresAt - Math.floor(Date.now() / 1000) + 60));
  } finally {
    lock.releaseLock();
  }
}

