# MySweetPea Dashboard — deploy runbook (manual CF steps)

**Status: Phase 0-1 code complete in `workers/dashboard/`. Authentik provider #29 + app `dashboard` already created and verified (discovery live, scopes `goauthentik.io/api` + `offline_access` confirmed).**

## One-time Cloudflare steps (user, ~5 minutes)

### 1. Create the KV namespace
Dashboard → Storage & Databases → Workers KV → Create namespace → name: `msp-dashboard-sessions`
→ copy the **Namespace ID** and paste it into `wrangler.toml` replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

### 2. Deploy the Worker
```bash
cd "D:/home lab/github repo/portfolio/workers/dashboard"
npx wrangler login        # one-time browser auth
npx wrangler secret put AUTHENTIK_CLIENT_ID     # paste: KKscbPxCeEB1O2TqAWbhDQ92pYvcX8NsdAQqRHD7
npx wrangler secret put MSP_INTERNAL_HEADER     # paste any long random string (shared secret)
npx wrangler secret put JELLYFIN_API_KEY        # (phase 3; can skip now)
npx wrangler secret put SEERR_API_KEY           # (phase 3; can skip now)
npx wrangler deploy
```

### 3. Bind the custom domain
Dashboard → Workers & Pages → `dashboard` → Settings → Domains & Routes → Add → Custom domain → `dashboard.mysweetpea.cc`
(Cloudflare auto-creates the DNS record + cert.)

### 4. WAF skip rules (protect Worker→authentik calls from BFM)
Security → WAF → Custom rules → Create (place ABOVE the block rules, below the Telegram skip):
- Name: `skip-dashboard-api`
- Expression: `(http.host eq "auth.mysweetpea.cc" and starts_with(http.request.uri.path, "/api/v3/") and http.request.headers["x-msp-internal"][0] eq "<the MSP_INTERNAL_HEADER value>")`
- Action: **Skip** → all remaining rules + Bot Fight Mode

Optional second rule (Phase 3, for Seerr stats):
- Name: `skip-dashboard-seerr`
- Expression: `(http.host eq "request.mysweetpea.cc" and http.request.headers["x-msp-internal"][0] eq "<same secret>")`
- Action: Skip (same)

## Verify Phase 1
1. Visit `https://dashboard.mysweetpea.cc` → glass card with "Sign in with MySweetPea"
2. Click → Authentik branded login → complete → redirected back, session cookie set
3. `GET /api/me` (browser console: `fetch('/api/me').then(r=>r.json()).then(console.log)`) → your profile JSON

## Current state of the code
- `src/index.ts` — OIDC PKCE auth (login/callback/logout), KV sessions + refresh, authentik API proxy as the user (me/sessions/consents/devices/status/audit + DELETE revokes), phase-1 glass UI placeholder
- Authentik: provider `dashboard` (public client, PKCE S256, 15-min access / 30-day refresh), scopes incl. `goauthentik.io/api`
- Redirect URI registered: `https://dashboard.mysweetpea.cc/auth/callback`
