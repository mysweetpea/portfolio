# KV free-tier guardrails (why this worker writes so little to KV)

Cloudflare Workers KV **free tier**: 1,000 write ops/day (also 1,000 deletes/day
and 1,000 lists/day; 100,000 reads/day). **Every `put()` counts** — rewriting
the same key repeatedly does NOT dedupe. Exceeding the write cap makes further
KV operations fail with 429 (logins would break, since sessions are KV-backed).

On 2026-09-10 this account hit **890 writes/day** and received Cloudflare's
"50% of the daily KV limit" email. The dashboard worker was the sole source.

## Rules for future changes

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

## Verified 2026-09-16

- Deployed version `ccbcb3e5` live on dashboard.mysweetpea.cc.
- 18 cache-path requests → **0 KV writes**.
- `wrangler tail`: 26 events, all `ok`, 0 exceptions, CPU p50 1 ms.
- Authentik provider change re-GET verified; provider is not blueprint-managed.
