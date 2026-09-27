/*
 * CivicConnect analytics engine - OFFLINE MIRROR.
 *
 * The authoritative implementation is the backend (citycare-backend:
 * app/analytics/engine.py + access.py). This file is a line-for-line port used
 * only when that server is unreachable (e.g. the static GitHub Pages demo), so
 * the prototype keeps working. tests/test_parity.py in the backend runs both
 * implementations on the same data and fails if they disagree.
 *
 * Keep CONFIG in sync with app/analytics/config.py.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CCEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONFIG = {
    ESCALATION_CHAIN: ['WARD', 'SDM', 'DISTRICT', 'STATE', 'COUNTRY'],
    LEVEL_RANK: { WARD: 1, REGION: 1.5, SDM: 2, DISTRICT: 3, STATE: 4, COUNTRY: 5 },
    UNIT_TYPE_LEVEL: { ward: 'WARD', region: 'REGION', sdm: 'SDM', district: 'DISTRICT', state: 'STATE', country: 'COUNTRY' },
    LEVEL_ROLE: { WARD: 'WARD_COUNCILLOR', REGION: 'VILLAGE_HEAD', SDM: 'TEHSILDAR_SDM', DISTRICT: 'DM_COLLECTOR', STATE: 'CM', COUNTRY: 'PM_CENTRAL_ADMIN' },
    ROLE_LABEL: {
      WARD_COUNCILLOR: 'Ward Councillor', VILLAGE_HEAD: 'Village Head', TEHSILDAR_SDM: 'Tehsildar / SDM',
      DM_COLLECTOR: 'DM / Collector', CM: 'Chief Minister', PM_CENTRAL_ADMIN: 'PM / Central Government',
    },
    LEVEL_PEER_NOUN: { WARD: ['Ward Councillor', 'Ward Councillors'], SDM: ['SDM', 'SDMs'], DISTRICT: ['DM', 'DMs'], STATE: ['CM', 'CMs'] },
    CATEGORY_SLA_DAYS: {
      crime: 3, publicsafety: 5, water: 7, electricity: 7, garbage: 7, sanitation: 10, drainage: 10,
      community: 14, infrastructure: 14, environment: 14, roads: 14, streetlights: 14, traffic: 14, other: 14,
    },
    DEFAULT_SLA_DAYS: 14,
    SCORING: {
      weights: { resolution: 0.40, sla: 0.30, speed: 0.20, escalation: 0.10 },
      reopen_penalty: 40.0,
      min_received: 3,
      min_due: 2,
      level_blend: {
        SDM: { own: 0.5, system: 0.5 }, DISTRICT: { own: 0.4, system: 0.6 },
        STATE: { own: 0.3, system: 0.7 }, COUNTRY: { own: 0.0, system: 1.0 },
      },
      min_own_received: 2,
      bands: { good: 80.0, watch: 60.0 },
      sla_target: 85.0,
    },
    RESOLUTION_POLICY: { requires_evidence_or_confirmation: true, confirmation_window_days: 7 },
    TZ_OFFSET_MINUTES: 330,
    AT_RISK_HOURS: 48,
  };
  const LEVEL_UNIT_TYPE = {};
  Object.keys(CONFIG.UNIT_TYPE_LEVEL).forEach(k => { LEVEL_UNIT_TYPE[CONFIG.UNIT_TYPE_LEVEL[k]] = k; });

  const MIN_MS = 60 * 1000, HOUR_MS = 60 * MIN_MS, DAY_MS = 24 * HOUR_MS;
  const TZ_MS = CONFIG.TZ_OFFSET_MINUTES * MIN_MS;
  const FAR_FUTURE = 1e15;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const CATEGORY_ORDER = ['roads', 'garbage', 'streetlights', 'water', 'drainage', 'electricity', 'sanitation',
    'infrastructure', 'publicsafety', 'traffic', 'community', 'environment', 'crime', 'other'];
  const LEVEL_LABEL = { WARD: 'Ward', REGION: 'Local region', SDM: 'SDM', DISTRICT: 'District', STATE: 'State', COUNTRY: 'National' };
  const OPEN = ['PENDING', 'VERIFIED', 'IN_PROGRESS', 'ESCALATED'];
  const isOpen = s => OPEN.indexOf(s) >= 0;

  class PolicyError extends Error {
    constructor(status, message) { super(message); this.status = status; this.message = message; }
  }

  const r1 = x => Math.round(x * 10) / 10;
  const pct = (n, d) => (d ? r1(100.0 * n / d) : null);
  const slaMs = cat => (CONFIG.CATEGORY_SLA_DAYS[cat] || CONFIG.DEFAULT_SLA_DAYS) * DAY_MS;
  const slaDays = cat => CONFIG.CATEGORY_SLA_DAYS[cat] || CONFIG.DEFAULT_SLA_DAYS;
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ------------------------------------------------------------------ Dataset */
  class Dataset {
    constructor(units, authorities, complaints, escalations, descriptions) {
      this.units = {}; this.children = {};
      units.forEach(u => { this.units[u.id] = u; this.children[u.id] = []; });
      units.forEach(u => { if (u.parent && u.type !== 'region') this.children[u.parent].push(u.id); });
      Object.keys(this.children).forEach(k => this.children[k].sort(cmpStr));
      this.authorities = {}; this.authority_by_unit = {};
      authorities.forEach(a => {
        const level = CONFIG.UNIT_TYPE_LEVEL[this.units[a.unit].type];
        const role = CONFIG.LEVEL_ROLE[level];
        const full = { id: a.id, unit: a.unit, title: a.title, level, role, role_label: CONFIG.ROLE_LABEL[role] };
        this.authorities[a.id] = full; this.authority_by_unit[a.unit] = full;
      });
      this.complaints = {};
      complaints.forEach(c => { this.complaints[c.id] = c; });
      this.escalations = escalations || [];
      this.descriptions = descriptions || {};
      this._wardCache = {};
      this.reindex();
    }
    reindex() {
      this.by_ward = {};
      Object.keys(this.complaints).sort(cmpStr).forEach(id => {
        const c = this.complaints[id];
        (this.by_ward[c.ward_id] = this.by_ward[c.ward_id] || []).push(c);
      });
    }
    addComplaint(c) { this.complaints[c.id] = c; this.reindex(); }
    levelOf(unitId) { return CONFIG.UNIT_TYPE_LEVEL[this.units[unitId].type]; }
    ancestor(wardId, level) {
      const want = LEVEL_UNIT_TYPE[level];
      let u = this.units[wardId];
      while (u.type !== want) u = this.units[u.parent];
      return u.id;
    }
    path(unitId) {
      const out = [];
      let u = this.units[unitId];
      while (u) { out.push({ id: u.id, type: u.type, name: u.name, short: u.short }); u = u.parent ? this.units[u.parent] : null; }
      return out.reverse();
    }
    subtree(unitId) {
      const u = this.units[unitId];
      if (u.type === 'region') return [unitId].concat(u.ward_ids.slice().sort(cmpStr));
      const out = [], stack = [unitId];
      while (stack.length) { const id = stack.pop(); out.push(id); stack.push.apply(stack, this.children[id]); }
      return out.sort(cmpStr);
    }
    wardsUnder(unitId) {
      if (!this._wardCache[unitId]) this._wardCache[unitId] = this.subtree(unitId).filter(id => this.units[id].type === 'ward');
      return this._wardCache[unitId];
    }
    complaintsIn(unitId) {
      let out = [];
      this.wardsUnder(unitId).forEach(w => { out = out.concat(this.by_ward[w] || []); });
      return out.sort(byId);
    }
    peerGroup(unitId) {
      const u = this.units[unitId];
      const level = CONFIG.UNIT_TYPE_LEVEL[u.type];
      if (!CONFIG.LEVEL_PEER_NOUN[level] || !u.parent) return null;
      return [level, u.parent];
    }
  }

  /* ------------------------------------------------------------- Seed loading */
  function datasetFromSeed(seed, now) {
    const ds = new Dataset(seed.units, seed.authorities, [], [], seed.descriptions || {});
    const complaints = seed.complaints.map(row => complaintFromSeed(ds, row, now));
    ds.complaints = {};
    complaints.forEach(c => { ds.complaints[c.id] = c; });
    ds.reindex();
    ds.escalations = deriveEscalations(ds, complaints);
    return ds;
  }

  function complaintFromSeed(ds, row, now) {
    const [cid, category, title, wardId, severity, upvotes, flags, created, status, asgRows, res, conf, confAt, reopen] = row;
    const t = minutes => now + minutes * MIN_MS;
    const window = slaMs(category);
    const assignments = [];
    asgRows.forEach((a, i) => {
      const [level, start, outcome, outcomeAt] = a;
      const unitId = ds.ancestor(wardId, level);
      const reason = i === 0 ? 'NEW' : (assignments[assignments.length - 1].outcome === 'REOPENED' ? 'REOPEN' : 'ESCALATION');
      const rec = {
        level, unit_id: unitId, authority_id: ds.authority_by_unit[unitId].id, assigned_at: t(start),
        deadline: t(start) + window, outcome, outcome_at: outcome ? t(outcomeAt) : null, reason,
        closed_at: null, closed_evidence: null,
      };
      if (outcome === 'REOPENED') { rec.closed_at = t(a[4][0]); rec.closed_evidence = !!a[4][1]; }
      assignments.push(rec);
    });
    let resolution = null;
    if (res) {
      const unitId = ds.ancestor(wardId, res[1]);
      resolution = {
        at: t(res[0]), level: res[1], authority_id: ds.authority_by_unit[unitId].id, evidence: !!res[2],
        note: res[2] ? 'Resolved - site photo attached.' : 'Marked resolved without photo evidence.',
      };
    }
    const ward = ds.units[wardId];
    return {
      id: cid, category, title,
      description: ds.descriptions[cid] || `${title}. Reported by a resident of ${ward.name}.`,
      ward_id: wardId, severity, upvotes,
      community_verified: !!(flags & 1), gov_verified: !!(flags & 2),
      reporter: (flags & 4) ? 'citizen-demo' : 'anonymous',
      created_at: t(created), status, level: assignments[assignments.length - 1].level,
      assignments, resolution,
      confirmation: conf === 1 ? 'CONFIRMED' : null,
      confirmation_at: conf === 1 ? t(confAt) : null,
      reopen_count: reopen, events: [], source: 'seed', intake_id: null,
    };
  }

  function deriveEscalations(ds, complaints) {
    const out = [];
    complaints.slice().sort(byId).forEach(c => {
      const asg = c.assignments;
      asg.forEach((a, i) => {
        if (a.outcome === 'ESCALATED' && i + 1 < asg.length) out.push(escalationRecord(c, a, asg[i + 1], 'AUTO_SLA', autoReason(c, a)));
      });
    });
    return out;
  }

  function autoReason(c, a) {
    return `SLA of ${slaDays(c.category)} days breached at ${LEVEL_LABEL[a.level]} level - escalated automatically`;
  }

  function escalationRecord(c, frm, to, trigger, reason) {
    return {
      complaint_id: c.id, from_level: frm.level, to_level: to.level, from_authority: frm.authority_id,
      to_authority: to.authority_id, escalated_at: to.assigned_at, sla_deadline: frm.deadline,
      elapsed_ms: to.assigned_at - frm.assigned_at, reason, trigger,
    };
  }

  /* --------------------------------------------------------------- Escalation */
  function escalate(ds, c, at, trigger, reason) {
    const last = c.assignments[c.assignments.length - 1];
    const chain = CONFIG.ESCALATION_CHAIN;
    const nextLevel = chain[chain.indexOf(c.level) + 1];
    const unitId = ds.ancestor(c.ward_id, nextLevel);
    const auth = ds.authority_by_unit[unitId];
    last.outcome = 'ESCALATED'; last.outcome_at = at;
    const nxt = {
      level: nextLevel, unit_id: unitId, authority_id: auth.id, assigned_at: at, deadline: at + slaMs(c.category),
      outcome: null, outcome_at: null, reason: 'ESCALATION', closed_at: null, closed_evidence: null,
    };
    c.assignments.push(nxt);
    c.level = nextLevel; c.status = 'ESCALATED';
    const rec = escalationRecord(c, last, nxt, trigger, reason);
    ds.escalations.push(rec);
    return rec;
  }

  function runEscalations(ds, now) {
    const changed = [], records = [];
    const chain = CONFIG.ESCALATION_CHAIN;
    Object.keys(ds.complaints).sort(cmpStr).forEach(cid => {
      const c = ds.complaints[cid];
      while (isOpen(c.status)) {
        const last = c.assignments[c.assignments.length - 1];
        if (now <= last.deadline || chain.indexOf(c.level) < 0) break;
        if (chain.indexOf(c.level) === chain.length - 1) break;
        records.push(escalate(ds, c, last.deadline, 'AUTO_SLA', autoReason(c, last)));
        if (changed.indexOf(cid) < 0) changed.push(cid);
      }
    });
    return [changed, records];
  }

  /* ------------------------------------------------------------------ Periods */
  function ymd(ms) { const d = new Date(ms + TZ_MS); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; }
  function dateMs(y, m, d) {
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return Date.UTC(y, m - 1, d) - TZ_MS;
  }
  function fmtDay(ms) { const [y, m, d] = ymd(ms); return `${String(d).padStart(2, '0')} ${MONTHS[m - 1].slice(0, 3)} ${y}`; }
  function parseDate(s) {
    const p = String(s).split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) throw new PolicyError(422, 'Dates must be YYYY-MM-DD.');
    return dateMs(p[0], p[1], p[2]);
  }
  function _period(key, label, f, t, pf, pt, prevLabel) {
    return { key, label, from: f, to: t, prev: pf !== null ? { from: pf, to: pt, label: prevLabel } : null };
  }
  function periodRange(key, now, frm, to) {
    const [y, m, d] = ymd(now);
    const today = dateMs(y, m, d);
    if (key === 'today') return _period(key, 'Today', today, today + DAY_MS, today - DAY_MS, today, 'vs yesterday');
    if (key === '7d') return _period(key, 'Last 7 days', now - 7 * DAY_MS, now + 1, now - 14 * DAY_MS, now - 7 * DAY_MS, 'vs previous 7 days');
    if (key === '30d') return _period(key, 'Last 30 days', now - 30 * DAY_MS, now + 1, now - 60 * DAY_MS, now - 30 * DAY_MS, 'vs previous 30 days');
    if (key === 'this_month') return _period(key, `This month (${MONTHS[m - 1]} ${y})`, dateMs(y, m, 1), dateMs(y, m + 1, 1), dateMs(y, m - 1, 1), dateMs(y, m, 1), 'vs last month');
    if (key === 'last_month') {
      const [py, pm] = ymd(dateMs(y, m - 1, 1));
      return _period(key, `Last month (${MONTHS[pm - 1]} ${py})`, dateMs(y, m - 1, 1), dateMs(y, m, 1), dateMs(y, m - 2, 1), dateMs(y, m - 1, 1), 'vs the month before');
    }
    if (key === 'this_quarter') {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      const label = `This quarter (${MONTHS[qm - 1].slice(0, 3)}-${MONTHS[qm + 1].slice(0, 3)} ${y})`;
      return _period(key, label, dateMs(y, qm, 1), dateMs(y, qm + 3, 1), dateMs(y, qm - 3, 1), dateMs(y, qm, 1), 'vs last quarter');
    }
    if (key === 'this_year') return _period(key, `This year (${y})`, dateMs(y, 1, 1), dateMs(y + 1, 1, 1), dateMs(y - 1, 1, 1), dateMs(y, 1, 1), 'vs last year');
    if (key === 'custom' && frm && to) {
      const f = parseDate(frm), t = parseDate(to) + DAY_MS;
      if (t <= f) throw new PolicyError(422, 'The custom range must end on or after its start date.');
      return _period(key, `${fmtDay(f)} - ${fmtDay(t - DAY_MS)}`, f, t, f - (t - f), f, 'vs the previous equal period');
    }
    return _period('all', 'All time', 0, FAR_FUTURE, null, null, null);
  }

  /* ------------------------------------------------------------------ Metrics */
  function isValidResolution(c) {
    const r = c.resolution;
    if (c.status !== 'RESOLVED' || !r) return false;
    if (!CONFIG.RESOLUTION_POLICY.requires_evidence_or_confirmation) return true;
    return !!r.evidence || c.confirmation === 'CONFIRMED';
  }

  function counts() {
    return {
      received: 0, resolved: 0, unverified: 0, within: 0, breached: 0, determined: 0, pending: 0, overdue: 0,
      escalated: 0, esc_resolved: 0, esc_pending: 0, reopened: 0, resolved_by_other: 0, open_in_sla: 0,
      evidence: 0, confirmed: 0, dur_sum: 0, speed_sum: 0.0,
    };
  }

  function levelCounts(complaints, level, f, t, now) {
    const m = counts();
    for (const c of complaints) {
      const asg = c.assignments.filter(a => a.level === level);
      if (!asg.length) continue;
      const first = asg[0], last = asg[asg.length - 1];
      if (!(f <= first.assigned_at && first.assigned_at < t)) continue;
      const res = c.resolution;
      const resolved = c.status === 'RESOLVED';
      const resolvedHere = resolved && !!res && res.level === level;
      const validHere = resolvedHere && isValidResolution(c);
      const escalated = asg.some(a => a.outcome === 'ESCALATED');
      const reopened = asg.some(a => a.outcome === 'REOPENED');
      const openHere = !resolved && c.level === level;
      const late = resolvedHere && res.at > last.deadline;
      const breached = escalated || (openHere && now > last.deadline) || late;
      m.received += 1;
      if (validHere) {
        m.resolved += 1;
        const dur = res.at - first.assigned_at;
        m.dur_sum += dur;
        m.speed_sum += Math.max(0.0, 1.0 - dur / (first.deadline - first.assigned_at));
        if (!late) m.within += 1;
        if (res.evidence) m.evidence += 1;
        if (c.confirmation === 'CONFIRMED') m.confirmed += 1;
      } else if (resolvedHere) {
        m.unverified += 1;
      } else if (resolved && !escalated) {
        m.resolved_by_other += 1;
      }
      if (resolvedHere || breached) m.determined += 1;
      if (breached) { m.breached += 1; if (!resolved) m.overdue += 1; }
      if (openHere) { m.pending += 1; if (!breached) m.open_in_sla += 1; }
      if (escalated) {
        m.escalated += 1;
        if (resolved && isValidResolution(c)) m.esc_resolved += 1;
        else if (!resolved) m.esc_pending += 1;
      }
      if (reopened) m.reopened += 1;
    }
    return m;
  }

  function systemCounts(complaints, f, t, now) {
    const m = counts();
    for (const c of complaints) {
      if (!(f <= c.created_at && c.created_at < t)) continue;
      const res = c.resolution;
      const asg = c.assignments;
      const first = asg[0], last = asg[asg.length - 1];
      const resolved = c.status === 'RESOLVED';
      const valid = resolved && isValidResolution(c);
      const escalated = asg.some(a => a.outcome === 'ESCALATED');
      const late = resolved && res.at > last.deadline;
      const breached = escalated || (!resolved && now > last.deadline) || late;
      m.received += 1;
      if (valid) {
        m.resolved += 1;
        const dur = res.at - c.created_at;
        m.dur_sum += dur;
        m.speed_sum += Math.max(0.0, 1.0 - dur / (first.deadline - first.assigned_at));
        if (!breached) m.within += 1;
        if (res.evidence) m.evidence += 1;
        if (c.confirmation === 'CONFIRMED') m.confirmed += 1;
      } else if (resolved) {
        m.unverified += 1;
      }
      if (resolved || breached) m.determined += 1;
      if (breached) { m.breached += 1; if (!resolved) m.overdue += 1; }
      if (!resolved) { m.pending += 1; if (!breached) m.open_in_sla += 1; }
      if (escalated) {
        m.escalated += 1;
        if (valid) m.esc_resolved += 1;
        else if (!resolved) m.esc_pending += 1;
      }
      if (c.reopen_count > 0) m.reopened += 1;
    }
    return m;
  }

  function finalize(m) {
    const closures = m.resolved + m.unverified;
    const due = m.received - m.open_in_sla;
    return {
      received: m.received, due, in_progress_within_sla: m.open_in_sla,
      resolved: m.resolved, unverified_closures: m.unverified,
      pending: m.pending, overdue: m.overdue, escalated: m.escalated,
      escalated_resolved: m.esc_resolved, escalated_pending: m.esc_pending,
      within_sla: m.within, sla_breached: m.breached, sla_determined: m.determined,
      reopened: m.reopened, resolved_by_other: m.resolved_by_other,
      resolution_rate: pct(m.resolved, due),
      sla_compliance: pct(m.within, m.determined),
      avg_resolution_days: m.resolved ? r1(m.dur_sum / m.resolved / DAY_MS) : null,
      escalation_rate: pct(m.escalated, due),
      escalation_resolution_rate: pct(m.esc_resolved, m.escalated),
      reopen_rate: pct(m.reopened, due),
      verified_closure_share: pct(m.resolved, closures),
      evidence_rate: pct(m.evidence, m.resolved),
      citizen_confirmation_rate: pct(m.confirmed, m.resolved),
    };
  }

  function scoreOf(m) {
    const S = CONFIG.SCORING;
    const due = m.received - m.open_in_sla;
    if (m.received < S.min_received || due < S.min_due || m.determined < 1) return null;
    const w = S.weights;
    const resolution = 100.0 * m.resolved / due;
    const sla = 100.0 * m.within / m.determined;
    const speed = m.resolved ? 100.0 * m.speed_sum / m.resolved : 0.0;
    const escalation = 100.0 - 100.0 * m.escalated / due;
    const base = w.resolution * resolution + w.sla * sla + w.speed * speed + w.escalation * escalation;
    const penalty = S.reopen_penalty * m.reopened / due;
    const value = Math.min(100.0, Math.max(0.0, base - penalty));
    return {
      value,
      components: [
        { key: 'resolution', label: 'Verified resolution rate', value: r1(resolution), weight: w.resolution, points: r1(w.resolution * resolution) },
        { key: 'sla', label: 'SLA compliance', value: r1(sla), weight: w.sla, points: r1(w.sla * sla) },
        { key: 'speed', label: 'Timeliness (SLA window left)', value: r1(speed), weight: w.speed, points: r1(w.speed * speed) },
        { key: 'escalation', label: 'Avoided escalation', value: r1(escalation), weight: w.escalation, points: r1(w.escalation * escalation) },
      ],
      penalty: r1(penalty),
    };
  }

  function insufficientReason(m) {
    if (m.received === 0) return 'No complaints received during this period.';
    if (m.received < CONFIG.SCORING.min_received) return `Only ${m.received} complaint(s) in this period - at least ${CONFIG.SCORING.min_received} are needed to score fairly.`;
    return 'Most complaints in this period are still inside their SLA window - not enough outcomes to score yet.';
  }

  function evaluate(ds, unitId, f, t, now, complaints) {
    const cs = complaints || ds.complaintsIn(unitId);
    const level = ds.levelOf(unitId);
    const sysC = systemCounts(cs, f, t, now);
    let ownC = null;
    if (CONFIG.ESCALATION_CHAIN.indexOf(level) >= 0 && level !== 'COUNTRY') ownC = levelCounts(cs, level, f, t, now);
    const ss = scoreOf(sysC);
    let value = null, basis = null, detail = null, blend = null, primary;
    if (level === 'WARD') {
      const so = scoreOf(ownC);
      primary = ownC;
      if (so) { value = so.value; basis = 'own'; detail = so; }
    } else if (level === 'REGION' || level === 'COUNTRY') {
      primary = sysC;
      if (ss) { value = ss.value; basis = 'system'; detail = ss; }
    } else {
      primary = sysC;
      const weights = CONFIG.SCORING.level_blend[level];
      const so = ownC.received >= CONFIG.SCORING.min_own_received ? scoreOf(ownC) : null;
      if (ss) {
        if (so && weights.own > 0) {
          value = weights.own * so.value + weights.system * ss.value;
          basis = 'blend';
          blend = { own_weight: weights.own, system_weight: weights.system, own_score: r1(so.value), system_score: r1(ss.value) };
        } else { value = ss.value; basis = 'system'; }
        detail = ss;
      }
    }
    return {
      unit_id: unitId, level, score: value !== null ? r1(value) : null, basis, detail, blend,
      insufficient_reason: value !== null ? null : insufficientReason(primary),
      primary, system: sysC, own: ownC,
    };
  }

  function band(score) {
    if (score === null || score === undefined) return 'none';
    if (score >= CONFIG.SCORING.bands.good) return 'good';
    return score >= CONFIG.SCORING.bands.watch ? 'watch' : 'critical';
  }

  /* ------------------------------------------------------------------ Ranking */
  function sortRanked(rows) {
    return rows.slice().sort((a, b) => (b.score - a.score) || ((b.resolution_rate || 0) - (a.resolution_rate || 0)) || cmpStr(a.unit_id, b.unit_id));
  }

  function ranking(ds, level, withinId, f, t, now) {
    const utype = LEVEL_UNIT_TYPE[level];
    const units = ds.subtree(withinId).filter(id => ds.units[id].type === utype && id !== withinId).sort(cmpStr);
    const rows = units.map(uid => {
      const ev = evaluate(ds, uid, f, t, now);
      const pm = finalize(ev.primary);
      return { unit_id: uid, score: ev.score, resolution_rate: pm.resolution_rate, ev, pm };
    });
    const ranked = sortRanked(rows.filter(r => r.score !== null));
    ranked.forEach((r, i) => { r.position = i + 1; });
    const unranked = rows.filter(r => r.score === null);
    unranked.forEach(r => { r.position = null; });
    return [ranked, unranked];
  }

  function groupLabel(ds, level, withinId, count) {
    const [singular, plural] = CONFIG.LEVEL_PEER_NOUN[level];
    const within = ds.units[withinId];
    const where = within.type === 'country' ? 'nationwide' : `in ${within.name}`;
    return `${count} ${count === 1 ? singular : plural} ${where}`;
  }

  function rankContext(ds, unitId, f, t, now) {
    const group = ds.peerGroup(unitId);
    if (!group) return null;
    const [level, within] = group;
    const [ranked, unranked] = ranking(ds, level, within, f, t, now);
    const me = ranked.find(r => r.unit_id === unitId) || null;
    const [singular, plural] = CONFIG.LEVEL_PEER_NOUN[level];
    const withinU = ds.units[within];
    const where = withinU.type === 'country' ? 'nationwide' : `in ${withinU.name}`;
    const total = ranked.length;
    const noun = total === 1 ? singular : plural;
    const label = me ? `Rank #${me.position} of ${total} ${noun} ${where}` : `Not ranked - insufficient data (${total} ${noun} ranked ${where})`;
    return {
      position: me ? me.position : null, of: total, unranked: unranked.length, level, within,
      within_name: withinU.name, label,
      peer_average: total ? r1(ranked.reduce((s, r) => s + r.score, 0) / total) : null,
    };
  }

  /* -------------------------------------------------------------------- Views */
  function unitBrief(ds, unitId) {
    const u = ds.units[unitId];
    const a = ds.authority_by_unit[unitId];
    return {
      id: u.id, type: u.type, name: u.name, short: u.short, level: CONFIG.UNIT_TYPE_LEVEL[u.type],
      authority: a ? { id: a.id, title: a.title, role: a.role, role_label: a.role_label } : null,
    };
  }

  function childUnits(ds, unitId) {
    const u = ds.units[unitId];
    if (u.type === 'region') return u.ward_ids.slice().sort(cmpStr);
    return ds.children[unitId].slice();
  }

  function rowFor(ds, uid, ev, position) {
    const pm = finalize(ev.primary), sm = finalize(ev.system);
    return Object.assign(unitBrief(ds, uid), {
      score: ev.score, band: band(ev.score), position: position === undefined ? null : position,
      basis: ev.basis, insufficient_reason: ev.insufficient_reason,
      received: pm.received, resolved: pm.resolved, pending: sm.pending, overdue: sm.overdue, escalated: pm.escalated,
      resolution_rate: pm.resolution_rate, sla_compliance: pm.sla_compliance, avg_resolution_days: pm.avg_resolution_days,
      escalation_rate: pm.escalation_rate, reopen_rate: pm.reopen_rate, unverified_closures: pm.unverified_closures,
    });
  }

  function childrenView(ds, unitId, f, t, now) {
    const kids = childUnits(ds, unitId);
    if (!kids.length) return null;
    const level = ds.levelOf(kids[0]);
    const rows = kids.map(uid => [uid, evaluate(ds, uid, f, t, now)]);
    const ranked = sortRanked(rows.filter(r => r[1].score !== null).map(([uid, ev]) => ({
      unit_id: uid, score: ev.score, resolution_rate: finalize(ev.primary).resolution_rate, ev,
    })));
    const items = ranked.map((r, i) => rowFor(ds, r.unit_id, r.ev, i + 1))
      .concat(rows.filter(r => r[1].score === null).map(([uid, ev]) => rowFor(ds, uid, ev)));
    const plural = (CONFIG.LEVEL_PEER_NOUN[level] || ['Ward', 'Wards'])[1];
    const unit = ds.units[unitId];
    const where = unit.type === 'country' ? 'nationwide' : `in ${unit.name}`;
    return { level, title: `${plural} ${where}`, noun: plural, unit_type: ds.units[kids[0]].type, items };
  }

  function statusBreakdown(complaints, f, t, now) {
    const out = { resolved_verified: 0, unverified_closure: 0, open_within_sla: 0, overdue: 0 };
    for (const c of complaints) {
      if (!(f <= c.created_at && c.created_at < t)) continue;
      if (c.status === 'RESOLVED') { out[isValidResolution(c) ? 'resolved_verified' : 'unverified_closure'] += 1; continue; }
      const escalated = c.assignments.some(a => a.outcome === 'ESCALATED');
      if (escalated || now > c.assignments[c.assignments.length - 1].deadline) out.overdue += 1;
      else out.open_within_sla += 1;
    }
    return out;
  }

  function monthWindows(now, count, span) {
    span = span || 3;
    const [y, m] = ymd(now);
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const f = dateMs(y, m - i - span + 1, 1);
      const t = dateMs(y, m - i + 1, 1);
      const [yy, mm] = ymd(dateMs(y, m - i, 1));
      out.push([f, t, `${MONTHS[mm - 1].slice(0, 3)} ${String(yy).slice(2)}`]);
    }
    return out;
  }

  function trend(ds, unitId, now, months) {
    months = months || 6;
    const group = ds.peerGroup(unitId);
    return monthWindows(now, months).map(([f, t, label]) => {
      const ev = evaluate(ds, unitId, f, t, now);
      const pm = finalize(ev.primary);
      let peerAvg = null;
      if (group) {
        const [ranked] = ranking(ds, group[0], group[1], f, t, now);
        if (ranked.length) peerAvg = r1(ranked.reduce((s, r) => s + r.score, 0) / ranked.length);
      }
      return {
        label, from: f, to: t, partial: t > now, score: ev.score, peer_average: peerAvg,
        resolution_rate: pm.resolution_rate, sla_compliance: pm.sla_compliance, received: pm.received,
      };
    });
  }

  function dashboard(ds, unitId, period, now) {
    const f = period.from, t = period.to;
    const cs = ds.complaintsIn(unitId);
    const ev = evaluate(ds, unitId, f, t, now, cs);
    let delta = null;
    if (period.prev && ev.score !== null) {
      const prev = evaluate(ds, unitId, period.prev.from, period.prev.to, now, cs);
      if (prev.score !== null) delta = { previous: prev.score, change: r1(ev.score - prev.score), label: period.prev.label };
    }
    const own = (ev.own !== null && ev.level !== 'WARD') ? finalize(ev.own) : null;
    return {
      unit: unitBrief(ds, unitId), path: ds.path(unitId), period,
      score: {
        value: ev.score, band: band(ev.score), basis: ev.basis, insufficient_reason: ev.insufficient_reason,
        components: ev.detail ? ev.detail.components : null, penalty: ev.detail ? ev.detail.penalty : null, blend: ev.blend,
      },
      delta,
      rank: rankContext(ds, unitId, f, t, now),
      metrics: finalize(ev.primary),
      system: finalize(ev.system),
      own,
      status_breakdown: statusBreakdown(cs, f, t, now),
      trend: trend(ds, unitId, now),
      children: childrenView(ds, unitId, f, t, now),
    };
  }

  function rankingsView(ds, level, withinId, period, now, highlight) {
    const [ranked, unranked] = ranking(ds, level, withinId, period.from, period.to, now);
    const items = ranked.map(r => rowFor(ds, r.unit_id, r.ev, r.position)).concat(unranked.map(r => rowFor(ds, r.unit_id, r.ev)));
    items.forEach(it => {  // the part of the path between the comparison group and the office itself
      const path = ds.path(it.id);
      const idx = path.findIndex(p => p.id === withinId);
      it.path = path.map(p => p.short).slice(idx >= 0 ? idx + 1 : 1, -1);
    });
    return {
      level, within: unitBrief(ds, withinId), period, label: groupLabel(ds, level, withinId, ranked.length),
      ranked: ranked.length, unranked: unranked.length, highlight: highlight || null, items,
    };
  }

  function complaintRef(ds, c) {
    return { id: c.id, title: c.title, category: c.category, ward_id: c.ward_id, ward_name: ds.units[c.ward_id].name };
  }

  function slaView(ds, unitId, period, now, limit) {
    limit = limit || 25;
    const f = period.from, t = period.to;
    const cs = ds.complaintsIn(unitId);
    const cohort = cs.filter(c => f <= c.created_at && c.created_at < t);
    const overall = finalize(systemCounts(cs, f, t, now));
    const byCat = [];
    CATEGORY_ORDER.forEach(cat => {
      const sub = cohort.filter(c => c.category === cat);
      if (!sub.length) return;
      const m = finalize(systemCounts(sub, f, t, now));
      byCat.push({ category: cat, sla_days: slaDays(cat), received: m.received, within_sla: m.within_sla, breached: m.sla_breached, determined: m.sla_determined, compliance: m.sla_compliance });
    });
    const byLevel = {};
    CONFIG.ESCALATION_CHAIN.forEach(l => { byLevel[l] = 0; });
    const breaches = [];
    cohort.forEach(c => {
      c.assignments.forEach(a => { if (a.outcome === 'ESCALATED') byLevel[a.level] += 1; });
      const last = c.assignments[c.assignments.length - 1];
      const escalated = c.assignments.filter(a => a.outcome === 'ESCALATED');
      const overdueNow = c.status !== 'RESOLVED' && now > last.deadline;
      if (escalated.length || overdueNow) {
        const firstBreach = escalated.length ? escalated[0] : last;
        breaches.push(Object.assign(complaintRef(ds, c), {
          breached_level: firstBreach.level, deadline: firstBreach.deadline, status: c.status, current_level: c.level,
          current_authority: ds.authorities[last.authority_id].title, resolved_at: c.resolution ? c.resolution.at : null,
        }));
      }
    });
    breaches.sort((a, b) => (b.deadline - a.deadline) || cmpStr(a.id, b.id));
    const atRisk = [];
    cs.forEach(c => {
      if (!isOpen(c.status)) return;
      const last = c.assignments[c.assignments.length - 1];
      const left = last.deadline - now;
      if (left > 0 && left <= CONFIG.AT_RISK_HOURS * HOUR_MS) {
        atRisk.push(Object.assign(complaintRef(ds, c), {
          level: c.level, authority: ds.authorities[last.authority_id].title, deadline: last.deadline, hours_left: r1(left / HOUR_MS),
        }));
      }
    });
    atRisk.sort((a, b) => (a.deadline - b.deadline) || cmpStr(a.id, b.id));
    return {
      unit: unitBrief(ds, unitId), period, overall, target: CONFIG.SCORING.sla_target, by_category: byCat,
      by_level: CONFIG.ESCALATION_CHAIN.filter(l => l !== 'COUNTRY').map(l => ({ level: l, label: LEVEL_LABEL[l], breaches: byLevel[l] })),
      breaches: breaches.slice(0, limit), breach_total: breaches.length, at_risk: atRisk.slice(0, limit), at_risk_total: atRisk.length,
    };
  }

  function escalationView(ds, unitId, period, now, limit) {
    limit = limit || 40;
    const f = period.from, t = period.to;
    const cs = ds.complaintsIn(unitId);
    const level = ds.levelOf(unitId);
    const cohort = cs.filter(c => f <= c.created_at && c.created_at < t);
    const funnel = CONFIG.ESCALATION_CHAIN.map(lvl => {
      let reached = 0, resolved = 0, open = 0;
      cohort.forEach(c => {
        if (c.assignments.some(a => a.level === lvl)) {
          reached += 1;
          if (c.status === 'RESOLVED' && c.resolution.level === lvl && isValidResolution(c)) resolved += 1;
          if (isOpen(c.status) && c.level === lvl) open += 1;
        }
      });
      return { level: lvl, label: LEVEL_LABEL[lvl], reached, resolved, open };
    });
    const system = finalize(systemCounts(cs, f, t, now));
    let own = null;
    if (CONFIG.ESCALATION_CHAIN.indexOf(level) >= 0 && level !== 'WARD' && level !== 'COUNTRY') own = finalize(levelCounts(cs, level, f, t, now));
    const ids = {};
    cs.forEach(c => { ids[c.id] = true; });
    const records = [];
    ds.escalations.forEach(e => {
      if (ids[e.complaint_id] && f <= e.escalated_at && e.escalated_at < t) {
        const c = ds.complaints[e.complaint_id];
        const res = c.resolution;
        records.push(Object.assign(complaintRef(ds, c), {
          from_level: e.from_level, to_level: e.to_level,
          from_authority: ds.authorities[e.from_authority].title, to_authority: ds.authorities[e.to_authority].title,
          escalated_at: e.escalated_at, sla_deadline: e.sla_deadline, elapsed_hours: r1(e.elapsed_ms / HOUR_MS),
          reason: e.reason, trigger: e.trigger,
          resolved_at: (res && res.at >= e.escalated_at) ? res.at : null,
          current_status: c.status, current_level: c.level,
        }));
      }
    });
    records.sort((a, b) => (b.escalated_at - a.escalated_at) || cmpStr(a.id, b.id));
    const byChild = [];
    childUnits(ds, unitId).forEach(uid => {
      const m = finalize(systemCounts(ds.complaintsIn(uid), f, t, now));
      if (m.received) byChild.push(Object.assign(unitBrief(ds, uid), { received: m.received, escalated: m.escalated, escalation_rate: m.escalation_rate, escalated_pending: m.escalated_pending }));
    });
    byChild.sort((a, b) => ((b.escalation_rate || 0) - (a.escalation_rate || 0)) || cmpStr(a.id, b.id));
    return { unit: unitBrief(ds, unitId), period, funnel, system, own, records: records.slice(0, limit), record_total: records.length, by_child: byChild };
  }

  function geoView(ds, unitId, period, now) {
    const f = period.from, t = period.to;
    let kids = childUnits(ds, unitId);
    if (!kids.length) kids = [unitId];
    const items = kids.map(uid => {
      const ev = evaluate(ds, uid, f, t, now);
      const u = ds.units[uid];
      const row = rowFor(ds, uid, ev);
      row.center = u.center || null; row.polygon = u.polygon || null;
      return row;
    });
    return { unit: unitBrief(ds, unitId), period, center: ds.units[unitId].center || null, items };
  }

  /* --------------------------------------------------------------- Complaints */
  function daysPending(c, now) { return c.status === 'RESOLVED' ? 0 : Math.floor((now - c.created_at) / DAY_MS); }

  function priorityScore(c, now) {
    const days = daysPending(c, now);
    const v = c.severity * 10 + Math.min(c.upvotes * 0.6, 60) + Math.min(days * 3, 45)
      + (c.gov_verified ? 20 : c.community_verified ? 10 : 0)
      + (c.category === 'crime' ? 30 : c.category === 'publicsafety' ? 18 : 0);
    return Math.floor(v + 0.5);
  }

  function complaintSummary(ds, c, now) {
    const last = c.assignments[c.assignments.length - 1];
    const auth = ds.authorities[last.authority_id];
    const open = isOpen(c.status);
    return {
      id: c.id, category: c.category, title: c.title, description: c.description,
      ward_id: c.ward_id, ward_name: ds.units[c.ward_id].name, severity: c.severity, upvotes: c.upvotes,
      community_verified: c.community_verified, gov_verified: c.gov_verified,
      status: c.status, level: c.level, level_label: LEVEL_LABEL[c.level], assigned_to: auth.title,
      created_at: c.created_at, days_pending: daysPending(c, now),
      escalation_count: c.assignments.filter(a => a.outcome === 'ESCALATED').length,
      priority_score: priorityScore(c, now),
      sla: { days: slaDays(c.category), deadline: last.deadline, remaining_ms: open ? last.deadline - now : null, breached: open && now > last.deadline },
      resolution: c.resolution, resolution_valid: isValidResolution(c), confirmation: c.confirmation, reopen_count: c.reopen_count,
    };
  }

  function listComplaints(ds, wardIds, now, sort, filt, ward, limit, offset) {
    sort = sort || 'priority'; filt = filt || 'all'; limit = limit || 50; offset = offset || 0;
    let items = [];
    wardIds.slice().sort(cmpStr).forEach(w => { if (!ward || w === ward) items = items.concat(ds.by_ward[w] || []); });
    const kpis = { total: 0, pending: 0, progress: 0, resolved: 0, escalated: 0, high: 0, open: 0, at_risk: 0, overdue: 0 };
    const atRiskMs = CONFIG.AT_RISK_HOURS * HOUR_MS;
    items.forEach(c => {
      kpis.total += 1;
      const esc = c.assignments.some(a => a.outcome === 'ESCALATED');
      const left = c.assignments[c.assignments.length - 1].deadline - now;
      if (c.status === 'PENDING') kpis.pending += 1;
      if (c.status === 'IN_PROGRESS') kpis.progress += 1;
      if (c.status === 'RESOLVED') kpis.resolved += 1;
      if (esc) kpis.escalated += 1;
      if (priorityScore(c, now) >= 110) kpis.high += 1;
      if (isOpen(c.status)) {
        kpis.open += 1;
        if (left > 0 && left <= atRiskMs) kpis.at_risk += 1;
        if (esc || left < 0) kpis.overdue += 1;
      }
    });
    items = items.filter(c => {
      const esc = c.assignments.some(a => a.outcome === 'ESCALATED');
      const left = c.assignments[c.assignments.length - 1].deadline - now;
      if (filt === 'open') return isOpen(c.status);
      if (filt === 'escalated') return esc;
      if (filt === 'unverified') return !c.gov_verified;
      if (filt === 'resolved') return c.status === 'RESOLVED';
      if (filt === 'at_risk') return isOpen(c.status) && left > 0 && left <= atRiskMs;
      if (filt === 'overdue') return isOpen(c.status) && (esc || left < 0);
      return true;
    });
    const openRank = c => (isOpen(c.status) ? 0 : 1);
    const dl = c => c.assignments[c.assignments.length - 1].deadline;
    if (sort === 'upvoted') items.sort((a, b) => (b.upvotes - a.upvotes) || cmpStr(a.id, b.id));
    else if (sort === 'oldest') items.sort((a, b) => (a.created_at - b.created_at) || cmpStr(a.id, b.id));
    else if (sort === 'recent') items.sort((a, b) => (b.created_at - a.created_at) || cmpStr(a.id, b.id));
    else if (sort === 'deadline') items.sort((a, b) => (openRank(a) - openRank(b)) || (dl(a) - dl(b)) || cmpStr(a.id, b.id));
    else items.sort((a, b) => (openRank(a) - openRank(b)) || (priorityScore(b, now) - priorityScore(a, now)) || cmpStr(a.id, b.id));
    return { total: items.length, offset, limit, kpis, items: items.slice(offset, offset + limit).map(c => complaintSummary(ds, c, now)) };
  }

  function titleCase(s) { return s.toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase()); }

  function buildTimeline(ds, c) {
    const days = slaDays(c.category);
    const ev = [{ at: c.created_at, kind: 'REPORTED', title: 'Reported by Anonymous Citizen' }];
    if (c.community_verified) ev.push({ at: c.created_at + 6 * HOUR_MS, kind: 'VERIFIED', title: 'Community verification completed' });
    if (c.gov_verified) ev.push({ at: c.created_at + 20 * HOUR_MS, kind: 'VERIFIED', title: 'Government authority verified' });
    c.assignments.forEach(a => {
      const who = ds.authorities[a.authority_id].title;
      if (a.reason === 'NEW') ev.push({ at: a.assigned_at, kind: 'ASSIGNED', title: `Assigned to ${who} · SLA ${days} days` });
      else if (a.reason === 'ESCALATION') ev.push({ at: a.assigned_at, kind: 'ESCALATED', title: `Escalated to ${who} · fresh ${days}-day SLA`, escalated: true });
      else ev.push({ at: a.assigned_at, kind: 'REOPENED', title: `Reopened with ${who} · fresh ${days}-day SLA`, escalated: true });
      if (a.outcome === 'REOPENED') {
        ev.push({ at: a.closed_at, kind: 'CLOSED', title: 'Marked resolved' + (a.closed_evidence ? ' with photo evidence' : ' without evidence') });
        ev.push({ at: a.outcome_at, kind: 'DISPUTED', title: 'Citizen reported the issue is not fixed', escalated: true });
      }
      if (a.outcome === 'ESCALATED') ev.push({ at: a.outcome_at, kind: 'SLA_BREACH', title: `${days}-day SLA breached at ${LEVEL_LABEL[a.level]} level`, escalated: true });
    });
    c.events.forEach(e => ev.push(Object.assign({}, e)));
    if (c.resolution) {
      const r = c.resolution;
      const who = ds.authorities[r.authority_id] ? ds.authorities[r.authority_id].title : r.level;
      ev.push({ at: r.at, kind: 'RESOLVED', done: true, title: `Resolved by ${who}` + (r.evidence ? ' · photo evidence attached' : ' · no evidence attached') });
    }
    if (c.confirmation === 'CONFIRMED') ev.push({ at: c.confirmation_at, kind: 'CONFIRMED', title: 'Citizen confirmed the fix', done: true });
    return ev.map((e, i) => [e, i]).sort((a, b) => (a[0].at - b[0].at) || (a[1] - b[1])).map(x => x[0]);
  }

  function complaintDetail(ds, c, now) {
    const out = complaintSummary(ds, c, now);
    out.assignments = c.assignments.map(a => Object.assign({}, a, { unit_name: ds.units[a.unit_id].name, authority_title: ds.authorities[a.authority_id].title }));
    out.escalations = ds.escalations.filter(e => e.complaint_id === c.id).map(e => Object.assign({}, e, {
      from_authority_title: ds.authorities[e.from_authority].title, to_authority_title: ds.authorities[e.to_authority].title,
    }));
    out.timeline = buildTimeline(ds, c);
    return out;
  }

  /* ---------------------------------------------------------------- Mutations */
  function applyStatus(ds, actor, c, status, note, evidence, now) {
    if (c.status === 'RESOLVED') throw new PolicyError(409, "This complaint is resolved. Only the citizen's dispute can reopen it.");
    if (status === 'RESOLVED') {
      if (!(note || '').trim()) throw new PolicyError(422, 'A resolution note is required.');
      const last = c.assignments[c.assignments.length - 1];
      last.outcome = 'RESOLVED'; last.outcome_at = now;
      c.resolution = { at: now, level: actor.level, authority_id: actor.id, evidence: !!evidence, note: note.trim() };
      c.status = 'RESOLVED'; c.confirmation = null; c.confirmation_at = null;
      return null;
    }
    if (status === 'ESCALATED') {
      const chain = CONFIG.ESCALATION_CHAIN;
      if (chain.indexOf(c.level) < 0 || c.level === chain[chain.length - 1]) throw new PolicyError(409, 'This complaint is already at the top of the escalation chain.');
      return escalate(ds, c, now, 'MANUAL', `Escalated manually by ${actor.title}`);
    }
    if (['PENDING', 'VERIFIED', 'IN_PROGRESS'].indexOf(status) >= 0) {
      c.status = status;
      c.events.push({ at: now, kind: 'STATUS', title: `Status set to ${titleCase(status.replace('_', ' '))} by ${actor.title}`, note: (note || '').trim() || null });
      if (status === 'VERIFIED') c.gov_verified = true;
      return null;
    }
    throw new PolicyError(422, `Unknown status ${status}.`);
  }

  function applyConfirmation(ds, citizenId, c, decision, now) {
    if (c.reporter !== citizenId) throw new PolicyError(403, 'Only the citizen who reported this complaint can confirm or dispute its resolution.');
    if (c.status !== 'RESOLVED') throw new PolicyError(409, 'This complaint is not marked resolved.');
    if (c.confirmation === 'CONFIRMED') throw new PolicyError(409, 'You have already confirmed this resolution.');
    if (decision === 'CONFIRMED') { c.confirmation = 'CONFIRMED'; c.confirmation_at = now; return; }
    if (decision !== 'DISPUTED') throw new PolicyError(422, 'decision must be CONFIRMED or DISPUTED.');
    const last = c.assignments[c.assignments.length - 1];
    const res = c.resolution;
    last.outcome = 'REOPENED'; last.outcome_at = now; last.closed_at = res.at; last.closed_evidence = !!res.evidence;
    const unitId = ds.ancestor(c.ward_id, c.level);
    c.assignments.push({
      level: c.level, unit_id: unitId, authority_id: ds.authority_by_unit[unitId].id, assigned_at: now,
      deadline: now + slaMs(c.category), outcome: null, outcome_at: null, reason: 'REOPEN', closed_at: null, closed_evidence: null,
    });
    c.resolution = null; c.confirmation = null; c.confirmation_at = null;
    c.reopen_count += 1; c.status = 'IN_PROGRESS';
  }

  function pointInPolygon(lat, lng, poly) {
    let inside = false;
    const n = poly.length;
    let p1 = poly[0];
    for (let i = 1; i <= n; i++) {
      const p2 = poly[i % n];
      if ((p1[0] < lat && lat <= p2[0]) || (p2[0] < lat && lat <= p1[0])) {
        if (lng <= (p2[1] - p1[1]) * (lat - p1[0]) / (p2[0] - p1[0]) + p1[1]) inside = !inside;
      }
      p1 = p2;
    }
    return inside;
  }

  function detectWard(ds, lat, lng) {
    const ids = Object.keys(ds.units).sort(cmpStr);
    for (const uid of ids) {
      const u = ds.units[uid];
      if (u.type === 'ward' && u.polygon && pointInPolygon(lat, lng, u.polygon)) return uid;
    }
    return null;
  }

  function nearestWard(ds, lat, lng, maxDeg) {
    maxDeg = maxDeg || 0.3;
    let best = null, bestD = null;
    Object.keys(ds.units).sort(cmpStr).forEach(uid => {
      const u = ds.units[uid];
      if (u.type !== 'ward' || !u.center) return;
      const d = Math.pow(u.center[0] - lat, 2) + Math.pow(u.center[1] - lng, 2);
      if (bestD === null || d < bestD) { best = uid; bestD = d; }
    });
    return bestD !== null && bestD <= maxDeg * maxDeg ? best : null;
  }

  function newComplaint(ds, cid, category, title, description, wardId, severity, reporter, now, intakeId) {
    const auth = ds.authority_by_unit[wardId];
    return {
      id: cid, category, title, description, ward_id: wardId, severity, upvotes: 0,
      community_verified: false, gov_verified: false, reporter, created_at: now, status: 'PENDING', level: 'WARD',
      assignments: [{ level: 'WARD', unit_id: wardId, authority_id: auth.id, assigned_at: now, deadline: now + slaMs(category), outcome: null, outcome_at: null, reason: 'NEW', closed_at: null, closed_evidence: null }],
      resolution: null, confirmation: null, confirmation_at: null, reopen_count: 0, events: [], source: 'citizen', intake_id: intakeId || null,
    };
  }

  /* ------------------------------------------ Access policy (mirror access.py) */
  const Access = {
    scopeUnits: (ds, actor) => new Set(ds.subtree(actor.unit)),
    scopeWards: (ds, actor) => new Set(ds.wardsUnder(actor.unit)),
    requireUnit(ds, actor, unitId) {
      if (!ds.units[unitId]) throw new PolicyError(404, 'Unknown jurisdiction.');
      if (!Access.scopeUnits(ds, actor).has(unitId)) throw new PolicyError(403, `${ds.units[unitId].name} is outside your jurisdiction (${ds.units[actor.unit].name}).`);
    },
    requireRanking(ds, actor, level, withinId) {
      if (!ds.units[withinId]) throw new PolicyError(404, 'Unknown jurisdiction.');
      if (Access.scopeUnits(ds, actor).has(withinId)) return;
      const g = ds.peerGroup(actor.unit);
      if (g && g[0] === level && g[1] === withinId) return;
      throw new PolicyError(403, `You can compare authorities inside ${ds.units[actor.unit].name} or your own peer group only.`);
    },
    canViewUnit: (ds, actor, unitId) => Access.scopeUnits(ds, actor).has(unitId),
    requireComplaint(ds, actor, c) {
      if (!c) throw new PolicyError(404, 'No such complaint.');
      if (!Access.scopeWards(ds, actor).has(c.ward_id)) {
        throw new PolicyError(403, `Complaint #${c.id} belongs to ${ds.units[c.ward_id].name}, outside your jurisdiction (${ds.units[actor.unit].name}).`);
      }
    },
    updatePermission(ds, actor, c) {
      if (c.status === 'RESOLVED') return [false, 'Resolved - awaiting citizen confirmation. Only a citizen dispute can reopen it.'];
      if (CONFIG.LEVEL_RANK[actor.level] < CONFIG.LEVEL_RANK[c.level]) {
        const holder = ds.authorities[c.assignments[c.assignments.length - 1].authority_id].title;
        return [false, `Escalated beyond your level - now handled by ${holder}.`];
      }
      return [true, null];
    },
    requireUpdate(ds, actor, c) {
      Access.requireComplaint(ds, actor, c);
      const [ok, reason] = Access.updatePermission(ds, actor, c);
      if (!ok) throw new PolicyError(c.status !== 'RESOLVED' ? 403 : 409, reason);
    },
    SECTIONS: ['my_performance', 'rankings', 'sla', 'escalations', 'geographic'],
  };

  return {
    CONFIG, LEVEL_LABEL, LEVEL_UNIT_TYPE, CATEGORY_ORDER, MONTHS, DAY_MS, HOUR_MS, MIN_MS, FAR_FUTURE, OPEN,
    PolicyError, Dataset, Access, r1, pct, slaDays, clone,
    datasetFromSeed, runEscalations, escalate, periodRange, isValidResolution, levelCounts, systemCounts,
    finalize, scoreOf, evaluate, band, ranking, rankContext, unitBrief, childUnits, dashboard, rankingsView,
    slaView, escalationView, geoView, listComplaints, complaintSummary, complaintDetail, buildTimeline,
    priorityScore, applyStatus, applyConfirmation, detectWard, nearestWard, newComplaint, monthWindows, trend,
  };
});
