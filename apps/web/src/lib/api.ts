import type { Actor, ApiEnvelope, Role } from '@smart-ltc/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const roleKey = 'smart-ltc-demo-role';
export const appMode = import.meta.env.VITE_APP_MODE === 'PILOT' ? 'PILOT' : 'DEMO';
export const isDemoMode = appMode === 'DEMO';
/** The role switcher only works against `wrangler dev` with DEMO_IMPERSONATION; deployed demos sign in. */
export const isLocalDemo = isDemoMode && import.meta.env.DEV;
/** GitHub Pages build: no backend, answers come from the in-browser synthetic fixtures. */
export const isStaticPreview = isDemoMode && import.meta.env.VITE_STATIC_PREVIEW === 'true';
export const canSwitchDemoRole = isLocalDemo || isStaticPreview;

/** An in-app path including the deployment base (e.g. /LTC-Care-Team/ on GitHub Pages). */
export const appHref = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;

export class ApiError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

export function getDemoRole(): Lowercase<Role> {
  return (sessionStorage.getItem(roleKey) as Lowercase<Role> | null) ?? 'cm';
}

export function setDemoRole(role: Lowercase<Role>): void {
  sessionStorage.setItem(roleKey, role);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (isStaticPreview) {
    const { previewRespond } = await import('./preview');
    const { status, body } = previewRespond(path, init, getDemoRole());
    if (status >= 400 || !body.ok || body.data === null) throw new ApiError(body.code, status, body.message || body.code);
    return body.data as T;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-ltc-request': '1' };
  if (isLocalDemo) headers['x-demo-role'] = getDemoRole();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...headers, ...init?.headers }
  });
  const envelope = await response.json().catch(() => ({ ok: false, code: 'NETWORK_ERROR', message: 'ไม่สามารถติดต่อระบบได้', data: null, requestId: '' })) as ApiEnvelope<T>;
  if (!response.ok || !envelope.ok || envelope.data === null) throw new ApiError(envelope.code, response.status, envelope.message || envelope.code);
  return envelope.data;
}

export const post = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });

/**
 * POST with upload progress (0–100), for large bodies such as images. fetch cannot report upload
 * progress, so this uses XMLHttpRequest with the same headers and envelope handling as api().
 */
export function postWithProgress<T>(path: string, body: unknown, onProgress: (percent: number) => void): Promise<T> {
  if (isStaticPreview) {
    onProgress(100);
    return post<T>(path, body);
  }
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_BASE}${path}`);
    request.withCredentials = true;
    request.setRequestHeader('content-type', 'application/json');
    request.setRequestHeader('x-ltc-request', '1');
    if (isLocalDemo) request.setRequestHeader('x-demo-role', getDemoRole());
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onerror = () => reject(new ApiError('NETWORK_ERROR', 0, 'ไม่สามารถติดต่อระบบได้'));
    request.onload = () => {
      let envelope: ApiEnvelope<T>;
      try { envelope = JSON.parse(request.responseText) as ApiEnvelope<T>; } catch { reject(new ApiError('NETWORK_ERROR', request.status, 'ไม่สามารถติดต่อระบบได้')); return; }
      if (request.status >= 400 || !envelope.ok || envelope.data === null) reject(new ApiError(envelope.code, request.status, envelope.message || envelope.code));
      else resolve(envelope.data);
    };
    request.send(JSON.stringify(body));
  });
}

/** Today's date in Bangkok as yyyy-MM-dd (toISOString would give yesterday before 07:00). */
export const todayInBangkok = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

export const getMe = () => api<Actor>('/auth/me');
export const logout = () => api<{ loggedOut: boolean }>('/auth/logout', { method: 'POST', body: '{}' });

