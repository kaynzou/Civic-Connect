-- ============================================================================
-- Seed data — fictional demo data only. Architecture supports every Indian
-- state/district/ward; Lucknow/UP is used here purely as a worked example.
-- ============================================================================

insert into countries (id, name) values ('00000000-0000-0000-0000-000000000001', 'India');

insert into states (id, country_id, name) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Uttar Pradesh');

insert into districts (id, state_id, name) values
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Lucknow');

insert into sub_districts (id, district_id, name) values
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 'Lucknow Sadar');

insert into villages (id, sub_district_id, name, is_urban) values
  ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000030', 'Gomti Nagar', true),
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000030', 'Aliganj', true),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000030', 'Chowk', true);

-- Mock rectangular ward boundaries for local development only — replace with
-- real GIS shapefiles before production use.
insert into wards (id, village_id, name, boundary) values
  ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000040', 'Ward 42',
    st_geomfromtext('POLYGON((80.94 26.84, 80.99 26.84, 80.99 26.88, 80.94 26.88, 80.94 26.84))', 4326)),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000041', 'Ward 17',
    st_geomfromtext('POLYGON((80.90 26.86, 80.94 26.86, 80.94 26.90, 80.90 26.90, 80.90 26.86))', 4326)),
  ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000042', 'Ward 7',
    st_geomfromtext('POLYGON((80.88 26.83, 80.92 26.83, 80.92 26.86, 80.88 26.86, 80.88 26.83))', 4326));

insert into escalation_rules (category, sla_days) values
  ('CRIME', 3), ('PUBLIC_SAFETY', 5), ('WATER', 7), ('ELECTRICITY', 7),
  ('COMMUNITY', 14), ('INFRASTRUCTURE', 14), ('ENVIRONMENT', 14), ('ROADS', 14),
  ('STREET_LIGHTS', 14), ('SANITATION', 10), ('GARBAGE', 7), ('DRAINAGE', 10),
  ('TRAFFIC', 14), ('OTHER', 14);

-- NOTE: demo user accounts (citizen + one official per role) are created via
-- Supabase Auth admin API in seed/002_seed_users.ts, not raw SQL, because
-- passwords must go through Supabase's auth hashing — see that file and
-- .env.example for DEMO_* variables. Never hardcode production credentials.
