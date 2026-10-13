export type HmacSha256 = (key: number[], message: number[]) => number[];

function xor(target: number[], source: number[]): void {
  for (let index = 0; index < target.length; index += 1) target[index] = (target[index] ?? 0) ^ (source[index] ?? 0);
}

function blockIndex(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

export function pbkdf2HmacSha256(
  hmac: HmacSha256,
  password: number[],
  salt: number[],
  iterations: number,
  keyLength = 32
): number[] {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('INVALID_ITERATIONS');
  const result: number[] = [];
  for (let block = 1; result.length < keyLength; block += 1) {
    let previous = hmac(password, [...salt, ...blockIndex(block)]);
    const aggregate = [...previous];
    for (let iteration = 1; iteration < iterations; iteration += 1) {
      previous = hmac(password, previous);
      xor(aggregate, previous);
    }
    result.push(...aggregate);
  }
  return result.slice(0, keyLength);
}

export function derivePasswordHash(password: string, saltBase64: string, pepper: string, iterations: number): string {
  const passwordBytes = Utilities.newBlob(`${password}\u0000${pepper}`).getBytes();
  const salt = Utilities.base64Decode(saltBase64);
  const derived = pbkdf2HmacSha256(
    (key, message) => Utilities.computeHmacSha256Signature(message, key),
    passwordBytes,
    salt,
    iterations
  );
  return Utilities.base64Encode(derived);
}

