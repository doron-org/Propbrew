'use client';

import { useActionState, useId, useState } from 'react';
import { Copy, LockKeyhole, MailPlus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Avatar, Card, CardHeader, StatusPill } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { PortalDialog } from '@/components/portal/portal-dialog';
import type { WorkspaceId } from '@/config/workspaces';
import { operationalProfileById, PROFILES_BY_WORKSPACE } from '@/config/operational-profiles';
import { constructionArchived } from '@/config/module-archive';
import type { CompanyActionState, CompanyFormAction } from './company-chooser';
import shared from '@/components/ui/workspace-layout.module.css';
import styles from './auth.module.css';

export type CompanyMember = {
  id: string; userId: string; name: string; email: string;
  companyRole: 'owner' | 'admin' | 'member';
  modules: Partial<Record<WorkspaceId, 'manage' | 'view'>>;
  facilityRole?: 'manager' | 'technician' | 'vendor' | null;
  vendorOrgId?: string | null;
  operationalProfileId?: string | null;
  estateIds?: string[];
  buildingIds?: string[];
  unitIds?: string[];
  allEstates?: boolean;
  constructionProjectIds?: string[];
  constructionPackageIds?: string[];
  constructionSubcontractorIds?: string[];
  constructionTaskIds?: string[];
  allConstructionProjects?: boolean;
  isCurrentUser: boolean;
};
const MODULES: { id: WorkspaceId; label: string; detail: string }[] = [
  { id: 'estate', label: 'Estate permissions', detail: 'Properties, residents, community and finance' },
  { id: 'facility', label: 'Facility permissions', detail: 'Assets, maintenance and site operations' },
  { id: 'shortlet', label: 'Shortlet', detail: 'Guests, bookings and stay operations' },
  { id: 'construction', label: constructionArchived() ? 'Construction · archived' : 'Construction', detail: constructionArchived() ? 'Existing permissions are retained for a future reopening' : 'Projects, procurement and delivery' },
];
const accessLabel = (access: 'manage' | 'view' | undefined) => access === 'manage' ? 'Manage' : access === 'view' ? 'View' : 'No access';

export type VendorOption = { id: string; name: string };
export type AssignmentOptions = {
  vendors: VendorOption[];
  estates: { id: string; name: string }[];
  buildings: { id: string; siteId: string; name: string }[];
  units: { id: string; siteId: string; buildingId: string; name: string }[];
  constructionProjects: { id: string; name: string }[];
  constructionPackages: { id: string; projectId: string; name: string }[];
  constructionSubcontractors: { id: string; projectIds: string[]; name: string }[];
  constructionTasks: { id: string; projectId: string; name: string }[];
};

export function CompanyTeam({ companyName, members, assignments, canManage, createCompanyInvite, updateCompanyMember, removeCompanyMember }: { companyName: string; members: CompanyMember[]; assignments: AssignmentOptions; canManage: boolean; createCompanyInvite: CompanyFormAction; updateCompanyMember: CompanyFormAction; removeCompanyMember: CompanyFormAction }) {
  const [invite, setInvite] = useState(false);
  return <div className={`pb-page ${shared.layout}`}><PageHeader title="Team & access" subtitle={`The people and workspace permissions in ${companyName}.`} actions={canManage ? <button type="button" className={styles.primary} onClick={() => setInvite(true)}><MailPlus size={17} aria-hidden="true" />Invite teammate</button> : undefined} />
    <Card><CardHeader title="Company members" subtitle={`${members.length} member${members.length === 1 ? '' : 's'} · access applies within this company`} action={<Users size={20} className="text-primary" aria-hidden="true" />} /><p className={shared.body}>{canManage ? 'Choose the workspaces each teammate can view or manage. Company administrators can also manage the team.' : 'You can review your company team. An owner or administrator manages membership and workspace access.'}</p></Card>
    <div className={styles.memberList}>{members.map((member) => <MemberCard key={member.id} member={member} assignments={assignments} companyName={companyName} canManage={canManage} update={updateCompanyMember} remove={removeCompanyMember} />)}{members.length === 0 && <Card><div className={styles.companyEmpty}><span className={styles.companyIcon}><Users size={24} aria-hidden="true" /></span><h2>No company members to show</h2><p>{canManage ? 'Invite a teammate to give them access to the workspaces they need.' : 'Ask your company administrator to review your membership.'}</p></div></Card>}</div>
    <div className={shared.notice}><ShieldCheck size={18} aria-hidden="true" /><p>Company access stays with the company.<span>Workspace permissions also apply to AI assistance and the records it can use.</span></p></div>
    {invite && <InviteCompanyMember companyName={companyName} assignments={assignments} action={createCompanyInvite} onClose={() => setInvite(false)} />}
  </div>;
}

function MemberCard({ member, assignments, companyName, canManage, update, remove }: { member: CompanyMember; assignments: AssignmentOptions; companyName: string; canManage: boolean; update: CompanyFormAction; remove: CompanyFormAction }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const protectedOwner = member.companyRole === 'owner';
  const profile = operationalProfileById(member.operationalProfileId);
  const scope = profile?.scope === 'company' ? 'All company records'
    : profile?.scope === 'vendor' ? assignments.vendors.find((row) => row.id === member.vendorOrgId)?.name ?? 'Vendor assignment required'
    : profile?.scope === 'unit' ? `${member.unitIds?.length ?? 0} assigned unit(s)`
    : profile?.scope === 'building' ? `${member.buildingIds?.length ?? 0} assigned block(s)`
    : profile?.scope === 'construction_project' ? `${member.constructionProjectIds?.length ?? 0} assigned project(s)`
    : profile?.scope === 'construction_package' ? `${member.constructionPackageIds?.length ?? 0} assigned work package(s)`
    : profile?.scope === 'construction_subcontractor' ? `${member.constructionSubcontractorIds?.length ?? 0} subcontractor assignment(s)`
    : profile?.scope === 'construction_task' ? `${member.constructionTaskIds?.length ?? 0} assigned task(s)`
    : profile ? `${member.estateIds?.length ?? 0} assigned property/site(s)` : 'Workspace access';
  return <Card><div className={styles.memberHeader}><div className={styles.memberIdentity}><Avatar name={member.name || member.email} size={42} /><div><h2>{member.name || 'Company teammate'}{member.isCurrentUser && <span className={styles.you}>You</span>}</h2><p>{member.email}</p></div></div><StatusPill status={member.companyRole} tone={protectedOwner ? 'info' : 'muted'} /></div><div className={styles.memberModules}>{profile && <><div><span>User type</span><strong>{profile.label}</strong></div><div><span>Record assignment</span><strong>{scope}</strong></div></>}<div><span>Property Management</span><strong>Estate {accessLabel(member.modules.estate)} · Facility {accessLabel(member.modules.facility)}</strong></div>{MODULES.filter((module) => module.id !== 'estate' && module.id !== 'facility').map((module) => <div key={module.id}><span>{module.label}</span><strong>{accessLabel(member.modules[module.id])}</strong></div>)}{member.modules.facility === 'manage' && <div><span>Facility duty</span><strong>{member.facilityRole === 'technician' ? 'Field technician' : member.facilityRole === 'vendor' ? assignments.vendors.find((vendor) => vendor.id === member.vendorOrgId)?.name ?? 'Vendor team' : 'Facility manager'}</strong></div>}</div>
    {protectedOwner || member.isCurrentUser ? <p className={styles.protected}><LockKeyhole size={14} aria-hidden="true" />{protectedOwner ? 'Owner access is protected.' : 'Another company administrator manages changes to your own access.'}</p> : canManage ? <div className={styles.memberActions}><button type="button" className={styles.secondary} onClick={() => setEditing((value) => !value)} aria-expanded={editing}>{editing ? 'Close access editor' : 'Edit access'}</button><button type="button" className={styles.danger} onClick={() => setRemoving(true)}><Trash2 size={15} aria-hidden="true" />Remove access</button></div> : null}
    {editing && !protectedOwner && canManage && <EditMemberAccess member={member} assignments={assignments} action={update} />}
    {removing && <RemoveCompanyMember member={member} companyName={companyName} action={remove} onClose={() => setRemoving(false)} />}
  </Card>;
}

function OperationalProfileFields({ profileId = '', member, assignments, onProfile }: { profileId?: string; member?: CompanyMember; assignments: AssignmentOptions; onProfile: (value: string) => void }) {
  const prefix = useId();
  const profile = operationalProfileById(profileId);
  return <fieldset className={styles.grantFields}><legend>Operational user type</legend><p className={styles.hint}>The user type sets allowed actions and record boundaries. Company administrators may leave this blank and use workspace access below.</p><div className={styles.grantGrid}><div className={styles.field}><label htmlFor={`${prefix}-profile`}>User type</label><select id={`${prefix}-profile`} name="operationalProfileId" value={profileId} onChange={(event) => onProfile(event.target.value)}><option value="">Company administrator · custom workspace access</option><optgroup label="Property Management user types">{[...PROFILES_BY_WORKSPACE.estate, ...PROFILES_BY_WORKSPACE.facility].map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</optgroup>{MODULES.filter((module) => module.id !== 'estate' && module.id !== 'facility').map((module) => <optgroup key={module.id} label={`${module.label} user types`}>{PROFILES_BY_WORKSPACE[module.id].map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</optgroup>)}</select>{profile && <p className={styles.hint}>{profile.description} · {profile.access === 'manage' ? 'operational access' : 'read-only access'}</p>}</div>
    {profile?.scope === 'estate' && <MultiAssignment id={`${prefix}-estates`} name="estateIds" label="Assigned properties / sites" values={member?.estateIds} options={assignments.estates} />}
    {profile?.scope === 'building' && <MultiAssignment id={`${prefix}-buildings`} name="buildingIds" label="Assigned blocks / buildings" values={member?.buildingIds} options={assignments.buildings.map((row) => ({ id: row.id, name: `${assignments.estates.find((site) => site.id === row.siteId)?.name ?? 'Property'} · ${row.name}` }))} />}
    {profile?.scope === 'unit' && <MultiAssignment id={`${prefix}-units`} name="unitIds" label="Assigned resident units" values={member?.unitIds} options={assignments.units.map((row) => ({ id: row.id, name: `${assignments.estates.find((site) => site.id === row.siteId)?.name ?? 'Property'} · ${row.name}` }))} />}
    {profile?.scope === 'construction_project' && <MultiAssignment id={`${prefix}-construction-projects`} name="constructionProjectIds" label="Assigned construction projects" values={member?.constructionProjectIds} options={assignments.constructionProjects} />}
    {profile?.scope === 'construction_package' && <MultiAssignment id={`${prefix}-construction-packages`} name="constructionPackageIds" label="Assigned work packages / cost codes" values={member?.constructionPackageIds} options={assignments.constructionPackages.map((row) => ({ id: row.id, name: `${assignments.constructionProjects.find((project) => project.id === row.projectId)?.name ?? 'Project'} · ${row.name}` }))} />}
    {profile?.scope === 'construction_subcontractor' && <><MultiAssignment id={`${prefix}-construction-subs`} name="constructionSubcontractorIds" label="Assigned subcontractor organisations" values={member?.constructionSubcontractorIds} options={assignments.constructionSubcontractors} /><MultiAssignment id={`${prefix}-construction-sub-packages`} name="constructionPackageIds" label="Assigned packages (optional narrowing)" values={member?.constructionPackageIds} required={false} options={assignments.constructionPackages.map((row) => ({ id: row.id, name: `${assignments.constructionProjects.find((project) => project.id === row.projectId)?.name ?? 'Project'} · ${row.name}` }))} /></>}
    {profile?.scope === 'construction_task' && <MultiAssignment id={`${prefix}-construction-tasks`} name="constructionTaskIds" label="Assigned field tasks" values={member?.constructionTaskIds} options={assignments.constructionTasks.map((row) => ({ id: row.id, name: `${assignments.constructionProjects.find((project) => project.id === row.projectId)?.name ?? 'Project'} · ${row.name}` }))} />}
    {profile?.scope === 'vendor' && <div className={styles.field}><label htmlFor={`${prefix}-vendor`}>Vendor organisation</label><select id={`${prefix}-vendor`} name="vendorOrgId" defaultValue={member?.vendorOrgId ?? ''} required><option value="">Choose a vendor</option>{assignments.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select><p className={styles.hint}>This user sees only work assigned to this vendor organisation.</p></div>}
  </div></fieldset>;
}

function MultiAssignment({ id, name, label, values = [], options, required = true }: { id: string; name: string; label: string; values?: string[]; options: { id: string; name: string }[]; required?: boolean }) {
  return <div className={styles.field}><label htmlFor={id}>{label}</label><select id={id} name={name} multiple required={required} defaultValue={values} size={Math.min(6, Math.max(3, options.length))}>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><p className={styles.hint}>{required ? 'Select one or more.' : 'Optional: leave empty for every package inside the assigned subcontractor projects.'} On macOS, hold Command to select multiple; on Windows, hold Ctrl.</p></div>;
}

function ModuleAccessFields({ modules = {}, disabled = false }: { modules?: CompanyMember['modules']; disabled?: boolean }) {
  const prefix = useId();
  return <fieldset className={styles.grantFields} disabled={disabled}><legend>Workspace access</legend><p className={styles.hint}>Property Management is one workspace. Set Estate and Facility permissions separately within it. View reads assigned records; Manage includes actions allowed by the user type.</p><div className={styles.grantGrid}>{MODULES.map((module) => <div className={styles.field} key={module.id}><label htmlFor={`${prefix}-${module.id}`}>{module.label}</label><select id={`${prefix}-${module.id}`} name={`module:${module.id}`} defaultValue={modules[module.id] ?? 'none'}><option value="none">No access</option><option value="view">View</option><option value="manage">Manage</option></select><p className={styles.hint}>{module.detail}</p></div>)}</div></fieldset>;
}

function EditMemberAccess({ member, assignments, action }: { member: CompanyMember; assignments: AssignmentOptions; action: CompanyFormAction }) {
  const prefix = useId();
  const [profileId, setProfileId] = useState(member.operationalProfileId ?? '');
  const [state, submit, pending] = useActionState(async (_previous: CompanyActionState, form: FormData) => await action(form) ?? { message: 'Company access saved.' }, {});
  return <form action={submit} className={`${styles.form} ${styles.accessEditor}`} aria-busy={pending}><input type="hidden" name="memberId" value={member.id} />{state.error && <p role="alert" className={styles.error}>{state.error}</p>}{state.message && <p role="status" className={styles.success}>{state.message}</p>}<fieldset className={styles.fieldset} disabled={pending}><legend className="sr-only">Edit access for {member.name || member.email}</legend><div className={styles.field}>{member.isCurrentUser ? <><span className={styles.fieldLabel}>Company role</span><input type="hidden" name="companyRole" value={member.companyRole} /><p className={styles.hint}>Your company role: {member.companyRole}. Ask another owner or administrator to change it.</p></> : <><label htmlFor={`${prefix}-role`}>Company role</label><select id={`${prefix}-role`} name="companyRole" defaultValue={member.companyRole}><option value="member">Member</option><option value="admin">Administrator</option></select></>}</div><OperationalProfileFields profileId={profileId} member={member} assignments={assignments} onProfile={setProfileId} /><ModuleAccessFields modules={member.modules} disabled={Boolean(profileId)} /><button type="submit" className={styles.primary} disabled={pending}>{pending ? 'Saving access…' : 'Save company access'}</button></fieldset></form>;
}

function InviteCompanyMember({ companyName, assignments, action, onClose }: { companyName: string; assignments: AssignmentOptions; action: CompanyFormAction; onClose: () => void }) {
  const prefix = useId();
  const [profileId, setProfileId] = useState('');
  const [state, submit, pending] = useActionState(async (_previous: CompanyActionState, form: FormData) => await action(form) ?? {}, {});
  const [copied, setCopied] = useState('');
  async function copy() {
    if (!state.inviteUrl) return;
    try { await navigator.clipboard.writeText(state.inviteUrl); setCopied('Invitation link copied.'); }
    catch { setCopied('Select the invitation link above and copy it.'); }
  }
  return <PortalDialog label={`Invite a teammate to ${companyName}`} onClose={onClose} canClose={!pending} dismissOnBackdrop={false} width={720}><div className={styles.teamDialog}><header><h2>Invite a teammate</h2><p>Choose a permanent user type and record assignment in {companyName}, then share a private invitation link.</p></header>{state.inviteUrl ? <div className={styles.form}><p role="status" className={styles.success}>Your invitation link is ready.</p><div className={styles.field}><label htmlFor={`${prefix}-link`}>Private invitation link</label><input id={`${prefix}-link`} readOnly value={state.inviteUrl} onFocus={(event) => event.target.select()} /><p className={styles.hint}>Share this link directly with the invited teammate. They must sign in with the invited email address to accept.</p></div><button type="button" className={styles.primary} onClick={copy}><Copy size={16} aria-hidden="true" />Copy invitation link</button><p role="status" className={styles.hint}>{copied}</p><button type="button" className={styles.secondary} onClick={onClose}>Done</button></div> : <form action={submit} className={styles.form} aria-busy={pending}>{state.error && <p role="alert" className={styles.error}>{state.error}</p>}<fieldset className={styles.fieldset} disabled={pending}><legend className="sr-only">Invitation details</legend><div className={styles.field}><label htmlFor={`${prefix}-email`}>Teammate email address</label><input id={`${prefix}-email`} name="email" type="email" required maxLength={254} autoComplete="off" placeholder="teammate@company.com" /></div><div className={styles.field}><label htmlFor={`${prefix}-role`}>Company role</label><select id={`${prefix}-role`} name="companyRole" defaultValue="member"><option value="member">Member</option><option value="admin">Administrator</option></select></div><OperationalProfileFields profileId={profileId} assignments={assignments} onProfile={setProfileId} /><ModuleAccessFields disabled={Boolean(profileId)} /><p className={styles.hint}>The invitation stores the user type and assignments. Acceptance cannot broaden them.</p><div className={styles.memberActions}><button type="button" className={styles.secondary} onClick={onClose} disabled={pending}>Cancel</button><button type="submit" className={styles.primary} disabled={pending}>{pending ? 'Creating invitation…' : 'Create invitation link'}</button></div></fieldset></form>}</div></PortalDialog>;
}

function RemoveCompanyMember({ member, companyName, action, onClose }: { member: CompanyMember; companyName: string; action: CompanyFormAction; onClose: () => void }) {
  const [state, submit, pending] = useActionState(async (_previous: CompanyActionState, form: FormData) => await action(form) ?? { message: 'Company access removed.' }, {});
  return <PortalDialog label="Remove company access" onClose={onClose} canClose={!pending} dismissOnBackdrop={false} width={500}><div className={styles.teamDialog}><header><h2>Remove company access</h2><p>Remove {member.name || member.email}&apos;s access to {companyName} and its workspaces.</p></header><form action={submit} className={styles.form} aria-busy={pending}><input type="hidden" name="memberId" value={member.id} />{state.error && <p role="alert" className={styles.error}>{state.error}</p>}{state.message ? <><p role="status" className={styles.success}>{state.message}</p><button type="button" className={styles.secondary} onClick={onClose}>Done</button></> : <div className={styles.memberActions}><button type="button" className={styles.secondary} onClick={onClose} disabled={pending}>Cancel</button><button type="submit" className={styles.danger} disabled={pending}>{pending ? 'Removing access…' : 'Remove company access'}</button></div>}</form></div></PortalDialog>;
}
