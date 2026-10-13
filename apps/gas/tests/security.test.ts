import { createHmac, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pbkdf2HmacSha256 } from '../src/security/password';
import { constantTimeEqual } from '../src/utils/encoding';

describe('password derivation', () => {
  it('is deterministic and salt-sensitive', () => {
    const hmac = (key: number[], message: number[]) => [...createHmac('sha256', Buffer.from(key)).update(Buffer.from(message)).digest()];
    const first = pbkdf2HmacSha256(hmac, [1, 2, 3], [4, 5, 6], 10);
    const second = pbkdf2HmacSha256(hmac, [1, 2, 3], [4, 5, 7], 10);
    expect(first).not.toEqual(second);
    expect(constantTimeEqual('same', 'same')).toBe(true);
    expect(constantTimeEqual('same', 'diff')).toBe(false);
    const password = [...Buffer.from('password')];
    const salt = [...Buffer.from('salt')];
    expect(Buffer.from(pbkdf2HmacSha256(hmac, password, salt, 2)).toString('hex'))
      .toBe(pbkdf2Sync('password', 'salt', 2, 32, 'sha256').toString('hex'));
  });
});
