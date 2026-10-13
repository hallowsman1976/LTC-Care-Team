import type { ApiEnvelope } from '@smart-ltc/shared';

export function envelope<T>(ok: boolean, code: string, message: string, data: T | null, requestId: string): ApiEnvelope<T> {
  return { ok, code, message, data, requestId };
}

export function jsonOutput(value: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

