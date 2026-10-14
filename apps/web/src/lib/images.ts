export interface PreparedImage {
  dataUrl: string;
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
  bytes: number;
}

const fromDataUrl = (dataUrl: string, mimeType: PreparedImage['mimeType']): PreparedImage => {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return { dataUrl, base64, mimeType, bytes: Math.round((base64.length * 3) / 4) };
};

/**
 * Resizes a photo in the browser (longest side `maxSide`, JPEG) so it uploads quickly on mobile
 * data and fits the server limit, and returns it as base64 with a preview URL.
 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.85): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('ไฟล์ต้องเป็นรูปภาพ');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('เบราว์เซอร์ไม่รองรับการย่อรูป');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return fromDataUrl(canvas.toDataURL('image/jpeg', quality), 'image/jpeg');
}

export const signatureImage = (canvas: HTMLCanvasElement): PreparedImage => fromDataUrl(canvas.toDataURL('image/png'), 'image/png');
