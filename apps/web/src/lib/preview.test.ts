import { describe, expect, it } from 'vitest';
import { previewRespond } from './preview';

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

describe('static preview API', () => {
  it('answers reads from the shared fixtures for the selected role', () => {
    expect(previewRespond('/auth/me', undefined, 'cg').body.data).toMatchObject({ role: 'CG' });
    expect(previewRespond('/patients', undefined, 'cg').body.data).toMatchObject({ items: [expect.anything()], hasMore: false });
    expect(previewRespond('/reviews', undefined, 'cg').status).toBe(403);
  });

  it('enforces the same capabilities and contracts as the gateway', () => {
    const review = { encounterId: 'enc-1', decision: 'VERIFIED', recordVersion: 1 };
    expect(previewRespond('/encounter-reviews', post(review), 'cg').status).toBe(403);
    expect(previewRespond('/encounter-reviews', post({ ...review, decision: 'RETURNED' }), 'cm')).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
    expect(previewRespond('/encounter-reviews', post(review), 'cm')).toMatchObject({ status: 200, body: { data: { demo: true, status: 'VERIFIED' } } });
    expect(previewRespond('/encounter-reviews', { method: 'POST', body: '{' }, 'cm').status).toBe(400);
  });

  it('does not pretend to support anything else', () => {
    expect(previewRespond('/exports/patients.csv', post({}), 'cm').status).toBe(404);
  });
});
