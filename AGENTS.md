# AGENTS.md — MySweetPea Portfolio & Dashboard

Coding agent conventions for this repo (OpenCode / Codex / Claude Code — read this first).

## What lives here

- `workers/site/` — the public portfolio website (Cloudflare Worker + static assets)
- `workers/dashboard/` — MySweetPea dashboard SPA (Cloudflare Worker, `public/index.html` + `src/index.ts`)
- `workers/email-auto-reply/` — email automation worker
- `scripts/` — misc site tooling; `_partials/` — HTML partials used by services.html

## Hard rules

1. **Never commit secrets.** API keys go in `npx wrangler secret put <NAME>` (interactive or stdin pipe). No keys in wrangler.toml `[vars]` except non-secret URLs/IDs. Known secret names for dashboard: `AUTHENTIK_CLIENT_ID`, `MSP_INTERNAL_HEADER`, `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `IMMICH_URL`, `IMMICH_API_KEY`.
2. **Deploy = `npx wrangler deploy`** from the worker's own directory (`workers/dashboard` etc.). Wrangler is OAuth-authed on this machine already — never run `wrangler login`.
3. **Verify after deploy**: `curl -s https://dashboard.mysweetpea.workers.dev/...` for worker routes (the custom domain `dashboard.mysweetpea.cc` 403s all curl — Cloudflare WAF; only browsers get through it).
4. **Git push**: after committing, push via `git push` (credential helper is configured). If it hangs, `git pull --rebase` first, then retry once.
5. **Dashboard SPA structure**: `public/index.html` is a single-file app — HTML + one `<style>` block + two `<script>` blocks (main app IIFE, then palette/engine script LAST — order matters: any code using `$()` must come after the main block). All shell HTML is built inside JS string literals: newlines inside those literals MUST be `\\n` escapes, never raw newlines.
6. **Design tokens** (do not invent new colors): bg `#0C1316`, primary `#8FAFB5`/bright `#C5D5D8`, sage `#A3C9B6`, gold `#D9A86C`, text `#EDF3F4`/dim `#A9BEC2`, card `rgba(19,30,34,.55)`, radius 18/12, glass blur 16px, fonts Inter (UI) + Fraunces (headings).
7. **Authentik deep links (2026.8)**: settings tabs are `#/settings;{"page":"page-details"}` (password), `page-credentials` (MFA/tokens), `page-sessions`. Never use legacy `#/mfa` / `#/user-details` fragments — they 404.
8. **Ceremonies open as popups** (user preference): `window.open('/auth/ceremony?f=...', 'msp-ceremony', 'width=480,height=680')` with a popup-close watcher that reloads the dashboard. Do NOT change to same-tab navigation.

## Testing checklist for dashboard changes

- `npx wrangler deploy --dry-run` before deploying (catches bundle errors)
- After deploy: fetch `/` on workers.dev and grep for your change's marker
- JS syntax-check both script blocks (node --check on extracted blocks or esbuild parse)
- Static-login state must still work: gate shows sign-in card when `/api/me` 401s
