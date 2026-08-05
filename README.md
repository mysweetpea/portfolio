# MySweetPea Website

Static marketing and signup site for MySweetPea — privacy-first, self-hosted,
community-funded services. No build step, no framework: plain HTML/CSS/JS
deployed as static files.

## File structure

/
├── index.html          # Landing page
├── pricing.html        # Tiers, services grid, per-service modals, FAQ
├── form.html           # Get Access ($5 donation) + Redeem Invite Code tabs
├── suggest.html        # Service suggestion form
├── support.html        # Anonymous crypto donation page
├── about.html          # Mission, self-hosting rationale, costs, open source
├── success.html        # Confirmation page (adapts via ?type=donation|redeem|sweetpea-request)
├── error.html          # Generic "something went wrong" page
├── 404.html            # Not-found page (wire up as server 404 handler)
├── manifest.json       # PWA manifest (installable)
├── apple-touch-icon.png # iOS home-screen icon
├── icon-192.png        # PWA icon (192px)
├── icon-512.png        # PWA icon (512px)
├── logo.svg            # Full logo
├── logo-favicon.svg    # Favicon
└── assets/
    ├── css/site.css    # Shared theme: tokens, nav, footer, animations, petals
    └── js/site.js      # Petal canvas, scroll progress, reveal-on-scroll, glow cards

## Backend integration

The site is static, but three pages POST to webhooks at
`https://subscribe.mysweetpea.cc/webhook`:

| Page         | Endpoint                      | Purpose                          |
|--------------|-------------------------------|----------------------------------|
| form.html    | /webhook/donation-request     | $5 donation access request       |
| form.html    | /webhook/check-code           | Live invite-code validation      |
| form.html    | /webhook/redeem-code          | Account creation from invite     |
| suggest.html | /webhook/suggest              | Service suggestion submission    |

Expected responses are JSON: `{ "ok": true }` on success, or
`{ "ok": false, "msg": "..." }` on failure (msg is shown on the button).

After successful donation/redeem submissions the user is redirected to
`/success.html?type=donation`, `/success.html?type=redeem`, or
`/success.html?type=sweetpea-request`. The success page reads the `type`
param and shows the appropriate message and next-steps list.

## Wallet addresses

Crypto wallet addresses live in a `WALLETS` object in the inline script of
`form.html` and `support.html`:

    var WALLETS = { monero: 'Coming Soon', bitcoin: 'Coming Soon' };

Replace both values (in both files) when real addresses are available.

## Deployment

Serve the directory with any static host (Nginx, Caddy, GitHub Pages,
Cloudflare Pages, etc.). For 404 handling:

- GitHub Pages: `404.html` at the root works automatically
- Nginx: `error_page 404 /404.html;` in the server block
- Caddy: `handle_errors { rewrite 404 /404.html; file_server }`

## Design system

Shared tokens are defined in `assets/css/site.css`:

- `--primary` (#5EB8A8) teal, `--sage` / seedling green (#5ED39E) accents
- Dark background (#0A1214) with glassmorphic cards (blur + transparency)
- `glass-text` shimmer headings, floating petals canvas, glow-on-hover cards
- Animations respect `prefers-reduced-motion`

Page-specific styles live in an inline `<style>` block in each HTML file.

## Accessibility notes

- Skip-to-content link and semantic landmarks on every page
- Keyboard-accessible service cards, crypto selectors, tabs, and modal
- Focus-visible outlines; decorative elements are `aria-hidden`
- `noindex` on success and 404 pages

## License / contact

Questions: support@mysweetpea.cc
Infrastructure code: https://github.com/mysweetpea/homelab-k8s
This site: https://github.com/mysweetpea/portfolio
