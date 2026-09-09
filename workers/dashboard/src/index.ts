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
  return { ...sess, at: t.access_token, rt: t.refresh_token ?? sess.rt };
}

async function requireSession(request: Request, env: Env): Promise<{ sess: SessionData; sid: string } | Response> {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
  if (!m) return json({ error: 'unauthorized' }, 401);
  const sid = m[1];
  const raw = await env.SESSIONS.get(`sess:${sid}`);
  if (!raw) return json({ error: 'unauthorized' }, 401);
  const sess = JSON.parse(raw) as SessionData;
  // opportunistically refresh if older than 10 minutes
  if (Date.now() - sess.created > 10 * 60 * 1000) {
    const fresh = await refreshSession(env, sess);
    if (fresh) {
      await env.SESSIONS.put(`sess:${sid}`, JSON.stringify(fresh), { expirationTtl: 86400 });
      return { sess: fresh, sid };
    }
  }
  return { sess, sid };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const res = await this.handle(request, env);
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

  async handle(request: Request, env: Env): Promise<Response> {
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
      headers.append('set-cookie', `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (path === '/auth/logout') {
      const cookie = request.headers.get('cookie') || '';
      const m = cookie.match(new RegExp(`${COOKIE}=([a-zA-Z0-9_-]+)`));
      if (m) await env.SESSIONS.delete(`sess:${m[1]}`);
      const headers = new Headers({ location: '/' });
      headers.append('set-cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; Max-Age=0`);
      return new Response(null, { status: 302, headers });
    }

    // ---------- API ----------
    if (path.startsWith('/api/')) {
      const auth = await requireSession(request, env);
      if (auth instanceof Response) return auth;
      const { sess, sid } = auth;

      if (path === '/api/me') {
        const r = await authentikFetch(env, sess.at, '/api/v3/core/users/me/');
        const d = await r.json() as any;
        const user = d && d.user ? d.user : d;
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
        return json(user, r.status);
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
        let bin: string;
        try { bin = atob(body.data); } catch { return json({ error: 'Invalid image data' }, 400); }
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
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
        // /core/users/{id}/ takes the NUMERIC pk (404 on uuid) — resolve+cache it.
        let upk = parseInt((await env.SESSIONS.get(`upk:${sess.sub}`)) || '', 10);
        if (!upk) {
          const lookup = await authentikFetch(env, env.AUTHENTIK_ADMIN_TOKEN, `/api/v3/core/users/?uuid=${sess.sub}`);
          if (lookup.ok) {
            const arr = (await lookup.json() as { results?: { pk?: number }[] }).results || [];
            if (arr[0]?.pk) { upk = arr[0].pk; await env.SESSIONS.put(`upk:${sess.sub}`, String(upk), { expirationTtl: 86400 * 30 }); }
          }
        }
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
        return json({ ok: true, name: updates.name ?? sess.name, email: updates.email ?? sess.email });
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
        const cache = await env.SESSIONS.get('cache:stats');
        if (cache) return json(JSON.parse(cache));
        const stat = async (): Promise<string> => {
          const out: Record<string, number | null> = { movies: null, series: null, photos: null, sessions: null };
          await Promise.all([
            (async () => {
              try {
                const r = await fetch(env.JELLYFIN_URL + '/Items/Counts', { headers: { 'x-emby-token': env.JELLYFIN_API_KEY } });
                if (r.ok) { const d = await r.json() as any; out.movies = d.MovieCount ?? null; out.series = d.SeriesCount ?? null; }
              } catch {}
            })(),
            (async () => {
              try {
                const r = await fetch(env.IMMICH_URL + '/api/server/statistics', { headers: { 'x-api-key': env.IMMICH_API_KEY } });
                if (r.ok) { const d = await r.json() as any; out.photos = (d.photos ?? 0) + (d.videos ?? 0); }
              } catch {}
            })(),
            (async () => {
              try {
                const s = await authentikFetch(env, sess.at, '/api/v3/core/authenticated_sessions/');
                if (s.ok) { const d = await s.json() as any; out.sessions = (d.results ?? []).length; }
              } catch {}
            })(),
          ]);
          return JSON.stringify(out);
        };
        const payload = await stat();
        await env.SESSIONS.put('cache:stats', payload, { expirationTtl: 300 });
        return new Response(payload, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      if (path === '/api/media/continue') {
        const cache = await env.SESSIONS.get('cache:media-cont');
        if (cache) return json(JSON.parse(cache));
        try {
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
          const payload = JSON.stringify({ items });
          await env.SESSIONS.put('cache:media-cont', payload, { expirationTtl: 120 });
          return json({ items });
        } catch {
          return json({ items: [] });
        }
      }
      if (path === '/api/media/latest') {
        const cache = await env.SESSIONS.get('cache:media-latest');
        if (cache) return json(JSON.parse(cache));
        try {
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
          const payload = JSON.stringify({ items });
          await env.SESSIONS.put('cache:media-latest', payload, { expirationTtl: 300 });
          return json({ items });
        } catch {
          return json({ items: [] });
        }
      }
      if (path === '/api/status') {
        const cache = await env.SESSIONS.get('cache:kuma');
        if (cache) return json(JSON.parse(cache));
        const r = await fetch(env.KUMA_STATUS_URL, { headers: { 'user-agent': 'Mozilla/5.0' } });
        const d = await r.json();
        await env.SESSIONS.put('cache:kuma', JSON.stringify(d), { expirationTtl: 30 });
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
    if (asset.status !== 404) return asset;
    return new Response('Not found', { status: 404 });
  },
};

