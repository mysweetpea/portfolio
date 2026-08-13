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
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off'
};

// Generate a base64url-safe nonce (16 bytes → 22 chars)
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// In-memory cache for /api/commits (survives across requests within an isolate)
let commitsCache = { data: null, ts: 0 };
const COMMITS_TTL = 300_000; // 5 minutes in ms

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
      commitsCache = { data: all, ts: now };

      return new Response(JSON.stringify(all), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'X-Cache': 'MISS'
        }
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

    // Handle 404: serve 404.html for unknown HTML routes
    if (res.status === 404 && !url.pathname.includes('.')) {
      const notFoundRes = await env.ASSETS.fetch(new Request('https://dummy.local/404.html'));
      if (notFoundRes.ok) {
        const body = await notFoundRes.text();
        const out = new Response(body, {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache'
          }
        });
        Object.entries(securityHeaders).forEach(([k, v]) => out.headers.set(k, v));
        return out;
      }
    }

    // Apply security headers to every response
    const out = new Response(res.body, res);
    Object.entries(securityHeaders).forEach(([k, v]) => out.headers.set(k, v));

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
      const csp = [
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

      out.headers.set('Content-Security-Policy', csp);

      // Inject nonce into all <script> and <style> tags in the HTML body
      const text = await out.text();
      let injected = text
        .replace(/<script(?![^>]*nonce=)/g, '<script nonce="' + nonce + '"')
        .replace(/<style(?![^>]*nonce=)/g, '<style nonce="' + nonce + '"');

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

      return new Response(injected, {
        status: out.status,
        statusText: out.statusText,
        headers: out.headers
      });
    }

    return out;
  }
};