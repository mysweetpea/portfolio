# Cloudflare free-tier notes — KV writes + Worker invocations

Two separate free-tier budgets bit (or nearly bit) this account:

| Budget | Free limit | This account | Fixed by |
|---|---|---|---|
| KV **writes**/day | 1,000 | **890 (Sep 10)** → email from CF | Cache API migration + JWT-lifetime sessions |
| Worker invocations/day | 100,000 | ~4,000/day | `run_worker_first` array (assets bypass the script) |

## KV rules (the 50% email)

Cloudflare Workers KV **free tier**: 1,000 write ops/day (also 1,000 deletes/day
and 1,000 lists/day; 100,000 reads/day). **Every `put()` counts** — rewriting
the same key repeatedly does NOT dedupe. Exceeding the write cap makes further
KV operations fail with 429 (logins would break, since sessions are KV-backed).

On 2026-09-10 this account hit **890 writes/day** and received Cloudflare's
"50% of the daily KV limit" email. The dashboard worker was the sole source.

### Rules

1. **Cache copies never live in KV.** Anything that is a cached *response*
   (stats, media rows, status page, profile) belongs in the **Cache API**
   (`caches.default`) via the `cacheGetJson`/`cachePutJson`/`cacheDeleteJson`
   helpers in `src/index.ts`. The Cache API is free and unmetered and does not
   touch the KV counters. KV is only for durable state:
   sessions, PKCE verifiers, avatars, audit entries, rate-limit counters,
   seerr-uid mapping.
2. **No timer-driven KV rewrites of session docs.** The access token now lives
   24 h (authentik provider "Provider for dashboard", `access_token_validity:
   hours=24`) and `requireSession()` refreshes at **half the JWT lifetime**,
   read from the token's `exp`/`iat`. Do not reintroduce a fixed short refresh
   timer — a 10-minute timer cost ~144 writes/day *per active session*.
3. If a token is ever not a JWT (parse fails), the code caps refresh at 12 h
   via the `created` stamp. Keep that fallback.
4. **Never enable Cloudflare "Workers Caching"** on these workers: cache hits
   are still billed as requests and would turn currently-free static asset
   traffic into billable invocations.
5. After any change here, re-check the counter:
   GraphQL `kvOperationsAdaptiveGroups` (dimensions: date, actionType) —
   target is well under 100 writes/day.

## Invocation rules (assets must not invoke the script)

Static-asset requests served directly by the assets layer are **free and
unlimited and consume no CPU**; only requests that actually invoke the Worker
script are billed. So `run_worker_first` must always be an **array of the
dynamic routes**, never `true`:

- dashboard: `["/api/*", "/auth/*"]`
- site: `["/api/*", "/.well-known/matrix/*"]`

Consequences to remember:

- **`_headers` only applies to asset-layer responses.** Anything set in the
  Worker's `Response` does not reach assets, and vice versa. Security headers
  for asset responses live in each worker's `_headers` file; dynamic routes
  keep setting their own headers in code.
- The site's HTML is **baked** (account chip + canonical + JSON-LD) by
  `site/bake_html.py`; its CSP is build-time sha256 hashes in `site/_headers`.
  If inline JS in any page changes, re-run `python bake_html.py --check` and
  update the `script-src` hash list. (Deploy-time validation catches malformed
  `_headers`, but NOT stale hashes — a stale hash silently blocks that script.)
- `not_found_handling: "404-page"` (site) serves the branded 404 for unknown
  paths without invoking the worker; dashboard keeps `single-page-application`.
- Verify changes with `wrangler tail`: send N asset requests and confirm **0**
  worker events, then N API requests and confirm N events.

## Verified 2026-09-16/17

- KV: deployed `ccbcb3e5`; 18 cache-path requests → **0 KV writes**.
- Invocations: `site` → `ec65f1ff`, `dashboard` → `1d29dd0d`;
  10 site asset + 8 dashboard asset requests → **0 worker events** each.
- Real-browser CSP check (local server replaying `_headers`): **0
  securitypolicyviolation events** across all 14 pages; chip + early-theme
  scripts execute.
- Exposure fix: `/src/index.js`, `/DEPLOY.md`, `/README.md`, `/fetch-icons.sh`,
  `/wrangler.jsonc` returned **200 before** (publicly served), **404 after**
  the `.assetsignore`.
- `wrangler tail`: all events `ok`, 0 exceptions; avatar round-trip byte-identical.

## Service Updates feed (added 2026-09-17, deployment `a6248768`)

`/api/updates` serves the 9 visitor services' update feed (bell + Home row +
Services hints). When touching it, keep these invariants:

- **The cache is Cache API, not KV** (`swrJson(ctx, env, 'cache:updates', ...)`).
  The feed refresh does 6 GitHub fetches + 7 runtime probes; if this ever moved
  to KV it would add ~48 writes/day and re-open the quota risk.
- **Reconcile is `to <= running` (LTE).** Do not "simplify" to equality: `==`
  collapses the feed to one entry per service (every historical step is below
  the running version and would be dropped).
- **Downgrade detection only compares version-like tags** (`^v?\d+(\.\d+)+`).
  AFFiNE's `stable-<sha>` tags otherwise parse as numeric garbage.
- **Release-notes links**: vaultwarden uses BARE tags, everything else `v`-prefixed;
  AFFiNE links its releases list (SHA tags are not releases); Jellyfin is
  deliberately unlinked (upstream is v12.x, deployment runs 10.11.11).
- **Run `npm test` in `workers/dashboard`** after any change to the parse/dedupe/
  reconcile pipeline — it asserts the exact expected counts (53→45→44, 1 drop,
  AFFiNE survives, 35.0.0 chain suppressed) against 53 real commits.
