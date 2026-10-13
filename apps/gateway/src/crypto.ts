const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hmacBase64(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

export async function encryptCid(cid: string, keyBase64: string): Promise<string> {
  return encryptText(cid, keyBase64, 'smart-ltc:cid:v1');
}

export async function encryptText(value: string, keyBase64: string, context: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', toArrayBuffer(base64ToBytes(keyBase64)), { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: encoder.encode(context) }, key, encoder.encode(value)
  ));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(encrypted)}`;
}

export async function decryptCid(value: string, keyBase64: string): Promise<string> {
  return decryptText(value, keyBase64, 'smart-ltc:cid:v1');
}

export async function decryptText(value: string, keyBase64: string, context: string): Promise<string> {
  const [version, ivValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue) throw new Error('INVALID_CIPHERTEXT');
  const key = await crypto.subtle.importKey(
    'raw', toArrayBuffer(base64ToBytes(keyBase64)), { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(ivValue)), additionalData: encoder.encode(context) },
    key,
    toArrayBuffer(base64ToBytes(encryptedValue))
  );
  return decoder.decode(plain);
}

