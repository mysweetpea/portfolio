# Workers — Cloudflare Workers

This folder contains the Cloudflare Workers that power MySweetPea's edge
services. Each worker is a small, focused piece of serverless code deployed
to Cloudflare's network.

## What's here

| Worker | What it does |
|--------|--------------|
| `site/` | The main website — static assets + security headers + API proxy (see [site/README.md](./site/README.md)) |
| `email-auto-reply/` | Auto-replies to incoming email (see [email-auto-reply/README.md](./email-auto-reply/README.md)) |

## Why Workers?

- **No servers to manage** — Cloudflare runs the code at the edge, close to
  users.
- **Tiny footprint** — each worker is a single JS file; no frameworks, no
  build step.
- **Fast** — edge execution means sub-100ms responses for static assets.
- **Secure by default** — Workers sit behind Cloudflare's network, and the
  site worker enforces strict security headers on every response.

## Deployment

Each worker has its own `wrangler.toml`/`wrangler.jsonc` and deploys
independently:

```bash
cd workers/site
wrangler deploy

cd workers/email-auto-reply
wrangler deploy
```

> **Note:** the site worker deploys automatically via the repo's Cloudflare
> Git integration on push. The email-auto-reply worker deploys manually
> (`wrangler deploy`) — see its README.
