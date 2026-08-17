# Email Auto-Reply Worker

A small Cloudflare Worker that **auto-replies to incoming email** sent to
MySweetPea's support address. It uses Cloudflare's `send_email` binding to
respond without any server.

## How it works

1. Email arrives at the bound address (`sweetpea@tuta.io`).
2. The worker's `email` handler runs (see `src/index.js`).
3. It sends an automatic reply acknowledging the message.

## Configuration

`wrangler.toml`:

```toml
name = "email-auto-reply"
main = "src/index.js"
compatibility_date = "2026-06-25"
compatibility_flags = ["nodejs_compat"]

[[send_email]]
name = "SEND_EMAIL"
destination_address = "sweetpea@tuta.io"
```

## Deployment

This worker deploys **manually** (no CI):

```bash
cd workers/email-auto-reply
wrangler deploy
```

> **Note:** `wrangler` auth on this machine has expired — run `wrangler login`
> before deploying.

## Files

| File | Role |
|------|------|
| `src/index.js` | The worker code (email handler) |
| `wrangler.toml` | Worker config + send_email binding |
| `dist/` | Built output (auto-generated, do not edit) |
