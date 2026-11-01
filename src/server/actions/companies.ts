'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { CompanyModuleGrants, FacilityRole } from '@/lib/auth/company-policy';
import { operationalProfileById, type OperationalProfile } from '@/config/operational-profiles';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { getNativeIdentity,getCompanyPrincipal,activateCompany,provisionCompany,withCompanyManagement,companyAudit,newInvitationToken,invitationHash,consumeAuthAttempt } from '@/server/auth/company';
import { withAuthTransaction } from '@/server/auth/database';
import { isDemoAccount } from '@/server/auth/demo-config';
import { withDurableRead } from '@/server/data/durable-records';
import { repos } from '@/server/data';
import { approvedConstructionSubcontractorAssignments } from '@/server/construction-control';

type Result = { error?: string; message?: string; inviteUrl?: string };
const uuid = z.uuid();
async function identity() { if (!nativeAuthEnabled()) throw new Error('Company accounts are unavailable.'); const current=await getNativeIdentity(); if(!current) redirect('/login'); return current; }
async function principal() { await identity(); const current=await getCompanyPrincipal(); if(!current) redirect('/companies'); return current; }
const selectedIds = (form: FormData, name: string) => [...new Set(form.getAll(name).map(String).filter((value) => /^[A-Za-z0-9_:-]{1,200}$/.test(value)))];
async function scopeFor(current: Awaited<ReturnType<typeof principal>>, profile: OperationalProfile | undefined, form: FormData) {
  const unrestricted = { constructionProjectIds: [] as string[], constructionPackageIds: [] as string[], constructionSubcontractorIds: [] as string[], constructionTaskIds: [] as string[], allConstructionProjects: true };
  if (!profile || profile.scope === 'company') return { estateIds: [] as string[], buildingIds: [] as string[], unitIds: [] as string[], allEstates: true, ...unrestricted };
  if (profile.workspace === 'construction') {
    const requestedProjects = selectedIds(form, 'constructionProjectIds');
    const requestedPackages = selectedIds(form, 'constructionPackageIds');
    const requestedSubcontractors = selectedIds(form, 'constructionSubcontractorIds');
    const requestedTasks = selectedIds(form, 'constructionTaskIds');
    const records = await withDurableRead(async () => ({
      projects: repos.constructionProjects.list(current.actor, { limit: 500 }).items,
      packages: repos.constructionCostCodes.list(current.actor, { limit: 5000 }).items,
      subcontractors: [...repos.constructionSubcontractors.list(current.actor, { limit: 1000 }).items, ...approvedConstructionSubcontractorAssignments(current.company.id)],
      tasks: repos.constructionTasks.list(current.actor, { limit: 10000 }).items,
    }));
    const projects = new Set(records.projects.map((row) => String(row.id)));
    const packages = new Map(records.packages.map((row) => [`${row.projectId}:${row.code}`, String(row.projectId)]));
    const subcontractors = new Map(records.subcontractors.map((row) => [String(row.id), row.projectIds.map(String)]));
    const tasks = new Map(records.tasks.map((row) => [String(row.id), String(row.projectId)]));
    if (requestedProjects.some((value) => !projects.has(value)) || requestedPackages.some((value) => !packages.has(value))
      || requestedSubcontractors.some((value) => !subcontractors.has(value)) || requestedTasks.some((value) => !tasks.has(value))) throw new Error('Construction assignment unavailable.');
    const projectIds = new Set<string>();
    if (profile.scope === 'construction_project') requestedProjects.forEach((value) => projectIds.add(value));
    if (profile.scope === 'construction_package') requestedPackages.forEach((value) => projectIds.add(packages.get(value)!));
    if (profile.scope === 'construction_subcontractor') requestedSubcontractors.forEach((value) => subcontractors.get(value)!.forEach((projectId) => projectIds.add(projectId)));
    if (profile.scope === 'construction_task') requestedTasks.forEach((value) => projectIds.add(tasks.get(value)!));
    if (profile.scope === 'construction_project' && !requestedProjects.length) throw new Error('Choose at least one construction project.');
    if (profile.scope === 'construction_package' && !requestedPackages.length) throw new Error('Choose at least one work package.');
    if (profile.scope === 'construction_subcontractor' && !requestedSubcontractors.length) throw new Error('Choose at least one subcontractor assignment.');
    if (profile.scope === 'construction_task' && !requestedTasks.length) throw new Error('Choose at least one assigned task.');
    if (profile.scope === 'construction_subcontractor' && requestedPackages.some((value) => !projectIds.has(packages.get(value)!))) throw new Error('Every narrowed package must belong to an assigned subcontractor project.');
    return { estateIds: [] as string[], buildingIds: [] as string[], unitIds: [] as string[], allEstates: true,
      constructionProjectIds: [...projectIds],
      constructionPackageIds: profile.scope === 'construction_package' || profile.scope === 'construction_subcontractor' ? requestedPackages : [],
      constructionSubcontractorIds: profile.scope === 'construction_subcontractor' ? requestedSubcontractors : [],
      constructionTaskIds: profile.scope === 'construction_task' ? requestedTasks : [], allConstructionProjects: false };
  }
  const requestedEstates = selectedIds(form, 'estateIds');
  const requestedBuildings = selectedIds(form, 'buildingIds');
  const requestedUnits = selectedIds(form, 'unitIds');
  const records = await withDurableRead(async () => ({
    sites: repos.sites.list(current.actor, { limit: 500 }).items,
    buildings: repos.buildings.list(current.actor, { limit: 2000 }).items,
    units: repos.units.list(current.actor, { limit: 5000 }).items,
  }));
  const sites = new Set(records.sites.map((row) => String(row.id)));
  const buildings = new Map(records.buildings.map((row) => [String(row.id), String(row.siteId)]));
  const units = new Map(records.units.map((row) => [String(row.id), { siteId: String(row.siteId), buildingId: String(row.buildingId) }]));
  if (requestedEstates.some((id) => !sites.has(id)) || requestedBuildings.some((id) => !buildings.has(id)) || requestedUnits.some((id) => !units.has(id))) throw new Error('Assignment unavailable.');
  if (profile.scope === 'estate' && !requestedEstates.length) throw new Error('Choose at least one property or site.');
  if (profile.scope === 'building' && !requestedBuildings.length) throw new Error('Choose at least one block or building.');
  if (profile.scope === 'unit' && !requestedUnits.length) throw new Error('Choose at least one resident unit.');
  const estateIds = new Set(requestedEstates);
  requestedBuildings.forEach((id) => estateIds.add(buildings.get(id)!));
  requestedUnits.forEach((id) => estateIds.add(units.get(id)!.siteId));
  const unitIds = profile.scope === 'building'
    ? records.units.filter((row) => requestedBuildings.includes(String(row.buildingId))).map((row) => String(row.id))
    : requestedUnits;
  return { estateIds: [...estateIds], buildingIds: requestedBuildings, unitIds, allEstates: false, ...unrestricted };
}
async function access(form:FormData, current: Awaited<ReturnType<typeof principal>>) {
  const role=z.enum(['admin','member']).parse(form.get('companyRole'));
  const profile = operationalProfileById(form.get('operationalProfileId'));
  if (role === 'member' && !profile) throw new Error('Choose an operational user type.');
  const modules:Record<string,'view'|'manage'> = profile ? { [profile.workspace]: profile.access } : {};
  if (!profile) for(const key of ['estate','facility','shortlet','construction']) { const value=z.enum(['none','view','manage']).parse(form.get(`module:${key}`)??'none');if(value!=='none')modules[key]=value; }
  if(!Object.keys(modules).length)throw new Error('Choose at least one workspace.');
  const facilityRole = profile?.id === 'field-technician' ? 'technician' : profile?.id === 'vendor-technician' ? 'vendor'
    : modules.facility === 'manage' ? 'manager' : null;
  const vendorOrgId = facilityRole === 'vendor' ? z.string().trim().min(1).max(200).parse(form.get('vendorOrgId')) : null;
  if ((facilityRole === 'technician' || facilityRole === 'vendor') && Object.entries(modules).some(([key,value]) => key !== 'facility' && value === 'manage')) throw new Error('Field roles cannot also hold another manager role.');
  const scope = await scopeFor(current, profile, form);
  return {role,modules:modules as CompanyModuleGrants,facilityRole:facilityRole as FacilityRole|null,vendorOrgId,operationalProfileId: profile?.id ?? null,...scope};
}
async function vendorExists(current: Awaited<ReturnType<typeof principal>>, vendorOrgId: string | null) {
  if (!vendorOrgId) return true;
  return withDurableRead(async()=>repos.vendors.list(current.actor,{limit:500}).items.some((vendor)=>String(vendor.id)===vendorOrgId));
}
export async function createCompany(form:FormData):Promise<Result|void> {
  const user=await identity();const parsed=z.string().trim().min(2).max(120).safeParse(form.get('companyName'));
  if(!parsed.success)return {error:'Enter a company name between 2 and 120 characters.'};
  try {await consumeAuthAttempt('company-create',user.user.id,5,24*3600);await provisionCompany(user,parsed.data);}catch{return {error:'The company could not be created. Please try again later.'};}
  redirect('/onboarding');
}
export async function selectCompany(companyId:string):Promise<Result|void> {
  const user=await identity();if(!uuid.safeParse(companyId).success)return {error:'Choose an available company.'};
  try {await activateCompany(user,companyId);}catch{return {error:'That company is unavailable. Choose a company you belong to.'};}
  redirect('/workspaces');
}
export async function createCompanyInvite(form:FormData):Promise<Result> {
  const current=await principal();
  try {
    const email=z.email().max(254).parse(form.get('email')).toLowerCase();const assignment=await access(form,current); const {role,modules,facilityRole,vendorOrgId,operationalProfileId,estateIds,buildingIds,unitIds,allEstates,constructionProjectIds,constructionPackageIds,constructionSubcontractorIds,constructionTaskIds,allConstructionProjects}=assignment;
    if(!(await vendorExists(current,vendorOrgId)))throw new Error('Vendor unavailable.');
    await consumeAuthAttempt('company-invite',current.user.id,30,3600);
    const token=newInvitationToken();
    await withCompanyManagement(current,async(client)=>{
      const existing=await client.query('select m.id from company_memberships m join auth_users u on u.id=m.user_id where m.tenant_id=$1::uuid and lower(u.email)=$2 and m.status=$3',[current.company.id,email,'active']);
      if(existing.rowCount)throw new Error('Already a member.');
      await client.query('update company_invitations set cancelled_at=now() where tenant_id=$1::uuid and lower(email)=$2 and accepted_at is null and cancelled_at is null',[current.company.id,email]);
      const saved=await client.query('insert into company_invitations(tenant_id,email,token_hash,company_role,modules,facility_role,vendor_org_id,operational_profile,estate_ids,building_ids,unit_ids,all_estates,construction_project_ids,construction_package_ids,construction_subcontractor_ids,construction_task_ids,all_construction_projects,created_by,expires_at) values($1::uuid,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18::uuid,now()+interval \'48 hours\') returning id',[current.company.id,email,token.hash,role,JSON.stringify(modules),facilityRole,vendorOrgId,operationalProfileId,JSON.stringify(estateIds),JSON.stringify(buildingIds),JSON.stringify(unitIds),allEstates,JSON.stringify(constructionProjectIds),JSON.stringify(constructionPackageIds),JSON.stringify(constructionSubcontractorIds),JSON.stringify(constructionTaskIds),allConstructionProjects,current.user.id]);
      await companyAudit(client,current.company.id,current.user.id,'company.invitation.created',saved.rows[0].id,assignment);
    });
    return {inviteUrl:new URL(`/invite/${token.token}`,process.env.BETTER_AUTH_URL??process.env.NEXT_PUBLIC_SITE_URL).toString(),message:'Invitation created. Share this private link with the named teammate. It expires in 48 hours.'};
  }catch{return {error:'The invitation could not be created. Check the email, role and workspace choices.'};}
}
export async function updateCompanyMember(form:FormData):Promise<Result> {
  const current=await principal();
  try {
    const id=uuid.parse(form.get('memberId'));const assignment=await access(form,current); const {role,modules,facilityRole,vendorOrgId,operationalProfileId,estateIds,buildingIds,unitIds,allEstates,constructionProjectIds,constructionPackageIds,constructionSubcontractorIds,constructionTaskIds,allConstructionProjects}=assignment;
    if(!(await vendorExists(current,vendorOrgId)))throw new Error('Vendor unavailable.');
    await withCompanyManagement(current,async(client)=>{
      const target=(await client.query('select id,user_id,company_role from company_memberships where id=$1::uuid and tenant_id=$2::uuid and status=$3 for update',[id,current.company.id,'active'])).rows[0];
      if(!target||target.company_role==='owner')throw new Error('Owner access is protected.');
      if(target.user_id===current.user.id)throw new Error('Ask another owner to change your own account access.');
      await client.query('update company_memberships set company_role=$1,modules=$2::jsonb,facility_role=$3,vendor_org_id=$4,operational_profile=$5,estate_ids=$6::jsonb,building_ids=$7::jsonb,unit_ids=$8::jsonb,all_estates=$9,construction_project_ids=$10::jsonb,construction_package_ids=$11::jsonb,construction_subcontractor_ids=$12::jsonb,construction_task_ids=$13::jsonb,all_construction_projects=$14,version=version+1,updated_at=now() where id=$15::uuid and tenant_id=$16::uuid',[role,JSON.stringify(modules),facilityRole,vendorOrgId,operationalProfileId,JSON.stringify(estateIds),JSON.stringify(buildingIds),JSON.stringify(unitIds),allEstates,JSON.stringify(constructionProjectIds),JSON.stringify(constructionPackageIds),JSON.stringify(constructionSubcontractorIds),JSON.stringify(constructionTaskIds),allConstructionProjects,id,current.company.id]);
      await companyAudit(client,current.company.id,current.user.id,'company.member.access_changed',id,assignment);
    });
    revalidatePath('/company/team');revalidatePath('/workspaces');return {message:'Access updated. The new permissions apply on the next request.'};
  }catch{return {error:'Access could not be changed. Owner access and your own management access are protected.'};}
}
export async function removeCompanyMember(form:FormData):Promise<Result> {
  const current=await principal();
  try {
    const id=uuid.parse(form.get('memberId'));
    await withCompanyManagement(current,async(client)=>{
      const target=(await client.query('select id,user_id,company_role from company_memberships where id=$1::uuid and tenant_id=$2::uuid and status=$3 for update',[id,current.company.id,'active'])).rows[0];
      if(!target||target.company_role==='owner'||target.user_id===current.user.id)throw new Error('Protected membership.');
      await client.query("update company_memberships set status='revoked',version=version+1,updated_at=now() where id=$1::uuid and tenant_id=$2::uuid",[id,current.company.id]);
      await companyAudit(client,current.company.id,current.user.id,'company.member.revoked',id);
    });
    revalidatePath('/company/team');return {message:'Company access removed. Saved company records remain in the company.'};
  }catch{return {error:'This membership could not be removed. Owners and your own account are protected.'};}
}
export async function acceptCompanyInvite(form:FormData):Promise<Result|void> {
  const user=await identity();
  if(isDemoAccount(user.user.id))return {error:'Demo accounts cannot join companies. Sign out and use your own account to accept an invitation.'};
  const token=String(form.get('token')??'');if(!/^[A-Za-z0-9_-]{43}$/.test(token))return {error:'This invitation is unavailable.'};
  try {
    await consumeAuthAttempt('accept-invite',user.user.id,10,3600);
    const companyId=await withAuthTransaction(user.user.id,async(client)=> (await client.query('select accept_company_invitation($1) id',[invitationHash(token)])).rows[0].id);
    await activateCompany(user,companyId);
  }catch{return {error:'This invitation is unavailable. Sign in with the invited email address or ask the company owner for a new link.'};}
  redirect('/workspaces');
}
