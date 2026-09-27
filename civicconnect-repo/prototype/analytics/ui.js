/*
 * Government Portal screens: official login, jurisdiction-scoped complaints,
 * complaint accountability (SLA + escalation chain), escalations, and the
 * Analytics & Performance section.
 *
 * This file only renders what the API returns - it never filters complaints
 * by jurisdiction or computes a score itself. Those decisions are made by the
 * backend (or, offline, by its in-browser mirror).
 *
 * Uses globals from the main prototype script: state, nav, back, render,
 * toast, CAT, STATUS_META, priorityLevel, W, WARDS, complaints, fmtDate,
 * notifications, constructionProjects, renderGovProjectCardHTML.
 */
(function () {
  'use strict';
  const E = window.CCEngine;
  const API = window.GovAPI;
  const LEVEL_LABEL = E.LEVEL_LABEL;
  const ROLE_LABEL = E.CONFIG.ROLE_LABEL;
  const ROLE_ORDER = ['WARD_COUNCILLOR', 'VILLAGE_HEAD', 'TEHSILDAR_SDM', 'DM_COLLECTOR', 'CM', 'PM_CENTRAL_ADMIN'];
  const ROLE_PREFIX = { PM_CENTRAL_ADMIN: 'pm-', CM: 'cm-', DM_COLLECTOR: 'dm-', TEHSILDAR_SDM: 'sdm-', WARD_COUNCILLOR: 'wc-' };
  const ROLE_DEPTH = { PM_CENTRAL_ADMIN: 0, CM: 1, DM_COLLECTOR: 2, TEHSILDAR_SDM: 3, WARD_COUNCILLOR: 4 };
  const STATUS_KEY = { PENDING: 'pending', VERIFIED: 'verified', IN_PROGRESS: 'progress', RESOLVED: 'resolved', ESCALATED: 'escalated' };
  const STATUS_API = { pending: 'PENDING', verified: 'VERIFIED', progress: 'IN_PROGRESS', resolved: 'RESOLVED', escalated: 'ESCALATED' };
  const GOV_SCREENS = ['gov-dashboard', 'escalated', 'gov-analytics', 'gov-profile'];
  const DATA_SCREENS = GOV_SCREENS.concat(['gov-detail']);
  const PERIODS = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['this_month', 'This month'], ['last_month', 'Last month'],
    ['this_quarter', 'Quarter'], ['this_year', 'This year'], ['all', 'All time'], ['custom', 'Custom…']];
  const UNIT_NOUN = { state: 'state', district: 'district', sdm: 'sub-district', ward: 'ward' };
  const LEVEL_TABS = { STATE: 'CMs · States', DISTRICT: 'DMs · Districts', SDM: 'SDMs', WARD: 'Ward Councillors' };
  const CHIPS = {
    priority: { label: 'Priority', sort: 'priority', filter: 'all' },
    at_risk: { label: '⏱ SLA at risk', sort: 'deadline', filter: 'at_risk' },
    upvoted: { label: 'Upvoted', sort: 'upvoted', filter: 'all' },
    oldest: { label: 'Oldest', sort: 'oldest', filter: 'all' },
    escalated: { label: 'Escalated', sort: 'priority', filter: 'escalated' },
    unverified: { label: 'Unverified', sort: 'priority', filter: 'unverified' },
  };
  const BAND_META = {
    good: { icon: '✓', label: 'Performing well' },
    watch: { icon: '◐', label: 'Needs attention' },
    critical: { icon: '⚠', label: 'Critical' },
    none: { icon: '○', label: 'Insufficient data' },
  };

  const G = {
    directory: null, dirError: null, loginRole: 'WARD_COUNCILLOR', loginAuthority: 'wc-ward24',
    authority: null, me: null, cache: {}, inflight: {},
    list: { chip: 'priority', limit: 30 },
    detailId: null, verify: {},
    an: { unit: null, tab: 'overview', period: '30d', from: '', to: '', level: null, showAll: false },
    lastRefresh: null, pollTimer: null, map: null,
  };
  window.GOV = G;

  /* ------------------------------------------------------------ helpers */
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pctTxt = v => (v === null || v === undefined ? '—' : `${v}%`);
  const numTxt = v => (v === null || v === undefined ? '—' : String(v));
  const dt = ms => new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const dd = ms => new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  function dur(ms) {
    const a = Math.abs(ms), d = Math.floor(a / 864e5), h = Math.floor((a % 864e5) / 36e5), m = Math.floor((a % 36e5) / 6e4);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  }
  const cat = id => CAT(id) || CAT('other');
  const catLabel = id => cat(id).label;
  const onAttr = js => esc(js);

  function modeBadge() {
    if (API.mode === 'live') return `<span class="an-mode live" data-tip="Connected to the CivicConnect server.\nEvery request is authorised server-side."><span class="dot"></span>Live · server-enforced</span>`;
    if (API.mode === 'offline') return `<span class="an-mode offline" data-tip="Server unreachable - running the in-browser mirror of the same rules.\nThe live server is the enforcement point."><span class="dot"></span>Offline demo</span>`;
    return `<span class="an-mode offline"><span class="dot"></span>Connecting…</span>`;
  }

  /* --------------------------------------------------------- data cache */
  function data(k, fetcher) {
    const c = G.cache[k];
    if ((!c || c.stale) && !G.inflight[k]) {
      G.inflight[k] = fetcher()
        .then(v => { G.cache[k] = { v, at: Date.now() }; }, err => { G.cache[k] = { err, at: Date.now() }; })
        .finally(() => {
          delete G.inflight[k];
          G.lastRefresh = Date.now();
          if (DATA_SCREENS.indexOf(state.screen) >= 0) refresh();
        });
    }
    return c || null;
  }
  const loading = k => !!G.inflight[k];
  function refresh() { state._keepScroll = true; render(); }
  function invalidate(prefixes) {
    Object.keys(G.cache).forEach(k => {
      if (!prefixes || prefixes.some(p => k.indexOf(p) === 0)) {
        if (G.cache[k].err) delete G.cache[k]; else G.cache[k].stale = true;
      }
    });
  }

  function errorCard(err) {
    const locked = err && (err.status === 403);
    return `<div class="glass-card an-empty">
      <div class="ee">${locked ? '🔒' : '⚠️'}</div>
      <div style="font-weight:800;font-size:14px;">${locked ? 'Outside your jurisdiction' : 'Could not load this view'}</div>
      <p class="muted" style="font-size:12px;margin:6px 0 0;line-height:1.5;">${esc(err && err.message)}</p>
      ${locked ? '<p class="an-note">This check is made by the server for every request - changing the URL or IDs in the browser cannot widen access.</p>' : ''}
    </div>`;
  }
  const loadingCard = (label) => `<div class="glass-card an-empty"><div class="spinner-ring" style="margin:4px auto 10px;"></div><div class="muted" style="font-size:12px;">${esc(label || 'Loading…')}</div></div>`;

  /* ---------------------------------------------------------- session */
  function ensureDirectory() {
    if (G.directory || G._dirLoading) return;
    G._dirLoading = true;
    API.detect().then(() => API.directory()).then(dir => {
      G.directory = dir; G.dirError = null;
      if (!dir.some(a => a.id === G.loginAuthority)) G.loginAuthority = (dir.find(a => a.role === G.loginRole) || dir[0]).id;
    }).catch(e => { G.dirError = e.message; }).finally(() => {
      G._dirLoading = false;
      if (state.screen === 'gov-login') refresh();
    });
  }

  async function startSession(authorityId) {
    const a = await API.login(authorityId);
    G.authority = a;
    G.cache = {};
    G.me = await API.get('/gov/me');
    G.an = { unit: a.unit, tab: G.an.tab || 'overview', period: G.an.period || '30d', from: G.an.from, to: G.an.to, level: null, showAll: false };
    G.list.limit = 30;
    state.activeGovRole = a.role;
    state.authMode = 'gov';
    if (a.level === 'WARD') { state.councillorWardId = a.unit; ensureWardGeometry(a.unit); }
    startPolling();
    return a;
  }

  // The construction module draws on the prototype's WARDS list; add this ward's boundary if it is new there.
  function ensureWardGeometry(unitId) {
    if (WARDS.some(w => w.id === unitId)) return;
    API.get('/gov/analytics/geo', { unit: unitId, period: 'all' }).then(g => {
      const it = g.items[0];
      if (!it || !it.polygon || WARDS.some(w => w.id === unitId)) return;
      const path = (G.me && G.me.path) || [];
      const name = n => (path[n] && path[n].name) || '';
      WARDS.push({ id: unitId, name: it.name, code: it.short.toUpperCase().replace(' ', '-'), village: it.name, subDistrict: name(3),
        district: name(2), state: name(1), country: 'India', councillor: G.authority.title, center: it.center, polygon: it.polygon });
    }).catch(() => {});
  }

  function startPolling() {
    if (G.pollTimer) clearInterval(G.pollTimer);
    G.pollTimer = setInterval(() => {
      if (state.authMode !== 'gov' || DATA_SCREENS.indexOf(state.screen) < 0) return;
      invalidate(null);
      refresh();
    }, 30000);
  }

  function authorityFor(role) {
    if (role === 'VILLAGE_HEAD') return 'vh-UP-LKO-LOCAL';
    const dir = G.directory || [];
    const path = (G.me ? G.me.path : []).map(p => p.id);
    const depth = ROLE_DEPTH[role];
    if (path[depth]) return ROLE_PREFIX[role] + path[depth];
    const names = (G.me ? G.me.path : []).map(p => p.name);
    const inside = dir.find(a => a.role === role && names.every((n, i) => a.path[i] === n));
    if (inside) return inside.id;
    return ROLE_PREFIX[role] + ['IN', 'UP', 'UP-LKO', 'UP-LKO-SADAR', 'ward24'][depth];
  }

  function syncLocalComplaint(detail) {
    const local = complaints.find(x => x.id === detail.id);
    if (!local) return;
    local.status = STATUS_KEY[detail.status] || local.status;
    local.escalated = detail.escalation_count > 0;
    local.assigned = detail.assigned_to;
    local.govVerified = detail.gov_verified;
    local.lifecycle = { confirmation: detail.confirmation, resolution_valid: detail.resolution_valid, reopen_count: detail.reopen_count };
    if (detail.timeline) local.timeline = detail.timeline.map(t => ({ title: t.title, date: fmtDate(new Date(t.at)), done: !!t.done, escalated: !!t.escalated }));
  }

  /* ---------------------------------------------------------- tooltip */
  function setupTooltips() {
    const phone = document.getElementById('phone');
    if (!phone || phone._anTips) return;
    phone._anTips = true;
    const tip = document.createElement('div');
    tip.className = 'an-tip';
    tip.setAttribute('role', 'tooltip');
    phone.appendChild(tip);
    const place = (x, y) => {
      const r = phone.getBoundingClientRect();
      let left = x - r.left + 12, top = y - r.top + 14;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      if (left + w > r.width - 8) left = x - r.left - w - 12;
      if (top + h > r.height - 8) top = y - r.top - h - 12;
      tip.style.left = Math.max(6, left) + 'px'; tip.style.top = Math.max(6, top) + 'px';
    };
    const show = (el, x, y) => { tip.textContent = el.getAttribute('data-tip'); tip.classList.add('on'); place(x, y); };
    const hide = () => tip.classList.remove('on');
    phone.addEventListener('pointermove', e => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el) show(el, e.clientX, e.clientY); else hide();
    });
    phone.addEventListener('pointerleave', hide);
    phone.addEventListener('focusin', e => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el) { const b = el.getBoundingClientRect(); show(el, b.left + b.width / 2, b.bottom); }
    });
    phone.addEventListener('focusout', hide);
    phone.addEventListener('scroll', hide, true);
  }

  /* =================================================== GOVERNMENT LOGIN */
  function screenGovLogin() {
    ensureDirectory();
    const dir = G.directory || [];
    const roleAuths = dir.filter(a => a.role === G.loginRole);
    const groups = {};
    roleAuths.forEach(a => { const g = a.path.slice(0, -1).join(' › ') || 'National'; (groups[g] = groups[g] || []).push(a); });
    const sel = dir.find(a => a.id === G.loginAuthority);
    return `
    <div class="screen no-pad-bottom">
      <div class="row gap10" style="margin:20px 0 16px;"><div class="icon-btn" onclick="nav('login')">←</div><h2 class="display" style="margin:0;font-size:18px;">Government Official Login</h2></div>
      <div class="glass-card">
        <p class="muted" style="font-size:12.5px;line-height:1.5;margin-top:0;">Government accounts are issued by the administration and cannot be self-registered. Pick a demo official account to preview that office's portal.</p>
        <div class="field"><label>Official ID</label><input value="${esc(sel ? 'GOV-' + sel.id.toUpperCase() : 'GOV-DEMO-2026')}" disabled></div>
        <div class="field"><label>Password</label><input type="password" value="••••••••" disabled></div>
        <div class="field">
          <label>Demo Role (development only)</label>
          <select onchange="GovUI.setLoginRole(this.value)">
            ${ROLE_ORDER.map(r => `<option value="${r}" ${r === G.loginRole ? 'selected' : ''}>${esc(ROLE_LABEL[r])}${dir.length ? ` (${dir.filter(a => a.role === r).length})` : ''}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Jurisdiction</label>
          <select id="gov-auth-select" onchange="GovUI.setLoginAuthority(this.value)" ${dir.length ? '' : 'disabled'}>
            ${dir.length ? Object.keys(groups).map(g => `<optgroup label="${esc(g)}">${groups[g].map(a => `<option value="${esc(a.id)}" ${a.id === G.loginAuthority ? 'selected' : ''}>${esc(a.path[a.path.length - 1])}</option>`).join('')}</optgroup>`).join('')
              : `<option>${G.dirError ? 'Could not load accounts' : 'Loading official accounts…'}</option>`}
          </select>
        </div>
        ${sel ? `<p class="an-note" style="margin:-4px 0 12px;">You will act as <b>${esc(sel.title)}</b> with access limited to <b>${esc(sel.path.join(' › '))}</b>.</p>` : ''}
        <button class="btn btn-primary full" onclick="loginAsGov()" ${dir.length ? '' : 'style="opacity:.5;pointer-events:none;"'}>Log In as Official</button>
        <div class="row between" style="margin-top:12px;">${modeBadge()}<span class="link" style="font-size:11.5px;" onclick="GovUI.retryConnection()">Retry connection</span></div>
      </div>
      <div class="glass-card tight" style="margin-top:14px;background:rgba(224,138,30,.1);border-color:rgba(224,138,30,.3);">
        <p style="font-size:11.5px;color:var(--warn);margin:0;line-height:1.5;"><b>Demo mode:</b> in production, officials authenticate with government-issued credentials only - this account picker exists solely to preview role- and jurisdiction-based access for this prototype.</p>
      </div>
    </div>`;
  }

  async function loginAsGov() {
    const sel = document.getElementById('gov-auth-select');
    const id = (sel && sel.value) || G.loginAuthority;
    try {
      await startSession(id);
      state.history = [];
      nav('gov-dashboard', { replace: true });
    } catch (e) { toast(e.message); }
  }

  /* ============================================================ DASHBOARD */
  function listKey() { const ch = CHIPS[G.list.chip] || CHIPS.priority; return ['list', ch.sort, ch.filter, G.list.limit].join('|'); }
  function listData() {
    const ch = CHIPS[G.list.chip] || CHIPS.priority;
    return data(listKey(), () => API.get('/gov/complaints', { sort: ch.sort, filter: ch.filter, limit: G.list.limit }));
  }

  function screenGovDashboard() {
    if (!G.authority) { setTimeout(() => nav('gov-login', { replace: true }), 0); return loadingCard(); }
    const a = G.authority, me = G.me;
    const isWard = a.level === 'WARD';
    const managedProjects = constructionProjects.filter(p => (isWard ? p.authorityWardId === state.councillorWardId : true));
    const ck = {
      underConstruction: managedProjects.filter(p => p.status === 'Under Construction').length,
      delayed: managedProjects.filter(p => p.status === 'Delayed').length,
      majorInfra: managedProjects.filter(p => p.projectType === 'MAJOR_INFRASTRUCTURE').length,
    };
    const res = listData();
    const k = res && res.v && res.v.kpis;
    const lucknowWards = WARDS.filter(w => w.subDistrict === 'Lucknow Sadar');
    return `
    <div class="screen">
      <div class="row between" style="margin:20px 0 4px;">
        <div style="min-width:0;">
          <div style="font-weight:800;font-size:16px;" class="display">${esc(a.title)}</div>
          <div class="muted" style="font-size:11.5px;">Jurisdiction: ${esc(me.path.map(p => p.short).join(' › '))}</div>
        </div>
        <div class="icon-btn" onclick="logout()" title="Log out">⎋</div>
      </div>
      <div class="row gap8" style="margin:12px 0 8px;">
        <select onchange="switchGovRole(this.value)" style="flex:1;">
          ${ROLE_ORDER.map(r => `<option value="${r}" ${r === a.role ? 'selected' : ''}>${esc(ROLE_LABEL[r])}</option>`).join('')}
        </select>
        ${modeBadge()}
      </div>
      ${isWard ? `
        <div class="row between" style="margin-bottom:12px;background:var(--glass);padding:6px 12px;border-radius:10px;font-size:12px;">
          <span class="muted">Demo account (ward):</span>
          <select style="width:auto;padding:4px 8px;font-size:12px;font-weight:700;" onchange="GovUI.switchWard(this.value)">
            ${lucknowWards.map(w => `<option value="${w.id}" ${w.id === a.unit ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
            ${lucknowWards.some(w => w.id === a.unit) ? '' : `<option selected>${esc(me.unit.name)}</option>`}
          </select>
        </div>` : ''}

      <button class="btn btn-primary full gap10" style="margin-bottom:14px;box-shadow:0 8px 24px rgba(90,79,224,.35);" onclick="openNewConstructionFlow()"><span>🚧</span> Map New Construction Project</button>

      <div class="seg" style="margin-bottom:14px;">
        <div class="seg-item ${state.govTab === 'complaints' ? 'active' : ''}" onclick="state.govTab='complaints';render()">📋 Complaints (${k ? k.total : '…'})</div>
        <div class="seg-item ${state.govTab === 'construction' ? 'active' : ''}" onclick="state.govTab='construction';render()">🚧 Construction (${managedProjects.length})</div>
      </div>

      ${state.govTab === 'complaints' ? complaintsTab(res) : `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
          <div class="kpi"><div class="kn">${ck.underConstruction}</div><div class="kl">UNDER CONSTRUCTION</div></div>
          <div class="kpi"><div class="kn" style="color:var(--danger);">${ck.delayed}</div><div class="kl">DELAYED PROJECTS</div></div>
          <div class="kpi"><div class="kn" style="color:var(--info);">${ck.majorInfra}</div><div class="kl">MAJOR INFRASTRUCTURE</div></div>
          <div class="kpi"><div class="kn">${managedProjects.length}</div><div class="kl">TOTAL MANAGED</div></div>
        </div>
        <h4 style="margin:10px 0 8px;font-size:14px;">Authorized Construction Areas</h4>
        ${managedProjects.length ? managedProjects.map(p => renderGovProjectCardHTML(p)).join('') : `
          <div class="empty glass-card"><div class="ee">🚧</div><div style="font-weight:800;font-size:15px;">No active construction mapped yet.</div>
          <p class="muted" style="font-size:12.5px;margin:6px 0 14px;">Use the button above to draw and publish construction zones on the satellite map.</p></div>`}
      `}
    </div>`;
  }

  function complaintsTab(res) {
    if (!res) return loadingCard('Loading complaints in your jurisdiction…');
    if (res.err) return errorCard(res.err);
    const d = res.v, k = d.kpis;
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;" class="${loading(listKey()) ? 'an-loading' : ''}">
        <div class="kpi"><div class="kn">${k.total}</div><div class="kl">TOTAL</div></div>
        <div class="kpi"><div class="kn">${k.progress}</div><div class="kl">IN PROGRESS</div></div>
        <div class="kpi"><div class="kn">${k.resolved}</div><div class="kl">RESOLVED</div></div>
        <div class="kpi"><div class="kn" style="color:var(--danger);">${k.escalated}</div><div class="kl">ESCALATED</div></div>
        <div class="kpi"><div class="kn" style="color:var(--warn);">${k.high}</div><div class="kl">HIGH PRIORITY</div></div>
        <div class="kpi"><div class="kn">${k.pending}</div><div class="kl">PENDING</div></div>
      </div>
      ${k.at_risk ? `<div class="geo-banner geo-banner-danger" style="cursor:pointer;margin-top:0;" onclick="GovUI.chip('at_risk')"><span>⏱</span><div><b>${k.at_risk} complaint${k.at_risk > 1 ? 's' : ''} will breach SLA within 48 hours</b> and auto-escalate to the next authority. Tap to review.</div></div>` : ''}
      <div class="row gap8" style="margin-bottom:14px;">
        <button class="btn btn-outline" style="flex:1;padding:12px;font-size:13px;" onclick="nav('escalated')">⚠ Escalated (${k.escalated})</button>
        <button class="btn btn-ghost" style="flex:1;padding:12px;font-size:13px;" onclick="GovUI.openAnalytics()">📊 My Performance</button>
      </div>
      <div class="an-scroll">
        ${Object.keys(CHIPS).map(id => `<div class="chip ${G.list.chip === id ? 'active' : ''}" onclick="GovUI.chip('${id}')">${CHIPS[id].label}</div>`).join('')}
      </div>
      ${d.items.length ? d.items.map(govCard).join('') : `<div class="empty glass-card"><div class="ee">✅</div><div style="font-weight:800;">Nothing to show here</div></div>`}
      ${d.total > d.items.length ? `<button class="btn btn-ghost full" style="margin-top:4px;" onclick="GovUI.more()">Show more (${d.total - d.items.length} remaining)</button>` : ''}
      <p class="an-note center" style="margin-top:12px;">🔒 Showing only complaints inside ${esc(G.me.unit.name)} - filtered by the server for your account.</p>`;
  }

  function slaChip(c) {
    if (c.status === 'RESOLVED') {
      if (c.resolution_valid) return `<span class="sla-chip done">✓ Resolved${c.confirmation === 'CONFIRMED' ? ' · citizen confirmed' : ''}</span>`;
      return `<span class="sla-chip risk" data-tip="Closed without photo evidence.\nCounts toward performance only if the citizen confirms.">◐ Unverified closure</span>`;
    }
    const left = c.sla.remaining_ms;
    const where = c.escalation_count ? `With ${LEVEL_LABEL[c.level]} · ` : '';
    if (left <= 0) return `<span class="sla-chip late">⚠ ${where}SLA breached</span>`;
    if (left <= 48 * 36e5) return `<span class="sla-chip risk">⏱ ${where}${dur(left)} left</span>`;
    return `<span class="sla-chip ${c.escalation_count ? 'late' : 'ok'}">${c.escalation_count ? '⬆ ' : '⏱ '}${where}${dur(left)} left</span>`;
  }

  function govCard(c) {
    const ct = cat(c.category), level = priorityLevel(c.priority_score), st = STATUS_KEY[c.status] || 'pending';
    return `<div class="complaint-card" onclick="openGovComplaint('${esc(c.id)}')">
      <div class="cat-icon" style="background:${ct.color}22;color:${ct.color};">${ct.icon}</div>
      <div style="flex:1;min-width:0;">
        <div class="row between" style="gap:6px;"><b style="font-size:13.5px;">${esc(c.title)}</b><span class="priority-tag pr-${level.toLowerCase()}">${level}</span></div>
        <div class="cc-meta">#${esc(c.id)} · Anonymous Citizen · ${esc(c.ward_name)} · ${c.days_pending}d pending</div>
        <div class="row gap6" style="margin-top:8px;flex-wrap:wrap;">
          <span class="badge ${STATUS_META[st].badge}">${STATUS_META[st].label}</span>
          ${slaChip(c)}
          <span class="muted" style="font-size:11px;">▲ ${c.upvotes}</span>
        </div>
      </div>
    </div>`;
  }

  /* ========================================================= GOV DETAIL */
  function openGovComplaint(id) { G.detailId = id; nav('gov-detail'); }

  function chainHTML(c) {
    const passed = {};
    (c.escalations || []).forEach(e => { passed[e.from_level] = true; });
    return `<div class="an-chain">${E.CONFIG.ESCALATION_CHAIN.map((lvl, i) => `
      ${i ? '<span class="arrow">→</span>' : ''}<span class="step ${c.level === lvl && c.status !== 'RESOLVED' ? 'now' : passed[lvl] ? 'done' : ''}">${LEVEL_LABEL[lvl]}</span>`).join('')}</div>`;
  }

  function screenGovDetail() {
    const k = 'detail|' + G.detailId;
    const res = data(k, () => API.get('/gov/complaints/' + encodeURIComponent(G.detailId)));
    const head = `<div class="row gap10" style="margin:20px 0 16px;"><div class="icon-btn" onclick="back()">←</div><h2 class="display" style="margin:0;font-size:17px;">Agent Verification</h2></div>`;
    if (!res) return `<div class="screen">${head}${loadingCard()}</div>`;
    if (res.err) return `<div class="screen">${head}${errorCard(res.err)}</div>`;
    const c = res.v, ct = cat(c.category), perm = c.permissions || {};
    const vstate = G.verify[c.id] || (c.gov_verified ? 'verified' : 'unverified');
    const left = c.sla.remaining_ms;
    return `<div class="screen">
      ${head}
      <div class="glass-card" style="margin-bottom:12px;">
        <div class="muted" style="font-size:11.5px;">Complaint ID</div><div style="font-weight:800;margin-bottom:10px;">#${esc(c.id)}</div>
        <div class="muted" style="font-size:11.5px;">Category</div><div style="font-weight:700;margin-bottom:10px;">${ct.icon} ${esc(ct.label)}</div>
        <div class="muted" style="font-size:11.5px;">Location</div><div style="font-weight:700;margin-bottom:10px;">${esc(c.ward_name)}</div>
        <div class="muted" style="font-size:11.5px;">Description</div><div style="font-size:13.5px;margin-bottom:10px;line-height:1.6;">${esc(c.description)}</div>
        <div class="muted" style="font-size:11.5px;">Reporter</div>
        <div class="row gap8" style="margin-bottom:4px;"><span class="chip" style="cursor:default;">🕶️ Anonymous Citizen</span></div>
      </div>

      <div class="glass-card" style="margin-bottom:12px;">
        <div class="row between" style="margin-bottom:10px;"><b style="font-size:14px;">SLA & Accountability</b><span class="an-pill ${c.status === 'RESOLVED' ? 'good' : left <= 0 ? 'critical' : left < 48 * 36e5 ? 'watch' : 'info'}">${c.sla.days}-day SLA</span></div>
        ${chainHTML(c)}
        <div style="font-size:12px;line-height:1.7;margin-top:10px;">
          <div><span class="muted">Currently with:</span> <b>${esc(c.assigned_to)}</b></div>
          ${c.status === 'RESOLVED'
            ? `<div><span class="muted">Resolved:</span> <b>${dt(c.resolution.at)}</b> · ${c.resolution.evidence ? '📷 photo evidence' : 'no evidence'}${c.confirmation === 'CONFIRMED' ? ' · ✓ citizen confirmed' : ' · awaiting citizen confirmation'}</div>`
            : `<div><span class="muted">SLA deadline:</span> <b>${dt(c.sla.deadline)}</b> · <b style="color:${left <= 0 ? 'var(--danger)' : left < 48 * 36e5 ? 'var(--warn)' : 'var(--success)'};">${left <= 0 ? 'breached' : dur(left) + ' left'}</b></div>
               <div class="muted" style="font-size:11px;">If unresolved by the deadline, the server escalates it automatically to the next authority.</div>`}
        </div>
        ${(c.escalations || []).length ? `<div style="margin-top:10px;">${c.escalations.map(e => `
          <div class="an-item"><div class="t">⬆ ${esc(LEVEL_LABEL[e.from_level])} → ${esc(LEVEL_LABEL[e.to_level])} <span class="an-pill ${e.trigger === 'MANUAL' ? 'info' : 'critical'}" style="margin-left:4px;">${e.trigger === 'MANUAL' ? 'Manual' : 'Auto · SLA'}</span></div>
          <div class="m">${esc(e.from_authority_title)} → ${esc(e.to_authority_title)}<br>${dt(e.escalated_at)} · after ${dur(e.elapsed_ms)} · ${esc(e.reason)}</div></div>`).join('')}</div>` : ''}
      </div>

      <div class="glass-card" style="margin-bottom:12px;">
        <div class="row between" style="margin-bottom:14px;"><b style="font-size:14px;">Verification Status</b>${verifyPill(vstate)}</div>
        <div class="row gap8">
          <button class="btn btn-success btn-sm" style="flex:1;" onclick="GovUI.verify('${esc(c.id)}',true)">Verify Complaint</button>
          <button class="btn btn-danger btn-sm" style="flex:1;" onclick="GovUI.verify('${esc(c.id)}',false)">Reject</button>
        </div>
        <button class="btn btn-ghost btn-sm full" style="margin-top:8px;" onclick="toast('Request for more information sent to citizen')">Request More Information</button>
      </div>

      <div class="glass-card" style="margin-bottom:12px;">
        <b style="font-size:14px;">Update Status</b>
        ${perm.can_update ? `
          <div class="row gap6" style="margin-top:12px;flex-wrap:wrap;">
            ${Object.keys(STATUS_META).map(s => `<div class="chip ${STATUS_KEY[c.status] === s ? 'active' : ''}" onclick="setGovStatus('${esc(c.id)}','${s}')">${s === 'escalated' ? '⬆ Escalate' : STATUS_META[s].label}</div>`).join('')}
          </div>
          <p class="an-note">Resolving asks for a note and a site photo. Closures without evidence only count toward performance if the citizen confirms the fix.</p>`
        : `<div class="geo-banner geo-banner-info" style="margin-bottom:0;"><span>🔒</span><div>${esc(perm.reason || 'You cannot change this complaint.')}</div></div>`}
      </div>

      <div class="glass-card">
        <b style="font-size:14px;">Timeline</b>
        <div style="margin-top:14px;">
          ${c.timeline.map((t, i) => `
            <div class="tl-item">
              <div class="tl-dot-col"><div class="tl-dot ${t.done ? 'done' : ''} ${t.escalated ? 'escalated' : ''}"></div>${i < c.timeline.length - 1 ? '<div class="tl-line"></div>' : ''}</div>
              <div class="tl-body"><div class="tl-title" style="${t.escalated ? 'color:var(--danger);' : ''}">${t.escalated ? '⚠ ' : ''}${esc(t.title)}</div><div class="tl-date">${dt(t.at)}</div>${t.note ? `<div class="tl-date">“${esc(t.note)}”</div>` : ''}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  }

  function verifyPill(vs) {
    if (vs === 'verifying') return '<div class="verify-pill verifying"><div class="spinner-ring"></div></div>';
    if (vs === 'verified') return '<div class="verify-pill verified"><span>✓</span><span class="vp-text">Verified</span></div>';
    if (vs === 'rejected') return '<div class="verify-pill rejected"><span>!</span><span class="vp-text">Rejected</span></div>';
    return '<div class="verify-pill unverified"><span>✓</span><span class="vp-text">Verification</span></div>';
  }

  async function verify(id, approve) {
    G.verify[id] = 'verifying'; refresh();
    await new Promise(r => setTimeout(r, 1200));
    const c = G.cache['detail|' + id] && G.cache['detail|' + id].v;
    if (!approve) { G.verify[id] = 'rejected'; toast('Complaint flagged as not verified'); refresh(); return; }
    try {
      if (c && c.status === 'PENDING' && c.permissions.can_update) await changeStatus(id, 'VERIFIED', 'Verified on site', false, true);
      G.verify[id] = 'verified';
      toast('Complaint verified successfully');
    } catch (e) { G.verify[id] = null; toast(e.message); }
    refresh();
  }

  async function changeStatus(id, status, note, evidence, quiet) {
    const detail = await API.patch('/gov/complaints/' + encodeURIComponent(id) + '/status', { status, note, evidence });
    G.cache['detail|' + id] = { v: detail, at: Date.now() };
    invalidate(['list', 'an|', 'esc|']);
    syncLocalComplaint(detail);
    const label = { RESOLVED: 'Resolved', ESCALATED: 'Escalated', IN_PROGRESS: 'In Progress', VERIFIED: 'Verified', PENDING: 'Pending' }[status];
    notifications.unshift({ text: `Your complaint #${id} status changed to "${label}".`, time: 'just now', read: false });
    if (!quiet) refresh();
    return detail;
  }

  function setGovStatus(id, s) {
    const status = STATUS_API[s];
    if (status === 'RESOLVED') return openResolveSheet(id);
    if (status === 'ESCALATED') {
      const c = G.cache['detail|' + id] && G.cache['detail|' + id].v;
      const next = c && E.CONFIG.ESCALATION_CHAIN[E.CONFIG.ESCALATION_CHAIN.indexOf(c.level) + 1];
      if (!window.confirm(`Escalate #${id} to the ${LEVEL_LABEL[next] || 'next'} level now?\n\nManual escalations are recorded and count as escalations for your office.`)) return;
    }
    changeStatus(id, status, null, false).then(d => {
      toast(status === 'ESCALATED' ? `Escalated to ${d.assigned_to} · citizen notified` : 'Status updated · citizen notified');
    }).catch(e => toast(e.message));
  }

  /* resolve sheet (note + evidence) */
  function openResolveSheet(id) {
    closeSheet();
    const phone = document.getElementById('phone');
    const bg = document.createElement('div');
    bg.className = 'an-sheet-bg'; bg.id = 'an-sheet';
    bg.onclick = e => { if (e.target === bg) closeSheet(); };
    bg.innerHTML = `<div class="an-sheet">
      <div class="row between" style="margin-bottom:12px;"><b class="display" style="font-size:17px;">Resolve #${esc(id)}</b><div class="icon-btn" onclick="GovUI.closeSheet()">✕</div></div>
      <div class="field"><label>Resolution note (required)</label><textarea id="an-res-note" placeholder="What was done on site?">Issue has been resolved by the ward team.</textarea></div>
      <div class="field"><label>Site photo evidence</label>
        <div class="row gap8" style="align-items:center;">
          <div id="an-res-thumb" class="thumb-add" style="overflow:hidden;">📷</div>
          <label class="btn btn-ghost btn-sm" style="margin:0;">Attach photo<input type="file" accept="image/*" class="hidden" onchange="GovUI.pickEvidence(event)"></label>
          <button class="btn btn-ghost btn-sm" onclick="GovUI.sampleEvidence()">Use sample photo</button>
        </div>
      </div>
      <div class="geo-banner geo-banner-info" id="an-res-hint"><span>ℹ️</span><div>No photo attached: this closure will count toward performance <b>only if the citizen confirms</b> the fix. Disputed closures reopen and are penalised.</div></div>
      <button class="btn btn-primary full" onclick="GovUI.submitResolve('${esc(id)}')">Submit resolution</button>
    </div>`;
    phone.appendChild(bg);
    G.sheetEvidence = false;
  }
  function closeSheet() { const s = document.getElementById('an-sheet'); if (s) s.remove(); }
  function setEvidence(url) {
    G.sheetEvidence = true;
    const t = document.getElementById('an-res-thumb');
    if (t) { t.innerHTML = ''; t.style.border = 'none'; t.style.background = `center/cover url('${url}')`; }
    const h = document.getElementById('an-res-hint');
    if (h) { h.className = 'geo-banner geo-banner-success'; h.innerHTML = '<span>✓</span><div>Photo evidence attached - this resolution counts toward performance unless the citizen disputes it.</div>'; }
  }
  function pickEvidence(e) { const f = e.target.files[0]; if (f) setEvidence(URL.createObjectURL(f)); }
  function sampleEvidence() {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><rect width='56' height='56' fill='%2312a454'/><text x='28' y='34' font-size='22' text-anchor='middle'>✓</text></svg>`;
    setEvidence('data:image/svg+xml;utf8,' + svg);
  }
  async function submitResolve(id) {
    const note = (document.getElementById('an-res-note') || {}).value || '';
    if (!note.trim()) { toast('A resolution note is required'); return; }
    try {
      const d = await changeStatus(id, 'RESOLVED', note, !!G.sheetEvidence, true);
      closeSheet();
      toast(d.counts_towards_score ? 'Resolved with evidence · counts toward performance' : 'Resolved without evidence · counts only if the citizen confirms');
      refresh();
    } catch (e) { toast(e.message); }
  }

  /* ========================================================== ESCALATED */
  function screenEscalated() {
    const a = G.authority;
    const head = `<div class="row gap10" style="margin:20px 0 16px;"><div class="icon-btn" onclick="back()">←</div><h2 class="display" style="margin:0;font-size:19px;">Escalated Complaints</h2></div>`;
    if (!a) return `<div class="screen">${head}</div>`;
    const res = data('esc|' + a.unit + '|all', () => API.get('/gov/analytics/escalations', { unit: a.unit, period: 'all' }));
    const banner = `<div class="glass-card tight" style="background:rgba(224,67,90,.08);border-color:rgba(224,67,90,.3);margin-bottom:14px;">
      <p style="font-size:11.5px;color:var(--danger);margin:0;line-height:1.6;">Complaints unresolved past their category SLA are escalated automatically by the server to the next authority: Ward Councillor → SDM → DM → CM → PM. Every escalation is recorded permanently.</p></div>`;
    if (!res) return `<div class="screen">${head}${banner}${loadingCard()}</div>`;
    if (res.err) return `<div class="screen">${head}${banner}${errorCard(res.err)}</div>`;
    const groups = [];
    const seen = {};
    res.v.records.forEach(r => { if (!seen[r.id]) { seen[r.id] = { ref: r, steps: [] }; groups.push(seen[r.id]); } seen[r.id].steps.unshift(r); });
    return `<div class="screen">${head}${banner}
      <div class="muted" style="font-size:11.5px;margin:-4px 0 10px;">${res.v.record_total} escalation records in ${esc(res.v.unit.name)}${res.v.record_total > res.v.records.length ? ` · latest ${res.v.records.length} shown` : ''}</div>
      ${groups.length ? groups.map(g => {
        const r = g.ref, last = g.steps[g.steps.length - 1];
        return `<div class="glass-card" style="margin-bottom:12px;cursor:pointer;" onclick="openGovComplaint('${esc(r.id)}')">
          <div class="row between"><b style="font-size:14px;">#${esc(r.id)}</b><span class="badge ${r.current_status === 'RESOLVED' ? 'badge-resolved' : 'badge-escalated'}">${r.current_status === 'RESOLVED' ? '✓ Resolved' : '⚠ With ' + esc(LEVEL_LABEL[r.current_level])}</span></div>
          <div class="muted" style="font-size:12.5px;margin:6px 0;">${esc(r.title)} · ${esc(r.ward_name)}</div>
          ${g.steps.map(s => `<div style="font-size:11.5px;line-height:1.55;margin-top:6px;">
            <b>${esc(LEVEL_LABEL[s.from_level])} → ${esc(LEVEL_LABEL[s.to_level])}</b> <span class="muted">· ${dt(s.escalated_at)} · after ${dur(s.elapsed_hours * 36e5)}</span><br>
            <span class="muted">${esc(s.from_authority)} → ${esc(s.to_authority)}</span></div>`).join('')}
          <div class="muted" style="font-size:11px;margin-top:6px;">Reason: ${esc(last.reason)}${last.resolved_at ? ` · resolved ${dt(last.resolved_at)}` : ''}</div>
        </div>`;
      }).join('') : `<div class="empty glass-card"><div class="ee">✅</div><div style="font-weight:800;">No escalations in your jurisdiction</div></div>`}
    </div>`;
  }

  /* ============================================================ PROFILE */
  function screenGovProfile() {
    const a = G.authority;
    if (!a) return '';
    const sec = G.securityCheck;
    const W_ = E.CONFIG.SCORING.weights;
    return `<div class="screen">
      <div class="row gap10" style="margin:20px 0 16px;"><div class="icon-btn" onclick="back()">←</div><h2 class="display" style="margin:0;font-size:19px;">Official Profile</h2></div>
      <div class="glass-card" style="margin-bottom:12px;">
        <div class="row gap12"><div class="avatar" style="width:52px;height:52px;font-size:20px;">🏛️</div>
          <div style="min-width:0;"><div style="font-weight:800;font-size:15px;">${esc(a.title)}</div><div class="muted" style="font-size:12px;">${esc(a.role_label)} · GOV-${esc(a.id.toUpperCase())}</div></div></div>
        <div class="an-note" style="margin-top:10px;">Jurisdiction: <b>${esc(G.me.path.map(p => p.name).join(' › '))}</b> · ${G.me.ward_count} ward${G.me.ward_count === 1 ? '' : 's'}</div>
        <div style="margin-top:10px;">${modeBadge()}</div>
      </div>
      <div class="glass-card" style="margin-bottom:12px;">
        <div class="an-card-title">🔒 Jurisdiction lock - live check</div>
        <div class="an-card-sub">Asks the server for a ward outside your jurisdiction, the way a tampered URL would.</div>
        <button class="btn btn-ghost btn-sm full" onclick="GovUI.securityCheck()">Try to open another ward's data</button>
        ${sec ? `<div class="geo-banner ${sec.ok ? 'geo-banner-success' : 'geo-banner-danger'}" style="margin-bottom:0;"><span>${sec.ok ? '🔒' : '⚠️'}</span><div><b>${esc(sec.title)}</b><br>${esc(sec.detail)}</div></div>` : ''}
      </div>
      <div class="glass-card" style="margin-bottom:12px;">
        <div class="an-card-title">Performance scoring model</div>
        <div class="an-card-sub">Configured in one place on the server (app/analytics/config.py).</div>
        ${weightsHTML(W_)}
      </div>
      <div class="glass-card" style="padding:6px 18px;">
        ${profileRow('📊', 'Analytics & Performance', () => nav('gov-analytics'))}
        ${profileRow('🎨', 'Theme', () => nav('theme-select'))}
        ${profileRow('♻️', 'Reset demo data', () => GovUI.resetDemo())}
      </div>
      <button class="btn btn-danger full" style="margin-top:16px;" onclick="logout()">Log Out</button>
    </div>`;
  }

  function weightsHTML(w) {
    const rows = [['Verified resolution rate', w.resolution], ['SLA compliance', w.sla], ['Timeliness', w.speed], ['Avoided escalation', w.escalation]];
    return `<div class="an-bars">${rows.map(([l, v]) => `
      <div class="an-bar-row nopos"><div><div class="name">${l}</div><div class="an-track"><div class="an-fill accent" style="width:${v * 100}%"></div></div></div><div class="val">${Math.round(v * 100)}%</div></div>`).join('')}
      <div class="an-note">Minus up to ${E.CONFIG.SCORING.reopen_penalty} points for closures that citizens dispute. Fewer than ${E.CONFIG.SCORING.min_received} complaints → "Insufficient data", never 0% or 100%.</div></div>`;
  }

  async function securityCheck() {
    const a = G.authority;
    const target = a.unit === 'ward24' ? 'ward42' : a.unit === 'IN' ? null : 'ward24';
    let probe = target;
    if (a.level !== 'WARD' && a.level !== 'REGION') probe = a.unit.indexOf('MH') === 0 ? 'KA' : 'MH';
    if (!probe) { G.securityCheck = { ok: true, title: 'National access', detail: 'The PM account covers every jurisdiction, so there is nothing outside it to test.' }; refresh(); return; }
    try {
      await API.get('/gov/analytics/dashboard', { unit: probe, period: 'all' });
      G.securityCheck = { ok: false, title: 'Unexpected: access was granted', detail: probe };
    } catch (e) {
      G.securityCheck = { ok: e.status === 403, title: `Server answered ${e.status} ${e.status === 403 ? 'Forbidden' : ''}`, detail: e.message };
    }
    refresh();
  }

  async function resetDemo() {
    if (!window.confirm('Reset the demo dataset? All actions taken in this demo are discarded.')) return;
    try { await API.post('/gov/demo/reset', {}); G.cache = {}; toast('Demo data reset'); refresh(); } catch (e) { toast(e.message); }
  }

  /* ========================================================== ANALYTICS */
  function periodQuery() {
    const an = G.an;
    if (an.period === 'custom' && an.from && an.to) return { period: 'custom', frm: an.from, to: an.to };
    return { period: an.period === 'custom' ? '30d' : an.period };
  }
  const pkey = () => { const q = periodQuery(); return [q.period, q.frm || '', q.to || ''].join(','); };
  const dashData = unit => data(['an|dash', unit, pkey()].join('|'), () => API.get('/gov/analytics/dashboard', Object.assign({ unit }, periodQuery())));

  function drill(unitId) { G.an.unit = unitId; G.an.tab = G.an.tab === 'rankings' ? 'rankings' : G.an.tab; G.an.level = null; G.an.showAll = false; refreshTop(); }
  function refreshTop() { state._keepScroll = false; render(); }

  function openAnalytics() { G.an.unit = G.authority.unit; nav('gov-analytics'); }

  function screenGovAnalytics() {
    const a = G.authority, an = G.an;
    if (!a) return '';
    const unit = an.unit || a.unit;
    const dash = dashData(unit);
    const dv = dash && dash.v;
    const path = dv ? dv.path : G.me.path;
    const ownDepth = G.me.path.length - 1;
    const tabs = [['overview', '📊 Overview'], ['rankings', '🏆 Rankings'], ['sla', '⏱ SLA'], ['escalations', '⬆ Escalations'], ['map', '🗺️ Map']];
    const kids = dv && dv.children ? dv.children.items : [];
    return `<div class="screen">
      <div class="an-head">
        <div style="min-width:0;">
          <h2 class="an-title">Analytics & Performance</h2>
          <div class="an-sub">${esc(a.title)}</div>
        </div>
        <div class="row gap6">${modeBadge()}<div class="icon-btn" style="width:34px;height:34px;font-size:14px;" onclick="GovUI.toggleWide()" data-tip="${document.getElementById('phone').classList.contains('wide') ? 'Phone view' : 'Command-centre view (wide)'}">${document.getElementById('phone').classList.contains('wide') ? '📱' : '⤢'}</div></div>
      </div>
      <div class="an-crumbs" aria-label="Jurisdiction path">
        ${path.map((p, i) => {
          const cls = p.id === unit ? 'current' : i < ownDepth && a.level !== 'REGION' ? 'locked' : 'link';
          const click = cls === 'link' ? `onclick="GovUI.drill('${esc(p.id)}')"` : '';
          return `${i ? '<span class="an-sep">›</span>' : ''}<span class="an-crumb ${cls}" ${click} ${cls === 'locked' ? 'data-tip="Above your jurisdiction - shown for context only"' : ''}>${esc(p.short)}</span>`;
        }).join('')}
      </div>
      ${kids.length ? `<div class="an-filters"><select onchange="if(this.value)GovUI.drill(this.value)" aria-label="Drill down">
          <option value="">${an.tab === 'rankings' ? 'Narrow to a' : 'Drill down to a'} ${esc(UNIT_NOUN[dv.children.unit_type] || 'unit')}…</option>
          ${kids.map(k => `<option value="${esc(k.id)}">${esc(k.name)}${k.score !== null ? ` · ${k.score}` : ''}</option>`).join('')}
        </select></div>` : ''}
      <div class="an-scroll" role="group" aria-label="Time period">
        ${PERIODS.map(([k, l]) => `<div class="chip ${an.period === k ? 'active' : ''}" onclick="GovUI.period('${k}')">${l}</div>`).join('')}
      </div>
      ${an.period === 'custom' ? `<div class="an-custom"><input type="date" id="an-from" value="${esc(an.from)}"><span class="muted">to</span><input type="date" id="an-to" value="${esc(an.to)}"><button class="btn btn-primary btn-sm" onclick="GovUI.applyCustom()">Apply</button></div>` : ''}
      <div class="an-tabs" role="tablist">
        ${tabs.map(([k, l]) => `<div class="an-tab ${an.tab === k ? 'active' : ''}" role="tab" onclick="GovUI.tab('${k}')">${l}</div>`).join('')}
      </div>
      <div class="an-updated">${dv ? esc(dv.period.label) + ' · ' : ''}${G.lastRefresh ? 'updated ' + new Date(G.lastRefresh).toLocaleTimeString('en-IN', { hour12: false }) + ' · auto-refresh 30s' : ''}</div>
      ${an.tab === 'overview' ? overviewTab(dash, unit)
        : an.tab === 'rankings' ? rankingsTab(dv, unit)
        : an.tab === 'sla' ? slaTab(unit, dash)
        : an.tab === 'escalations' ? escalationsTab(unit)
        : mapTab(unit)}
    </div>`;
  }

  /* ---------- overview */
  function overviewTab(dash, unit) {
    if (!dash) return loadingCard('Computing performance from complaint records…');
    if (dash.err) return errorCard(dash.err);
    const d = dash.v, s = d.score, m = d.metrics, isWard = d.unit.level === 'WARD';
    const busy = loading(['an|dash', unit, pkey()].join('|'));
    return `<div class="an-grid ${busy ? 'an-loading' : ''}">
      ${heroCard(d)}
      <div class="glass-card">
        <div class="an-card-title">${isWard ? 'Complaint handling' : 'Jurisdiction outcomes'}</div>
        <div class="an-card-sub">${isWard ? 'Complaints filed in this ward during the period' : `All complaints filed in ${esc(d.unit.name)}, whoever resolved them`}</div>
        ${kpiGrid(m)}
        <p class="an-note">Rates use the ${m.due} complaint${m.due === 1 ? '' : 's'} that are resolved or past their SLA. ${m.in_progress_within_sla} still inside their SLA window count neither for nor against${isWard ? ' the councillor' : ''} yet.</p>
      </div>
      <div class="glass-card">
        <div class="an-card-title">Complaint status</div>
        <div class="an-card-sub">Where every complaint from this period stands right now</div>
        ${statusStack(d.status_breakdown)}
      </div>
      <div class="glass-card">
        <div class="an-card-title">Performance over time</div>
        <div class="an-card-sub">Score on a rolling 3-month window${d.rank ? ` · vs the average of peer ${esc(E.CONFIG.LEVEL_PEER_NOUN[d.rank.level][1])} ${d.rank.within === 'IN' ? 'nationwide' : 'in ' + esc(d.rank.within_name)}` : ''}</div>
        ${lineChart(d.trend, d.unit.short, !!d.rank)}
      </div>
      ${d.own ? ownCard(d) : ''}
      ${breakdownCard(d)}
      ${integrityCard(m, isWard)}
      ${d.children ? childrenCard(d) : ''}
    </div>`;
  }

  function heroCard(d) {
    const s = d.score, meta = BAND_META[s.band];
    const who = d.unit.authority ? d.unit.authority.title : d.unit.name;
    let delta = '';
    if (d.delta) {
      const ch = d.delta.change, cls = ch > 0.05 ? 'up' : ch < -0.05 ? 'down' : 'flat';
      delta = `<span class="an-delta ${cls}">${cls === 'up' ? '▲' : cls === 'down' ? '▼' : '■'} ${Math.abs(ch).toFixed(1)} pts</span> <span class="muted" style="font-size:11px;">${esc(d.delta.label)}</span>`;
    }
    const basis = s.basis === 'blend' && s.blend
      ? `<p class="an-note">Blend: ${Math.round(s.blend.own_weight * 100)}% escalated cases this office handled (${s.blend.own_score}) + ${Math.round(s.blend.system_weight * 100)}% jurisdiction outcomes (${s.blend.system_score}).</p>`
      : s.basis === 'system' && d.unit.level !== 'WARD' ? `<p class="an-note">Based on jurisdiction outcomes${d.unit.level !== 'COUNTRY' && d.unit.level !== 'REGION' ? ' (too few escalated cases this period to score the office separately)' : ''}.</p>` : '';
    return `<div class="glass-card span-all">
      <div class="row between" style="gap:8px;align-items:flex-start;">
        <div style="min-width:0;"><div class="an-card-title">${esc(who)}</div><div class="an-card-sub" style="margin-bottom:0;">${esc(d.period.label)}</div></div>
        <span class="an-band ${s.band}">${meta.icon} ${meta.label}</span>
      </div>
      ${s.value === null ? `
        <div style="padding:14px 0 4px;"><div class="an-hero-num" style="font-size:30px;letter-spacing:0;">Insufficient data</div>
        <p class="muted" style="font-size:12.5px;margin:6px 0 0;">${esc(s.insufficient_reason)}</p>
        ${d.rank ? `<p class="an-note">${esc(d.rank.label)}</p>` : ''}</div>` : `
        <div class="an-hero" style="margin-top:10px;">
          <div class="an-hero-num">${s.value}<small>/100</small></div>
          <div style="min-width:0;">
            <div>${delta}</div>
            ${d.rank ? `<div class="an-rank">${esc(d.rank.label)}</div><div class="an-rank-sub">Peer average ${numTxt(d.rank.peer_average)}${d.rank.unranked ? ` · ${d.rank.unranked} not ranked (insufficient data)` : ''}</div>`
              : `<div class="an-rank-sub">${d.unit.level === 'COUNTRY' ? 'National aggregate - no peer group' : 'No comparable peer group for this office'}</div>`}
          </div>
        </div>
        <div class="an-track" style="margin-top:12px;height:8px;"><div class="an-fill accent" style="width:${s.value}%"></div>${d.rank && d.rank.peer_average !== null ? `<div class="an-target" style="left:${d.rank.peer_average}%" data-tip="Peer average ${d.rank.peer_average}"></div>` : ''}</div>
        ${basis}`}
    </div>`;
  }

  function kpiGrid(m) {
    const tile = (v, l, color, tip) => `<div class="an-kpi" ${tip ? `data-tip="${esc(tip)}" tabindex="0"` : ''}><div class="v" style="${color ? 'color:' + color : ''}">${v}</div><div class="l">${l}</div></div>`;
    return `<div class="an-kpis">
      ${tile(m.received, 'RECEIVED')}
      ${tile(m.resolved, 'RESOLVED (VERIFIED)', 'var(--success)', 'Resolved with photo evidence or confirmed by the citizen')}
      ${tile(m.in_progress_within_sla, 'IN PROGRESS WITHIN SLA', '', 'Still inside their SLA window - not counted yet')}
      ${tile(m.overdue, 'OVERDUE', m.overdue ? 'var(--danger)' : '', 'Past SLA and still unresolved')}
      ${tile(m.escalated, 'ESCALATED', m.escalated ? 'var(--danger)' : '', 'Breached SLA and moved up the chain')}
      ${tile(m.avg_resolution_days === null ? '—' : m.avg_resolution_days + 'd', 'AVG RESOLUTION', '', 'Average time to a verified resolution')}
      ${tile(pctTxt(m.resolution_rate), 'RESOLUTION RATE', '', 'Verified resolutions ÷ complaints due')}
      ${tile(pctTxt(m.sla_compliance), 'SLA COMPLIANCE', '', 'Resolved within SLA ÷ complaints whose SLA outcome is known')}
      ${tile(pctTxt(m.escalation_resolution_rate), 'ESCALATED → RESOLVED', '', `${m.escalated_resolved} of ${m.escalated} escalated complaints resolved; ${m.escalated_pending} still pending`)}
    </div>`;
  }

  function statusStack(sb) {
    const segs = [
      ['resolved_verified', '✓ Resolved (verified)', 'var(--st-good)'],
      ['open_within_sla', '⏱ In progress within SLA', 'var(--info)'],
      ['unverified_closure', '◐ Closed without proof', 'var(--st-watch)'],
      ['overdue', '⚠ Overdue / escalated & open', 'var(--st-critical)'],
    ];
    const total = segs.reduce((s, x) => s + sb[x[0]], 0);
    if (!total) return `<div class="an-empty"><div class="ee">📭</div><div class="muted" style="font-size:12px;">No complaints received during this period.</div></div>`;
    return `<div class="an-stack" role="img" aria-label="Complaint status breakdown">${segs.filter(x => sb[x[0]]).map(([k, l, c]) =>
      `<div style="width:${(sb[k] / total) * 100}%;background:${c};" data-tip="${esc(l)}: ${sb[k]} (${Math.round((sb[k] / total) * 100)}%)"></div>`).join('')}</div>
      <div class="an-legend">${segs.map(([k, l, c]) => `<span><i class="an-sw" style="background:${c}"></i>${esc(l)} <b style="color:var(--text)">${sb[k]}</b></span>`).join('')}</div>`;
  }

  function lineChart(points, selfLabel, withPeers) {
    const W = 340, H = 158, pl = 30, pr = 34, pt = 10, pb = 24, iw = W - pl - pr, ih = H - pt - pb;
    const n = points.length;
    const x = i => pl + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = v => pt + ih - (v / 100) * ih;
    if (!points.some(p => p.score !== null)) return `<div class="an-empty"><div class="ee">📉</div><div class="muted" style="font-size:12px;">Not enough history to draw a trend yet.</div></div>`;
    const pathFor = key => {
      let dstr = '', pen = false;
      points.forEach((p, i) => { if (p[key] === null) { pen = false; return; } dstr += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`; pen = true; });
      return dstr;
    };
    const grid = [0, 25, 50, 75, 100].map(v => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('');
    const xl = points.map((p, i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label.split(' ')[0])}${p.partial ? '*' : ''}</text>`).join('');
    const peer = withPeers ? `<path d="${pathFor('peer_average')}" fill="none" stroke="var(--viz-muted)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '';
    const self = `<path d="${pathFor('score')}" fill="none" stroke="var(--viz-accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const dots = points.map((p, i) => p.score === null ? '' : `<circle cx="${x(i)}" cy="${y(p.score)}" r="4" fill="${p.partial ? 'var(--bg-1)' : 'var(--viz-accent)'}" stroke="${p.partial ? 'var(--viz-accent)' : 'var(--bg-1)'}" stroke-width="2"/>`).join('');
    let lastI = -1;
    points.forEach((p, i) => { if (p.score !== null) lastI = i; });
    const endLabel = lastI >= 0 ? `<text x="${x(lastI) + 8}" y="${y(points[lastI].score) + 3}" style="fill:var(--text);font-weight:700;font-size:11px;">${points[lastI].score}</text>` : '';
    const band = n > 1 ? iw / (n - 1) : iw;
    const hits = points.map((p, i) => {
      const tip = `${p.label}${p.partial ? ' (month in progress)' : ''}\nScore: ${p.score === null ? 'insufficient data' : p.score}${withPeers ? `\nPeer average: ${numTxt(p.peer_average)}` : ''}\nResolution: ${pctTxt(p.resolution_rate)} · SLA: ${pctTxt(p.sla_compliance)}\nComplaints: ${p.received}`;
      return `<rect class="hit" x="${x(i) - band / 2}" y="${pt}" width="${band}" height="${ih}" data-tip="${esc(tip)}" tabindex="0"/><line class="cross" x1="${x(i)}" x2="${x(i)}" y1="${pt}" y2="${pt + ih}"/>`;
    }).join('');
    return `<div class="an-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Performance trend">${grid}<line class="axis" x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}"/>${xl}${peer}${self}${dots}${endLabel}${hits}</svg></div>
      <div class="an-legend"><span><i class="an-key" style="background:var(--viz-accent)"></i>${esc(selfLabel)}</span>${withPeers ? '<span><i class="an-key" style="background:var(--viz-muted)"></i>Peer average</span>' : ''}<span class="muted">* month in progress</span></div>
      <table class="an-sr"><caption>${esc(selfLabel)} score by month</caption><tr><th>Month</th><th>Score</th>${withPeers ? '<th>Peer average</th>' : ''}</tr>${points.map(p => `<tr><td>${esc(p.label)}</td><td>${numTxt(p.score)}</td>${withPeers ? `<td>${numTxt(p.peer_average)}</td>` : ''}</tr>`).join('')}</table>`;
  }

  function ownCard(d) {
    const o = d.own;
    const noun = { SDM: 'SDM', DISTRICT: 'DM', STATE: 'CM office' }[d.unit.level] || 'office';
    return `<div class="glass-card">
      <div class="an-card-title">⬆ Escalated cases handled by the ${noun}</div>
      <div class="an-card-sub">Complaints escalated to this office in the period - the office's own responsibility</div>
      ${o.received ? `<div class="an-hero" style="gap:12px;margin-bottom:10px;"><div class="an-hero-num" style="font-size:34px;">${pctTxt(o.resolution_rate)}</div>
        <div class="muted" style="font-size:12px;line-height:1.5;"><b style="color:var(--text)">${o.resolved}</b> of ${o.due} due escalations resolved (verified)<br>${o.in_progress_within_sla} still within the office's SLA</div></div>
        <div class="an-kpis">
          <div class="an-kpi"><div class="v">${o.received}</div><div class="l">ESCALATED TO YOU</div></div>
          <div class="an-kpi"><div class="v" style="color:var(--success)">${pctTxt(o.sla_compliance)}</div><div class="l">WITHIN YOUR SLA</div></div>
          <div class="an-kpi"><div class="v" style="${o.escalated ? 'color:var(--danger)' : ''}">${o.escalated}</div><div class="l">ESCALATED FURTHER</div></div>
        </div>` : `<div class="an-empty"><div class="ee">📭</div><div class="muted" style="font-size:12px;">No escalated cases during this period.</div></div>`}
    </div>`;
  }

  function breakdownCard(d) {
    const s = d.score;
    if (!s.components) return '';
    return `<div class="glass-card">
      <div class="an-card-title">How the score is built</div>
      <div class="an-card-sub">Weights are configured on the server; the same model scores every office</div>
      <div class="an-bars">${s.components.map(c => `
        <div class="an-bar-row nopos" data-tip="${esc(c.label)}: ${c.value}/100 × ${Math.round(c.weight * 100)}% = ${c.points} points" tabindex="0">
          <div><div class="name">${esc(c.label)} <span class="muted" style="font-weight:600;">· ${Math.round(c.weight * 100)}%</span></div><div class="an-track"><div class="an-fill accent" style="width:${c.value}%"></div></div></div>
          <div class="val">${c.points}</div></div>`).join('')}
        ${s.penalty ? `<div class="an-bar-row nopos"><div><div class="name" style="color:var(--danger)">Citizen-disputed closures</div><div class="muted" style="font-size:10.5px;">penalty for closures that were reopened</div></div><div class="val" style="color:var(--danger)">−${s.penalty}</div></div>` : ''}
      </div>
      <p class="an-note">${d.score.basis === 'blend' ? 'Shown: jurisdiction component. ' : ''}Resolution counts only verified fixes, so closing complaints without proof cannot raise the score.</p>
    </div>`;
  }

  function integrityCard(m, isWard) {
    const flags = [];
    if (m.reopen_rate !== null && m.reopen_rate >= 15) flags.push(`High dispute rate: citizens reopened ${m.reopened} closure${m.reopened === 1 ? '' : 's'} (${m.reopen_rate}%).`);
    if (m.unverified_closures && m.verified_closure_share !== null && m.verified_closure_share < 85) flags.push(`${m.unverified_closures} closure${m.unverified_closures === 1 ? '' : 's'} without evidence or confirmation - not counted as resolved.`);
    const closures = m.resolved + m.unverified_closures;
    return `<div class="glass-card">
      <div class="an-card-title">🛡 Resolution integrity</div>
      <div class="an-card-sub">Guards against closing complaints without fixing them</div>
      <table class="an-table">
        <tr><td>Closures verified (photo or citizen)</td><td class="num"><b>${m.resolved}</b> / ${closures}</td></tr>
        <tr><td>Closed without proof (not counted)</td><td class="num">${m.unverified_closures}</td></tr>
        <tr><td>Reopened after citizen dispute</td><td class="num" style="${m.reopened ? 'color:var(--danger);font-weight:800' : ''}">${m.reopened}</td></tr>
        <tr><td>Photo evidence on resolutions</td><td class="num">${pctTxt(m.evidence_rate)}</td></tr>
        <tr><td>Citizen-confirmed resolutions</td><td class="num">${pctTxt(m.citizen_confirmation_rate)}</td></tr>
        ${isWard && m.resolved_by_other ? `<tr><td>Resolved by a superior instead</td><td class="num">${m.resolved_by_other}</td></tr>` : ''}
      </table>
      ${flags.length ? flags.map(f => `<div class="geo-banner geo-banner-danger" style="margin:10px 0 0;"><span>⚠</span><div>${esc(f)}</div></div>`).join('')
        : `<div class="geo-banner geo-banner-success" style="margin:10px 0 0;"><span>✓</span><div>No integrity concerns in this period.</div></div>`}
    </div>`;
  }

  function childrenCard(d) {
    const ch = d.children;
    const items = ch.items;
    return `<div class="glass-card span-all">
      <div class="an-card-title">${esc(ch.title)}</div>
      <div class="an-card-sub">Ranked by performance score · tap to drill down${items.some(i => i.score === null) ? ' · offices with too few complaints are listed as insufficient data' : ''}</div>
      ${rankBars(items, null, true)}
    </div>`;
  }

  function bandPill(b) { const m = BAND_META[b]; return `<span class="an-pill ${b === 'none' ? '' : b}">${m.icon} ${esc(m.label)}</span>`; }

  function rankBars(items, highlight, drillable) {
    if (!items.length) return `<div class="an-empty"><div class="muted" style="font-size:12px;">No offices to compare.</div></div>`;
    return `<div class="an-bars">${items.map(it => {
      const can = drillable && it.accessible !== false;
      const me = highlight && it.id === highlight;
      const name = it.authority ? it.authority.title.replace(/^.*· /, '') : it.name;
      const tip = `${it.authority ? it.authority.title : it.name}\nScore: ${it.score === null ? 'insufficient data' : it.score}\nResolution ${pctTxt(it.resolution_rate)} · SLA ${pctTxt(it.sla_compliance)}\nEscalated ${it.escalated} · Overdue ${it.overdue} · Received ${it.received}${it.accessible === false ? '\nAggregate only - outside your jurisdiction' : ''}`;
      return `<div class="an-bar-row ${can ? 'click' : ''} ${me ? 'me' : ''}" ${can ? `onclick="GovUI.drill('${esc(it.id)}')"` : ''} data-tip="${esc(tip)}" tabindex="0">
        <div class="pos">${it.position ? '#' + it.position : '–'}</div>
        <div style="min-width:0;">
          <div class="name">${esc(name)}${me ? ' <span class="an-pill info" style="margin-left:4px;">You</span>' : ''}</div>
          <div class="meta">${it.path && it.path.length ? esc(it.path.join(' › ')) + ' · ' : ''}${it.score === null ? esc(it.insufficient_reason || 'Insufficient data') : `Resolution ${pctTxt(it.resolution_rate)} · SLA ${pctTxt(it.sla_compliance)} · ${it.escalated} escalated${it.overdue ? ` · ${it.overdue} overdue` : ''}`}</div>
          ${it.score === null ? '' : `<div class="an-track"><div class="an-fill ${!highlight || me ? 'accent' : ''}" style="width:${it.score}%"></div></div>`}
        </div>
        <div class="val">${it.score === null ? '—' : it.score}</div>
      </div>`;
    }).join('')}</div>`;
  }

  /* ---------- rankings */
  function rankLevels(dv) {
    const me = G.me, own = G.authority.level;
    const viewed = dv ? dv.unit.level : own;
    const R = E.CONFIG.LEVEL_RANK;
    return (me.ranking_levels || []).filter(l => R[l] < R[viewed] || (l === own && me.peer_group));
  }

  function rankingsTab(dv, unit) {
    if (!dv) return loadingCard();
    const levels = rankLevels(dv);
    if (!levels.length) return `<div class="glass-card an-empty"><div class="ee">🏆</div><div style="font-weight:800;">No comparison group</div><p class="muted" style="font-size:12px;">This office has no peers or subordinate offices to rank.</p></div>`;
    const own = G.authority;
    const preferred = { COUNTRY: 'STATE', STATE: 'SDM', DISTRICT: 'SDM', SDM: 'WARD', WARD: 'WARD', REGION: 'WARD' }[own.level];
    const level = G.an.level && levels.indexOf(G.an.level) >= 0 ? G.an.level : levels.indexOf(preferred) >= 0 ? preferred : levels[0];
    const peer = G.me.peer_group;
    const within = level === own.level && peer ? peer.within : unit;
    const k = ['an|rank', level, within, pkey()].join('|');
    const res = data(k, () => API.get('/gov/analytics/rankings', Object.assign({ level, within }, periodQuery())));
    const header = `<div class="an-scroll">${levels.map(l => `<div class="chip ${l === level ? 'active' : ''}" onclick="GovUI.rankLevel('${l}')">${LEVEL_TABS[l]}${l === own.level && peer ? ' (peers)' : ''}</div>`).join('')}</div>`;
    if (!res) return header + loadingCard();
    if (res.err) return header + errorCard(res.err);
    const r = res.v;
    const shown = G.an.showAll ? r.items : r.items.slice(0, 15);
    const mine = r.items.find(i => i.id === own.unit);
    const bottom = r.items.filter(i => i.score !== null).slice(-3).reverse();
    return `${header}
      <div class="an-grid ${loading(k) ? 'an-loading' : ''}">
        <div class="glass-card span-all">
          <div class="an-card-title">🏆 ${esc(r.label)}</div>
          <div class="an-card-sub">${esc(r.period.label)} · ranked by performance score${r.unranked ? ` · ${r.unranked} not ranked (insufficient data)` : ''}</div>
          ${mine && mine.position ? `<div class="geo-banner geo-banner-success" style="margin-top:0;"><span>📍</span><div>You are <b>Rank #${mine.position} of ${r.ranked}</b> in this comparison group.</div></div>` : ''}
          ${mine && !mine.position ? `<div class="geo-banner geo-banner-info" style="margin-top:0;"><span>📭</span><div>You are not ranked this period: ${esc(mine.insufficient_reason)}</div></div>` : ''}
          ${level === own.level && peer ? `<p class="an-note" style="margin:0 0 10px;">Peers are shown as aggregate scores only. Their complaints stay private to their own jurisdictions.</p>` : ''}
          ${rankBars(shown, mine ? own.unit : null, true)}
          ${r.items.length > 15 ? `<button class="btn btn-ghost btn-sm full" style="margin-top:10px;" onclick="GovUI.toggleAll()">${G.an.showAll ? 'Show top 15' : `Show all ${r.items.length}`}</button>` : ''}
        </div>
        ${bottom.length >= 3 && r.ranked >= 6 ? `<div class="glass-card">
          <div class="an-card-title">⚠ Needs attention</div><div class="an-card-sub">Lowest scores in this group</div>
          ${bottom.map(b => `<div class="an-item"><div class="t">${esc(b.authority ? b.authority.title : b.name)} · ${b.score}</div><div class="m">${b.path && b.path.length ? esc(b.path.join(' › ')) + ' · ' : ''}${b.escalated} escalated · ${b.overdue} overdue · resolution ${pctTxt(b.resolution_rate)}</div></div>`).join('')}
        </div>` : ''}
        <div class="glass-card span-all">
          <div class="an-card-title">Table view</div>
          <div class="an-table-wrap"><table class="an-table">
            <tr><th>#</th><th>Office</th><th class="num">Score</th><th class="num">Resol.</th><th class="num">SLA</th><th class="num">Esc.</th><th class="num">Overdue</th></tr>
            ${shown.map(i => `<tr class="${i.accessible ? 'click' : ''}" ${i.accessible ? `onclick="GovUI.drill('${esc(i.id)}')"` : ''}><td>${i.position || '–'}</td><td>${esc(i.name)}${i.path && i.path.length ? `<div class="muted" style="font-size:10px;">${esc(i.path.join(' › '))}</div>` : ''}</td><td class="num"><b>${numTxt(i.score)}</b></td><td class="num">${pctTxt(i.resolution_rate)}</td><td class="num">${pctTxt(i.sla_compliance)}</td><td class="num">${i.escalated}</td><td class="num">${i.overdue}</td></tr>`).join('')}
          </table></div>
        </div>
      </div>`;
  }

  /* ---------- SLA */
  function slaTab(unit, dash) {
    const k = ['an|sla', unit, pkey()].join('|');
    const res = data(k, () => API.get('/gov/analytics/sla', Object.assign({ unit }, periodQuery())));
    if (!res) return loadingCard();
    if (res.err) return errorCard(res.err);
    const s = res.v, o = s.overall;
    const comp = o.sla_compliance;
    const trendPts = dash && dash.v ? dash.v.trend : [];
    return `<div class="an-grid ${loading(k) ? 'an-loading' : ''}">
      <div class="glass-card span-all">
        <div class="an-card-title">⏱ SLA compliance · ${esc(s.unit.name)}</div>
        <div class="an-card-sub">${esc(s.period.label)} · category SLAs from 3 days (crime) to 14 days (roads)</div>
        ${o.sla_determined ? `<div class="an-hero"><div class="an-hero-num">${comp}<small>%</small></div>
          <div class="muted" style="font-size:12px;line-height:1.55;"><b style="color:var(--success)">${o.within_sla}</b> resolved within SLA<br><b style="color:var(--danger)">${o.sla_breached}</b> breached (escalated or late)<br>${o.in_progress_within_sla} still running</div></div>
          <div class="an-track" style="height:10px;margin-top:12px;"><div class="an-fill" style="width:${comp}%;background:${comp >= s.target ? 'var(--st-good)' : comp >= 60 ? 'var(--st-watch)' : 'var(--st-critical)'}"></div><div class="an-target" style="left:${s.target}%" data-tip="Target ${s.target}%"></div></div>
          <div class="an-legend"><span>${comp >= s.target ? '✓ Meets' : '⚠ Below'} the ${s.target}% target</span></div>`
          : `<div class="an-empty"><div class="ee">📭</div><div class="muted" style="font-size:12px;">No complaint in this period has reached an SLA outcome yet.</div></div>`}
      </div>
      <div class="glass-card">
        <div class="an-card-title">⚠ At risk - breaching in the next 48 h</div>
        <div class="an-card-sub">Will auto-escalate unless resolved · ${s.at_risk_total} open</div>
        ${s.at_risk.length ? s.at_risk.map(r => `<div class="an-item" style="cursor:pointer;" onclick="openGovComplaint('${esc(r.id)}')">
          <div class="row between"><div class="t">#${esc(r.id)} · ${esc(r.title)}</div><span class="an-pill ${r.hours_left < 12 ? 'critical' : 'watch'}">${dur(r.hours_left * 36e5)} left</span></div>
          <div class="m">${esc(r.ward_name)} · with ${esc(r.authority)}</div></div>`).join('')
          : '<div class="an-empty"><div class="ee">✅</div><div class="muted" style="font-size:12px;">Nothing about to breach.</div></div>'}
      </div>
      <div class="glass-card">
        <div class="an-card-title">By category</div>
        <div class="an-card-sub">Compliance against each category's own SLA</div>
        ${s.by_category.length ? `<div class="an-bars">${s.by_category.map(c => `
          <div class="an-bar-row nopos" data-tip="${esc(catLabel(c.category))} (${c.sla_days}-day SLA)\n${c.within_sla} within SLA · ${c.breached} breached · ${c.received} received" tabindex="0">
            <div><div class="name">${cat(c.category).icon} ${esc(catLabel(c.category))} <span class="muted" style="font-weight:600;">· ${c.sla_days}d</span></div>
            <div class="an-track"><div class="an-fill accent" style="width:${c.compliance || 0}%"></div><div class="an-target" style="left:${s.target}%"></div></div></div>
            <div class="val">${pctTxt(c.compliance)}</div></div>`).join('')}</div>` : '<div class="muted" style="font-size:12px;">No complaints in this period.</div>'}
      </div>
      <div class="glass-card">
        <div class="an-card-title">Where SLAs break</div>
        <div class="an-card-sub">Breaches by level of the chain</div>
        ${barList(s.by_level.map(l => ({ label: l.label, value: l.breaches })), 'breaches')}
        ${trendPts.length ? `<div style="margin-top:14px;" class="an-card-title">SLA compliance over time</div>${slaTrend(trendPts)}` : ''}
      </div>
      <div class="glass-card span-all">
        <div class="an-card-title">SLA breaches</div>
        <div class="an-card-sub">${s.breach_total} in this period${s.breach_total > s.breaches.length ? ` · latest ${s.breaches.length}` : ''}</div>
        ${s.breaches.length ? `<div class="an-table-wrap"><table class="an-table"><tr><th>Complaint</th><th>Breached at</th><th>Now</th></tr>
          ${s.breaches.map(b => `<tr class="click" onclick="openGovComplaint('${esc(b.id)}')"><td><b>#${esc(b.id)}</b> ${esc(b.title)}<div class="muted" style="font-size:10px;">${esc(b.ward_name)}</div></td>
          <td>${esc(LEVEL_LABEL[b.breached_level])}<div class="muted" style="font-size:10px;">${dt(b.deadline)}</div></td>
          <td>${b.status === 'RESOLVED' ? '<span class="an-pill good">✓ Resolved</span>' : `<span class="an-pill critical">With ${esc(LEVEL_LABEL[b.current_level])}</span>`}</td></tr>`).join('')}</table></div>`
          : '<div class="an-empty"><div class="ee">✅</div><div class="muted" style="font-size:12px;">No SLA breaches in this period.</div></div>'}
      </div>
    </div>`;
  }

  function slaTrend(points) {
    const pts = points.map(p => ({ label: p.label, score: p.sla_compliance, peer_average: null, partial: p.partial, resolution_rate: p.resolution_rate, sla_compliance: p.sla_compliance, received: p.received }));
    return lineChart(pts, 'SLA compliance %', false);
  }

  function barList(rows, unit) {
    const max = Math.max(1, ...rows.map(r => r.value));
    return `<div class="an-bars">${rows.map(r => `<div class="an-bar-row nopos" data-tip="${esc(r.label)}: ${r.value} ${unit}" tabindex="0"><div><div class="name">${esc(r.label)}</div><div class="an-track"><div class="an-fill accent" style="width:${(r.value / max) * 100}%"></div></div></div><div class="val">${r.value}</div></div>`).join('')}</div>`;
  }

  /* ---------- escalations */
  function escalationsTab(unit) {
    const k = ['an|esc', unit, pkey()].join('|');
    const res = data(k, () => API.get('/gov/analytics/escalations', Object.assign({ unit }, periodQuery())));
    if (!res) return loadingCard();
    if (res.err) return errorCard(res.err);
    const e = res.v, s = e.system;
    const max = Math.max(1, e.funnel[0].reached);
    return `<div class="an-grid ${loading(k) ? 'an-loading' : ''}">
      <div class="glass-card span-all">
        <div class="an-card-title">Escalation chain · ${esc(e.unit.name)}</div>
        <div class="an-card-sub">${esc(e.period.label)} · how far complaints had to travel before being resolved</div>
        <div class="an-bars">${e.funnel.map(f => `
          <div class="an-bar-row nopos" data-tip="${esc(f.label)} level\nReached: ${f.reached}\nResolved here (verified): ${f.resolved}\nOpen here now: ${f.open}" tabindex="0">
            <div><div class="name">${esc(f.label)} <span class="muted" style="font-weight:600;">· ${f.resolved} resolved here${f.open ? ` · ${f.open} open` : ''}</span></div>
            <div class="an-track"><div class="an-fill accent" style="width:${(f.reached / max) * 100}%"></div></div></div>
            <div class="val">${f.reached}</div></div>`).join('')}</div>
        <p class="an-note">Bars show how many complaints reached each level. Ward → SDM → DM → CM → PM; each level gets a fresh SLA window.</p>
      </div>
      <div class="glass-card">
        <div class="an-card-title">Escalation outcomes</div>
        <div class="an-card-sub">Complaints filed in the period that breached SLA at least once</div>
        <div class="an-kpis">
          <div class="an-kpi"><div class="v" style="color:var(--danger)">${s.escalated}</div><div class="l">ESCALATED</div></div>
          <div class="an-kpi"><div class="v" style="color:var(--success)">${s.escalated_resolved}</div><div class="l">RESOLVED AFTER ESCALATION</div></div>
          <div class="an-kpi"><div class="v">${s.escalated_pending}</div><div class="l">STILL PENDING</div></div>
        </div>
        <p class="an-note">Escalation rate ${pctTxt(s.escalation_rate)} · escalated cases resolved ${pctTxt(s.escalation_resolution_rate)}.</p>
      </div>
      ${e.own ? `<div class="glass-card"><div class="an-card-title">Your office's escalated cases</div><div class="an-card-sub">Credit for resolving what was escalated to you</div>
        <div class="an-hero" style="gap:12px;"><div class="an-hero-num" style="font-size:34px;">${pctTxt(e.own.resolution_rate)}</div>
        <div class="muted" style="font-size:12px;line-height:1.5;"><b style="color:var(--text)">${e.own.received}</b> escalated to you · <b style="color:var(--success)">${e.own.resolved}</b> resolved<br>${e.own.pending} pending · ${e.own.escalated} escalated further</div></div></div>` : ''}
      ${e.by_child.length ? `<div class="glass-card"><div class="an-card-title">Bottlenecks</div><div class="an-card-sub">Escalation rate by ${esc((e.by_child[0].type || 'unit').replace('sdm', 'sub-district'))}</div>
        <div class="an-bars">${e.by_child.slice(0, 10).map(c => `<div class="an-bar-row nopos click" onclick="GovUI.drill('${esc(c.id)}')" data-tip="${esc(c.name)}\n${c.escalated} of ${c.received} escalated\n${c.escalated_pending} still pending" tabindex="0">
          <div><div class="name">${esc(c.name)}</div><div class="an-track"><div class="an-fill accent" style="width:${c.escalation_rate || 0}%"></div></div></div><div class="val">${pctTxt(c.escalation_rate)}</div></div>`).join('')}</div></div>` : ''}
      <div class="glass-card span-all">
        <div class="an-card-title">Escalation records</div>
        <div class="an-card-sub">Immutable log · ${e.record_total} in this period${e.record_total > e.records.length ? ` · latest ${e.records.length}` : ''}</div>
        ${e.records.length ? `<div class="an-table-wrap"><table class="an-table">
          <tr><th>Complaint</th><th>From → To</th><th>Escalated</th><th class="num">Time taken</th><th>Status</th></tr>
          ${e.records.map(r => `<tr class="click" onclick="openGovComplaint('${esc(r.id)}')">
            <td><b>#${esc(r.id)}</b><div class="muted" style="font-size:10px;">${esc(r.ward_name)}</div></td>
            <td>${esc(LEVEL_LABEL[r.from_level])} → ${esc(LEVEL_LABEL[r.to_level])}<div class="muted" style="font-size:10px;">${r.trigger === 'MANUAL' ? 'manual' : 'auto · SLA'} · deadline ${dt(r.sla_deadline)}</div></td>
            <td>${dt(r.escalated_at)}</td>
            <td class="num">${dur(r.elapsed_hours * 36e5)}</td>
            <td>${r.current_status === 'RESOLVED' ? `<span class="an-pill good">✓ ${r.resolved_at ? dd(r.resolved_at) : 'Resolved'}</span>` : `<span class="an-pill critical">${esc(LEVEL_LABEL[r.current_level])}</span>`}</td></tr>`).join('')}
        </table></div>` : '<div class="an-empty"><div class="ee">✅</div><div class="muted" style="font-size:12px;">No escalated cases during this period.</div></div>'}
      </div>
    </div>`;
  }

  /* ---------- map */
  function mapTab(unit) {
    const k = ['an|geo', unit, pkey()].join('|');
    const res = data(k, () => API.get('/gov/analytics/geo', Object.assign({ unit }, periodQuery())));
    if (!res) return loadingCard();
    if (res.err) return errorCard(res.err);
    const g = res.v;
    const items = g.items.slice();
    const worst = items.filter(i => i.score !== null).sort((a, b) => a.score - b.score).slice(0, 5);
    const overdue = items.filter(i => i.overdue).sort((a, b) => b.overdue - a.overdue).slice(0, 5);
    return `<div class="an-grid">
      <div class="glass-card span-all">
        <div class="an-card-title">🗺️ Geographic performance · ${esc(g.unit.name)}</div>
        <div class="an-card-sub">${esc(g.period.label)} · each area coloured by its office's score</div>
        <div id="an-map" class="map-wrap map-wrap-lg" style="margin:4px 0 10px;"></div>
        <div class="an-legend">
          <span><i class="an-sw" style="background:#12a454"></i>✓ ≥ 80 performing well</span>
          <span><i class="an-sw" style="background:#e08a1e"></i>◐ 60-79 needs attention</span>
          <span><i class="an-sw" style="background:#e0435a"></i>⚠ &lt; 60 critical</span>
          <span><i class="an-sw" style="background:#8a90ab"></i>○ insufficient data</span>
        </div>
      </div>
      <div class="glass-card"><div class="an-card-title">Lowest performing areas</div><div class="an-card-sub">Where to look first</div>
        ${worst.length ? worst.map(w => `<div class="an-item ${w.id !== unit ? 'click' : ''}" style="cursor:pointer;" onclick="${w.id !== unit ? `GovUI.drill('${esc(w.id)}')` : ''}"><div class="row between"><div class="t">${esc(w.name)}</div>${bandPill(w.band)}</div><div class="m">Score ${w.score} · resolution ${pctTxt(w.resolution_rate)} · ${w.escalated} escalated</div></div>`).join('') : '<div class="muted" style="font-size:12px;">Insufficient data in this period.</div>'}
      </div>
      <div class="glass-card"><div class="an-card-title">Backlog hotspots</div><div class="an-card-sub">Most overdue complaints right now</div>
        ${overdue.length ? overdue.map(w => `<div class="an-item"><div class="row between"><div class="t">${esc(w.name)}</div><span class="an-pill critical">${w.overdue} overdue</span></div><div class="m">${w.pending} open in total</div></div>`).join('') : '<div class="an-empty"><div class="ee">✅</div><div class="muted" style="font-size:12px;">No overdue backlog.</div></div>'}
      </div>
    </div>`;
  }

  function initAnalyticsMap() {
    const el = document.getElementById('an-map');
    if (!el) return;
    const k = ['an|geo', G.an.unit || G.authority.unit, pkey()].join('|');
    const res = G.cache[k];
    if (!res || !res.v) return;
    if (typeof L === 'undefined') { el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8a90ab;font-size:12px;">Map needs an internet connection</div>'; return; }
    if (G.map) { try { G.map.remove(); } catch (e) { /* already gone */ } G.map = null; }
    const map = L.map(el, { zoomControl: true, attributionControl: false });
    getTileLayer('street').addTo(map); // same OpenStreetMap layer the prototype's other maps use
    const color = b => ({ good: '#12a454', watch: '#e08a1e', critical: '#e0435a' }[b] || '#8a90ab');
    const pts = [];
    res.v.items.forEach(it => {
      if (!it.center) return;
      const tip = `<b>${esc(it.authority ? it.authority.title : it.name)}</b><br>Score: ${it.score === null ? 'insufficient data' : it.score}<br>Resolution ${pctTxt(it.resolution_rate)} · SLA ${pctTxt(it.sla_compliance)}<br>${it.escalated} escalated · ${it.overdue} overdue`;
      let layer;
      if (it.polygon) {
        layer = L.polygon(it.polygon, { color: color(it.band), fillColor: color(it.band), fillOpacity: 0.35, weight: 2 });
        it.polygon.forEach(p => pts.push(p));
      } else {
        const r = 7 + Math.min(18, Math.sqrt(it.received || 1) * 2);
        layer = L.circleMarker(it.center, { radius: r, color: '#fff', weight: 2, fillColor: color(it.band), fillOpacity: 0.85 });
        pts.push(it.center);
      }
      layer.bindTooltip(tip);
      if (it.id !== (G.an.unit || G.authority.unit)) layer.on('click', () => drill(it.id));
      layer.addTo(map);
    });
    if (pts.length > 1) map.fitBounds(pts, { padding: [44, 44], maxZoom: 13 });
    else if (pts.length) map.setView(pts[0], 13);
    else map.setView([22.6, 79.2], 4);
    G.map = map;
    setTimeout(() => map.invalidateSize(), 120);
  }

  /* ============================================================ CITIZEN */
  function citizenCard(c) {
    if (c.status !== 'resolved' || c.wardId !== CITIZEN_HOME_WARD) return '';
    const lc = c.lifecycle || {};
    if (lc.confirmation === 'CONFIRMED') return `<div class="glass-card" style="margin-bottom:12px;"><div class="geo-banner geo-banner-success" style="margin:0;"><span>✓</span><div>You confirmed this fix. Thank you - confirmations make government performance ratings trustworthy.</div></div></div>`;
    return `<div class="glass-card" style="margin-bottom:12px;">
      <b style="font-size:14px;">Was this actually fixed?</b>
      <p class="muted" style="font-size:12px;margin:6px 0 12px;line-height:1.5;">The authority marked this complaint resolved. Your answer decides whether it counts toward their performance score - a "No" reopens it with a fresh SLA.</p>
      <div class="row gap8">
        <button class="btn btn-success btn-sm" style="flex:1;" onclick="GovUI.citizenDecision('${esc(c.id)}','CONFIRMED')">✓ Yes, it's fixed</button>
        <button class="btn btn-danger btn-sm" style="flex:1;" onclick="GovUI.citizenDecision('${esc(c.id)}','DISPUTED')">✗ Not fixed - reopen</button>
      </div>
    </div>`;
  }

  async function citizenDecision(id, decision) {
    const c = complaints.find(x => x.id === id);
    try {
      if (!API.citizenToken) await API.citizenLogin();
      const s = await API.post('/v2/complaints/' + encodeURIComponent(id) + '/confirmation', { decision }, 'citizen');
      invalidate(['list', 'an|', 'esc|', 'detail|' + id]);
      await syncCitizen(c, true);
      if (c && decision === 'CONFIRMED') { c.lifecycle = Object.assign({}, c.lifecycle, { confirmation: 'CONFIRMED' }); }
      toast(decision === 'CONFIRMED' ? 'Thanks! Resolution confirmed.' : `Reopened · back with ${s.assigned_to}`);
      render();
    } catch (e) { toast(e.message); }
  }

  // Pull the lifecycle (status, SLA, escalations, timeline) of the citizen's own complaint.
  async function syncCitizen(c, quiet) {
    if (!c) return;
    try {
      await API.detect();
      if (!API.citizenToken) await API.citizenLogin();
      const s = await API.get('/v2/complaints/' + encodeURIComponent(c.id), null, 'citizen');
      const before = c.status + c.timeline.length + c.assigned;
      syncLocalComplaint(s);
      if (!quiet && before !== c.status + c.timeline.length + c.assigned && state.screen === 'complaint-details' && state.activeComplaintId === c.id) refresh();
    } catch (e) { /* not the citizen's complaint, or not tracked - keep the local view */ }
  }

  /* ================================================================ NAV */
  function renderGovNav() {
    const items = [['gov-dashboard', '📋', 'Complaints'], ['escalated', '⚠️', 'Escalated'], ['gov-analytics', '📊', 'Analytics'], ['gov-profile', '👤', 'Profile']];
    document.getElementById('bottomnav').innerHTML = items.map(([id, icon, label]) => `
      <div class="nav-item ${state.screen === id ? 'active' : ''}" onclick="GovUI.go('${id}')"><div class="ni-icon">${icon}</div><div class="nav-label">${label}</div></div>`).join('');
  }

  function go(screen) {
    if (screen === 'gov-analytics' && !G.an.unit) G.an.unit = G.authority.unit;
    state.history = [];
    nav(screen, { replace: true });
  }

  function afterRender() {
    setupTooltips();
    if (state.screen === 'gov-analytics' && G.an.tab === 'map') setTimeout(initAnalyticsMap, 60);
  }

  /* ============================================================ exports */
  window.GovUI = {
    GOV_SCREENS, renderGovNav, afterRender, citizenCard, syncCitizen,
    setLoginRole(r) {
      G.loginRole = r;
      const first = (G.directory || []).find(a => a.role === r && (r !== 'WARD_COUNCILLOR' || a.id === 'wc-ward24')) || (G.directory || []).find(a => a.role === r);
      if (first) G.loginAuthority = first.id;
      render();
    },
    setLoginAuthority(id) { G.loginAuthority = id; render(); },
    retryConnection() { G.directory = null; API.detect(true).then(() => render()); ensureDirectory(); },
    chip(id) { G.list.chip = id; G.list.limit = 30; state.govSort = id; state.govTab = 'complaints'; if (state.screen !== 'gov-dashboard') nav('gov-dashboard'); else refresh(); },
    more() { G.list.limit += 30; refresh(); },
    async switchWard(wardId) {
      try { await startSession('wc-' + wardId); toast(`Signed in as ${G.authority.title}`); render(); } catch (e) { toast(e.message); }
    },
    openAnalytics, drill, go,
    tab(t) { G.an.tab = t; G.an.showAll = false; refreshTop(); },
    period(p) { G.an.period = p; if (p !== 'custom') refreshTop(); else refresh(); },
    applyCustom() {
      const f = document.getElementById('an-from').value, t = document.getElementById('an-to').value;
      if (!f || !t) { toast('Pick both dates'); return; }
      G.an.from = f; G.an.to = t; refreshTop();
    },
    rankLevel(l) { G.an.level = l; G.an.showAll = false; refresh(); },
    toggleAll() { G.an.showAll = !G.an.showAll; refresh(); },
    toggleWide() { document.getElementById('phone').classList.toggle('wide'); refresh(); if (G.map) setTimeout(() => G.map.invalidateSize(), 400); },
    verify, closeSheet, pickEvidence, sampleEvidence, submitResolve, securityCheck, resetDemo, citizenDecision,
  };

  // Names the main prototype script calls.
  Object.assign(window, {
    screenGovLogin, loginAsGov, screenGovDashboard, openGovComplaint, screenGovDetail, setGovStatus,
    screenEscalated, screenGovAnalytics, screenGovProfile,
    switchGovRole(role) {
      const id = authorityFor(role);
      startSession(id).then(a => { toast(`Signed in as ${a.title}`); render(); }).catch(e => toast(e.message));
    },
  });
})();
