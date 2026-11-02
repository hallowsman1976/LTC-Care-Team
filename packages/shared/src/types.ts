export type Role = 'ADMIN' | 'CM' | 'CG';

export type Capability =
  | 'users:manage'
  | 'assignments:manage'
  | 'patients:import'
  | 'patients:read'
  | 'patients:write'
  | 'patients:delete'
  | 'adl:approve'
  | 'classification:confirm'
  | 'carePlan:approve'
  | 'encounter:review'
  | 'export:phi'
  | 'budget:read'
  | 'budget:manage';

export interface Actor {
  userId: string;
  role: Role;
  capabilities: Capability[];
  credentialValidUntil?: string;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  code: string;
  message: string;
  data: T | null;
  requestId: string;
}

export interface VersionedRecord {
  recordVersion: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export const VISIT_STATUSES = [
  'PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED',
  'RETURNED', 'MISSED', 'CANCELLED'
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_STATUS_LABELS: Readonly<Record<VisitStatus, string>> = {
  PLANNED: 'ยังไม่มอบหมาย', ASSIGNED: 'มอบหมายแล้ว', IN_PROGRESS: 'กำลังเยี่ยม', SUBMITTED: 'รอตรวจ',
  VERIFIED: 'ยืนยันผลแล้ว', RETURNED: 'ส่งคืนแก้ไข', MISSED: 'ไม่ได้เยี่ยม', CANCELLED: 'ยกเลิก'
};


export interface Page<T> {
  items: T[];
  hasMore: boolean;
}
