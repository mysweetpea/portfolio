/* MySweetPea — Cloudflare Worker
   Serves the static site with security headers and Matrix federation well-known.
   Nav/footer are now inlined directly into each HTML page (no injection needed). */

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
};

// CSP allows only our own assets (fonts + QR are self-hosted).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://subscribe.mysweetpea.cc",
  "frame-ancestors 'none'"
].join('; ');

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

    // Apply security headers to every response
    const out = new Response(res.body, res);
    Object.entries(securityHeaders).forEach(([k, v]) => out.headers.set(k, v));

    // Add CSP to HTML responses
    if (contentType.includes('text/html')) {
      out.headers.set('Content-Security-Policy', csp);
    }

    return out;
  }
};
