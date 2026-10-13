import type { Actor, ApiEnvelope, Role } from '@smart-ltc/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const roleKey = 'smart-ltc-demo-role';
export const appMode = import.meta.env.VITE_APP_MODE === 'PILOT' ? 'PILOT' : 'DEMO';
export const isDemoMode = appMode === 'DEMO';

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
  if (isDemoMode) headers['x-demo-role'] = getDemoRole();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...headers, ...init?.headers }
  });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !envelope.ok || envelope.data === null) throw new ApiError(envelope.code, response.status, envelope.message || envelope.code);
  return envelope.data;
}

export const getMe = () => api<Actor>('/auth/me');
export const logout = () => api<{ loggedOut: boolean }>('/auth/logout', { method: 'POST', body: '{}' });

