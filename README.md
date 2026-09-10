# CivicConnect

**Your Voice. Your Community. Your Government.**

A civic grievance platform: citizens report issues to the right government
authority by ward jurisdiction, reports stay anonymous to officials, the
community upvotes with a transparent priority score, and anything unresolved
past 14 days auto-escalates up the administrative chain — Ward Councillor →
Village Head → Tehsildar/SDM → DM/Collector → CM → Central Government.

```
civicconnect/
  prototype/   ← open index.html in a browser — fully interactive UI demo
  backend/     ← Supabase schema, RLS policies, SQL functions, service layer
  mobile/      ← Expo/React Native app skeleton, wired to backend/src/services
```

## Quick start

**See it now (no setup):** open `prototype/index.html` in any browser. Every
screen and interaction — login, raising a complaint with the geo-lock check,
the verification-button animation, community upvoting, and jurisdiction-
scoped government dashboards for all six roles — is live, with mock data and
a light/dark liquid-glass theme toggle in Profile → Theme.

**Stand up the real backend:**
```bash
cd backend
cp .env.example .env        # fill in your Supabase project values
supabase db push            # runs migrations/ in order
psql < functions/priority_score.sql
psql < functions/escalation.sql
psql < functions/jurisdiction_lookup.sql
psql < seed/001_seed_data.sql
npm install && npm run seed:users
```

**Run the mobile app against it:**
```bash
cd mobile
cp .env.example .env        # same Supabase URL/anon key as backend/.env
npm install
npx expo start
```

## What's real vs. what's a starting point

| Piece | Status |
|---|---|
| `prototype/` | Complete, runs as-is, no dependencies |
| `backend/migrations`, `functions`, RLS | Production-shaped SQL, ready to push to a real Supabase project |
| `backend/src/services` | Real TypeScript implementing every documented flow (submit, vote, verify, escalate, dashboard) |
| `mobile/` | A working Expo skeleton — navigation, theming, auth, and two fully wired screens (Login, Home) that call the real backend services. The remaining ~28 screens follow the exact same pattern (see comments in `mobile/src/navigation/RootNavigator.tsx`) and map 1:1 onto the prototype screens and `backend/src/services` functions. |

Each backend folder has its own README/comments going deeper — start with
`backend/README.md` for the architecture and security model.

## License

MIT — see `LICENSE`.
