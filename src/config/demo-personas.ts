import type { Role } from '@/domain/enums';
import type { Capability } from '@/lib/authz/matrix';
import type { Action } from '@/lib/authz/policy';
import { OPERATIONAL_PROFILES } from './operational-profiles';
import type { WorkspaceId } from './workspaces';

export const DEMO_PERSONA_COOKIE = 'propbrew_demo_persona';
type DemoModuleAccess = 'manage' | 'view';

export type DemoPersona = {
  id: string;
  label: string;
  description: string;
  home: string;
  roles: readonly Role[];
  modules: Readonly<Partial<Record<WorkspaceId, DemoModuleAccess>>>;
  capabilities?: Readonly<Partial<Record<Capability, DemoModuleAccess>>>;
  capabilityActions?: Readonly<Partial<Record<Capability, readonly Action[]>>>;
  estateIds?: readonly string[];
  buildingIds?: readonly string[];
  allEstates?: boolean;
  unitIds?: readonly string[];
  vendorOrgId?: string;
};

const ALL_MANAGE = Object.freeze({ estate: 'manage', facility: 'manage', shortlet: 'manage', construction: 'manage' } as const);
const ALL_VIEW = Object.freeze({ estate: 'view', facility: 'view', shortlet: 'view', construction: 'view' } as const);
const ESTATE_SITE = 's-gardens';
const RESIDENT_UNIT = 'u-c12b';
const ESTATE_BUILDING = 'b-gardens-c';
const DEMO_VENDOR = 'v-brightworks';

/** Review personas are authorization projections inside a private demo sandbox.
 * They never create accounts, change a real membership or cross tenant scope. */
export const DEMO_PERSONAS: readonly DemoPersona[] = Object.freeze([
  Object.freeze({
    id: 'company-owner', label: 'Company owner', description: 'Full sandbox access across all three workspaces', home: '/workspaces',
    roles: Object.freeze(['estate_manager', 'facility_manager', 'technician', 'security'] as const), modules: ALL_MANAGE,
  }),
  Object.freeze({
    id: 'executive', label: 'Executive viewer', description: 'Portfolio visibility without operational changes', home: '/workspaces',
    roles: Object.freeze(['executive'] as const), modules: ALL_VIEW,
  }),
  ...OPERATIONAL_PROFILES.map((profile): DemoPersona => Object.freeze({
    id: profile.id,
    label: profile.label,
    description: profile.description,
    home: profile.home,
    roles: profile.roles,
    modules: Object.freeze({ [profile.workspace]: profile.access }),
    ...(profile.capabilities ? { capabilities: profile.capabilities } : {}),
    ...(profile.capabilityActions ? { capabilityActions: profile.capabilityActions } : {}),
    ...(['estate', 'building'].includes(profile.scope) ? { estateIds: Object.freeze([ESTATE_SITE]), allEstates: false } : {}),
    ...(profile.scope === 'building' ? { buildingIds: Object.freeze([ESTATE_BUILDING]), unitIds: Object.freeze([RESIDENT_UNIT]) } : {}),
    ...(profile.scope === 'unit' ? { unitIds: Object.freeze([RESIDENT_UNIT]) } : {}),
    ...(profile.scope === 'vendor' ? { vendorOrgId: DEMO_VENDOR } : {}),
  })),
]);

export type DemoPersonaId = string;
export const DEFAULT_DEMO_PERSONA_ID = 'company-owner';

export function demoPersonaById(value: unknown): DemoPersona {
  return DEMO_PERSONAS.find((persona) => persona.id === value)
    ?? DEMO_PERSONAS.find((persona) => persona.id === DEFAULT_DEMO_PERSONA_ID)!;
}
