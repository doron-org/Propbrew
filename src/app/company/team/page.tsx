import Link from 'next/link';
import { notFound,redirect } from 'next/navigation';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { getCompanyPrincipal,listCompanyMembers } from '@/server/auth/company';
import { canManageCompanyMembers } from '@/lib/auth/company-policy';
import { CompanyTeam } from '@/components/auth/company-team';
import { createCompanyInvite,updateCompanyMember,removeCompanyMember } from '@/server/actions/companies';
import { withDurableRead } from '@/server/data/durable-records';
import { repos } from '@/server/data';
import { approvedConstructionSubcontractorAssignments } from '@/server/construction-control';
export const dynamic = 'force-dynamic';
export default async function CompanyTeamPage() {
  if(!nativeAuthEnabled())notFound(); const current=await getCompanyPrincipal();if(!current)redirect('/companies');
  if(!canManageCompanyMembers(current.actor))notFound();
  const assignments=await withDurableRead(async()=>({
    vendors:repos.vendors.list(current.actor,{limit:200}).items.map((row)=>({id:String(row.id),name:row.name})),
    estates:repos.sites.list(current.actor,{limit:500}).items.map((row)=>({id:String(row.id),name:row.name})),
    buildings:repos.buildings.list(current.actor,{limit:2000}).items.map((row)=>({id:String(row.id),siteId:String(row.siteId),name:row.name})),
    units:repos.units.list(current.actor,{limit:5000}).items.map((row)=>({id:String(row.id),siteId:String(row.siteId),buildingId:String(row.buildingId),name:row.label})),
    constructionProjects:repos.constructionProjects.list(current.actor,{limit:500}).items.map((row)=>({id:String(row.id),name:`${row.code} · ${row.name}`})),
    constructionPackages:repos.constructionCostCodes.list(current.actor,{limit:5000}).items.map((row)=>({id:`${row.projectId}:${row.code}`,projectId:String(row.projectId),name:`${row.code} · ${row.name}`})),
    constructionSubcontractors:[...repos.constructionSubcontractors.list(current.actor,{limit:1000}).items,...approvedConstructionSubcontractorAssignments(current.company.id)].map((row)=>({id:String(row.id),projectIds:row.projectIds.map(String),name:`${row.name} · ${row.trade}`})),
    constructionTasks:repos.constructionTasks.list(current.actor,{limit:10000}).items.map((row)=>({id:String(row.id),projectId:String(row.projectId),name:row.name})),
  }));
  return <main className="pb-app min-h-screen bg-app p-5 md:p-8"><Link href="/workspaces" className="pb-link">← Workspaces</Link><CompanyTeam companyName={current.company.name} members={await listCompanyMembers(current)} assignments={assignments} canManage={true} createCompanyInvite={createCompanyInvite} updateCompanyMember={updateCompanyMember} removeCompanyMember={removeCompanyMember}/></main>;
}
