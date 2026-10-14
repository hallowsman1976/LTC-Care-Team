import { DEMO_ACTORS, patientCreateSchema, patientImportSchema, READ_ROUTES, WRITE_ROUTES, type Actor, type ApiEnvelope } from '@smart-ltc/shared';

// Backend-free API for the static GitHub Pages preview (VITE_STATIC_PREVIEW=true). It answers from
// the same synthetic fixtures and validates with the same contracts as the Worker's local demo,
// and stores nothing.

const envelope = <T>(ok: boolean, code: string, message: string, data: T | null): ApiEnvelope<T> => ({ ok, code, message, data, requestId: 'preview' });
const reply = (status: number, body: ApiEnvelope<unknown>) => ({ status, body });

function parseBody(init?: RequestInit): unknown {
  try { return init?.body ? JSON.parse(String(init.body)) : {}; } catch { return Symbol('invalid'); }
}

export function previewRespond(path: string, init: RequestInit | undefined, role: string): { status: number; body: ApiEnvelope<unknown> } {
  const method = (init?.method ?? 'GET').toUpperCase();
  const actor: Actor | undefined = DEMO_ACTORS[role];
  if (!actor) return reply(401, envelope(false, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ', null));
  if (path === '/auth/me' && method === 'GET') return reply(200, envelope(true, 'OK', '', actor));
  if (path === '/auth/logout' && method === 'POST') return reply(200, envelope(true, 'OK', '', { loggedOut: true }));

  const read = READ_ROUTES[path];
  if (read && method === 'GET') {
    if (read.capability && !actor.capabilities.includes(read.capability)) return reply(403, envelope(false, 'FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', null));
    return reply(200, envelope(true, 'OK', '', read.demo(actor)));
  }

  if (path === '/admin/patients/import' && method === 'POST') {
    if (!actor.capabilities.includes('patients:import')) return reply(403, envelope(false, 'FORBIDDEN', 'ไม่มีสิทธิ์นำเข้าข้อมูล', null));
    const input = patientImportSchema.safeParse(parseBody(init));
    if (!input.success) return reply(400, envelope(false, 'VALIDATION_FAILED', 'ข้อมูลไม่ครบหรือไม่ถูกต้อง', null));
    return reply(200, envelope(true, 'OK', '', { demo: true, created: input.data.rows.length, skipped: [] }));
  }

  const write = WRITE_ROUTES[path];
  const isPatientCreate = path === '/patients' && method === 'POST';
  if ((write || isPatientCreate) && method === 'POST') {
    const allowed = isPatientCreate ? actor.role === 'CM' && actor.capabilities.includes('patients:write') : actor.capabilities.includes(write!.capability);
    if (!allowed) return reply(403, envelope(false, 'FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้', null));
    const input = (isPatientCreate ? patientCreateSchema : write!.schema).safeParse(parseBody(init));
    if (!input.success) return reply(400, envelope(false, 'VALIDATION_FAILED', 'ข้อมูลไม่ครบหรือไม่ถูกต้อง', null));
    const data = isPatientCreate ? { status: 'CREATED', patient: { patientId: crypto.randomUUID() } } : write!.demo(input.data as Record<string, unknown>);
    return reply(200, envelope(true, 'OK', '', { demo: true, ...data }));
  }
  return reply(404, envelope(false, 'NOT_FOUND', 'หน้าตัวอย่างไม่รองรับการทำงานนี้', null));
}
