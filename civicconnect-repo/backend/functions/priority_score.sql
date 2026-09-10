-- ============================================================================
-- Priority Score — transparent, explainable, and NOT a raw upvote sort.
--
-- priority_score =
--     base_severity        (severity * 10,        max 50)
--   + community_upvotes    (min(upvotes * 0.6, 60))
--   + time_pending         (min(days_pending * 3, 45))
--   + verification_conf    (government_verified: 20 / community_verified: 10 / 0)
--   + safety_impact        (crime: 30 / PUBLIC_SAFETY: 18 / 0)
--
-- Recomputed whenever upvotes, verification, or status change, and once a
-- day for time-pending decay via the escalation scheduler. The breakdown is
-- exposed back to citizens ("Why is this prioritized?") and to officials,
-- so nobody has to trust a black-box ranking.
-- ============================================================================

create or replace function compute_priority_score(p_complaint_id uuid) returns numeric as $$
declare
  c record;
  v_days_pending integer;
  v_score numeric;
begin
  select * into c from complaints where id = p_complaint_id;
  v_days_pending := extract(day from (now() - c.created_at));

  v_score :=
      (c.severity * 10)
    + least(c.upvote_count * 0.6, 60)
    + least(v_days_pending * 3, 45)
    + (case when c.government_verified then 20 when c.community_verified then 10 else 0 end)
    + (case when c.is_crime then 30 when c.category = 'PUBLIC_SAFETY' then 18 else 0 end);

  update complaints set priority_score = v_score, updated_at = now() where id = p_complaint_id;
  return v_score;
end;
$$ language plpgsql security definer;

-- Trigger: recompute on vote insert/delete
create or replace function trg_recompute_priority_on_vote() returns trigger as $$
begin
  update complaints
    set upvote_count = (select count(*) from complaint_votes where complaint_id = coalesce(new.complaint_id, old.complaint_id))
    where id = coalesce(new.complaint_id, old.complaint_id);
  perform compute_priority_score(coalesce(new.complaint_id, old.complaint_id));
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger trg_vote_priority
  after insert or delete on complaint_votes
  for each row execute function trg_recompute_priority_on_vote();
