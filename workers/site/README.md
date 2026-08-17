# Site Worker — The MySweetPea Website

This is the main website worker: it serves the static site, enforces a strict
security policy, and proxies a few API calls. No framework, no build step —
plain HTML/CSS/JS served from Cloudflare's edge.

## What it does

1. **Serves static assets** — all pages, CSS, JS, fonts, and images from the
   `workers/site/` directory via Workers Assets.
2. **Enforces security headers** — a strict Content-Security-Policy with
   per-request nonces, plus hardened headers on every response (see the
   [main README](../../README.md#security) for the full list).
3. **Injects metadata** — per-page canonical links and JSON-LD `Organization`
   schema.
4. **Handles 404s** — unknown HTML routes get the custom `404.html`.
5. **Proxies `/api/commits`** — fetches recent GitHub commits for the
   changelog page (token stays server-side, 5-min cache).

## How the CSP works

The worker generates a **random nonce per request** and injects it into every
`<script>` tag in the HTML:

- `script-src 'self' 'nonce-<random>'` — scripts must carry the nonce; no
  `unsafe-inline`.
- `style-src 'self' 'unsafe-inline'` — styles use `unsafe-inline` **without**
  a nonce (per CSP spec, `unsafe-inline` is ignored when a nonce is present
  in the same source list, so the two must not be mixed).

Because the HTML is dynamic (nonce per request), the worker sets
`Cache-Control: no-store` and strips `If-None-Match`/`If-Modified-Since`
before `env.ASSETS.fetch` — otherwise edge caching would serve stale nonces
and break the CSP.

## Key files

| File | Role |
|------|------|
| `src/index.js` | The worker: nonce generation, CSP, headers, 404, `/api/commits` proxy |
| `wrangler.jsonc` | Worker config (routes, assets binding) |
| `sw.js` | Service worker (stale-while-revalidate, v22) |
| `manifest.json` | PWA manifest (installable, shortcuts, maskable icon) |
| `_partials/` | Shared nav/footer HTML fragments |
| `assets/` | CSS, JS, fonts, icons, mockups, videos |

## Deployment

```bash
cd workers/site
wrangler deploy
```

The worker deploys automatically via the repo's Cloudflare Git integration on
push. Static asset changes (HTML/CSS/JS) are served directly from the repo;
changes to `src/index.js` require a `wrangler deploy` to take effect.

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Landing page |
| `pricing.html` | Tiers, services grid, per-service modals, FAQ |
| `form.html` | Get Access ($5 donation) + Redeem Invite Code tabs |
| `redeem.html` | Invite-code redemption |
| `suggest.html` | Service suggestion form |
| `support.html` | Anonymous crypto donation page |
| `about.html` | Mission, self-hosting rationale, costs, open source |
| `status.html` | Live status + incidents (Uptime Kuma + n8n) |
| `changelog.html` | GitHub commits feed |
| `contact.html` | Contact + "before you write" checklist |
| `success.html` / `error.html` / `404.html` | Confirmation / error / not-found |
