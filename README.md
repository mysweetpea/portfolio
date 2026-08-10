# MySweetPea Website

Static marketing and signup site for **MySweetPea** — privacy-first, self-hosted,
community-funded services. No build step, no framework: plain HTML/CSS/JS served
as static files through a Cloudflare Worker.

**Live:** https://mysweetpea.cc
**Infrastructure:** https://github.com/mysweetpea/homelab-k8s

---

## Stack

| Layer | Tech |
|-------|------|
| Hosting | Cloudflare Worker + Workers Assets |
| Frontend | Vanilla HTML / CSS / JS (no framework, no build step) |
| Fonts | Self-hosted Inter + Fraunces (variable, `font-display: swap`) |
| PWA | `manifest.json` + service worker (`sw.js`) |
| Backend | n8n webhooks at `https://subscribe.mysweetpea.cc/webhook/*` |
| Status | Uptime Kuma at `https://status.mysweetpea.cc` |

---

## File structure

```
workers/site/
├── index.html          # Landing page
├── pricing.html        # Tiers, services grid, per-service modals, FAQ
├── form.html           # Get Access ($5 donation) + Redeem Invite Code tabs
├── redeem.html         # Invite-code redemption
├── suggest.html        # Service suggestion form
├── support.html        # Anonymous crypto donation page
├── about.html          # Mission, self-hosting rationale, costs, open source
├── status.html         # Live status + incidents (Uptime Kuma + n8n)
├── changelog.html      # GitHub commits feed (portfolio + homelab-k8s)
├── contact.html        # Contact + "before you write" checklist
├── success.html        # Confirmation page (?type=donation|redeem|sweetpea-request)
├── error.html          # Generic error page
├── 404.html            # Not-found page
├── manifest.json       # PWA manifest (installable, shortcuts, maskable icon)
├── sw.js               # Service worker (stale-while-revalidate, v8)
├── robots.txt          # Search engines allowed, AI crawlers blocked
├── sitemap.xml         # SEO sitemap
├── src/index.js        # Cloudflare Worker: CSP nonces, security headers,
│                       #   canonical/JSON-LD injection, 404, /api/commits proxy
├── assets/
│   ├── css/site.css    # Shared theme: tokens, nav, footer, animations, petals
│   ├── css/fonts.css   # @font-face declarations
│   ├── js/site.js      # Petals, scroll progress, reveal, glow cards, Ctrl+K palette
│   └── icons/          # Service + UI icons (SVG)
└── wrangler.jsonc      # Worker config (routes, assets)
```

---

## Backend integration

The site is static, but several pages POST to webhooks at
`https://subscribe.mysweetpea.cc/webhook`:

| Page | Endpoint | Purpose |
|------|----------|---------|
| form.html | `/webhook/donation-request` | $5 donation access request |
| form.html | `/webhook/check-code` | Live invite-code validation |
| form.html | `/webhook/redeem-code` | Account creation from invite |
| suggest.html | `/webhook/suggest` | Service suggestion submission |
| status.html | `/webhook/incidents` (GET) | Active incidents feed |

Expected responses are JSON: `{ "ok": true }` on success, or
`{ "ok": false, "msg": "..." }` on failure (msg is shown on the button).

After successful submissions the user is redirected to
`/success.html?type=donation`, `/success.html?type=redeem`, or
`/success.html?type=sweetpea-request`. The success page reads the `type`
param and shows the appropriate message and next-steps list.

---

## Security

The Cloudflare Worker (`src/index.js`) enforces a **strict Content-Security-Policy**
with **per-request nonces** — `'unsafe-inline'` is **not** used for scripts or styles:

- `script-src 'self' 'nonce-<random>'`
- `style-src 'self' 'nonce-<random>'`
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self' https://subscribe.mysweetpea.cc`
- `frame-ancestors 'none'`, `upgrade-insecure-requests`

Additional headers set on every response:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (camera/mic/geolocation/payment/usb disabled)
- `Strict-Transport-Security` (2-year, preload)
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`
- `Cross-Origin-Resource-Policy: same-origin`

The Worker also:
- Injects a per-page `<link rel="canonical">` + JSON-LD `Organization` schema
- Serves `404.html` for unknown HTML routes
- Proxies `/api/commits` to GitHub (token stays server-side, 5-min cache)

> **Note:** The Worker must be redeployed (`wrangler deploy`) after any change to
> `src/index.js` for header/nonce changes to take effect. Static asset changes
> (HTML/CSS/JS) are served directly from the repo.

---

## Deployment

```bash
cd workers/site
wrangler deploy
```

The Worker serves the directory as static assets and applies security headers.
For 404 handling, the Worker intercepts unknown HTML routes and returns `404.html`.

---

## Design system

Shared tokens are defined in `assets/css/site.css`:

- `--primary` (#8FAFB5) nordic teal, `--sage` (#A3C9B6) stem sage accents
- Dark background (#0C1316) with glassmorphic cards (blur + transparency)
- `glass-text` shimmer headings, floating petals canvas, glow-on-hover cards
- Dark/light theme toggle (persisted in `localStorage`)
- Animations respect `prefers-reduced-motion`

Page-specific styles live in the shared `site.css` scoped via `body[data-page]`.

---

## Accessibility

- Skip-to-content link and semantic landmarks on every page
- Keyboard-accessible service cards, crypto selectors, tabs, and modal
- Focus-visible outlines; decorative elements are `aria-hidden`
- `noindex` on success and 404 pages
- Command palette (Ctrl+K) for keyboard-first navigation

---

## Wallet addresses

Crypto wallet addresses live in a `WALLETS` object in the inline script of
`form.html` and `support.html`:

```js
var WALLETS = { monero: 'Coming Soon', bitcoin: 'Coming Soon' };
```

Replace both values (in both files) when real addresses are available.

---

## License / contact

Questions: support@mysweetpea.cc
Infrastructure code: https://github.com/mysweetpea/homelab-k8s
This site: https://github.com/mysweetpea/portfolio
