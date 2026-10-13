import { capabilitiesFor, type Actor, type Page } from '@smart-ltc/shared';

// Synthetic fixtures served only to `wrangler dev` with DEMO_IMPERSONATION (see isLocalDemo).

export const demoActors: Record<string, Actor> = {
  admin: { userId: 'usr-demo-admin', role: 'ADMIN', capabilities: capabilitiesFor('ADMIN') },
  cm: { userId: 'usr-demo-cm', role: 'CM', capabilities: capabilitiesFor('CM'), credentialValidUntil: '2099-12-31T00:00:00.000Z' },
  cg: { userId: 'usr-demo-cg', role: 'CG', capabilities: capabilitiesFor('CG') }
};

export const demoDashboard = {
  dueToday: 6,
  overdue: 2,
  reviewQueue: 3,
  highRiskAlerts: 1,
  drafts: 1
};

const page = <T>(items: T[]): Page<T> => ({ items, hasMore: false });

const patients = [
  { patientId: 'pt-demo-001', localCode: 'DEMO-001', hn: 'HN-DEMO-001', fullName: 'นายตัวอย่าง หนึ่ง', age: 78, village: 'หมู่ 1', groupNumber: 3, status: 'ACTIVE' },
  { patientId: 'pt-demo-002', localCode: 'DEMO-002', hn: 'HN-DEMO-002', fullName: 'นางตัวอย่าง สอง', age: 82, village: 'หมู่ 4', groupNumber: 2, status: 'ACTIVE' },
  { patientId: 'pt-demo-003', localCode: 'DEMO-003', hn: 'HN-DEMO-003', fullName: 'นายข้อมูลจำลอง สาม', age: 71, village: 'หมู่ 2', groupNumber: 1, status: 'ACTIVE' }
];

export function demoPatients(actor: Actor): Page<Record<string, unknown>> {
  return page(actor.role === 'CG' ? patients.slice(0, 1) : patients);
}

export const demoVisits = page([
  { visitId: 'vs-demo-001', episodeId: 'ep-demo-001', visitDateTime: '2026-10-13T09:00:00+07:00', expectedEndTime: '2026-10-13T10:00:00+07:00', visitType: 'เยี่ยมบ้านตาม Care Plan', status: 'ASSIGNED' }
]);

export const demoAlerts = page([
  { alertId: 'al-demo-001', severity: 'HIGH', alertType: 'CG_URGENT_FLAG', eventAt: '2026-10-12T15:30:00+07:00', status: 'OPEN' }
]);

export const demoReviews = page([
  { encounterId: 'enc-demo-001', visitId: 'vs-demo-000', performerId: 'usr-demo-cg', endedAt: '2026-10-12T10:00:00+07:00', status: 'SUBMITTED', recordVersion: 1 }
]);
