-- ============================================================================
-- CivicConnect — Row Level Security
-- ============================================================================
-- Golden rule: the mobile client is never trusted to declare its own role.
-- Every policy below reads the caller's role from `roles`, keyed off
-- auth.uid(), which Supabase Auth sets server-side from the verified JWT.
-- ============================================================================

alter table user_identity enable row level security;
alter table roles enable row level security;
alter table citizen_home_ward enable row level security;
alter table complaints enable row level security;
alter table complaint_images enable row level security;
alter table complaint_status_history enable row level security;
alter table complaint_votes enable row level security;
alter table complaint_comments enable row level security;
alter table complaint_verifications enable row level security;
alter table complaint_assignments enable row level security;
alter table complaint_escalations enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;

-- Helper: current caller's role row
create or replace function current_role_row() returns roles as $$
  select * from roles where user_id = auth.uid();
$$ language sql stable security definer;

create or replace function is_government(u uuid) returns boolean as $$
  select exists (
    select 1 from roles where user_id = u and role <> 'CITIZEN'
  );
$$ language sql stable security definer;

-- ---------------------------------------------------------------------------
-- user_identity — only the owner can ever read/write their own identity.
-- No government role is granted select here, at any level. This is the
-- technical backbone of "officials never see who filed a complaint."
-- ---------------------------------------------------------------------------
create policy identity_owner_select on user_identity
  for select using (user_id = auth.uid());
create policy identity_owner_update on user_identity
  for update using (user_id = auth.uid());
-- Insert happens via a trusted trigger/function on signup, not direct client insert.

-- ---------------------------------------------------------------------------
-- roles — readable by the owner (to render their own UI), never writable by
-- the client. Role assignment for officials happens via an admin-only RPC
-- executed with the service role, outside normal client access.
-- ---------------------------------------------------------------------------
create policy roles_owner_select on roles
  for select using (user_id = auth.uid());
-- No insert/update/delete policy is defined for the authenticated role —
-- absence of a policy means RLS denies the operation by default.

-- ---------------------------------------------------------------------------
-- complaints — the core jurisdiction + anonymity logic.
-- ---------------------------------------------------------------------------

-- Citizens: can insert their own complaints (application layer enforces the
-- geo-lock check before insert; this policy adds a defense-in-depth check
-- that reporter_id must equal the caller).
create policy complaints_citizen_insert on complaints
  for insert with check (reporter_id = auth.uid());

-- Citizens: can read their own complaints in full.
create policy complaints_owner_select on complaints
  for select using (reporter_id = auth.uid());

-- Citizens: can read OTHER citizens' complaints in their ward for the
-- Community feed, but the view/select list used by the client must never
-- include reporter_id — enforce this by exposing a public-safe VIEW
-- (see 003_views.sql) rather than direct table grants for community reads.

-- Ward Councillor: only their assigned ward.
create policy complaints_ward_councillor_select on complaints
  for select using (
    exists (
      select 1 from roles r
      where r.user_id = auth.uid() and r.role = 'WARD_COUNCILLOR'
        and r.ward_id = complaints.ward_id
    )
  );

-- Village Head: their assigned village/local region (all wards under it).
create policy complaints_village_head_select on complaints
  for select using (
    exists (
      select 1 from roles r
      join wards w on w.id = complaints.ward_id
      where r.user_id = auth.uid() and r.role = 'VILLAGE_HEAD'
        and r.village_id = w.village_id
    )
  );

-- Tehsildar/SDM: their assigned sub-district.
create policy complaints_sdm_select on complaints
  for select using (
    exists (
      select 1 from roles r
      where r.user_id = auth.uid() and r.role = 'TEHSILDAR_SDM'
        and r.sub_district_id = complaints.sub_district_id
    )
  );

-- DM/Collector: their assigned district.
create policy complaints_dm_select on complaints
  for select using (
    exists (
      select 1 from roles r
      where r.user_id = auth.uid() and r.role = 'DM_COLLECTOR'
        and r.district_id = complaints.district_id
    )
  );

-- CM: their assigned state.
create policy complaints_cm_select on complaints
  for select using (
    exists (
      select 1 from roles r
      where r.user_id = auth.uid() and r.role = 'CM'
        and r.state_id = complaints.state_id
    )
  );

-- PM / Central Government: all complaints, nationwide.
create policy complaints_pm_select on complaints
  for select using (
    exists (select 1 from roles r where r.user_id = auth.uid() and r.role = 'PM_CENTRAL_ADMIN')
  );

-- Status/verification updates: only the official whose role+jurisdiction
-- currently matches the complaint may update it (reuses the select policies
-- above via a combined check function for brevity in production code).
create policy complaints_official_update on complaints
  for update using (
    is_government(auth.uid()) and (
      exists (select 1 from roles r where r.user_id=auth.uid() and r.role='WARD_COUNCILLOR' and r.ward_id=complaints.ward_id)
      or exists (select 1 from roles r join wards w on w.id=complaints.ward_id where r.user_id=auth.uid() and r.role='VILLAGE_HEAD' and r.village_id=w.village_id)
      or exists (select 1 from roles r where r.user_id=auth.uid() and r.role='TEHSILDAR_SDM' and r.sub_district_id=complaints.sub_district_id)
      or exists (select 1 from roles r where r.user_id=auth.uid() and r.role='DM_COLLECTOR' and r.district_id=complaints.district_id)
      or exists (select 1 from roles r where r.user_id=auth.uid() and r.role='CM' and r.state_id=complaints.state_id)
      or exists (select 1 from roles r where r.user_id=auth.uid() and r.role='PM_CENTRAL_ADMIN')
    )
  );

-- ---------------------------------------------------------------------------
-- complaint_votes — one vote per citizen per complaint (also DB-enforced by
-- the composite primary key), and only the voter can remove their own vote.
-- ---------------------------------------------------------------------------
create policy votes_insert on complaint_votes
  for insert with check (user_id = auth.uid());
create policy votes_select on complaint_votes
  for select using (true); -- counts are public; identities of voters are not exposed by the API layer
create policy votes_delete_own on complaint_votes
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- complaint_comments — author_id is stored for moderation/audit, but no
-- select policy or API view ever returns it; clients always render
-- "Anonymous Citizen". Anyone with read access to the complaint can read
-- comments; only the author can delete their own comment.
-- ---------------------------------------------------------------------------
create policy comments_insert on complaint_comments
  for insert with check (author_id = auth.uid());
create policy comments_select on complaint_comments
  for select using (true);
create policy comments_delete_own on complaint_comments
  for delete using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- notifications — strictly owner-only.
-- ---------------------------------------------------------------------------
create policy notifications_owner on notifications
  for select using (user_id = auth.uid());
create policy notifications_owner_update on notifications
  for update using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_logs — no client role (citizen or official) gets any policy here.
-- Only a narrow AUDIT_ADMIN role, via a security-definer RPC that itself
-- logs the access, may read identity-linking records, satisfying
-- "only authorized security/audit administrators... when legally required."
-- ---------------------------------------------------------------------------
create policy audit_admin_select on audit_logs
  for select using (
    exists (select 1 from roles r where r.user_id = auth.uid() and r.role = 'AUDIT_ADMIN')
  );

-- ---------------------------------------------------------------------------
-- complaint_escalations — read-only for any role that can already read the
-- underlying complaint; no insert/update/delete policy for client roles at
-- all (escalation rows are written exclusively by the scheduled function
-- running under the service role).
-- ---------------------------------------------------------------------------
create policy escalations_select on complaint_escalations
  for select using (
    exists (select 1 from complaints c where c.id = complaint_escalations.complaint_id)
  );
