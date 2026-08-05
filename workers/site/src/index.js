const NAV_PARTIAL = '/_partials/nav.html';
const FOOTER_PARTIAL = '/_partials/footer.html';

async function getPartial(env, path) {
  try {
    const res = await env.ASSETS.fetch(new Request('https://placeholder.invalid' + path));
    if (res.ok) return await res.text();
  } catch (e) { /* fall through */ }
  return null;
}

/* Mark the nav link matching the current path as active (aria-current="page"). */
function markActiveNav(navHtml, pathname) {
  const clean = pathname.replace(/\/$/, '') || '/index.html';
  // Map "/" and "/index.html" to the home link; otherwise match the .html path.
  let target;
  if (clean === '/' || clean === '/index.html') target = '/index.html';
  else target = clean.endsWith('.html') ? clean : clean + '.html';
  // Add aria-current to the matching <a href="..."> in the nav.
  return navHtml.replace(
    new RegExp('(<a[^>]+href="' + target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*)>', 'g'),
    '$1 aria-current="page">'
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Matrix federation well-known
    if (url.pathname === '/.well-known/matrix/server') {
      return new Response(JSON.stringify({
        "m.server": "matrix.mysweetpea.cc:443"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/.well-known/matrix/client') {
      return new Response(JSON.stringify({
        "m.homeserver": { "base_url": "https://matrix.mysweetpea.cc" }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Serve static site
    const res = await env.ASSETS.fetch(request);
    const contentType = res.headers.get('Content-Type') || '';

    // Security headers applied to every response (privacy-first brand signal)
    const securityHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
    };

    if (!contentType.includes('text/html')) {
      // Non-HTML: apply security headers and return as-is
      const out = new Response(res.body, res);
      Object.entries(securityHeaders).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }

    // Inject shared nav + footer into HTML pages (single source of truth).
    const [nav, footer] = await Promise.all([
      getPartial(env, NAV_PARTIAL),
      getPartial(env, FOOTER_PARTIAL)
    ]);

    let html = await res.text();
    let injected = false;

    if (nav) {
      const activeNav = markActiveNav(nav, url.pathname);
      if (html.includes('<!-- NAV -->')) {
        html = html.replace('<!-- NAV -->', activeNav);
        injected = true;
      }
    }
    if (footer && html.includes('<!-- FOOTER -->')) {
      html = html.replace('<!-- FOOTER -->', footer);
      injected = true;
    }

    if (!injected) {
      // No placeholders found — return the original response with security headers.
      const out = new Response(res.body, res);
      Object.entries(securityHeaders).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }

    // CSP allows our own assets, Google Fonts, and the QR CDN (if still used).
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' https://subscribe.mysweetpea.cc",
      "frame-ancestors 'none'"
    ].join('; ');

    return new Response(html, {
      status: res.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        ...securityHeaders,
        'Content-Security-Policy': csp
      }
    });
  }
};
