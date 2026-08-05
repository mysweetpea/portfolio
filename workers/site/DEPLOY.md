# MySweetPea — Cache-Busting & Deploy Notes

## Cache-busting (IMPORTANT)

The site uses a service worker (`sw.js`) that caches assets aggressively for
offline support. **Every time you change CSS or JS, you MUST bump the version
in two places** or returning users will see stale content:

1. **Asset query strings** — in every `.html` file, bump `?v=N`:
   - `/assets/css/site.css?v=N`
   - `/assets/css/fonts.css?v=N`
   - `/assets/js/site.js?v=N`
   - `/assets/js/qrcode.min.js?v=N`

2. **Service worker cache name** — in `sw.js`, bump `mysweetpea-vN`:
   ```js
   const CACHE = 'mysweetpea-vN';
   ```

Both must be bumped together. The SW `activate` handler deletes old caches,
so bumping the name forces a clean refresh.

### Quick way to bump (from `workers/site/`)

```bash
# Replace all ?v=N with ?v=N+1 across HTML files
find . -name '*.html' -exec sed -i 's/?v=[0-9]*/?v=3/g' {} +
# Then update sw.js cache name to match
sed -i "s/mysweetpea-v[0-9]*/mysweetpea-v3/" sw.js
```

## Deploy

The site auto-deploys via Cloudflare Workers Git integration on every push to
`main`. No manual step needed.

## Backend integration (pending)

These live features are wired but need backend endpoints to fully function:

| Feature | Endpoint | Status |
|---------|----------|--------|
| Live status pill (home) | `https://status.mysweetpea.cc/api/status-page/heartbeat/1` | Needs Uptime Kuma behind tunnel |
| Notify-me buttons (services) | `https://subscribe.mysweetpea.cc/webhook/suggest` | Needs n8n webhook |
| Invite-code check (redeem) | `https://subscribe.mysweetpea.cc/webhook/check-code` | Needs n8n webhook |

Until these exist, they gracefully fall back (status shows "All systems
operational", buttons flip to "We'll let you know", code check keeps default
hint).

## Service URLs (pending Session 32)

The services page advertises these as LIVE but they're still on MetalLB LAN
IPs until Traefik IngressRoutes + Cloudflare DNS records are created:
- `cloud.mysweetpea.cc` (Nextcloud)
- `photos.mysweetpea.cc` (Immich)
- `chat.mysweetpea.cc` (Open WebUI)
