-- Native field evidence is stored alongside the construction workspace backup.
-- Each capture/photo index is immutable and idempotent across device retries.
create table if not exists construction_field_photos (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id text not null check(length(project_id) between 1 and 200),
  task_id text not null check(length(task_id) between 1 and 200),
  package_scope_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(package_scope_ids)='array'),
  capture_id uuid not null,
  photo_index integer not null check(photo_index between 0 and 19),
  content_type text not null check(content_type in ('image/png','image/jpeg','image/webp')),
  size_bytes integer not null check(size_bytes between 1 and 10485760),
  sha256 text not null check(length(sha256)=64),
  bytes bytea not null,
  created_by uuid not null references auth_users(id),
  created_at timestamptz not null default now(),
  unique(tenant_id,created_by,capture_id,photo_index),
  check(octet_length(bytes)=size_bytes),
  check(encode(digest(bytes,'sha256'),'hex')=sha256)
);
create index if not exists construction_field_photo_task_idx on construction_field_photos(tenant_id,project_id,task_id,created_at);

create or replace function construction_field_photo_access(company uuid,project text,task text,owner uuid,packages jsonb,p_write boolean default false)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $field$
  select company::text=current_setting('app.tenant_id',true)
    and public.demo_sandbox_access(company,p_write)
    and exists (
      select 1 from public.company_memberships m
      join public.tenants t on t.id=m.tenant_id
      join public.auth_sessions s on s."userId"=m.user_id
      where m.tenant_id=company and m.user_id::text=current_setting('app.auth_user_id',true)
        and s.id::text=current_setting('app.auth_session_id',true) and s."expiresAt">now()
        and m.status='active' and t.status='active'
        and m.modules->>'construction' in ('view','manage')
        and (not p_write or m.modules->>'construction'='manage')
        and (not p_write or owner=m.user_id)
        and (
          (coalesce(m.operational_profile,'') in ('project-manager','site-manager','quantity-surveyor','procurement-officer','planning-engineer','construction-hse','quality-inspector','site-engineer','materials-storekeeper','subcontractor','construction-field-worker','client-investor','consultant-approver') and m.construction_project_ids ? project)
          or (coalesce(m.operational_profile,'') not in ('project-manager','site-manager','quantity-surveyor','procurement-officer','planning-engineer','construction-hse','quality-inspector','site-engineer','materials-storekeeper','subcontractor','construction-field-worker','client-investor','consultant-approver') and (m.all_construction_projects or m.construction_project_ids ? project))
        )
        and (coalesce(m.operational_profile,'') not in ('construction-field-worker','subcontractor','site-engineer') or (owner=m.user_id and m.construction_task_ids ? task))
    );
$field$;
alter table construction_field_photos enable row level security;
alter table construction_field_photos force row level security;
create policy construction_field_photo_read on construction_field_photos for select using(public.construction_field_photo_access(tenant_id,project_id,task_id,created_by,package_scope_ids,false));
create policy construction_field_photo_insert on construction_field_photos for insert with check(public.construction_field_photo_access(tenant_id,project_id,task_id,created_by,package_scope_ids,true));

create or replace function construction_field_photo_quota() returns trigger
language plpgsql security definer set search_path=pg_catalog,public set row_security=off as $field$
declare v_bytes bigint; v_files bigint;
begin
  if not public.construction_field_photo_access(new.tenant_id,new.project_id,new.task_id,new.created_by,new.package_scope_ids,true) then raise exception 'Field photo access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text,812653));
  select coalesce(sum(size_bytes),0),count(*) into v_bytes,v_files from public.construction_field_photos where tenant_id=new.tenant_id;
  if v_bytes+new.size_bytes>524288000 or v_files>=5000 then raise exception 'Company field photo storage limit reached'; end if;
  return new;
end;
$field$;
create trigger construction_field_photo_quota before insert on construction_field_photos for each row execute function construction_field_photo_quota();
revoke all on construction_field_photos from public;
revoke all on function construction_field_photo_access(uuid,text,text,uuid,jsonb,boolean),construction_field_photo_quota() from public;
do $grants$
declare v_role text;
begin
  foreach v_role in array array['propbrew_review_app','propbrew_review_runtime'] loop
    if exists(select from pg_roles where rolname=v_role) then
      execute format('grant select,insert on construction_field_photos to %I',v_role);
      execute format('grant execute on function construction_field_photo_access(uuid,text,text,uuid,jsonb,boolean) to %I',v_role);
    end if;
  end loop;
end;
$grants$;
