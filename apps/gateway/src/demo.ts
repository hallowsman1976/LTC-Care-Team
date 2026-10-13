import type { Actor } from '@smart-ltc/shared';

export const demoActors: Record<string, Actor> = {
  admin: { userId: 'usr-demo-admin', role: 'ADMIN', capabilities: ['users:manage', 'export:phi'] },
  cm: {
    userId: 'usr-demo-cm', role: 'CM',
    capabilities: ['patients:read', 'patients:write', 'adl:approve', 'classification:confirm', 'carePlan:approve', 'encounter:review', 'export:phi'],
    credentialValidUntil: '2099-12-31T00:00:00.000Z'
  },
  cg: { userId: 'usr-demo-cg', role: 'CG', capabilities: ['patients:read'] }
};

export const demoDashboard = {
  dueToday: 6,
  overdue: 2,
  reviewQueue: 3,
  highRiskAlerts: 1,
  drafts: 1
};

export const demoPatients = [
  { patientId: 'pt-demo-001', localCode: 'DEMO-001', hn: 'HN-DEMO-001', fullName: 'นายตัวอย่าง หนึ่ง', age: 78, village: 'หมู่ 1', groupNumber: 3, status: 'ACTIVE' },
  { patientId: 'pt-demo-002', localCode: 'DEMO-002', hn: 'HN-DEMO-002', fullName: 'นางตัวอย่าง สอง', age: 82, village: 'หมู่ 4', groupNumber: 2, status: 'ACTIVE' },
  { patientId: 'pt-demo-003', localCode: 'DEMO-003', hn: 'HN-DEMO-003', fullName: 'นายข้อมูลจำลอง สาม', age: 71, village: 'หมู่ 2', groupNumber: 1, status: 'ACTIVE' }
];

