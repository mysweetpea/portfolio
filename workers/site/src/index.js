/* MySweetPea — Cloudflare Worker
   Serves the static site with strict CSP (per-request nonces), security headers,
   Matrix federation well-known, GitHub commits proxy, and 404 handling. */

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'X-DNS-Prefetch-Control': 'off'
};

// CORP is applied per-response-type: HTML gets 'same-origin' (blocks
// cross-origin embedding of the site itself), while public assets
// (logo.svg, icons, fonts, images) get 'cross-origin' so other origins
// (auth.mysweetpea.cc, email clients) can embed them. A blanket
// 'same-origin' broke the Authentik login logo (naturalWidth 0).
function corpFor(contentType) {
  return contentType.includes('text/html') ? 'same-origin' : 'cross-origin';
}

// Generate a base64url-safe nonce (16 bytes → 22 chars)
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Build the strict CSP for a fresh nonce (shared by normal pages and 404s)
function buildCsp(nonce) {
  return [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' https://subscribe.mysweetpea.cc https://status.mysweetpea.cc",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://subscribe.mysweetpea.cc",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join('; ');
}

// Inject nonce into all <script> and <style> tags in the HTML body
function injectNonces(text, nonce) {
  return text
    .replace(/<script(?![^>]*nonce=)/g, '<script nonce="' + nonce + '"')
    .replace(/<style(?![^>]*nonce=)/g, '<style nonce="' + nonce + '"');
}

// In-memory cache for /api/commits (survives across requests within an isolate)
let commitsCache = { data: null, ts: 0 };
const COMMITS_TTL = 300_000; // 5 minutes in ms

// Portal identity: replace the static "Sign in" link with a live account
// chip + inline popup on EVERY page (serve-time transform, one place).
// Applied to all HTML responses (pages and the branded 404 alike).
function navAccountMarkup(nonce) {
  const person =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>';
  const popOut =
    '<a class="nap-primary" href="https://dashboard.mysweetpea.cc/auth/login">Dashboard</a>' +
    '<a href="https://dashboard.mysweetpea.cc/#account">My account</a>' +
    '<a href="/status.html">Status</a>' +
    '<a href="/contact.html">Contact</a>';
  const css =
    '<style>.nav-account{position:relative;display:inline-flex;align-items:center}' +
    '.nav-account-chip{display:inline-flex;align-items:center;gap:7px}' +
    '.nav-account-pop[hidden]{display:none!important}.nav-account-pop{position:absolute;top:calc(100% + 10px);right:0;min-width:216px;max-width:calc(100vw - 24px);background:rgba(12,19,22,.94);backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);border:1px solid rgba(143,175,181,.18);border-radius:14px;padding:8px;display:flex;flex-direction:column;gap:2px;box-shadow:0 12px 40px rgba(0,0,0,.45);z-index:80}' +
    '.nav-account-pop a{display:block;padding:9px 12px;border-radius:10px;color:#A9BEC2;font-size:.88rem;text-decoration:none;transition:background .2s,color .2s}' +
    '.nav-account-pop a:hover{background:rgba(143,175,181,.12);color:#C5D5D8}' +
    '.nav-account-pop a.nap-primary{background:linear-gradient(135deg,#8FAFB5,#6B9AA6);color:#0C1316;font-weight:600;text-align:center;margin-bottom:4px}' +
    '.nav-account-pop a.nap-primary:hover{background:linear-gradient(135deg,#C5D5D8,#8FAFB5);color:#0C1316}' +
    '@media (max-width:768px){.nav-account-pop{position:absolute;right:0}}</style>';
  const js =
    '<script nonce="' + nonce + '">' +
    '(function(){"use strict";' +
    'var chip=document.getElementById("nav-account-chip"),pop=document.getElementById("nav-account-pop"),label=document.getElementById("nav-account-label");' +
    'if(!chip||!pop)return;' +
    'function close(){pop.hidden=true;chip.setAttribute("aria-expanded","false")}' +
    'function open(){pop.hidden=false;chip.setAttribute("aria-expanded","true")}' +
    'chip.addEventListener("click",function(e){e.stopPropagation();pop.hidden?open():close()});' +
    'document.addEventListener("click",function(e){if(!pop.hidden&&e.target!==chip&&!pop.contains(e.target)&&!chip.contains(e.target))close()});' +
    'document.addEventListener("keydown",function(e){if(e.key==="Escape")close()});' +
    'var dash="https://dashboard.mysweetpea.cc";' +
    'fetch("/api/auth/state?name=1",{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(s){' +
    'if(!s||!s.logged_in)return;' +
    'var first=String(s.name||"").trim().split(/\\s+/)[0];' +
    'label.textContent=first||"Account";' +
    'pop.innerHTML=\'<a class="nap-primary" href="\'+dash+\'">Open dashboard</a>\';' +
    '}).catch(function(){});' +
    '})();</' + 'script>';
  return '<div class="nav-account" id="nav-account">' +
    '<button type="button" class="nav-btn nav-signin nav-account-chip" id="nav-account-chip" aria-expanded="false" aria-controls="nav-account-pop" aria-haspopup="true">' +
    person + '<span id="nav-account-label">Sign in</span></button>' +
    '<div class="nav-account-pop" id="nav-account-pop" hidden>' + popOut + '</div></div>' +
    css + js;
}

const NAV_SIGNIN_LINK = '<a href="https://dashboard.mysweetpea.cc" class="nav-btn nav-signin">Sign in</a>';

function injectNavAccount(html, nonce) {
  if (html.indexOf(NAV_SIGNIN_LINK) === -1) return html;
  return html.replace(NAV_SIGNIN_LINK, navAccountMarkup(nonce));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- Proxy GitHub commits for the changelog (token stays server-side) ---
    if (url.pathname === '/api/commits') {
      const now = Date.now();
      if (commitsCache.data && (now - commitsCache.ts) < COMMITS_TTL) {
        return new Response(JSON.stringify(commitsCache.data), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            'X-Cache': 'HIT'
          }
        });
      }

      const token = env.GITHUB_TOKEN || '';
      const repos = ['mysweetpea/portfolio', 'mysweetpea/homelab-k8s'];
      const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'mysweetpea-site'
      };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const results = await Promise.all(repos.map(async (repo) => {
        try {
          const res = await fetch('https://api.github.com/repos/' + repo + '/commits?per_page=10', { headers });
          if (!res.ok) return [];
          const data = await res.json();
          return data.map((c) => ({
            repo: repo.split('/')[1],
            sha: c.sha.slice(0, 7),
            message: (c.commit && c.commit.message || '').split('\n')[0],
            date: c.commit && c.commit.author && c.commit.author.date
          }));
        } catch (e) {
          return [];
        }
      }));

      const all = results.flat().sort((a, b) => new Date(b.date) - new Date(a.date));
      // Don't cache empty results: a transient GitHub failure would otherwise
      // blank the changelog for the whole TTL.
      if (all.length > 0) {
        commitsCache = { data: all, ts: now };
      }

      return new Response(JSON.stringify(all), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'X-Cache': 'MISS'
        }
      });
    }

    // --- Portal identity: proxy auth state from the dashboard worker ---
    // Forwards the incoming Cookie header verbatim so the dashboard can
    // resolve the session; Set-Cookie is intentionally not passed through.
    // Browser headers ride along so the dashboard's WAF lets the fetch through.
    
    // --- Suggest-a-Service: authenticated proxy to the n8n webhook ---
    // Only signed-in members may submit; anonymous traffic is rejected here so the
    // upstream webhook is never exposed to the public.
    if (url.pathname === '/api/suggest') {
      if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
      const state = await (async () => {
        const fwd = {};
        const cookie = request.headers.get('Cookie');
        const ua = request.headers.get('User-Agent');
        if (cookie) fwd['Cookie'] = cookie;
        if (ua) fwd['User-Agent'] = ua;
        try { return await (await fetch('https://dashboard.mysweetpea.cc/api/auth/state', { headers: fwd })).json(); }
        catch { return { logged_in: false }; }
      })();
      if (!state.logged_in) return new Response(JSON.stringify({ error: 'sign_in_required' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      let payload;
      try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
      // Sanitize: only known fields, bounded lengths
      const clean = {
        service_name: String(payload.service_name || '').slice(0, 120),
        project_url: String(payload.project_url || '').slice(0, 300),
        category: String(payload.category || '').slice(0, 60),
        reason: String(payload.reason || '').slice(0, 2000),
        your_name: state.name || String(payload.your_name || '').slice(0, 120),
        your_email: String(payload.your_email || '').slice(0, 200)
      };
      if (!clean.service_name || !clean.category || !clean.reason) return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      const upstream = await fetch('https://subscribe.mysweetpea.cc/webhook/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clean)
      });
      return new Response(JSON.stringify({ ok: upstream.ok }), {
        status: upstream.ok ? 200 : 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    if (url.pathname === '/api/auth/state') {
      const fwd = {};
      const cookie = request.headers.get('Cookie');
      const ua = request.headers.get('User-Agent');
      const accept = request.headers.get('Accept');
      const lang = request.headers.get('Accept-Language');
      if (cookie) fwd['Cookie'] = cookie;
      if (ua) fwd['User-Agent'] = ua;
      if (accept) fwd['Accept'] = accept;
      if (lang) fwd['Accept-Language'] = lang;
      let upstream;
      try {
        upstream = await fetch('https://dashboard.mysweetpea.cc/api/auth/state' + (url.search || ''), { headers: fwd });
      } catch (e) {
        return new Response(JSON.stringify({ logged_in: false, error: 'upstream_unreachable' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
      }
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    // --- Matrix federation well-known ---
    if (url.pathname === '/.well-known/matrix/server') {
      return new Response(JSON.stringify({
        'm.server': 'matrix.mysweetpea.cc:443'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/.well-known/matrix/client') {
      return new Response(JSON.stringify({
        'm.homeserver': { 'base_url': 'https://matrix.mysweetpea.cc' }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // --- Serve static site ---
    // Strip conditional headers (If-None-Match / If-Modified-Since) before
    // hitting ASSETS: the binding's ETag describes the STATIC file, but HTML
    // bodies are rewritten per-request (nonce injection). Passing conditionals
    // through lets edge nodes revalidate to a 304 (no Content-Type → the HTML
    // branch below is skipped) and keep serving pre-rewrite HTML forever.
    const freshHeaders = new Headers(request.headers);
    freshHeaders.delete('If-None-Match');
    freshHeaders.delete('If-Modified-Since');
    const res = await env.ASSETS.fetch(new Request(request, { headers: freshHeaders }));
    const contentType = res.headers.get('Content-Type') || '';

    // Handle 404: serve 404.html for unknown HTML routes (both extensionless
    // and .html paths — a dot in the path used to mean "asset", but .html
    // pages are HTML too and deserve the branded 404, not an empty body)
    const isHtmlPath = !url.pathname.includes('.') || url.pathname.endsWith('.html');
    if (res.status === 404 && isHtmlPath) {
      const notFoundRes = await env.ASSETS.fetch(new Request('https://dummy.local/404.html'));
      if (notFoundRes.ok) {
        const body = await notFoundRes.text();
        const nonce = generateNonce();
        const out = new Response(injectNavAccount(injectNonces(body, nonce), nonce), {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache'
          }
        });
        Object.entries(securityHeaders).forEach(([k, v]) => out.headers.set(k, v));
        out.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        out.headers.set('Content-Security-Policy', buildCsp(nonce));
        return out;
      }
    }

    // Apply security headers to every response
    const out = new Response(res.body, res);
    Object.entries(securityHeaders).forEach(([k, v]) => out.headers.set(k, v));
    out.headers.set('Cross-Origin-Resource-Policy', corpFor(contentType));

    // Apply strict CSP with nonce to HTML responses
    if (contentType.includes('text/html')) {
      const nonce = generateNonce();

      // HTML is DYNAMIC (per-request nonce) — never edge-cache it. The ASSETS
      // binding's ETag/max-age=0 headers describe the static file, not this
      // rewritten body; keeping them lets Cloudflare serve stale HTML with
      // old nonces from other edge nodes. no-store fixes that permanently.
      out.headers.set('Cache-Control', 'no-store');
      out.headers.delete('ETag');
      out.headers.delete('Last-Modified');

      // Build CSP — scripts require the nonce (no unsafe-inline). Styles use
      // 'unsafe-inline' WITHOUT a nonce: per CSP spec, 'unsafe-inline' is
      // ignored when a nonce/hash is present in the same source list, and the
      // pages rely on inline style="" attributes (static widths, JS-set
      // transforms). The <style> blocks are static, worker-served content.
      const csp = buildCsp(nonce);

      out.headers.set('Content-Security-Policy', csp);

      // Inject nonce into all <script> and <style> tags in the HTML body
      const text = await out.text();
      let injected = injectNonces(text, nonce);

      // Inject canonical URL + JSON-LD Organization schema into <head>
      const page = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
      const canonical = 'https://mysweetpea.cc/' + (page === 'index.html' ? '' : page);
      const jsonLd = '<script type="application/ld+json" nonce="' + nonce + '">' +
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          'name': 'MySweetPea',
          'url': 'https://mysweetpea.cc',
          'logo': 'https://mysweetpea.cc/logo.png',
          'description': 'Private, self-hosted alternatives to the services you use every day. No ads, no tracking, no subscriptions — community funded.',
          'email': 'support@mysweetpea.cc',
          'sameAs': ['https://github.com/mysweetpea']
        }) + '</script>';
      const headInject = '<link rel="canonical" href="' + canonical + '">' + jsonLd;
      injected = injected.replace('</head>', headInject + '</head>');

      // Live account chip on every page (replaces the static Sign in link)
      injected = injectNavAccount(injected, nonce);

      return new Response(injected, {
        status: out.status,
        statusText: out.statusText,
        headers: out.headers
      });
    }

    return out;
  }
};