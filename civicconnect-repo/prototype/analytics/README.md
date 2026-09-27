# Government Portal: hierarchical analytics, SLA escalation and ranking

This folder adds an accountability layer to the prototype's Government
Portal:

    Citizen → Ward Councillor → SDM → DM → CM → PM

Every office sees how complaints are handled in its jurisdiction and by the
offices below it. Complaints that miss their SLA escalate automatically.

## What's in the portal

- **Official login.** Pick a role, then a jurisdiction (e.g. Ward Councillor →
  Ward 42). The demo covers 5 states, 12 districts, 25 SDMs and 100 wards.
- **Complaints.** Only those inside your jurisdiction, each with an SLA
  countdown, plus an alert for any about to breach within 48 hours.
- **Complaint detail.** The escalation chain, deadline and escalation history.
  Resolving requires a note and a photo.
- **Escalated.** A permanent record of every escalation: previous and new
  authority, time, reason, SLA deadline, time taken and current status.
- **📊 Analytics & Performance.**
  - Tabs: Overview, Rankings, SLA, Escalations, Map.
  - Periods: today, 7 days, 30 days, month, quarter, year, custom.
  - Drill-down: India → State → District → Sub-district → Ward.
  - A wide "command-centre" layout for laptops.
- **Citizen side.** New complaints are routed to a ward from their GPS
  location. The reporter can confirm a fix, or dispute it to reopen the
  complaint.

## Rules

- **Scoring** (configurable):
  - 40% verified resolution rate
  - 30% SLA compliance
  - 20% timeliness
  - 10% avoided escalation
  - minus a penalty for fixes that citizens dispute
- **Anti-gaming.** A closure counts only with photo evidence or citizen
  confirmation.
- **Fair rates.** Complaints still inside their SLA window don't count for or
  against anyone yet. Offices with too few complaints show *Insufficient
  data*, never a fake 0% or Rank #1.
- **SLAs per category** (crime 3 days … roads 14 days). Each level of the
  chain gets a fresh window.
- **Rankings always name the comparison group**, e.g. "Rank #2 of 6 Ward
  Councillors in Lucknow Sadar". Peers appear as aggregate scores only;
  their complaints stay private.

## Live vs offline demo

The authoritative implementation is the CityCare backend (FastAPI,
`app/analytics/`). It enforces jurisdiction on every request: tampered IDs or
URLs get `403`.

- **Live.** When the backend at `citycare-backend-ft8o.onrender.com` exposes
  `/api/gov/...`, the portal uses it. The badge reads **Live · server-enforced**.
- **Offline demo.** Until then, or while the free-tier server is waking up,
  the portal runs an in-browser mirror of the same engine (`engine.js`,
  `local-server.js`) on the demo dataset (`seed.js`). The badge reads
  **Offline demo**.

The backend's parity test fails if the two implementations ever disagree.

`?api=offline` forces the mirror; `?api=<url>` points at another backend.

| File | Role |
|---|---|
| `ui.js` | Government Portal screens (they only render API results) |
| `api.js` | API client, live/offline switching |
| `engine.js`, `local-server.js` | Offline mirror of the backend engine and routes |
| `analytics.css` | Styles, built on the prototype's design tokens |
| `seed.js` | Generated demo dataset (by the backend's `scripts/generate_analytics_seed.py`) |

## Demo walkthrough

1. **Ward Councillor · Ward 24** → 📊 Analytics: score, rank among peers,
   trend against the peer average.
2. **Profile → Try to open another ward's data**: access is refused.
3. **SLA tab → At risk**: two demo complaints breach a few minutes after the
   data loads, then move to the SDM on their own.
4. **Tehsildar / SDM (Lucknow Sadar)**: blended score, the escalated cases it
   handled, its six wards ranked. Drill into Ward 7. Check Ward 30 with *All
   time* selected: it closes complaints fast but mostly without proof, and
   ranks last.
5. **PM / Central Government**: CMs compared nationwide; SDM ranking narrowed
   by state; map; drill down to a single ward.
6. Resolve a complaint as a councillor with a photo, then watch the analytics
   update. As the citizen, dispute **CMP24002** and watch it reopen.
