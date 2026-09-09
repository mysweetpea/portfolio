# MySweetPea Dashboard — deploy runbook (manual CF steps)

**Status: Authentik provider + app created & verified. Worker code complete. KV namespace `8fdd1c40796c413ebbd479c42c90ef44` (`msp-dashboard-sessions`) confirmed via CF API and wired into wrangler.toml.**

## One-time steps (user)

### 1. ~~Create the KV namespace~~ ✅ DONE (id confirmed)

### 2. Deploy the Worker (~2 min)
Open a terminal (PowerShell or Git Bash) and run:

```bash
cd "D:/home lab/github repo/portfolio/workers/dashboard"

# one-time browser login (a browser window opens; click Allow)
npx wrangler login

# set secrets (each prompts for a value, paste, Enter)
npx wrangler secret put AUTHENTIK_CLIENT_ID
#   paste: KKscbPxCeEB1O2TqAWbhDQ92pYvcX8NsdAQqRHD7

npx wrangler secret put MSP_INTERNAL_HEADER
#   paste: any long random string (SAVE it — the WAF rule needs the exact same value)
#   e.g. generate one:  openssl rand -hex 32   (or any 40+ char random text)

npx wrangler deploy
```

> `npx` may ask to install wrangler the first time — answer yes. Node v22 + wrangler 4.130 are already installed on this PC and working.

### 3. Bind the custom domain (~1 min)
1. Cloudflare dashboard → **Workers & Pages** (left sidebar)
2. Click the **`dashboard`** worker (appears after step 2 deploy)
3. **Settings** tab → **Domains & Routes** → **Add** → **Custom domain**
4. Type: `dashboard.mysweetpea.cc` → Add domain
   - Cloudflare auto-creates the DNS record and the certificate (takes ~1 min to go live)

### 4. Update the combined WAF skip rule (~1 min)
Security → WAF → Custom rules → edit your existing Telegram skip rule → replace the expression with (keep action **Skip**, keep it at position 1):

```
(ip.src in {149.154.160.0/20 91.108.4.0/22}) or (http.host eq "subscribe.mysweetpea.cc") or (http.host eq "auth.mysweetpea.cc" and starts_with(http.request.uri.path, "/api/v3/") and http.request.headers["x-msp-internal"][0] eq "PASTE_YOUR_SECRET_HERE")
```

Replace `PASTE_YOUR_SECRET_HERE` with the exact same string you set as `MSP_INTERNAL_HEADER` in step 2 (no angle brackets, no quotes-in-quotes — just the raw string inside the CF quotes).

Skip options: check **All remaining custom rules** + **Bot Fight Mode** (same as the rule already does).

## Verify Phase 1 (after all steps)
1. Visit `https://dashboard.mysweetpea.cc` → glass card, "Sign in with MySweetPea"
2. Click → Authentik branded login → complete → back on the dashboard
3. In the browser console on the dashboard page:
   `fetch('/api/me').then(r=>r.json()).then(console.log)` → your profile JSON

Then tell the agent — Phase 2 (security center) begins.

## Architecture notes
- Worker: `dashboard` in this folder; static phase-1 UI embedded in `src/index.ts`
- KV binding `SESSIONS` → namespace `msp-dashboard-sessions`
- All authentik calls server-side with user Bearer token + `x-msp-internal` header
- Authentik provider: `dashboard` (public client, PKCE S256, scopes incl. `goauthentik.io/api`)
