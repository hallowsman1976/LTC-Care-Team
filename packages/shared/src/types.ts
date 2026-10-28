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


export interface Page<T> {
  items: T[];
  hasMore: boolean;
}
