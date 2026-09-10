-- ============================================================================
-- CivicConnect — Public-safe views
-- ============================================================================
-- The client apps (citizen community feed, official dashboards) should query
-- these views, never the base `complaints` / `complaint_comments` tables
-- directly. That way reporter_id and author_id can never leak into an API
-- response, a URL, or client-side state, no matter what the frontend does.
-- ============================================================================

create view complaints_public as
select
  c.id,
  c.display_id,
  c.category,
  c.description,
  c.severity,
  c.approximate_location, -- exact latitude/longitude intentionally omitted
  w.name as ward_name,
  v.name as village_name,
  sd.name as sub_district_name,
  d.name as district_name,
  s.name as state_name,
  'Anonymous Citizen'::text as reporter_display_name, -- hardcoded, never derived from identity
  c.status,
  c.verification_status,
  c.community_verified,
  c.government_verified,
  c.upvote_count,
  c.priority_score,
  c.assigned_authority_role,
  c.is_crime,
  c.created_at,
  c.updated_at,
  c.resolved_at,
  c.escalated_at
from complaints c
join wards w on w.id = c.ward_id
join villages v on v.id = c.village_id
join sub_districts sd on sd.id = c.sub_district_id
join districts d on d.id = c.district_id
join states s on s.id = c.state_id;

create view comments_public as
select
  cc.id,
  cc.complaint_id,
  cc.parent_comment_id,
  'Anonymous Citizen'::text as author_display_name,
  cc.body,
  cc.is_flagged,
  cc.created_at
from complaint_comments cc;

-- Priority score is computed server-side (see functions/priority.sql) and
-- stored on the row so all clients sort identically without recomputing a
-- weighted formula on-device, which would be easy to spoof.
