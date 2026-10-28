import type { Capability, Role } from './types';

// Single source of truth for role capabilities. Gateway, GAS and the demo actors all read from here.
export const ROLE_CAPABILITIES: Readonly<Record<Role, readonly Capability[]>> = {
  ADMIN: ['patients:read', 'patients:write', 'users:manage', 'assignments:manage', 'patients:import', 'export:phi', 'budget:read'],
  CM: ['patients:read', 'patients:write', 'adl:approve', 'classification:confirm', 'carePlan:approve', 'encounter:review', 'export:phi',
    'users:manage', 'assignments:manage', 'patients:import', 'budget:read', 'budget:manage'],
  CG: ['patients:read']
};

export function capabilitiesFor(role: Role): Capability[] {
  const capabilities = ROLE_CAPABILITIES[role];
  if (!capabilities) throw new Error('INVALID_ROLE');
  return [...capabilities];
}
