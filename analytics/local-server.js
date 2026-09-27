/*
 * Offline mirror of the Government Portal API (citycare-backend:
 * app/analytics/router.py). Used ONLY when the real server cannot be reached,
 * e.g. on the static GitHub Pages demo. Same routes, same JSON, same access
 * checks - but running in the browser, so it demonstrates the rules rather
 * than enforcing them. The live server is the enforcement point.
 */
(function (root) {
  'use strict';
  const E = root.CCEngine;
  const PolicyError = E.PolicyError;

  // Loaded with a <script> tag rather than fetch() so it also works from file://
  function loadSeed(url) {
    if (root.CC_SEED) return Promise.resolve(root.CC_SEED);
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = url;
      tag.onload = () => (root.CC_SEED ? resolve(root.CC_SEED) : reject(new Error('Demo dataset is empty')));
      tag.onerror = () => reject(new Error('Could not load the demo dataset'));
      document.head.appendChild(tag);
    });
  }

  const LocalServer = {
    ds: null,
    tokens: {},
    seedUrl: 'analytics/seed.js',
    _seed: null,
    _timer: null,

    async init(seedUrl) {
      if (this.ds) return;
      if (seedUrl) this.seedUrl = seedUrl;
      this._seed = await loadSeed(this.seedUrl);
      this.ds = E.datasetFromSeed(this._seed, Date.now());
      if (!this._timer) this._timer = setInterval(() => this.tick(), 30000);
    },

    tick() { if (this.ds) E.runEscalations(this.ds, Date.now()); },

    reset() { this.ds = E.datasetFromSeed(this._seed, Date.now()); },

    issue(kind, sub) {
      const token = 'offline.' + kind + '.' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      this.tokens[token] = { kind, sub };
      return token;
    },

    who(headers, kind) {
      const h = headers && (headers.Authorization || headers.authorization);
      if (!h || !/^bearer /i.test(h)) throw new PolicyError(401, kind === 'gov' ? 'Government login required.' : 'Citizen login required.');
      const t = this.tokens[h.split(' ')[1]];
      if (!t || t.kind !== kind) throw new PolicyError(401, 'Invalid or expired session. Please log in again.');
      if (kind === 'gov') {
        const a = this.ds.authorities[t.sub];
        if (!a) throw new PolicyError(401, 'This official account no longer exists.');
        return a;
      }
      return t.sub;
    },

    period(q) { return E.periodRange(q.period || '30d', Date.now(), q.frm, q.to); },

    /** Returns {status, body}. Never throws. */
    async handle(method, path, query, body, headers) {
      try {
        await this.init();
        this.tick();
        return { status: 200, body: E.clone(this.route(method, path, query || {}, body || {}, headers || {})) };
      } catch (e) {
        if (e instanceof PolicyError) return { status: e.status, body: { detail: e.message } };
        console.error('[offline server]', e);
        return { status: 500, body: { detail: String(e && e.message || e) } };
      }
    },

    route(method, path, q, body, headers) {
      const ds = this.ds, now = Date.now(), A = E.Access;
      let m;
      if (method === 'GET' && path === '/gov/health') {
        return { ok: true, mode: 'offline', now, complaints: Object.keys(ds.complaints).length, demo_login: true };
      }
      if (method === 'GET' && path === '/gov/directory') {
        const order = { COUNTRY: 0, STATE: 1, DISTRICT: 2, SDM: 3, REGION: 4, WARD: 5 };
        const out = Object.values(ds.authorities).map(a => ({
          id: a.id, title: a.title, role: a.role, role_label: a.role_label, level: a.level, unit_id: a.unit,
          path: ds.path(a.unit).map(p => p.name),
        }));
        out.sort((a, b) => (order[a.level] - order[b.level]) || (a.path.join('\u0000') < b.path.join('\u0000') ? -1 : 1));
        return { authorities: out };
      }
      if (method === 'POST' && path === '/gov/auth/demo-login') {
        const a = ds.authorities[body.authority_id];
        if (!a) throw new PolicyError(404, 'Unknown official account.');
        return { token: this.issue('gov', a.id), expires_at: now + 8 * 3600e3, authority: a };
      }
      if (method === 'POST' && path === '/v2/citizen/demo-login') {
        return { token: this.issue('citizen', 'citizen-demo'), expires_at: now + 8 * 3600e3, citizen: 'citizen-demo' };
      }
      if (path.startsWith('/v2/')) return this.citizenRoute(method, path, q, body, headers);

      const actor = this.who(headers, 'gov');
      if (method === 'GET' && path === '/gov/me') {
        const g = ds.peerGroup(actor.unit);
        const levels = ['STATE', 'DISTRICT', 'SDM', 'WARD'].filter(level => {
          const utype = E.LEVEL_UNIT_TYPE[level];
          const inside = ds.subtree(actor.unit).some(u => ds.units[u].type === utype && u !== actor.unit);
          return inside || (g && g[0] === level);
        });
        return {
          authority: actor, unit: E.unitBrief(ds, actor.unit), path: ds.path(actor.unit),
          peer_group: g ? { level: g[0], within: g[1], within_name: ds.units[g[1]].name, noun: E.CONFIG.LEVEL_PEER_NOUN[g[0]][1] } : null,
          ranking_levels: levels, sections: A.SECTIONS, ward_count: ds.wardsUnder(actor.unit).length,
        };
      }
      if (method === 'GET' && path === '/gov/hierarchy') {
        const unit = q.unit || actor.unit;
        A.requireUnit(ds, actor, unit);
        return {
          unit: E.unitBrief(ds, unit), path: ds.path(unit),
          children: E.childUnits(ds, unit).map(uid => Object.assign(E.unitBrief(ds, uid), { child_count: E.childUnits(ds, uid).length })),
        };
      }
      if (method === 'GET' && path === '/gov/complaints') {
        const wards = A.scopeWards(ds, actor);
        if (q.ward && !wards.has(q.ward)) throw new PolicyError(403, `${ds.units[q.ward] ? ds.units[q.ward].name : q.ward} is outside your jurisdiction.`);
        const limit = Math.max(1, Math.min(Number(q.limit) || 40, 200));
        return E.listComplaints(ds, Array.from(wards), now, q.sort || 'priority', q.filter || 'all', q.ward || null, limit, Math.max(0, Number(q.offset) || 0));
      }
      if ((m = path.match(/^\/gov\/complaints\/([^/]+)$/)) && method === 'GET') {
        const c = ds.complaints[decodeURIComponent(m[1]).replace(/^#/, '')];
        A.requireComplaint(ds, actor, c);
        const out = E.complaintDetail(ds, c, now);
        const [ok, reason] = A.updatePermission(ds, actor, c);
        out.permissions = { can_update: ok, reason };
        return out;
      }
      if ((m = path.match(/^\/gov\/complaints\/([^/]+)\/status$/)) && method === 'PATCH') {
        const c = ds.complaints[decodeURIComponent(m[1]).replace(/^#/, '')];
        A.requireUpdate(ds, actor, c);
        E.applyStatus(ds, actor, c, String(body.status || '').toUpperCase(), body.note, !!body.evidence, now);
        const out = E.complaintDetail(ds, c, now);
        const [ok, reason] = A.updatePermission(ds, actor, c);
        out.permissions = { can_update: ok, reason };
        out.counts_towards_score = c.status === 'RESOLVED' ? E.isValidResolution(c) : null;
        return out;
      }
      if (method === 'GET' && path === '/gov/analytics/config') {
        const C = E.CONFIG;
        return { scoring: C.SCORING, resolution_policy: C.RESOLUTION_POLICY, category_sla_days: C.CATEGORY_SLA_DAYS, escalation_chain: C.ESCALATION_CHAIN };
      }
      const views = { '/gov/analytics/dashboard': E.dashboard, '/gov/analytics/sla': E.slaView, '/gov/analytics/escalations': E.escalationView, '/gov/analytics/geo': E.geoView };
      if (method === 'GET' && views[path]) {
        const unit = q.unit || actor.unit;
        A.requireUnit(ds, actor, unit);
        const out = views[path](ds, unit, this.period(q), now);
        if (path === '/gov/analytics/dashboard') {
          out.viewer = { authority_id: actor.id, unit: actor.unit, is_self: out.unit.id === actor.unit };
          if (out.children) out.children.items.forEach(it => { it.accessible = A.canViewUnit(ds, actor, it.id); });
        }
        return out;
      }
      if (method === 'GET' && path === '/gov/analytics/rankings') {
        const level = String(q.level || '').toUpperCase();
        if (!E.CONFIG.LEVEL_PEER_NOUN[level]) throw new PolicyError(422, 'level must be one of WARD, SDM, DISTRICT, STATE.');
        const within = q.within || actor.unit;
        A.requireRanking(ds, actor, level, within);
        const out = E.rankingsView(ds, level, within, this.period(q), now, actor.unit);
        out.items.forEach(it => { it.accessible = A.canViewUnit(ds, actor, it.id); });
        return out;
      }
      if (method === 'POST' && path === '/gov/demo/reset') {
        this.reset();
        return { ok: true, complaints: Object.keys(this.ds.complaints).length };
      }
      throw new PolicyError(404, 'Not found');
    },

    citizenRoute(method, path, q, body, headers) {
      const ds = this.ds, now = Date.now();
      let m;
      if (method === 'POST' && path === '/v2/complaints') {
        const cat = body.category_key;
        if (!E.CONFIG.CATEGORY_SLA_DAYS[cat]) throw new PolicyError(422, 'Unknown category.');
        let ward = E.detectWard(ds, Number(body.latitude), Number(body.longitude));
        if (!ward && cat === 'crime') ward = E.nearestWard(ds, Number(body.latitude), Number(body.longitude));
        if (!ward) throw new PolicyError(422, 'This location is outside the wards onboarded on CivicConnect.');
        let reporter = 'anonymous';
        if (headers.Authorization) reporter = this.who(headers, 'citizen');
        let id = String(body.id || '').replace(/^#/, '');
        if (!id || ds.complaints[id]) { do { id = 'CMPI' + Math.floor(1000 + Math.random() * 9000); } while (ds.complaints[id]); }
        const c = E.newComplaint(ds, id, cat, body.title || 'Complaint', body.description || '', ward,
          Math.max(1, Math.min(5, Number(body.severity) || 3)), reporter, now, id);
        ds.addComplaint(c);
        return { intake: null, lifecycle: E.complaintSummary(ds, c, now) };
      }
      if ((m = path.match(/^\/v2\/complaints\/([^/]+)\/confirmation$/)) && method === 'POST') {
        const citizen = this.who(headers, 'citizen');
        const c = ds.complaints[decodeURIComponent(m[1]).replace(/^#/, '')];
        if (!c) throw new PolicyError(404, 'No such complaint.');
        E.applyConfirmation(ds, citizen, c, String(body.decision || '').toUpperCase(), now);
        return E.complaintSummary(ds, c, now);
      }
      if ((m = path.match(/^\/v2\/complaints\/([^/]+)$/)) && method === 'GET') {
        const citizen = this.who(headers, 'citizen');
        const c = ds.complaints[decodeURIComponent(m[1]).replace(/^#/, '')];
        if (!c || c.reporter !== citizen) throw new PolicyError(404, 'No such complaint in your account.');
        const out = E.complaintSummary(ds, c, now);
        out.timeline = E.buildTimeline(ds, c);
        return out;
      }
      throw new PolicyError(404, 'Not found');
    },
  };

  root.CCLocalServer = LocalServer;
})(typeof self !== 'undefined' ? self : this);
