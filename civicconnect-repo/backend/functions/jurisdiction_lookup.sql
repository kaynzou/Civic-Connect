-- ============================================================================
-- getWardFromCoordinates(latitude, longitude)
--
-- Point-in-polygon lookup against ward boundaries (PostGIS). Returns the
-- full administrative chain so the client can render:
--   India → Uttar Pradesh → Lucknow → Lucknow Sadar → Gomti Nagar → Ward 42
--
-- This is architecture, not a Lucknow-only hack: any state/district/ward can
-- be added by inserting rows + polygons — nothing here assumes one region.
-- For development, ward boundaries can be simple mock rectangles (see
-- seed/002_wards_mock_geometry.sql) until official GIS shapefiles are loaded.
-- ============================================================================

create or replace function get_ward_from_coordinates(p_lat double precision, p_lng double precision)
returns table (
  country text, state text, district text, sub_district text, village text,
  ward text, ward_id uuid, village_id uuid, sub_district_id uuid, district_id uuid, state_id uuid, country_id uuid
) as $$
  select
    co.name, s.name, d.name, sd.name, v.name, w.name,
    w.id, v.id, sd.id, d.id, s.id, co.id
  from wards w
  join villages v on v.id = w.village_id
  join sub_districts sd on sd.id = v.sub_district_id
  join districts d on d.id = sd.district_id
  join states s on s.id = d.state_id
  join countries co on co.id = s.country_id
  where st_contains(w.boundary, st_setsrid(st_point(p_lng, p_lat), 4326))
  limit 1;
$$ language sql stable security definer;

-- ---------------------------------------------------------------------------
-- Geo-lock check used before a normal (non-crime) complaint is accepted.
-- Crime reports call this only to attach a public-safe approximate_location
-- to the incident — never to gate submission.
-- ---------------------------------------------------------------------------
create or replace function citizen_can_report_here(p_user uuid, p_lat double precision, p_lng double precision)
returns boolean as $$
declare
  v_home_ward uuid;
  v_detected_ward uuid;
begin
  select ward_id into v_home_ward from citizen_home_ward where user_id = p_user;
  select ward_id into v_detected_ward from get_ward_from_coordinates(p_lat, p_lng);
  return v_home_ward is not null and v_home_ward = v_detected_ward;
end;
$$ language plpgsql stable security definer;
