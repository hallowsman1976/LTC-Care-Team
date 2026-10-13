import { describe, expect, it } from 'vitest';
import { browserSupported } from './browser';

describe('browser support', () => {
  it('enforces the accepted matrix', () => {
    expect(browserSupported('Mozilla/5.0 Chrome/109.0.0.0 Safari/537.36')).toBe(true);
    expect(browserSupported('Mozilla/5.0 Chrome/108.0.0.0 Safari/537.36')).toBe(false);
    expect(browserSupported('Mozilla/5.0 Trident/7.0; rv:11.0')).toBe(false);
  });
});

