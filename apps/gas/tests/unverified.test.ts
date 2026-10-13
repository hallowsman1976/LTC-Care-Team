import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeGas, parseOutput, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';

const raw = (contents: string) => parseOutput(doPost({ postData: { contents } } as unknown as GoogleAppsScript.Events.DoPost));

beforeEach(() => {
  installFakeGas();
  seed('Users', [{ userId: 'usr-cg', role: 'CG', enabled: 'true' }]);
});

describe('responses to callers that have not proven they are the gateway', () => {
  it('return one generic code whatever went wrong', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forged = JSON.parse(String((signedEvent('visit.list', 'usr-cg', {}) as unknown as { postData: { contents: string } }).postData.contents));
    forged.auth.signature = 'A'.repeat(44);
    const results = [
      raw(''),
      raw('{not json'),
      raw('{}'),
      raw(JSON.stringify(forged))
    ];
    installFakeGas({ APP_MODE: 'PILOT', GATEWAY_ASSERTION_SECRET: 'too-short' }); // misconfigured gateway secret
    results.push(raw('{}'));
    for (const result of results) expect(result).toMatchObject({ ok: false, code: 'REQUEST_REJECTED', data: null });
    // The real reason is still logged for operators (Apps Script Executions).
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)).code)).toEqual(
      expect.arrayContaining(['INVALID_REQUEST', 'VALIDATION_FAILED', 'INVALID_ASSERTION', 'INVALID_CONFIG:GATEWAY_ASSERTION_SECRET'])
    );
    warn.mockRestore();
  });

  it('keep specific codes once the request is verified, so the gateway can map them', () => {
    expect(parseOutput(doPost(signedEvent('visit.list', 'usr-unknown', {})))).toMatchObject({ ok: false, code: 'ACTOR_NOT_ALLOWED' });
  });
});
