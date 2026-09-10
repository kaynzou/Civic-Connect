-- ============================================================================
-- CivicConnect — Construction Projects & Authority Mapping Schema
-- ============================================================================

create table if not exists construction_projects (
  id uuid primary key default uuid_generate_v4(),
  project_no text unique not null,
  name text not null,
  project_type text not null check (project_type in ('LOCAL_WARD', 'MAJOR_INFRASTRUCTURE')),
  authority_id uuid references auth.users(id),
  authority_role app_role not null,
  authority_ward_id uuid references wards(id),
  affected_ward_ids uuid[] default '{}',
  geometry geometry(Geometry, 4326) not null,
  start_date date not null,
  estimated_end_date date not null,
  duration_days integer,
  official_sla text not null,
  actual_completion_date date,
  status text not null default 'Under Construction' check (status in ('Planned', 'Upcoming', 'Under Construction', 'Delayed', 'Completed', 'Cancelled')),
  description text not null,
  alternative_route text,
  visibility_scope text not null default 'WARD' check (visibility_scope in ('WARD', 'PUBLIC_CITY', 'STATE', 'NATIONAL')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists construction_projects_geom_idx on construction_projects using gist (geometry);
create index if not exists construction_projects_ward_idx on construction_projects(authority_ward_id);
create index if not exists construction_projects_status_idx on construction_projects(status);

-- ---------------------------------------------------------------------------
-- Strict Server-Side Geometric Authorization Trigger
-- ---------------------------------------------------------------------------
create or replace function check_construction_authority_bounds() returns trigger as $$
declare
  v_ward_geom geometry;
begin
  if new.project_type = 'LOCAL_WARD' then
    if new.authority_ward_id is null then
      raise exception 'authority_ward_id is required for local ward projects';
    end if;

    select boundary into v_ward_geom from wards where id = new.authority_ward_id;
    if v_ward_geom is null then
      raise exception 'Assigned ward boundary not found';
    end if;

    -- Verify that the requested construction geometry is strictly within the ward polygon
    if not st_contains(v_ward_geom, new.geometry) then
      raise exception 'Geographic authorization error: Construction geometry must be completely inside assigned ward boundary';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_construction_authority_bounds on construction_projects;
create trigger trg_check_construction_authority_bounds
  before insert or update on construction_projects
  for each row execute function check_construction_authority_bounds();

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS)
-- ---------------------------------------------------------------------------
alter table construction_projects enable row level security;

-- Citizens see:
-- 1. All MAJOR_INFRASTRUCTURE projects across the city
-- 2. LOCAL_WARD projects in their own registered home ward
create policy construction_citizen_select on construction_projects
  for select using (
    project_type = 'MAJOR_INFRASTRUCTURE'
    or (
      project_type = 'LOCAL_WARD'
      and authority_ward_id in (select ward_id from citizen_home_ward where user_id = auth.uid())
    )
    or is_government(auth.uid())
  );

-- Ward Councilors can only create/update projects within their assigned ward
create policy construction_councillor_insert on construction_projects
  for insert with check (
    (current_role_row()).role = 'WARD_COUNCILLOR'
    and project_type = 'LOCAL_WARD'
    and authority_ward_id = (current_role_row()).ward_id
  );

-- High-level officials (SDM, DM, CM, Central Admin) can create major infrastructure
create policy construction_official_insert on construction_projects
  for insert with check (
    (current_role_row()).role in ('TEHSILDAR_SDM', 'DM_COLLECTOR', 'CM', 'PM_CENTRAL_ADMIN')
  );
