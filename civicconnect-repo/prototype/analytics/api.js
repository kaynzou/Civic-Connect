/*
 * Government Portal API client.
 *
 * Talks to the CivicConnect backend (FastAPI, app/analytics_app.py). If the
 * server is unreachable - or the deployed backend predates these endpoints -
 * it switches to the in-browser mirror (local-server.js) and says so in the UI.
 *
 * Overrides: ?api=offline forces the mirror; ?api=<url> or window.CIVIC_API_BASE
 * points at another backend.
 */
(function (root) {
  'use strict';
  const RENDER_API = 'https://citycare-backend-ft8o.onrender.com/api';

  function resolveApiBase() {
    const param = new URLSearchParams(location.search).get('api');
    if (param && param !== 'offline') return param.replace(/\/$/, '');
    if (root.CIVIC_API_BASE) return root.CIVIC_API_BASE;
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (local && location.pathname.startsWith('/portal')) return location.origin + '/api';
    if (local) return 'http://localhost:8000/api';
    return RENDER_API;
  }

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  const GovAPI = {
    base: resolveApiBase(),
    mode: 'unknown',           // 'live' | 'offline'
    token: null,               // government session
    authority: null,
    citizenToken: null,
    _detecting: null,
    forceOffline: new URLSearchParams(location.search).get('api') === 'offline',

    detect(force) {
      if (this._detecting && !force) return this._detecting;
      this._detecting = (async () => {
        if (!this.forceOffline) {
          try {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 4000);
            const res = await fetch(this.base + '/gov/health', { signal: ctl.signal });
            clearTimeout(timer);
            if (res.ok) { this.mode = 'live'; return this.mode; }
          } catch (e) { /* unreachable - fall through */ }
        }
        await root.CCLocalServer.init();
        this.mode = 'offline';
        return this.mode;
      })();
      return this._detecting;
    },

    async request(method, path, opts) {
      opts = opts || {};
      await this.detect();
      const kind = opts.auth === 'citizen' ? 'citizen' : opts.auth === false ? null : 'gov';
      const headers = {};
      const tok = kind === 'gov' ? this.token : kind === 'citizen' ? this.citizenToken : null;
      if (tok) headers.Authorization = 'Bearer ' + tok;
      const q = {};
      Object.keys(opts.query || {}).forEach(k => { if (opts.query[k] !== null && opts.query[k] !== undefined && opts.query[k] !== '') q[k] = opts.query[k]; });

      if (this.mode === 'offline') {
        const r = await root.CCLocalServer.handle(method, path, q, opts.body, headers);
        if (r.status >= 400) throw new ApiError(r.status, r.body.detail || 'Request failed');
        return r.body;
      }
      const qs = new URLSearchParams(q).toString();
      let res;
      try {
        const init = { method, headers };
        if (opts.form) init.body = opts.form;
        else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
        res = await fetch(this.base + path + (qs ? '?' + qs : ''), init);
      } catch (e) {
        // Server went away mid-session: continue on the offline mirror.
        await this.goOffline();
        return this.request(method, path, opts);
      }
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (res.status === 401 && !opts._retried && kind === 'gov' && this.authority) {
        // Sessions are signed per server process; after a restart, sign in again silently.
        await this.login(this.authority.id);
        return this.request(method, path, Object.assign({}, opts, { _retried: true }));
      }
      if (res.status === 401 && !opts._retried && kind === 'citizen') {
        await this.citizenLogin();
        return this.request(method, path, Object.assign({}, opts, { _retried: true }));
      }
      if (res.status === 404 && path.indexOf('/gov/') === 0 && !this.forceOffline && !opts._retried && data && data.detail === 'Not Found') {
        // The deployed backend predates the analytics endpoints: use the mirror.
        await this.goOffline();
        return this.request(method, path, Object.assign({}, opts, { _retried: true }));
      }
      if (!res.ok) {
        const detail = data && (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
        throw new ApiError(res.status, detail || res.statusText);
      }
      return data;
    },

    async goOffline() {
      await root.CCLocalServer.init();
      this.mode = 'offline';
      this._detecting = Promise.resolve('offline');
      const aid = this.authority && this.authority.id;
      this.token = null; this.citizenToken = null;
      if (aid) await this.login(aid);
      if (root.toast) root.toast('Server unreachable - continuing in offline demo mode');
    },

    get(path, query, auth) { return this.request('GET', path, { query, auth }); },
    post(path, body, auth) { return this.request('POST', path, { body, auth }); },
    patch(path, body) { return this.request('PATCH', path, { body }); },

    async directory() { return (await this.get('/gov/directory', null, false)).authorities; },

    async login(authorityId) {
      const r = await this.post('/gov/auth/demo-login', { authority_id: authorityId }, false);
      this.token = r.token;
      this.authority = r.authority;
      return r.authority;
    },

    logout() { this.token = null; this.authority = null; },

    async citizenLogin() {
      try {
        const r = await this.post('/v2/citizen/demo-login', {}, false);
        this.citizenToken = r.token;
      } catch (e) { this.citizenToken = null; }
      return this.citizenToken;
    },

    /* Citizen submission: live = existing intake + routing (multipart); offline = mirror. */
    async submitComplaint(fields, photos) {
      await this.detect();
      if (!this.citizenToken) await this.citizenLogin();
      if (this.mode === 'offline') {
        return this.request('POST', '/v2/complaints', { body: fields, auth: 'citizen' });
      }
      const form = new FormData();
      Object.keys(fields).forEach(k => form.append(k, fields[k]));
      (photos || []).forEach(p => { if (p) form.append('photos', p); });
      return this.request('POST', '/v2/complaints', { form, auth: 'citizen' });
    },
  };

  // Switch an offline session to the real server (e.g. once a sleeping host wakes up).
  GovAPI.upgradeToLive = async function () {
    if (this.mode === 'live') return;
    const authorityId = this.authority && this.authority.id;
    this.mode = 'live';
    this._detecting = Promise.resolve('live');
    this.token = null;
    this.citizenToken = null;
    if (root.GovUI && root.GovUI.onModeChange) await root.GovUI.onModeChange(authorityId);
  };

  // A sleeping free-tier server (Render) takes 30-60 s to wake - longer than the
  // 4 s the page waits before choosing a mode. Keep a request open in the
  // background and move to live as soon as the server answers.
  function wakeServer(attempt) {
    fetch(GovAPI.base + '/gov/health').then(res => {
      if (res.ok && GovAPI.mode !== 'live') GovAPI.upgradeToLive();
    }).catch(() => {
      if (attempt < 8) setTimeout(() => wakeServer(attempt + 1), 15000);
    });
  }
  if (!GovAPI.forceOffline && !/localhost|127\.0\.0\.1/.test(GovAPI.base)) wakeServer(0);

  root.GovAPI = GovAPI;
  root.GovApiError = ApiError;
})(typeof self !== 'undefined' ? self : this);
