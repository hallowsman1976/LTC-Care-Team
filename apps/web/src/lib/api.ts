import type { Actor, ApiEnvelope, Role } from '@smart-ltc/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const roleKey = 'smart-ltc-demo-role';
export const appMode = import.meta.env.VITE_APP_MODE === 'PILOT' ? 'PILOT' : 'DEMO';
export const isDemoMode = appMode === 'DEMO';
/** The role switcher only works against `wrangler dev` with DEMO_IMPERSONATION; deployed demos sign in. */
export const isLocalDemo = isDemoMode && import.meta.env.DEV;

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

/** Today's date in Bangkok as yyyy-MM-dd (toISOString would give yesterday before 07:00). */
export const todayInBangkok = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

export const getMe = () => api<Actor>('/auth/me');
export const logout = () => api<{ loggedOut: boolean }>('/auth/logout', { method: 'POST', body: '{}' });

