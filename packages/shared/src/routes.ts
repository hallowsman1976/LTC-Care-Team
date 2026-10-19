import { calculateAdlTotal } from './adl';
import {
  adlCreateSchema, carePlanActivateSchema, carePlanCreateSchema, classificationConfirmSchema,
  encounterReviewSchema, fileUploadSchema, visitSubmitSchema
} from './actions';
import { assignmentSetSchema, type CaregiverDetail } from './admin';
import {
  budgetApproveSchema, budgetCreateSchema, budgetGetSchema, budgetReviseSchema, budgetSaveSchema, budgetSyncSchema,
  DEFAULT_BUDGET_SETTINGS, type BudgetGroup, type BudgetPlanDetail
} from './budget';
import { capabilitiesFor } from './rbac';
import { visitContextSchema, visitImageUploadSchema, visitRecordSubmitSchema } from './visitRecord';
import type { Actor, Capability, Page } from './types';

// The gateway's public route map, shared so the Worker and the static preview build behave the
// same. `demo` results are synthetic and only ever served without a backend (wrangler dev with
// DEMO_IMPERSONATION, or the GitHub Pages preview).

const page = <T>(items: T[]): Page<T> => ({ items, hasMore: false });

export const DEMO_ACTORS: Record<string, Actor> = {
  admin: { userId: 'usr-demo-admin', role: 'ADMIN', capabilities: capabilitiesFor('ADMIN') },
  cm: { userId: 'usr-demo-cm', role: 'CM', capabilities: capabilitiesFor('CM'), credentialValidUntil: '2099-12-31T00:00:00.000Z' },
  cg: { userId: 'usr-demo-cg', role: 'CG', capabilities: capabilitiesFor('CG') }
};

const demoCaregivers = [
  { userId: 'usr-demo-cg', displayName: 'CG ตัวอย่าง', username: 'cg.demo', enabled: true, activePatients: 1, phone: '0800000001', organizationName: 'รพ.สต. ตัวอย่าง', education: 'UPPER_SECONDARY', photoUrl: '', latestTraining: 'หลักสูตรผู้ดูแลผู้สูงอายุ (Caregiver) 70 ชั่วโมง', trainingCount: 1 },
  { userId: 'usr-demo-cg2', displayName: 'CG ตัวอย่าง สอง', username: 'cg.demo2', enabled: true, activePatients: 0, phone: '', organizationName: '', education: '', photoUrl: '', latestTraining: '', trainingCount: 0 }
];

/** The edit form's synthetic caregiver, shared by the local demo and the static preview. */
export function demoCaregiverDetail(userId: string): CaregiverDetail {
  const caregiver = demoCaregivers.find((item) => item.userId === userId) ?? demoCaregivers[0]!;
  return {
    userId: caregiver.userId, displayName: caregiver.displayName, username: caregiver.username, enabled: caregiver.enabled, activePatients: caregiver.activePatients,
    cidLast4: '0002', birthDate: '1985-04-12', phone: caregiver.phone, address: '12 ม.2 ต.ตัวอย่าง (ข้อมูลสมมติ)', email: '', photoUrl: '',
    education: caregiver.education, organization: { name: caregiver.organizationName, type: 'HEALTH_PROMOTING_HOSPITAL', serviceArea: 'หมู่ 2' },
    trainings: caregiver.trainingCount ? [{ course: caregiver.latestTraining, provider: 'สสจ.ตัวอย่าง', completedOn: '2024-06-30', hours: 70 }] : [],
    recordVersion: caregiver.trainingCount ? 1 : 0
  };
}

const demoPatients = [
  { patientId: 'pt-demo-001', localCode: 'DEMO-001', hn: 'HN-DEMO-001', fullName: 'นายตัวอย่าง หนึ่ง', age: 78, village: 'หมู่ 1', groupNumber: 3, status: 'ACTIVE' },
  { patientId: 'pt-demo-002', localCode: 'DEMO-002', hn: 'HN-DEMO-002', fullName: 'นางตัวอย่าง สอง', age: 82, village: 'หมู่ 4', groupNumber: 2, status: 'ACTIVE' },
  { patientId: 'pt-demo-003', localCode: 'DEMO-003', hn: 'HN-DEMO-003', fullName: 'นายข้อมูลจำลอง สาม', age: 71, village: 'หมู่ 2', groupNumber: 1, status: 'ACTIVE' }
];

/** The edit form's synthetic patient, shared by the local demo and the static preview. */
export function demoPatientDetail(patientId: string): Record<string, unknown> {
  const patient = demoPatients.find((item) => item.patientId === patientId) ?? demoPatients[0]!;
  return {
    patientId: patient.patientId, localCode: patient.localCode, hn: patient.hn, cidLast4: '0001', fullName: patient.fullName,
    sex: patient.fullName.startsWith('นาง') ? 'FEMALE' : 'MALE', birthDate: `${2026 - patient.age}-03-15`, phone: '', registerDate: '2026-10-01',
    address: '12 (ข้อมูลสมมติ)', village: patient.village, villageNo: patient.village.replace(/\D/g, ''), villageName: '', subdistrict: 'ตัวอย่าง', district: 'เมือง', province: 'ขอนแก่น',
    latitude: '', longitude: '', mainCaregiverName: 'ญาติตัวอย่าง', mainCaregiverPhone: '0800000009', relationship: 'CHILD', rightType: 'UC', diseases: 'ความดันโลหิตสูง',
    dependencyStatus: 'HOMEBOUND', adlScore: 8, taiGroup: 'C3', ppsScore: 60, mentalHealthStatus: 'NORMAL',
    careManagerId: 'usr-demo-cm', caregiverId: patient.patientId === 'pt-demo-001' ? 'usr-demo-cg' : '', status: patient.status, recordVersion: 1
  };
}

/** The budget pages' synthetic plan: one line per demo patient, plus one not yet classified. */
export function demoBudgetPlan(): BudgetPlanDetail {
  const line = (patient: typeof demoPatients[number], index: number) => ({
    lineId: `bl-demo-00${index + 1}`, patientId: patient.patientId, fullName: patient.fullName, age: patient.age, address: `${patient.village} (ข้อมูลสมมติ)`,
    adlScore: [8, 11, 15][index] ?? null, groupNumber: patient.groupNumber as BudgetGroup, serviceFrom: '2025-10-01', serviceTo: '2026-09-30', serviceDays: 365, serviceMonths: 12,
    caregiverName: index === 0 ? 'CG ตัวอย่าง' : '', caregiverChanged: false, diapersPerDay: index === 0 ? 1 : 0, diaperCount: null, otherSupplies: index === 0 ? 1500 : 500,
    assessFee: null, reassessFee: null, teamFee: null, cgMonthly: null, excluded: false, excludeReason: '', note: '', currentGroup: patient.groupNumber as BudgetGroup
  });
  return {
    planId: 'bp-demo-2569', fiscalYear: 2569, version: 1, status: 'DRAFT', approvedAt: '', approvedByName: '', updatedAt: '2026-10-15T09:00:00.000Z', lineCount: 4,
    settings: { ...DEFAULT_BUDGET_SETTINGS, fundName: 'กองทุนหลักประกันสุขภาพตำบลตัวอย่าง', unitName: 'รพ.สต. ตัวอย่าง', assessFee: 300, reassessFee: 200, teamFee: 300, cgMonthly: 150 },
    approvalNote: '', revisionReason: '', syncedAt: '2026-10-15T09:00:00.000Z', recordVersion: 1,
    lines: [...demoPatients.map(line), {
      ...line(demoPatients[2]!, 3), patientId: 'pt-demo-004', fullName: 'นางรอประเมิน สี่', adlScore: null, groupNumber: null, currentGroup: null,
      serviceFrom: '2026-04-01', serviceDays: 183, serviceMonths: 6, otherSupplies: 0
    }]
  };
}

export interface ReadRoute {
  action: string;
  capability?: Capability;
  payload?: Record<string, unknown>;
  demo: (actor: Actor) => unknown;
}

export const READ_ROUTES: Record<string, ReadRoute> = {
  '/dashboard': { action: 'dashboard.summary', demo: () => ({ dueToday: 6, overdue: 2, reviewQueue: 3, highRiskAlerts: 1, drafts: 1 }) },
  '/patients': { action: 'patient.list', payload: { limit: 50 }, demo: (actor) => page(actor.role === 'CG' ? demoPatients.slice(0, 1) : demoPatients) },
  '/visits': {
    action: 'visit.list',
    demo: () => page([{ visitId: 'vs-demo-001', episodeId: 'ep-demo-001', visitDateTime: '2026-10-13T09:00:00+07:00', expectedEndTime: '2026-10-13T10:00:00+07:00', visitType: 'เยี่ยมบ้านตาม Care Plan', status: 'ASSIGNED', patientName: 'นายตัวอย่าง หนึ่ง' }])
  },
  '/alerts': {
    action: 'alert.list',
    demo: (actor) => page(actor.role === 'CG' ? [] : [{ alertId: 'al-demo-001', severity: 'HIGH', alertType: 'CG_URGENT_FLAG', eventAt: '2026-10-12T15:30:00+07:00', status: 'OPEN' }])
  },
  '/admin/caregivers': { action: 'caregiver.list', capability: 'users:manage', demo: () => page(demoCaregivers) },
  '/admin/users': {
    action: 'user.list', capability: 'users:manage',
    demo: () => page([
      { userId: 'usr-demo-admin', displayName: 'ผู้ดูแลระบบตัวอย่าง', username: 'admin.demo', role: 'ADMIN', enabled: true, createdAt: '2026-10-01T00:00:00.000Z', credentialValidUntil: '' },
      { userId: 'usr-demo-cm', displayName: 'CM ตัวอย่าง', username: 'cm.demo', role: 'CM', enabled: true, createdAt: '2026-10-01T00:00:00.000Z', credentialValidUntil: '2099-12-31' },
      ...demoCaregivers.map((caregiver) => ({ userId: caregiver.userId, displayName: caregiver.displayName, username: caregiver.username, role: 'CG', enabled: caregiver.enabled, createdAt: '2026-10-01T00:00:00.000Z', credentialValidUntil: '' }))
    ])
  },
  '/admin/assignments': {
    action: 'assignment.list', capability: 'assignments:manage',
    demo: () => page(demoPatients.map((patient, index) => ({
      patientId: patient.patientId, localCode: patient.localCode, hn: patient.hn, fullName: patient.fullName, village: patient.village,
      hasActiveEpisode: true, caregiverUserId: index === 0 ? 'usr-demo-cg' : '', caregiverName: index === 0 ? 'CG ตัวอย่าง' : ''
    })))
  },
  '/budget-plans': {
    action: 'budget.list', capability: 'budget:read',
    demo: () => {
      const { settings: _settings, lines: _lines, approvalNote: _note, revisionReason: _reason, syncedAt: _synced, recordVersion: _version, ...summary } = demoBudgetPlan();
      return page([summary]);
    }
  },
  '/reviews': {
    action: 'review.list', capability: 'encounter:review',
    demo: () => page([{
      encounterId: 'enc-demo-001', visitId: 'vs-demo-000', performerId: 'usr-demo-cg', performerName: 'CG ตัวอย่าง', patientName: 'นายตัวอย่าง หนึ่ง',
      visitType: 'เยี่ยมบ้านตาม Care Plan', visitDateTime: '2026-10-12T09:00:00+07:00', startedAt: '2026-10-12T09:05', endedAt: '2026-10-12T09:50',
      notes: ['กิจกรรม: ทำได้บางส่วน (ผู้ป่วยเหนื่อยหรือไม่สุขสบาย)', 'การกินอาหารและน้ำ: กินได้น้อยลง', 'บันทึกเพิ่มเติม: ญาติแจ้งว่านอนไม่ค่อยหลับ 2 คืน'].join('\n'),
      vitalsJson: JSON.stringify({ temperature: 37.8, pulse: 96 }), urgentFlag: true, status: 'SUBMITTED', recordVersion: 1
    }])
  }
};

export interface WriteRoute {
  action: string;
  capability: Capability;
  schema: { parse(value: unknown): Record<string, unknown>; safeParse(value: unknown): { success: boolean; data?: Record<string, unknown> } };
  demo: (input: Record<string, unknown>) => Record<string, unknown>;
}

const uuid = () => globalThis.crypto.randomUUID();

// Every write the UI can make. The gateway checks the capability and validates before calling GAS,
// and GAS re-checks both. auth.* actions are deliberately not reachable through this map.
export const WRITE_ROUTES: Record<string, WriteRoute> = {
  '/adl-assessments': {
    action: 'adl.create', capability: 'adl:approve', schema: adlCreateSchema,
    demo: (input) => ({ assessmentId: uuid(), status: 'APPROVED', totalScore: calculateAdlTotal(adlCreateSchema.parse(input).items) })
  },
  '/ltc-classifications': {
    action: 'classification.confirm', capability: 'classification:confirm', schema: classificationConfirmSchema,
    demo: (input) => ({ classId: uuid(), decisionStatus: 'CONFIRMED', groupNumber: input.groupNumber })
  },
  '/care-plans': {
    action: 'carePlan.create', capability: 'carePlan:approve', schema: carePlanCreateSchema,
    demo: () => ({ carePlanId: uuid(), status: 'DRAFT', recordVersion: 1 })
  },
  '/care-plans/activate': {
    action: 'carePlan.activate', capability: 'carePlan:approve', schema: carePlanActivateSchema,
    demo: (input) => ({ carePlanId: input.carePlanId, status: 'ACTIVE' })
  },
  '/visit-encounters': {
    action: 'visit.submit', capability: 'patients:read', schema: visitSubmitSchema,
    demo: (input) => ({ encounterId: uuid(), submissionId: input.submissionId, status: 'SUBMITTED' })
  },
  '/encounter-reviews': {
    action: 'encounter.review', capability: 'encounter:review', schema: encounterReviewSchema,
    demo: (input) => ({ encounterId: input.encounterId, status: input.decision })
  },
  '/visit-files': {
    action: 'file.upload', capability: 'patients:read', schema: fileUploadSchema,
    demo: () => ({ fileRecordId: uuid(), scanStatus: 'PENDING_SCAN' })
  },
  // A read with a parameter, so it is a POST; it changes nothing.
  '/visit-context': {
    action: 'visit.context', capability: 'patients:read', schema: visitContextSchema,
    demo: (input) => ({ visitId: input.visitId, patientName: 'นายตัวอย่าง หนึ่ง', visitType: 'เยี่ยมบ้านตาม Care Plan', visitDateTime: '2026-10-13T09:00:00+07:00', visitNumber: 3, visitorName: 'CG ตัวอย่าง' })
  },
  '/visit-images': {
    action: 'visitImage.upload', capability: 'patients:read', schema: visitImageUploadSchema,
    demo: () => ({ imageId: uuid(), url: '' })
  },
  '/admin/assignments': {
    action: 'assignment.set', capability: 'assignments:manage', schema: assignmentSetSchema,
    demo: (input) => ({ patientId: input.patientId, caregiverUserId: input.caregiverUserId, status: 'ASSIGNED', reassignedVisits: 0 })
  },
  '/budget-plans/create': {
    action: 'budget.create', capability: 'budget:manage', schema: budgetCreateSchema,
    demo: () => ({ planId: demoBudgetPlan().planId })
  },
  // A read with a parameter, so it is a POST; it changes nothing.
  '/budget-plans/get': { action: 'budget.get', capability: 'budget:read', schema: budgetGetSchema, demo: () => ({ ...demoBudgetPlan() }) },
  '/budget-plans/sync': {
    action: 'budget.sync', capability: 'budget:manage', schema: budgetSyncSchema,
    demo: (input) => ({ planId: input.planId, recordVersion: Number(input.recordVersion) + 1, added: 0, updated: 4 })
  },
  '/budget-plans/save': {
    action: 'budget.save', capability: 'budget:manage', schema: budgetSaveSchema,
    demo: (input) => ({ planId: input.planId, recordVersion: Number(input.recordVersion) + 1 })
  },
  '/budget-plans/approve': {
    action: 'budget.approve', capability: 'budget:manage', schema: budgetApproveSchema,
    demo: (input) => ({ planId: input.planId, status: 'APPROVED' })
  },
  '/budget-plans/revise': {
    action: 'budget.revise', capability: 'budget:manage', schema: budgetReviseSchema,
    demo: () => ({ planId: 'bp-demo-2569-v2', version: 2, status: 'DRAFT' })
  },
  '/visit-records': {
    action: 'visitRecord.submit', capability: 'patients:read', schema: visitRecordSubmitSchema,
    demo: () => ({ encounterId: uuid(), visitNumber: 3, status: 'SUBMITTED' })
  }
};
