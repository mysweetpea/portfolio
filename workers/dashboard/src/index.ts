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
    const url = new URL(request.url);
    const path = url.pathname;

    // ---------- auth ----------
    if (path === '/auth/login') {
      const state = randomB64u(16);
      const verifier = randomB64u(64);
      const challenge = b64uEncode(await sha256(verifier));
      const redirect = new URL('/auth/callback', env.APP_URL).toString();
      const authorizeUrl = new URL(`${env.AUTH_ISSUER}/authorize/`);
      authorizeUrl.searchParams.set('client_id', env.AUTHENTIK_CLIENT_ID);
      authorizeUrl.searchParams.set('redirect_uri', redirect);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', SCOPES);
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('code_challenge', challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      const res = Response.redirect(authorizeUrl.toString(), 302);
      const headers = new Headers(res.headers);
      headers.append('set-cookie', `msp_pkce=${state}.${verifier}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
      return new Response(null, { status: 302, headers });
    }

    if (path === '/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookie = request.headers.get('cookie') || '';
      const m = cookie.match(/msp_pkce=([^.]+)\.([a-zA-Z0-9_-]+)/);
      if (!code || !state || !m || m[1] !== state) {
        return new Response('Invalid OAuth state', { status: 400 });
      }
      const verifier = m[2];
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

      const headers = new Headers({ location: '/' });
      headers.append('set-cookie', `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
      headers.append('set-cookie', 'msp_pkce=; Path=/auth; HttpOnly; Secure; Max-Age=0');
      return new Response(null, { status: 302, headers });
    }

    // Popup ceremony: deep-link into an authentik-hosted setup flow with
    // a return-to-dashboard next. The user's authentik browser session runs
    // the ceremony (stock-supported path); completion lands back on /.
    if (path === '/auth/ceremony') {
      const flow = url.searchParams.get('f') || '';
      if (!/^[a-z0-9-]+$/.test(flow)) return new Response('Bad flow', { status: 400 });
      const next = encodeURIComponent(env.APP_URL + '/');
      return Response.redirect(`${env.AUTH_BASE}/if/flow/${flow}/?next=${next}`, 302);
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
      const { sess } = auth;

      if (path === '/api/me') {
        const r = await authentikFetch(env, sess.at, '/api/v3/core/users/me/');
        const d = await r.json();
        return json(d.user ?? d, r.status);
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
    return new Response('Not found', { status: 404 });
  },
};

