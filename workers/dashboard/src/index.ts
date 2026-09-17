// MySweetPea Dashboard Worker — session + OIDC PKCE + authentik API proxy
// Phase 1 skeleton: auth round-trip + /api/me + static SPA serving.

export interface Env {
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
  AUTHENTIK_CLIENT_ID: string;
  MSP_INTERNAL_HEADER: string;
  AUTH_ISSUER: string;
  AUTH_BASE: string;
  APP_URL: string;
  KUMA_STATUS_URL: string;
  JELLYFIN_URL: string;
  SEERR_URL: string;
  JELLYFIN_API_KEY: string;
  SEERR_API_KEY: string;

  IMMICH_URL: string;
  IMMICH_API_KEY: string;
  JELLYFIN_USER_ID: string;
  AUTHENTIK_ADMIN_TOKEN: string;
  GITHUB_TOKEN?: string; // optional — homelab-k8s is public; token only lifts the 60/hr anon limit
}

interface SessionData {
  at: string;            // access token
  rt?: string;           // refresh token
  sub: string;           // user uuid
  username: string;
  name: string;
  email: string;
  created: number;
}

const COOKIE = 'msp_dash_session';
const SCOPES = 'openid profile email offline_access goauthentik.io/api';

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomB64u(n = 32): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64uEncode(b);
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function akHeaders(env: Env, token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'x-msp-internal': env.MSP_INTERNAL_HEADER,
  };
}

async function authentikFetch(env: Env, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.AUTH_BASE}${path}`, {
    ...init,
    headers: {
      ...akHeaders(env, token),
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> || {}),
    },
  });
}

// Sniff magic bytes — never trust a client-supplied mime type.
function sniffImageMime(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

// Password step-up: drive the default authentication flow headlessly with a
// minimal cookie jar and check the password stage accepts. The submitted
// password is only ever sent to authentik's flow executor — never stored or
// logged anywhere.
async function verifyPassword(env: Env, username: string, password: string): Promise<boolean> {
  const url = `${env.AUTH_BASE}/api/v3/flows/executor/default-authentication-flow/`;
  let jar: string[] = [];
  const absorb = (r: Response) => {
    try {
      const sc = typeof r.headers.getSetCookie === 'function'
        ? r.headers.getSetCookie()
        : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie') as string] : []);
      jar = jar.concat(sc.map((c) => c.split(';')[0]));
    } catch { /* keep whatever jar we have */ }
  };
  const cookieHeader = (): Record<string, string> => (jar.length ? { cookie: jar.join('; ') } : {});
  const post = (payload: unknown) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-msp-internal': env.MSP_INTERNAL_HEADER, ...cookieHeader() },
    body: JSON.stringify(payload),
  });
  try {
    // 1. start the flow, capture session/csrf cookies
    absorb(await fetch(url, { headers: { 'x-msp-internal': env.MSP_INTERNAL_HEADER } }));
    // 2. identification stage
    absorb(await post({ component: 'ak-stage-identification', uid_field: username }));
    // 3. password stage
    const pr = await post({ component: 'ak-stage-password', password });
    if (!pr.ok) return false;
    let data: any = null;
    try { data = await pr.json(); } catch { return false; }
    if (!data || typeof data !== 'object') return false;
    const errs = !!(Array.isArray(data.non_field_errors) && data.non_field_errors.length) ||
      !!data.responseErrors || !!(Array.isArray(data.messages) && data.messages.length);
    // wrong password: executor re-renders the password stage with errors
    if (data.component === 'ak-stage-password' && errs) return false;
    // flow completed -> redirect target present
    if (typeof data.to === 'string' && data.to) return true;
    // password accepted, flow advanced to another stage (e.g. MFA)
    if (data.component && data.component !== 'ak-stage-password') return true;
    return false;
  } catch {
    return false;
  }
}

async function getSession(request: Request, env: Env): Promise<SessionData | null> {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
  if (!m) return null;
  const raw = await env.SESSIONS.get(`sess:${m[1]}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

async function refreshSession(env: Env, sess: SessionData): Promise<SessionData | null> {
  if (!sess.rt) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: sess.rt,
    client_id: env.AUTHENTIK_CLIENT_ID,
  });
  const r = await fetch(`${env.AUTH_ISSUER}/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-msp-internal': env.MSP_INTERNAL_HEADER },
    body,
  });
  if (!r.ok) return null;
  const t = await r.json() as { access_token: string; refresh_token?: string };
  // Reset `created` so the 10-minute refresh window restarts. Without this the
  // stamp stays old and EVERY request re-runs this token round-trip.
  return { ...sess, at: t.access_token, rt: t.refresh_token ?? sess.rt, created: Date.now() };
}

async function requireSession(request: Request, env: Env): Promise<{ sess: SessionData; sid: string } | Response> {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
  if (!m) return json({ error: 'unauthorized' }, 401);
  const sid = m[1];
  const raw = await env.SESSIONS.get(`sess:${sid}`);
  if (!raw) return json({ error: 'unauthorized' }, 401);
  const sess = JSON.parse(raw) as SessionData;
  // Refresh when the access token is past half its lifetime (JWT exp/iat),
  // NOT on a fixed wall-clock timer. Dashboard provider tokens last 24h, so
  // this is ~1 refresh/day per active session instead of ~144. If the token
  // cannot be parsed (not a JWT), fall back to a 12h cap so the refresh rate
  // stays bounded either way.
  const refreshAt = accessTokenRefreshAt(sess.at);
  const stale = refreshAt > 0
    ? Date.now() >= refreshAt
    : (Date.now() - sess.created > 12 * 60 * 60 * 1000);
  if (stale) {
    const fresh = await refreshSession(env, sess);
    if (fresh) {
      await kvPutBestEffort(env, `sess:${sid}`, JSON.stringify(fresh), 86400);
      return { sess: fresh, sid };
    }
  }
  return { sess, sid };
}

// Resolve the NUMERIC authentik pk for a session user (404 on uuid in
// /core/users/{id}/). Looked up once via the admin token, cached 30d in KV.
async function resolveUpk(env: Env, sess: SessionData): Promise<number> {
  let upk = parseInt((await env.SESSIONS.get(`upk:${sess.sub}`)) || '', 10);
  if (upk) return upk;
  const lookup = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN, `/api/v3/core/users/?uuid=${sess.sub}`);
  if (!lookup.ok) return 0;
  const arr = (await lookup.json() as { results?: { pk?: number }[] }).results || [];
  if (arr[0]?.pk) {
    upk = arr[0].pk;
    await env.SESSIONS.put(`upk:${sess.sub}`, String(upk), { expirationTtl: 86400 * 30 });
  }
  return upk || 0;
}

// ---------- Uptime Kuma: PUBLIC status page only ----------
// End-user surfaces (Services tab uptime bars, Home status card) must show
// ONLY the `public` visitor set ("Visitor Services" group), never the admin
// `homelab` page with all ~48 monitors. KUMA_STATUS_URL may point at any
// slug — derive just the origin here and request the `public` slug so the
// secret's value can never leak admin monitors to members.
const KUMA_PUBLIC_SLUG = 'public';

function kumaOrigin(env: Env): string {
  const raw = (env.KUMA_STATUS_URL || '').trim();
  const m = raw.match(/^https?:\/\/[^/]+/i);
  return m ? m[0] : 'https://status.mysweetpea.cc';
}

interface KumaMonitor {
  id: number;
  name: string;
  group: string;
  current: boolean;
  up24: number | null;
  beats: boolean[];
}

// Fetch + shape the public status page (page config for names/groups,
// heartbeat endpoint for beats/uptime). Cached 180s in the Cache API under a
// public-specific key (`cache:kuma-pub`) so switching slugs later stays trivial.
// Best-effort KV write for the small set of durable keys that remain in KV
// (session docs, the seerr-uid mapping). A KV failure (quota, transient
// errors) must never 500 a route — session refreshes retry on the next
// request. Response caches no longer live here (see cachePutJson).
async function kvPutBestEffort(env: Env, key: string, value: string, ttl: number): Promise<void> {
  try {
    await env.SESSIONS.put(key, value, { expirationTtl: Math.max(ttl, 60) });
  } catch { /* cache writes are best-effort */ }
}

// ---------- Response caches live in the Cache API, NOT KV ----------
// Everything under `cache:*` is a cache COPY, never durable state. The Workers
// KV free tier allows only 1,000 write operations/day (every put() counts,
// even to the same key) and the response caches were a large share of this
// account's ~890 writes/day peak. The Cache API is free, unmetered, per-colo,
// and does not touch the KV quota. KV now holds only durable state: sessions,
// PKCE verifiers, avatars, audit entries and rate-limit counters.
const CACHE_ORIGIN = 'https://cache.msp.internal';

function cacheUrl(key: string): string {
  return CACHE_ORIGIN + '/' + encodeURIComponent(key);
}

async function cacheGetJson(key: string): Promise<string | null> {
  try {
    const hit = await caches.default.match(new Request(cacheUrl(key)));
    return hit ? await hit.text() : null;
  } catch {
    return null;
  }
}

async function cachePutJson(key: string, body: string, ttlSeconds: number): Promise<void> {
  try {
    await caches.default.put(
      new Request(cacheUrl(key)),
      new Response(body, {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=' + Math.max(ttlSeconds, 60),
        },
      }),
    );
  } catch {
    /* caches are droppable — never fail a request over a cache write */
  }
}

async function cacheDeleteJson(key: string): Promise<void> {
  try {
    await caches.default.delete(new Request(cacheUrl(key)));
  } catch {
    /* no-op */
  }
}

// When should this access token be refreshed? Read the JWT exp/iat claims
// (the signature is NOT verified here — authentik validates the token
// server-side on every API call; this is scheduling only). Refresh once half
// the token's lifetime has elapsed: ~1 refresh per 12h on the 24h tokens the
// dashboard provider now mints, and any old 15-minute token is re-minted
// once, immediately. This replaced a fixed "every 10 minutes" timer that
// cost ~144 KV writes per active session per day.
function accessTokenRefreshAt(token: string): number {
  try {
    const part = token.split('.')[1];
    if (!part) return 0;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    const claims = JSON.parse(atob(padded)) as { exp?: number; iat?: number };
    if (!claims.exp) return 0;
    const iat = claims.iat || (claims.exp - 900);
    const lifetimeMs = Math.max(claims.exp - iat, 300) * 1000;
    return claims.exp * 1000 - lifetimeMs / 2;
  } catch {
    return 0;
  }
}

// Stale-while-revalidate JSON helper.
// The dashboard's slow feel = blocking upstream fetches whenever a cache
// entry expires (media rows, stats). With SWR the client ALWAYS gets an
// answer in ~10ms when any cached copy exists (fresh OR stale); the refresh
// happens in the background via ctx.waitUntil. Only the very first request
// after a cold cache (or brand-new instance) pays upstream latency.
// Backed by the Cache API (see helpers above) — never KV.
// Stored shape: {"d": <payload string>, "t": <unix ms>}. Legacy raw payloads
// are treated as ts=0 (= immediately stale, served instantly + refreshed).
async function swrJson(ctx: ExecutionContext, env: Env, key: string, freshMs: number, produce: () => Promise<string>): Promise<string> {
  let payload: string | null = null;
  let ts = 0;
  const raw = await cacheGetJson(key);
  if (raw) {
    try {
      const p = JSON.parse(raw) as { d?: string; t?: number };
      if (typeof p?.d === 'string') { payload = p.d; ts = p.t || 0; }
      else { payload = raw; ts = 0; } // legacy format
    } catch { payload = raw; ts = 0; } // legacy non-JSON payload
  }
  const now = Date.now();
  const refresh = async (): Promise<void> => {
    try {
      const d = await produce();
      await cachePutJson(key, JSON.stringify({ d, t: Date.now() }), 86400);
    } catch { /* keep serving stale copy */ }
  };
  if (payload !== null && (now - ts) < freshMs) return payload; // fresh
  if (payload !== null) {
    ctx.waitUntil(refresh()); // stale: serve now, refresh behind the scenes
    return payload;
  }
  await refresh(); // cold: must block once
  const raw2 = await cacheGetJson(key);
  if (raw2) { try { const p = JSON.parse(raw2) as { d?: string }; if (typeof p?.d === 'string') return p.d; } catch { /* fall through */ } }
  return '{"items":[]}';
}

async function fetchPublicKuma(env: Env): Promise<{ monitors: KumaMonitor[] } | null> {
  const cached = await cacheGetJson('cache:kuma-pub');
  if (cached) {
    try { return JSON.parse(cached) as { monitors: KumaMonitor[] }; } catch { /* refetch */ }
  }
  const base = kumaOrigin(env);
  const opt: RequestInit = { headers: { 'user-agent': 'Mozilla/5.0', 'x-msp-internal': env.MSP_INTERNAL_HEADER } };
  let page: any = null;
  let hb: any = null;
  try {
    const [pageR, hbR] = await Promise.all([
      fetch(`${base}/api/status-page/${KUMA_PUBLIC_SLUG}`, opt),
      fetch(`${base}/api/status-page/heartbeat/${KUMA_PUBLIC_SLUG}`, opt),
    ]);
    if (!hbR.ok) return null;
    hb = await hbR.json();
    if (pageR.ok) page = await pageR.json();
  } catch {
    return null;
  }
  const heartbeatList = (hb && hb.heartbeatList) || {};
  const uptimeList = (hb && hb.uptimeList) || {};
  const groups: any[] = (page && Array.isArray(page.publicGroupList) && page.publicGroupList.length)
    ? page.publicGroupList
    : [{ name: '', monitorList: Object.keys(heartbeatList).map((id) => ({ id: parseInt(id, 10) || 0, name: '' })) }];
  const monitors: KumaMonitor[] = [];
  for (const g of groups) {
    const groupName = typeof g?.name === 'string' ? g.name : '';
    for (const m of (Array.isArray(g?.monitorList) ? g.monitorList : [])) {
      const id = Number(m?.id);
      if (!id) continue;
      const beats: boolean[] = ((heartbeatList[String(id)] || []) as { status?: number }[])
        .slice(-40)
        .map((h) => h?.status === 1);
      const up = uptimeList[`${id}_24`];
      monitors.push({
        id,
        name: typeof m?.name === 'string' ? m.name : `Monitor ${id}`,
        group: groupName,
        current: beats.length ? beats[beats.length - 1] : false,
        up24: typeof up === 'number' ? Math.round(up * 1000) / 10 : null,
        beats,
      });
    }
  }
  const payload = JSON.stringify({ monitors });
  await cachePutJson('cache:kuma-pub', payload, 180);
  return { monitors };
}

// ---------- Service updates feed (git commits + runtime reconcile) ----------
// argocd-image-updater commit format (verified 53/53 over 180d, 0 parse fails):
//   subject: build: automatic update of <app>
//   body:    updates image <image> tag '<from>' to '<to>'
// Pipeline: parse -> map app->service -> dedupe (service,from,to; keep earliest)
//   -> drop downgrades (ONLY when both tags version-like) -> 90d window -> reconcile.
// Reconcile rule: announce when to <= running (LTE, not == — equality would
// collapse every historical step; LTE keeps the chain and still suppresses the
// rolled-back nextcloud 35.0.0 chain). Non-version tags skip the comparison.
const GH_REPO_API = 'https://api.github.com/repos/mysweetpea/homelab-k8s/commits';
const GH_PAGES = 6; // 600 commits ~ 34 days of history, covers the 30d Services window
const UPDATES_WINDOW_DAYS = 90;

const APP_SERVICE: Record<string, string> = {
  'vaultwarden': 'vaultwarden',
  'matrix-synapse': 'matrix', 'matrix-mas': 'matrix', 'element-web': 'matrix', 'matrix-rtc': 'matrix',
  'affine': 'affine', 'koalasync': 'koalasync', 'jellyfin': 'jellyfin', 'seerr': 'seerr',
  'nextcloud': 'nextcloud', 'immich': 'immich', 'open-webui': 'open-webui',
};
const SERVICE_NAME: Record<string, string> = {
  'vaultwarden': 'Vaultwarden', 'matrix': 'Matrix / Element', 'affine': 'AFFiNE', 'koalasync': 'KoalaSync',
  'jellyfin': 'Jellyfin', 'seerr': 'Seerr', 'nextcloud': 'Nextcloud', 'immich': 'Immich', 'open-webui': 'Open WebUI',
};
// Release-notes repos. prefix: 'v' | '' (vaultwarden tags bare) | null (SHA tags
// are not releases — link the releases list instead). Jellyfin deliberately
// absent: upstream latest is v12.x while the cluster runs 10.11.11 — never link.
const APP_RELEASE: Record<string, { repo: string; prefix: string | null }> = {
  'vaultwarden': { repo: 'dani-garcia/vaultwarden', prefix: '' },
  'matrix-synapse': { repo: 'element-hq/synapse', prefix: 'v' },
  'element-web': { repo: 'element-hq/element-web', prefix: 'v' },
  'matrix-mas': { repo: 'element-hq/matrix-authentication-service', prefix: 'v' },
  'affine': { repo: 'toeverything/AFFiNE', prefix: null },
  'koalasync': { repo: 'Shik3i/KoalaSync', prefix: 'v' },
  'seerr': { repo: 'seerr-team/seerr', prefix: 'v' },
  'nextcloud': { repo: 'nextcloud/server', prefix: 'v' },
  'immich': { repo: 'immich-app/immich', prefix: 'v' },
  'open-webui': { repo: 'open-webui/open-webui', prefix: 'v' },
};

// Runtime version probes (all verified 200 from a Worker). Keyed by APP — only
// apps whose image version IS the endpoint's version reconcile (element-web
// must not be compared against synapse's version). element-web/affine/
// koalasync/matrix-mas/matrix-rtc have no public endpoint -> git evidence only.
const RUNTIME_PROBES: Record<string, { url: string; pick: (d: any) => string }> = {
  'vaultwarden': { url: 'https://vault.mysweetpea.cc/api/version', pick: (d) => (typeof d === 'string' ? d : '') },
  'matrix-synapse': { url: 'https://matrix.mysweetpea.cc/_matrix/federation/v1/version', pick: (d) => (d && d.server && d.server.version) || '' },
  'seerr': { url: 'https://request.mysweetpea.cc/api/v1/status', pick: (d) => (d && d.version) || '' },
  'nextcloud': { url: 'https://cloud.mysweetpea.cc/status.php', pick: (d) => (d && d.versionstring) || '' },
  'immich': {
    url: 'https://photos.mysweetpea.cc/api/server/version',
    pick: (d) => (d && typeof d.major === 'number' ? `${d.major}.${d.minor}.${d.patch}` : (typeof d === 'string' ? d : '')),
  },
  'open-webui': { url: 'https://ai.mysweetpea.cc/api/config', pick: (d) => (d && d.version) || '' },
};

const UPD_SUBJECT_RE = /^build: automatic update of (\S+)/m;
const UPD_TAGLINE_RE = /updates image (\S+) tag '([^']*)' to '([^']*)'/g;
const isVersionLike = (t: string): boolean => /^v?\d+(\.\d+)+/.test(String(t || ''));
const isShaLike = (t: string): boolean => /^[A-Za-z]+-[0-9a-f]{6,}$/.test(String(t || '')) || /^[0-9a-f]{7,40}$/.test(String(t || ''));
function parseVer(t: string): number[] | null {
  const m = String(t || '').replace(/^v/, '').match(/^\d+(\.\d+)*/);
  if (!m) return null;
  const parts = m[0].split('.').map(Number);
  return parts.every((n) => isFinite(n)) ? parts : null;
}
function cmpVer(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

interface RawUpdate { app: string; from: string; to: string; date: string; sha: string }
interface UpdItem { service: string; name: string; from: string; to: string; date: string; sha: string; releaseUrl: string | null; kind: string }

function parseUpdateCommit(c: any): RawUpdate | null {
  const msg = String((c && c.commit && c.commit.message) || '');
  const sm = msg.match(UPD_SUBJECT_RE);
  if (!sm) return null;
  const app = sm[1].split('/').pop() as string;
  if (!APP_SERVICE[app]) return null;
  UPD_TAGLINE_RE.lastIndex = 0;
  const tm = UPD_TAGLINE_RE.exec(msg);
  if (!tm) return null;
  const date = String((c.commit.author && c.commit.author.date) || '').slice(0, 10);
  return { app, from: tm[2], to: tm[3], date, sha: String(c.sha || '').slice(0, 7) };
}

function buildUpdate(e: RawUpdate): UpdItem {
  const rel = APP_RELEASE[e.app];
  let releaseUrl: string | null = null;
  if (rel && rel.prefix !== null && isVersionLike(e.to)) {
    const tag = rel.prefix + String(e.to).replace(/^v/, '');
    releaseUrl = 'https://github.com/' + rel.repo + '/releases/tag/' + tag;
  } else if (rel && rel.prefix === null) {
    releaseUrl = 'https://github.com/' + rel.repo + '/releases';
  }
  let kind = 'update'; // non-version from tag ("latest"/"testing"/"preview-*")
  if (isVersionLike(e.from) && isVersionLike(e.to)) kind = 'version';
  else if (isShaLike(e.from) || isShaLike(e.to)) kind = 'build'; // affine stable-<sha>
  return { service: APP_SERVICE[e.app], name: SERVICE_NAME[APP_SERVICE[e.app]], from: e.from, to: e.to, date: e.date, sha: e.sha, releaseUrl, kind };
}

async function fetchGithubCommitPages(env: Env): Promise<any[]> {
  const headers: Record<string, string> = {
    'user-agent': 'mysweetpea-dashboard',
    'accept': 'application/vnd.github+json',
  };
  if (env.GITHUB_TOKEN) headers['authorization'] = 'Bearer ' + env.GITHUB_TOKEN;
  const pages = await Promise.all(Array.from({ length: GH_PAGES }, async (_, i) => {
    try {
      const r = await fetch(`${GH_REPO_API}?per_page=100&page=${i + 1}`, { headers });
      if (!r.ok) return [];
      return (await r.json() as any[]) || [];
    } catch { return []; }
  }));
  return pages.flat();
}

async function fetchRunningVersions(): Promise<{ running: Record<string, number[]>; ok: number }> {
  const keys = Object.keys(RUNTIME_PROBES);
  const settled = await Promise.allSettled(keys.map(async (k) => {
    const p = RUNTIME_PROBES[k];
    const r = await fetch(p.url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(String(r.status));
    return parseVer(p.pick(await r.json()));
  }));
  const running: Record<string, number[]> = {};
  let ok = 0;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && s.value) { running[keys[i]] = s.value; ok++; }
  });
  return { running, ok };
}

async function produceUpdates(env: Env): Promise<string> {
  const cutoff = new Date(Date.now() - UPDATES_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const commits = await fetchGithubCommitPages(env);
  // parse -> dedupe by (service, from, to), keep EARLIEST -> 90d window
  const best = new Map<string, RawUpdate>();
  for (const c of commits) {
    const e = parseUpdateCommit(c);
    if (!e || e.date < cutoff) continue;
    const k = APP_SERVICE[e.app] + '|' + e.from + '|' + e.to;
    const prev = best.get(k);
    if (!prev || e.date < prev.date) best.set(k, e);
  }
  // drop downgrades — compare ONLY when both tags are version-like (AFFiNE's
  // stable-<sha> tags parse as garbage numbers and must never be compared)
  const kept: RawUpdate[] = [];
  for (const e of best.values()) {
    const f = parseVer(e.from), t = parseVer(e.to);
    if (f && t && cmpVer(t, f) < 0) continue;
    kept.push(e);
  }
  kept.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const { running, ok } = await fetchRunningVersions();
  const updates = kept
    .filter((e) => {
      const run = running[e.app];
      if (!run) return true; // not reconcilable / endpoint failed -> git evidence alone
      const to = parseVer(e.to);
      if (!to) return true; // non-version tag skips the comparison
      return cmpVer(to, run) <= 0; // LTE: keep the chain, drop never-ran versions
    })
    .map(buildUpdate);
  return JSON.stringify({ updates, generated: Date.now(), reconciled: ok > 0 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const res = await this.handle(request, env, ctx);
    // security headers on every response (dashboard is auth-gated, but
    // defense-in-depth costs nothing — mirrors the site worker's posture)
    const h = new Headers(res.headers);
    if (!h.has('X-Frame-Options')) h.set('X-Frame-Options', 'DENY');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },

  async handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---------- auth ----------
    if (path === '/auth/login') {
      // Cookie-free PKCE: the verifier lives server-side in KV keyed by
      // state (state already travels in the authorize URL). The previous
      // design set the pkce cookie on this cross-site 302; some
      // browsers/extensions drop Set-Cookie during redirect chains, the
      // callback then 400'd on a missing cookie and login looped forever.
      const state = randomB64u(16);
      const verifier = randomB64u(64);
      const challenge = b64uEncode(await sha256(verifier));
      await env.SESSIONS.put(`pkce:${state}`, verifier, { expirationTtl: 600 });
      const authorizeUrl = new URL(`${env.AUTH_ISSUER}/authorize/`);
      authorizeUrl.searchParams.set('client_id', env.AUTHENTIK_CLIENT_ID);
      authorizeUrl.searchParams.set('redirect_uri', new URL('/auth/callback', env.APP_URL).toString());
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', SCOPES);
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('code_challenge', challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      return Response.redirect(authorizeUrl.toString(), 302);
    }

    if (path === '/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        return new Response('Invalid OAuth state', { status: 400 });
      }
      // Cookie-free PKCE: verifier from KV by state (one-time read).
      const verifier = await env.SESSIONS.get(`pkce:${state}`);
      if (!verifier) {
        return new Response('Invalid OAuth state', { status: 400 });
      }
      await env.SESSIONS.delete(`pkce:${state}`);
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: new URL('/auth/callback', env.APP_URL).toString(),
        client_id: env.AUTHENTIK_CLIENT_ID,
        code_verifier: verifier,
      });
      const tr = await fetch(`${env.AUTH_ISSUER}/token/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-msp-internal': env.MSP_INTERNAL_HEADER },
        body,
      });
      if (!tr.ok) return new Response('Token exchange failed', { status: 502 });
      const tokens = await tr.json() as { access_token: string; refresh_token?: string; id_token?: string };

      // fetch profile as the user
      const me = await authentikFetch(env, tokens.access_token, '/api/v3/core/users/me/');
      if (!me.ok) return new Response('Profile fetch failed', { status: 502 });
      const meData = await me.json() as { user: { pk: string; username: string; name: string; email: string; is_active: boolean } };
      if (!meData.user.is_active) return new Response('Account disabled', { status: 403 });

      const sid = randomB64u(32);
      const sess: SessionData = {
        at: tokens.access_token,
        rt: tokens.refresh_token,
        sub: meData.user.pk,
        username: meData.user.username,
        name: meData.user.name,
        email: meData.user.email,
        created: Date.now(),
      };
      await env.SESSIONS.put(`sess:${sid}`, JSON.stringify(sess), { expirationTtl: 86400 });
      // audit
      const audit = { t: Date.now(), event: 'login', ip: request.headers.get('cf-connecting-ip') || '' };
      await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify(audit), { expirationTtl: 90 * 86400 });

      // One-time landing token: avoids Set-Cookie during the cross-site
      // navigation (privacy blockers eat those). The interstitial exchanges
      // this token for the session cookie via a same-site fetch.
      const token = randomB64u(32);
      await env.SESSIONS.put('land:' + token, sid, { expirationTtl: 60 });
      const headers = new Headers({ 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' });
      headers.append('set-cookie', 'msp_pkce=; Path=/auth; HttpOnly; Secure; Max-Age=0');
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Signing you in…</title>
<style>body{background:#0C1316;color:#EDF3F4;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.c{width:46px;height:46px;border:3px solid rgba(143,175,181,.2);border-top-color:#8FAFB5;border-radius:50%;animation:s 0.9s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><div class="c"></div><script>
(async () => {
  const t = ${JSON.stringify(token)};
  try {
    const lr = await fetch('/auth/land', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t }), credentials: 'include' });
    if (!lr.ok) throw new Error('land failed ' + lr.status);
  } catch (e) { location.replace('/?login_retry=1'); return; }
  let n = 0;
  const go = () => fetch('/api/me', { credentials: 'include' }).then(r => {
    if (r.ok) location.replace('/');
    else if (++n < 20) setTimeout(go, 250);
    else location.replace('/?login_retry=1');
  }).catch(() => { if (++n < 20) setTimeout(go, 250); else location.replace('/?login_retry=1'); });
  go();
})();
</script></body></html>`;
      return new Response(html, { status: 200, headers });
    }

    // Popup ceremony: deep-link into an authentik-hosted setup flow with
    // a return-to-dashboard next. The user's authentik browser session runs
    // the ceremony (stock-supported path); completion lands back on /.
    if (path === '/auth/ceremony') {
      // authentik's embedded user interface handles all self-service
      // ceremonies with the user's own browser session (stock-supported).
      // 2026.8 dropped #/mfa-style fragments: deep links are now
      // #/settings;{"page":"page-<key>"} (verified in the UI bundle).
      // Serve a tiny client-side redirector instead of a Location header so
      // the raw JSON fragment survives without URL-encoding questions.
      const f = url.searchParams.get('f') || 'mfa';
      const page = /password/.test(f) ? 'page-details'
                 : /session/.test(f) ? 'page-sessions'
                 : 'page-credentials';
      const html = `<!doctype html><meta charset="utf-8"><title>Opening settings…</title>
<script>location.replace(${JSON.stringify(env.AUTH_BASE + '/if/user/#/settings;')} + ${JSON.stringify(JSON.stringify({ page }))});</script>`;
      return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
    }

    if (path === '/auth/land' && request.method === 'POST') {
      const { token } = await request.json() as { token?: string };
      if (!token) return json({ ok: false, error: 'no token' }, 400);
      const sid = await env.SESSIONS.get('land:' + token);
      if (!sid) return json({ ok: false, error: 'token expired' }, 401);
      await env.SESSIONS.delete('land:' + token);
      const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
      headers.append('set-cookie', `${COOKIE}=${sid}; Domain=.mysweetpea.cc; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (path === '/auth/logout') {
      const cookie = request.headers.get('cookie') || '';
      const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
      if (m) await env.SESSIONS.delete(`sess:${m[1]}`);
      const headers = new Headers({ location: '/' });
      headers.append('set-cookie', `${COOKIE}=; Domain=.mysweetpea.cc; Path=/; HttpOnly; Secure; Max-Age=0`);
      return new Response(null, { status: 302, headers });
    }

    // ---------- API ----------
    // Portal identity probe (no auth roundtrip): the site worker proxies this
    // so its nav chip can show "Sign in" vs the user's first name.
    if (path === '/api/auth/state') {
      const cookie = request.headers.get('cookie') || '';
      const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
      let raw: string | null = null;
      if (m) raw = await env.SESSIONS.get(`sess:${m[1]}`);
      const logged_in = !!raw;
      if (logged_in && url.searchParams.get('name') === '1') {
        try {
          const s = JSON.parse(raw as string) as Partial<SessionData>;
          return json({ logged_in, name: s.name || s.username || '' });
        } catch {
          return json({ logged_in });
        }
      }
      return json({ logged_in });
    }
    if (path.startsWith('/api/')) {
      const auth = await requireSession(request, env);
      if (auth instanceof Response) return auth;
      const { sess, sid } = auth;

      if (path === '/api/me') {
        // SWR-cached: /api/me is called on EVERY dashboard load and does a live
        // authentik round-trip; the profile rarely changes, so cache it per-user
        // (60s fresh, stale-served instantly while refreshing in the background).
        // ⚠️ MUST NOT cache failures: an expired/momentary authentik error used to
        // get cached as the "profile" (HTTP 200, body {detail:...}) for 24h, which
        // crashed the client boot (applyAcctMenu .split of undefined) and left the
        // tab bar unpainted. Failures now bypass the cache AND return their real
        // status; stale-but-valid cached profiles are still served instantly.
        const meKey = 'cache:me:' + sess.sub;
        const meProduce = async (): Promise<string> => {
          const r = await authentikFetch(env, sess.at, '/api/v3/core/users/me/');
          const d = await r.json() as any;
          const user = d && d.user ? d.user : d;
          // Auth/permission failure or malformed body -> signal error, do not cache.
          if (!r.ok || !user || typeof user.username !== 'string' || user.username === '') {
            throw new Error('me ' + r.status);
          }
          user.has_avatar = false;
          user.avatar_ts = 0;
          // tier badge: membership of the authentik 'sweetpea' / 'seedling' groups
          const groupNames = (user.groups || []).map((g: any) => String(g && g.name || '').toLowerCase());
          user.tier = groupNames.includes('sweetpea') ? 'sweetpea'
                    : groupNames.includes('seedling') ? 'seedling'
                    : 'seedling';
          try {
            const m = await env.SESSIONS.get(`avm:${sess.sub}`);
            if (m) {
              const meta = JSON.parse(m) as { updated?: number };
              user.has_avatar = true;
              user.avatar_ts = meta.updated || 0;
            }
          } catch { /* fall back to initials */ }
          return JSON.stringify(user);
        };
        // Serve fresh cache directly; serve stale cache instantly + refresh behind;
        // on cold miss do a blocking fetch but NEVER cache/return an error body.
        let meRaw: string | null = null;
        let meFresh = false;
        const raw = await cacheGetJson(meKey);
        if (raw) {
          try {
            const p = JSON.parse(raw) as { d?: string; t?: number };
            if (typeof p?.d === 'string' && p.d.indexOf('"detail"') < 0) {
              meRaw = p.d;
              meFresh = (Date.now() - (p.t || 0)) < 60000;
            }
          } catch { /* cold */ }
        }
        if (meRaw && meFresh) {
          return new Response(meRaw, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        }
        if (meRaw) {
          ctx.waitUntil((async () => { try { const d = await meProduce(); await cachePutJson(meKey, JSON.stringify({ d, t: Date.now() }), 86400); } catch { /* keep serving stale */ } })());
          return new Response(meRaw, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        }
        try {
          const d = await meProduce();
          await cachePutJson(meKey, JSON.stringify({ d, t: Date.now() }), 86400);
          return new Response(d, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        } catch {
          // Real failure (token expired/authentik down): surface it honestly so the
          // client falls back to the sign-in gate instead of crashing mid-boot.
          return json({ error: 'unauthorized' }, 401);
        }
      }

      // ---------- avatar (KV-stored profile picture) ----------
      if (path === '/api/avatar/meta') {
        const m = await env.SESSIONS.get(`avm:${sess.sub}`);
        if (!m) return json({ has: false, mime: '', bytes: 0, updated: 0 });
        try {
          const meta = JSON.parse(m) as { mime: string; bytes: number; updated: number };
          return json({ has: true, mime: meta.mime || '', bytes: meta.bytes || 0, updated: meta.updated || 0 });
        } catch {
          return json({ has: false, mime: '', bytes: 0, updated: 0 });
        }
      }
      if (path === '/api/avatar' && request.method === 'POST') {
        let body: { data?: string } = {};
        try { body = await request.json() as { data?: string }; } catch {}
        if (!body.data || typeof body.data !== 'string') return json({ error: 'Missing image data' }, 400);
        // 512KB max after base64 decode (~700KB of base64 text); reject before decoding huge payloads
        if (body.data.length > 700000) return json({ error: 'Image too large (max 512KB)' }, 413);
        // Fast path: Uint8Array.fromBase64 (native, ~6x faster than the
        // atob + charCodeAt loop for 512KB payloads — probe-verified on this
        // runtime). Falls back to atob where unavailable (older runtimes).
        let bytes: Uint8Array;
        try {
          bytes = (typeof (Uint8Array as any).fromBase64 === 'function')
            ? (Uint8Array as any).fromBase64(body.data)
            : (() => {
                const bin = atob(body.data);
                const u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                return u;
              })();
        } catch { return json({ error: 'Invalid image data' }, 400); }
        if (bytes.length > 512 * 1024) return json({ error: 'Image too large (max 512KB)' }, 413);
        const mime = sniffImageMime(bytes);
        if (!mime) return json({ error: 'Unsupported image type (use PNG, JPEG or WebP)' }, 400);
        await env.SESSIONS.put(`av:${sess.sub}`, bytes.buffer as ArrayBuffer);
        const updated = Date.now();
        await env.SESSIONS.put(`avm:${sess.sub}`, JSON.stringify({ mime, bytes: bytes.length, updated }));
        await env.SESSIONS.put(`audit:${sess.sub}:${updated}`, JSON.stringify({ t: updated, event: 'avatar_set' }), { expirationTtl: 90 * 86400 });
        return json({ ok: true });
      }
      if (path === '/api/avatar' && request.method === 'DELETE') {
        await env.SESSIONS.delete(`av:${sess.sub}`);
        await env.SESSIONS.delete(`avm:${sess.sub}`);
        const now = Date.now();
        await env.SESSIONS.put(`audit:${sess.sub}:${now}`, JSON.stringify({ t: now, event: 'avatar_removed' }), { expirationTtl: 90 * 86400 });
        return json({ ok: true });
      }
      if (path === '/api/avatar') {
        const m = await env.SESSIONS.get(`avm:${sess.sub}`);
        if (!m) return json({ error: 'no avatar' }, 404);
        const data = await env.SESSIONS.get(`av:${sess.sub}`, { type: 'arrayBuffer' });
        if (!data) return json({ error: 'no avatar' }, 404);
        let mime = 'application/octet-stream';
        try { mime = (JSON.parse(m) as { mime?: string }).mime || mime; } catch {}
        return new Response(data, {
          headers: { 'content-type': mime, 'cache-control': 'private, max-age=300' },
        });
      }

      // ---------- profile edit (name + email) with password step-up ----------
      if (path === '/api/profile/update' && request.method === 'POST') {
        let body: { name?: unknown; email?: unknown; password?: unknown } = {};
        try { body = await request.json() as typeof body; } catch {}
        const password = typeof body.password === 'string' ? body.password : '';
        if (!password) return json({ error: 'Your password is required to save changes.' }, 400);

        const updates: { name?: string; email?: string } = {};
        if (body.name !== undefined) {
          if (typeof body.name !== 'string') return json({ error: 'Name must be 1-80 characters.' }, 400);
          const name = body.name.trim();
          if (name.length < 1 || name.length > 80) return json({ error: 'Name must be 1-80 characters.' }, 400);
          updates.name = name;
        }
        if (body.email !== undefined) {
          if (typeof body.email !== 'string') return json({ error: 'Enter a valid email address.' }, 400);
          const email = body.email.trim();
          if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
          updates.email = email;
        }
        if (!updates.name && !updates.email) return json({ error: 'Nothing to update.' }, 400);

        // rate limit: 5 attempts per hour (counter increments even on failure)
        const rlKey = `rl:prof:${sess.sub}`;
        const count = (parseInt((await env.SESSIONS.get(rlKey)) || '0', 10) || 0) + 1;
        await env.SESSIONS.put(rlKey, String(count), { expirationTtl: 3600 });
        if (count > 5) return json({ error: 'Too many attempts, try again later' }, 429);

        if (!(await verifyPassword(env, sess.username, password))) {
          return json({ error: 'Incorrect password' }, 401);
        }

        // authentik FOSS denies self-writes; the worker patches via an admin
        // token, gated by the step-up above (user can only change their own).
        const upk = await resolveUpk(env, sess);
        if (!upk) return json({ error: 'Profile update failed.' }, 502);
        const pr = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN, `/api/v3/core/users/${upk}/`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        });
        if (!pr.ok) return json({ error: 'Profile update failed.' }, 502);

        // keep the KV session doc in sync so the dashboard reflects immediately
        const raw = await env.SESSIONS.get(`sess:${sid}`);
        if (raw) {
          const doc = JSON.parse(raw) as SessionData;
          if (updates.name) doc.name = updates.name;
          if (updates.email) doc.email = updates.email;
          await env.SESSIONS.put(`sess:${sid}`, JSON.stringify(doc), { expirationTtl: 86400 });
        }

        const now = Date.now();
        await env.SESSIONS.put(`audit:${sess.sub}:${now}`, JSON.stringify({ t: now, event: 'profile_updated', fields: Object.keys(updates) }), { expirationTtl: 90 * 86400 });
        await cacheDeleteJson('cache:me:' + sess.sub); // invalidate /api/me cache
        return json({ ok: true, name: updates.name ?? sess.name, email: updates.email ?? sess.email });
      }

      // ---------- inline password change (verifies current, writes to authentik) ----------
      if (path === '/api/password/change' && request.method === 'POST') {
        let body: { currentPassword?: unknown; newPassword?: unknown } = {};
        try { body = await request.json() as typeof body; } catch {}
        const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
        if (!currentPassword || !newPassword) return json({ error: 'Both fields are required.' }, 400);
        if (newPassword.length < 12) return json({ error: 'New password must be at least 12 characters.' }, 400);

        // rate limit: 5 attempts per hour (counter increments even on failure)
        const rlKey = `rl:pw:${sess.sub}`;
        const count = (parseInt((await env.SESSIONS.get(rlKey)) || '0', 10) || 0) + 1;
        await env.SESSIONS.put(rlKey, String(count), { expirationTtl: 3600 });
        if (count > 5) return json({ error: 'Too many attempts, try again later' }, 429);

        if (!(await verifyPassword(env, sess.username, currentPassword))) {
          return json({ error: 'Incorrect current password' }, 401);
        }

        const upk = await resolveUpk(env, sess);
        if (!upk) return json({ error: 'Password change failed.' }, 502);
        const pr = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN, `/api/v3/core/users/${upk}/set_password/`, {
          method: 'POST',
          body: JSON.stringify({ password: newPassword }),
        });
        if (!pr.ok) return json({ error: 'Password change failed.' }, 502);

        const now = Date.now();
        await env.SESSIONS.put(`audit:${sess.sub}:${now}`, JSON.stringify({ t: now, event: 'password_changed' }), { expirationTtl: 90 * 86400 });
        return json({ ok: true });
      }

      if (path === '/api/sessions') {
        const r = await authentikFetch(env, sess.at, '/api/v3/core/authenticated_sessions/');
        return json(await r.json(), r.status);
      }
      if (path === '/api/consents') {
        const r = await authentikFetch(env, sess.at, '/api/v3/core/user_consent/');
        return json(await r.json(), r.status);
      }
      if (path === '/api/devices') {
        const r = await authentikFetch(env, sess.at, '/api/v3/authenticators/totp/?include_unconfirmed=true');
        const r2 = await authentikFetch(env, sess.at, '/api/v3/authenticators/webauthn/');
        const r3 = await authentikFetch(env, sess.at, '/api/v3/authenticators/static/');
        const [totp, webauthn, statics] = await Promise.all([r.json(), r2.json(), r3.json()]);
        return json({ totp: totp.results ?? [], webauthn: webauthn.results ?? [], static: statics.results ?? [] });
      }
      if (path === '/api/stats') {
        // SWR: instant from cache (fresh OR stale); refresh in background.
        const payload = await swrJson(ctx, env, 'cache:stats', 300000, async () => {
          const out: Record<string, number | string | null> = {
            movies: null, series: null, episodes: null, songs: null, boxsets: null, jf_resume: null,
            jf_watch_hours: null, jf_resume_titles: null, jf_top_title: null,
            photos: null, videos: null, usage_mb: null,
            users: null, sessions: null,
            seerr_total: null, seerr_pending: null, seerr_approved: null, seerr_available: null, seerr_media: null,
          };
          await Promise.all([
            (async () => {
              try {
                const r = await fetch(env.JELLYFIN_URL + '/Items/Counts', { headers: { 'x-emby-token': env.JELLYFIN_API_KEY } });
                if (r.ok) {
                  const d = await r.json() as any;
                  out.movies = d.MovieCount ?? null;
                  out.series = d.SeriesCount ?? null;
                  out.episodes = d.EpisodeCount ?? null;
                  out.songs = d.SongCount ?? null;
                  out.boxsets = d.BoxSetCount ?? null;
                }
              } catch {}
            })(),
            (async () => {
              // resume/watching count — TotalRecordCount only, no item fetch
              try {
                const r = await fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID +
                  '&Recursive=true&Filters=IsResumable&Limit=1',
                  { headers: { 'x-emby-token': env.JELLYFIN_API_KEY } });
                if (r.ok) {
                  const d = await r.json() as any;
                  out.jf_resume = typeof d.TotalRecordCount === 'number' ? d.TotalRecordCount : null;
                }
              } catch {}
            })(),
            (async () => {
              // wrapped hero: sum playback positions of resumable items -> watch hours
              try {
                const r = await fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID +
                  '&Recursive=true&Filters=IsResumable&Fields=UserData,PlaybackPositionTicks&Limit=50',
                  { headers: { 'x-emby-token': env.JELLYFIN_API_KEY } });
                if (r.ok) {
                  const d = await r.json() as any;
                  const items = (Array.isArray(d.Items) ? d.Items : []) as any[];
                  let hours = 0;
                  for (const it of items) hours += (it && it.UserData && typeof it.UserData.PlaybackPositionTicks === 'number' ? it.UserData.PlaybackPositionTicks : 0) / 3.6e9;
                  out.jf_watch_hours = Math.round(hours * 10) / 10;
                  out.jf_resume_titles = items.length;
                  out.jf_top_title = (items[0] && typeof items[0].Name === 'string' && items[0].Name) || null;
                }
              } catch {}
            })(),
            (async () => {
              try {
                const r = await fetch(env.IMMICH_URL + '/api/server/statistics', { headers: { 'x-api-key': env.IMMICH_API_KEY } });
                if (r.ok) {
                  const d = await r.json() as any;
                  out.photos = d.photos ?? null;
                  out.videos = d.videos ?? null;
                  if (typeof d.usage === 'number') out.usage_mb = Math.round(d.usage / 1048576);
                }
              } catch {}
            })(),
            (async () => {
              try {
                // admin token: total member count from the users pagination header
                const r = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN, '/api/v3/core/users/?page=1&page_size=1');
                if (r.ok) {
                  const d = await r.json() as any;
                  const c = d && d.pagination && typeof d.pagination.count === 'number' ? d.pagination.count : null;
                  out.users = c;
                }
              } catch {}
            })(),
            (async () => {
              try {
                const s = await authentikFetch(env, sess.at, '/api/v3/core/authenticated_sessions/');
                if (s.ok) { const d = await s.json() as any; out.sessions = (d.results ?? []).length; }
              } catch {}
            })(),
            (async () => {
              try {
                const r = await fetch(env.SEERR_URL + '/api/v3/request/count', { headers: { 'X-Api-Key': env.SEERR_API_KEY } });
                if (r.ok) {
                  const d = await r.json() as any;
                  out.seerr_total = typeof d.total === 'number' ? d.total : null;
                  out.seerr_pending = typeof d.pending === 'number' ? d.pending : null;
                  out.seerr_approved = typeof d.approved === 'number' ? d.approved : null;
                  out.seerr_available = typeof d.available === 'number' ? d.available : null;
                }
              } catch {}
            })(),
            (async () => {
              try {
                const r = await fetch(env.SEERR_URL + '/api/v3/media?take=1', { headers: { 'X-Api-Key': env.SEERR_API_KEY } });
                if (r.ok) {
                  const d = await r.json() as any;
                  const total = d && d.pageInfo && (d.pageInfo.results ?? d.pageInfo.resultsTotal);
                  out.seerr_media = typeof total === 'number' ? total : null;
                }
              } catch {}
            })(),
          ]);
          return JSON.stringify(out);
        });
        return new Response(payload, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      if (path === '/api/media/continue') {
        // SWR: instant from cache (fresh OR stale); refresh in background.
        const payload = await swrJson(ctx, env, 'cache:media-cont', 120000, async () => {
          const r = await fetch(env.JELLYFIN_URL + '/Items?userId=' + env.JELLYFIN_USER_ID +
            '&Recursive=true&SortBy=DatePlayed&SortOrder=Descending&Filters=IsResumable' +
            '&IncludeItemTypes=Movie,Episode&Limit=12&Fields=ProductionYear,SeriesName&EnableImages=true',
            { headers: { 'x-emby-token': env.JELLYFIN_API_KEY } });
          if (!r.ok) throw new Error('jellyfin ' + r.status);
          const d = await r.json() as any;
          const items = ((d.Items ?? []) as any[]).map((it) => ({
            id: it.Id,
            name: it.Name,
            seriesName: it.SeriesName ?? '',
            type: it.Type,
            progressPct: Math.round(it.UserData?.PlayedPercentage ?? 0),
            img: env.JELLYFIN_URL + '/Items/' + it.Id + '/Images/Primary?fillHeight=420&fillWidth=280&quality=75',
          }));
          return JSON.stringify({ items });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/media/latest') {
        // SWR: instant from cache (fresh OR stale); refresh in background.
        const payload = await swrJson(ctx, env, 'cache:media-latest', 300000, async () => {
          const r = await fetch(env.JELLYFIN_URL + '/Items/Latest?userId=' + env.JELLYFIN_USER_ID + '&Limit=12&EnableImages=true',
            { headers: { 'x-emby-token': env.JELLYFIN_API_KEY } });
          if (!r.ok) throw new Error('jellyfin ' + r.status);
          const d = await r.json() as any;
          const items = ((Array.isArray(d) ? d : []) as any[]).map((it) => ({
            id: it.Id,
            name: it.Name,
            seriesName: it.SeriesName ?? '',
            type: it.Type,
            img: env.JELLYFIN_URL + '/Items/' + it.Id + '/Images/Primary?fillHeight=420&fillWidth=280&quality=75',
          }));
          return JSON.stringify({ items });
        });
        return json(JSON.parse(payload));
      }
      if (path === '/api/requests') {
        // Home "Your requests" journeys — this user's recent Seerr requests.
        // Seerr matches by ITS numeric user id (resolved once via email),
        // cached per-user for 120s. Unmatched users (never opened Seerr)
        // get an empty list — the UI hides the section.
        const cacheKey = 'cache:requests:' + sess.sub;
        const cache = await cacheGetJson(cacheKey);
        if (cache) return json(JSON.parse(cache));
        const out: any[] = [];
        try {
          const sessMe = await authentikFetch(env, sess.at, '/api/v3/core/users/me/');
          const me = await sessMe.json() as any;
          const meEmail = ((me && me.user ? me.user : me).email || '').toLowerCase();
          // resolve the Seerr user id for this email (admin API, id cached 24h)
          let seerrUid = parseInt((await env.SESSIONS.get('seerruid:' + sess.sub)) || '', 10);
          if (!seerrUid) {
            const ur = await fetch(env.SEERR_URL + '/api/v1/user?take=100', { headers: { 'X-Api-Key': env.SEERR_API_KEY } });
            if (ur.ok) {
              const ud = await ur.json() as any;
              const hit = (ud.results ?? []).find((u: any) => (u.email || '').toLowerCase() === meEmail);
              if (hit?.id) { seerrUid = hit.id; await kvPutBestEffort(env, 'seerruid:' + sess.sub, String(seerrUid), 86400); }
            }
          }
          if (seerrUid) {
            const r = await fetch(env.SEERR_URL + '/api/v1/request?take=12&sort=added&requestedBy=' + seerrUid,
              { headers: { 'X-Api-Key': env.SEERR_API_KEY } });
            if (r.ok) {
              const d = await r.json() as any;
              for (const rq of (d.results ?? [])) {
                const m = rq?.media ?? {};
                out.push({
                  tmdbId: m.tmdbId ?? null,
                  mediaType: rq.type === 'tv' ? 'tv' : 'movie',
                  status: rq.status ?? null,            // 1 pending, 2 approved, 3 declined
                  availability: m.status ?? null,        // 3 partly, 4/5 available
                  title: (rq as any).title ?? null,
                  createdAt: rq.createdAt ?? null,
                });
              }
            }
          }
        } catch {}
        const payload = JSON.stringify({ requests: out });
        await cachePutJson(cacheKey, payload, 120);
        return json({ requests: out });
      }
      if (path === '/api/status') {
        // Home "Service status" card — public slug only, shaped for the SPA.
        const d = await fetchPublicKuma(env);
        if (!d) return json({ monitors: [] });
        return json({ monitors: d.monitors.map((m) => ({ name: m.name, current: m.current, uptime24h: m.up24 })) });
      }
      if (path === '/api/status/extended') {
        // Services tab uptime bars — public slug only, beats for the strip.
        const d = await fetchPublicKuma(env);
        if (!d) return json({ monitors: [] });
        return json(d);
      }
      if (path === '/api/audit') {
        const list = await env.SESSIONS.list({ prefix: `audit:${sess.sub}:` });
        const out = [];
        for (const k of list.keys.slice(-30).reverse()) {
          const v = await env.SESSIONS.get(k.name);
          if (v) out.push(JSON.parse(v));
        }
        return json(out);
      }
      if (path === '/api/updates') {
        // Service updates feed — SWR cached 30 min; refresh fetches 6 GitHub
        // pages + 7 runtime probes in parallel on cache-miss only.
        const payload = await swrJson(ctx, env, 'cache:updates', 1800000, () => produceUpdates(env));
        return new Response(payload, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }

      // DELETE endpoints
      if (request.method === 'DELETE') {
        if (path.startsWith('/api/sessions/')) {
          const uuid = path.split('/')[3];
          const r = await authentikFetch(env, sess.at, `/api/v3/core/authenticated_sessions/${uuid}/`, { method: 'DELETE' });
          await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify({ t: Date.now(), event: 'session_revoked', target: uuid }));
          return json({ ok: r.ok }, r.status);
        }
        if (path.startsWith('/api/devices/')) {
          const [kind, pk] = path.split('/').slice(3);
          const map: Record<string, string> = { totp: 'totp', webauthn: 'webauthn', static: 'static' };
          if (!map[kind]) return json({ error: 'bad device type' }, 400);
          const r = await authentikFetch(env, sess.at, `/api/v3/authenticators/${map[kind]}/${pk}/`, { method: 'DELETE' });
          await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify({ t: Date.now(), event: 'device_removed', target: kind + ':' + pk }));
          return json({ ok: r.ok }, r.status);
        }
        if (path.startsWith('/api/consents/')) {
          const id = path.split('/')[3];
          const r = await authentikFetch(env, sess.at, `/api/v3/core/user_consent/${id}/`, { method: 'DELETE' });
          await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify({ t: Date.now(), event: 'consent_revoked', target: id }));
          return json({ ok: r.ok }, r.status);
        }
        if (path.startsWith('/api/devices/totp/')) {
          const id = path.split('/')[4];
          const r = await authentikFetch(env, sess.at, `/api/v3/authenticators/totp/${id}/`, { method: 'DELETE' });
          await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify({ t: Date.now(), event: 'totp_removed', target: id }));
          return json({ ok: r.ok }, r.status);
        }
        if (path.startsWith('/api/devices/webauthn/')) {
          const id = path.split('/')[4];
          const r = await authentikFetch(env, sess.at, `/api/v3/authenticators/webauthn/${id}/`, { method: 'DELETE' });
          await env.SESSIONS.put(`audit:${sess.sub}:${Date.now()}`, JSON.stringify({ t: Date.now(), event: 'passkey_removed', target: id }));
          return json({ ok: r.ok }, r.status);
        }
      }

      return json({ error: 'not found' }, 404);
    }

    // ---------- static ----------
    if (path === '/' || path === '/index.html') {
      return env.ASSETS.fetch(new URL('/', request.url));
    }
    // Real asset files (site.webmanifest, icons) — fall through to the assets
    // binding before 404ing. run_worker_first sends everything here first.
    const asset = await env.ASSETS.fetch(new URL(path, request.url));
    if (asset.status !== 404) {
      // Immutable versioned assets get long-lived caching (fonts/icons/manifest)
      if (/\.(woff2|svg|png|webp)$/.test(path)) {
        const h = new Headers(asset.headers);
        h.set('cache-control', 'public, max-age=31536000, immutable');
        return new Response(asset.body, { status: asset.status, headers: h });
      }
      return asset;
    }
    return new Response('Not found', { status: 404 });
  },
};

