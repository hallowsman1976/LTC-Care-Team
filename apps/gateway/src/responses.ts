import type { ApiEnvelope } from '@smart-ltc/shared';

export function json<T>(status: number, envelope: ApiEnvelope<T>, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  responseHeaders.set('cache-control', 'no-store');
  responseHeaders.set('x-content-type-options', 'nosniff');
  responseHeaders.set('referrer-policy', 'no-referrer');
  responseHeaders.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  return new Response(JSON.stringify(envelope), { status, headers: responseHeaders });
}

export function failure(status: number, code: string, message: string, requestId: string = crypto.randomUUID()): Response {
  return json(status, { ok: false, code, message, data: null, requestId });
}

