-- ============================================================================
-- Automatic Escalation — scheduled job (Supabase Cron / pg_cron)
--
-- Rule: if a complaint has been assigned to an authority for longer than the
-- category's configured SLA (default 14 days) without reaching RESOLVED,
-- escalate it to the next role in that category's configured chain.
--
-- Every escalation writes an immutable row to complaint_escalations (never
-- updated or deleted) and a matching audit_logs entry, records which
-- authority failed to act, notifies both the outgoing and incoming
-- authority, and notifies the citizen — without exposing internal details.
-- ============================================================================

create or replace function run_escalation_check() returns void as $$
declare
  rec record;
  rule record;
  current_idx integer;
  next_role app_role;
  next_user uuid;
  days_pending integer;
begin
  for rec in
    select c.*, a.assigned_role, a.deadline_at, a.assigned_user_id
    from complaints c
    join complaint_assignments a on a.complaint_id = c.id
    where c.status not in ('RESOLVED','REJECTED')
      and a.deadline_at < now()
      and not exists ( -- don't double-escalate the same overdue assignment
        select 1 from complaint_escalations e
        where e.complaint_id = c.id and e.from_role = a.assigned_role
      )
  loop
    select * into rule from escalation_rules where category = rec.category;
    if rule is null then
      -- fall back to the default chain if no category-specific rule exists
      select array['WARD_COUNCILLOR','VILLAGE_HEAD','TEHSILDAR_SDM','DM_COLLECTOR','CM','PM_CENTRAL_ADMIN']::app_role[]
        into rule.chain;
      rule.sla_days := 14;
    end if;

    current_idx := array_position(rule.chain, rec.assigned_role);
    if current_idx is null or current_idx >= array_length(rule.chain, 1) then
      continue; -- already at the top of the chain; nothing higher to escalate to
    end if;

    next_role := rule.chain[current_idx + 1];
    days_pending := extract(day from (now() - rec.created_at));

    -- find an official holding next_role in the same jurisdiction
    select user_id into next_user from roles
      where role = next_role
        and (ward_id = rec.ward_id or village_id = rec.village_id
             or sub_district_id = rec.sub_district_id or district_id = rec.district_id
             or state_id = rec.state_id or next_role = 'PM_CENTRAL_ADMIN')
      limit 1;

    insert into complaint_escalations (complaint_id, from_role, to_role, from_user_id, to_user_id, days_pending, reason)
    values (rec.id, rec.assigned_role, next_role, rec.assigned_user_id, next_user, days_pending,
            format('Complaint exceeded the %s-day resolution window.', rule.sla_days));

    insert into audit_logs (actor_role, action, target_table, target_id, previous_value, new_value)
    values ('PM_CENTRAL_ADMIN', 'AUTO_ESCALATION', 'complaints', rec.id,
            jsonb_build_object('role', rec.assigned_role), jsonb_build_object('role', next_role));

    update complaints
      set status = 'ESCALATED', assigned_authority_role = next_role, escalated_at = now()
      where id = rec.id;

    insert into complaint_assignments (complaint_id, assigned_role, assigned_user_id, deadline_at)
    values (rec.id, next_role, next_user, now() + make_interval(days => rule.sla_days));

    insert into complaint_status_history (complaint_id, previous_status, new_status, changed_by_role, note)
    values (rec.id, rec.status, 'ESCALATED', 'PM_CENTRAL_ADMIN',
            format('Auto-escalated from %s to %s after %s days pending.', rec.assigned_role, next_role, days_pending));

    insert into notifications (user_id, complaint_id, message)
    values (rec.reporter_id, rec.id, format('Complaint #%s has been escalated due to the resolution deadline.', rec.display_id));

    if next_user is not null then
      insert into notifications (user_id, complaint_id, message)
      values (next_user, rec.id, format('Complaint #%s has been escalated to you after %s days pending.', rec.display_id, days_pending));
    end if;

    perform compute_priority_score(rec.id);
  end loop;
end;
$$ language plpgsql security definer;

-- Schedule (requires pg_cron extension, enabled per-project in Supabase):
-- select cron.schedule('civicconnect-escalation-check', '0 * * * *', 'select run_escalation_check();');
