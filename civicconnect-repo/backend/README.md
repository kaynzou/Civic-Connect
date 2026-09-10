# CivicConnect

**Your Voice. Your Community. Your Government.**

A civic grievance platform connecting citizens with the appropriate government
authority — geo-jurisdiction-aware complaint routing, anonymous reporting,
community upvoting with a transparent priority score, and automatic
14-day escalation up an administrative hierarchy.

## What's in this delivery, honestly

This was requested as a fully working React Native + Expo + Supabase mobile
app. Two things were true about the environment this was built in:

- There's no mobile runtime (Expo/simulator) or live Supabase project here to
  actually run and hand back to you as a running app.
- The spec itself (52 numbered sections) is closer to a multi-week product
  build than something to fully wire end-to-end in one pass.

So this delivery is split into two honest pieces:

1. **`civicconnect-prototype.html`** — a fully interactive, working
   simulation of the entire product: real navigation, real state, the exact
   verification-button animation, geo-lock logic (with a demo GPS-scenario
   switcher since real device GPS isn't available in a browser preview),
   priority scoring with the "why is this prioritized" breakdown, anonymous
   comments/reporting, upvoting with duplicate-vote prevention, and
   role-switchable government dashboards (Ward Councillor → Village Head →
   Tehsildar/SDM → DM → CM → Central Government) each correctly scoped to
   their jurisdiction. Open it in any browser — this is the "show me the UI"
   deliverable, and every button in it actually works.

2. **This `backend/` scaffold** — real, non-toy SQL and TypeScript that
   implements the parts a prototype can't fake: the Postgres schema, Row
   Level Security policies that enforce jurisdiction and anonymity *at the
   database layer* (not just hidden in the UI), the priority-score formula
   as a SQL function, the automatic escalation job, and a service layer the
   real Expo app would call. It's a scaffold to build the production app on
   top of, not a deployed backend.

To go from here to the actual React Native/Expo app: scaffold an Expo
project (`npx create-expo-app`), install `@supabase/supabase-js`,
`expo-location`, `expo-image-picker`, `expo-secure-store`, and React
Navigation, then build screens that call the services in `src/services/`
against a real Supabase project created from `migrations/`.

## Architecture

```
backend/
  migrations/
    001_schema.sql          -- jurisdiction hierarchy, complaints, identity split
    002_rls_policies.sql    -- anonymity + jurisdiction enforcement at the DB layer
    003_views.sql           -- public-safe views (never expose reporter_id)
  functions/
    priority_score.sql      -- transparent, explainable priority formula
    escalation.sql          -- scheduled 14-day auto-escalation job
    jurisdiction_lookup.sql -- getWardFromCoordinates() via PostGIS
  seed/
    001_seed_data.sql       -- demo jurisdiction tree (India > UP > Lucknow > ...)
    002_seed_users.ts       -- demo accounts via env-configured credentials
  src/
    supabaseClient.ts       -- secure-storage session client
    services/                -- business logic, kept out of UI components
      jurisdictionService.ts
      complaintService.ts
      votingService.ts
      verificationService.ts
      escalationService.ts
      governmentService.ts
    types/domain.ts
  .env.example
```

## Core design decisions

**Identity is structurally separated from complaints.** `user_identity` and
`complaints` are different tables with different RLS policies; no policy
grants any government role `SELECT` on `user_identity`, ever. Clients read
complaints and comments through `complaints_public` / `comments_public`
views that hardcode `'Anonymous Citizen'` rather than joining to identity —
so there's no query path, correct or buggy, that can leak a name.

**Nothing trusts the client for authorization.** Role and jurisdiction live
in the `roles` table, populated only by a trusted admin process — never by a
client-side insert. Every jurisdiction-scoped `SELECT`/`UPDATE` policy on
`complaints` re-derives the caller's role and jurisdiction from `auth.uid()`
on the server. A modified app can't grant itself a higher role or someone
else's ward.

**Priority is a formula, not a raw upvote sort**, computed server-side
(`compute_priority_score`) so it can't be gamed client-side, and the
breakdown (severity, community support, time pending, verification
confidence, safety impact) is shown back to users — see section 38's "why is
this prioritized" requirement.

**Escalation is immutable and configurable.** `complaint_escalations` has no
update/delete grants for any role. `escalation_rules` lets each complaint
category have its own SLA and its own chain of roles, rather than hardcoding
one 6-level hierarchy for every jurisdiction in India, since real
administrative structures vary between urban and rural areas.

**Crime reports skip the ward geo-lock** (`geo_lock_exempt` generated
column) but still get a location attached to the *incident*, separate from
the reporter's own coordinates, which are never exposed publicly regardless
of category.

## Setup (once you have a real Supabase project)

```bash
cp .env.example .env        # fill in your project's values
supabase db push            # runs migrations/ in order
psql < functions/priority_score.sql
psql < functions/escalation.sql
psql < functions/jurisdiction_lookup.sql
psql < seed/001_seed_data.sql
npm install
npm run seed:users          # creates demo accounts from .env
```

Enable `pg_cron` in the Supabase dashboard and schedule the escalation
check:

```sql
select cron.schedule('civicconnect-escalation-check', '0 * * * *', 'select run_escalation_check();');
```

## Security notes

- RLS is enabled on every table that holds user or complaint data; the
  handful of `SELECT` policies per role in `002_rls_policies.sql` are the
  actual enforcement — the prototype's UI-level role switcher is a demo
  convenience only and has no bearing on real authorization.
- The `service_role` key is never referenced from `src/` (app code) — only
  from `seed/002_seed_users.ts` and the scheduled function, both of which
  run outside the shipped app.
- Photo EXIF stripping happens in an edge function between upload and
  storage (stubbed as a comment in `complaintService.ts`), not on-device,
  so it can't be skipped by a modified client.
