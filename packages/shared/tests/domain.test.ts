import { describe, expect, it } from 'vitest';
import { calculateAdlTotal, describeAdl, suggestLtcGroup } from '../src';

describe('ADL', () => {
  it('calculates the server authoritative 0-20 total', () => {
    expect(calculateAdlTotal({
      feeding: 2, grooming: 1, transfer: 3, toiletUse: 2, mobility: 3,
      dressing: 2, stairs: 2, bathing: 1, bowels: 2, bladder: 2
    })).toBe(20);
    expect(describeAdl(11)).toBe('HOME_BOUND');
  });
});

describe('LTC decision support', () => {
  it('never confirms the group and requests review for ambiguity', () => {
    expect(suggestLtcGroup({
      adlTotal: 8,
      mobilityStatus: 'UNKNOWN',
      cognitiveStatus: 'DISTURBANCE',
      terminalStatus: 'NOT_CONFIRMED'
    }).status).toBe('REQUIRES_CM_REVIEW');
  });
});
