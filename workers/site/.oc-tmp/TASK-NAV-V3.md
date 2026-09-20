# Task: Build the "Terminal + Crowned" navigation bar (nav v3)

## What this is

Replace the navigation bar on ALL 14 pages of the MySweetPea marketing site with
the approved redesign: **Terminal voice** (monospace links, one glyph per item,
current page tinted sage) arranged in the **Crowned structure** (Fraunces
wordmark dead centre, links split 3/2 around it), under an always-on glass bar,
with ONE ice-white action button.

An approved interactive mockup already exists. REUSE ITS DESIGN VERBATIM:
    .oc-tmp/nav-options.html   (a copy sits beside this brief — use THIS path)
Read it first. Concept 4 ("The hybrid") = the target, in both signed-out and
signed-in states.

## Repo / working dir

Repo root:  `D:/home lab/github repo/portfolio`
Work only inside: `workers/site/`
Temp/scratch files: `workers/site/.oc-tmp/` ONLY. Never write outside the repo.
This directory IS the public web root (wrangler `assets.directory: "./"`), so
never leave stray files anywhere under `workers/site/`.

## The 14 pages

404.html about.html changelog.html contact.html error.html form.html index.html
pricing.html redeem.html services.html status.html success.html suggest.html
support.html

Each currently contains an IDENTICAL `<nav class="top-nav" ...>...</nav>` block.
Replace that block in every page with the new one. The `<nav>` element, its
`nav-toggle` button and the `nav-links` container MUST keep their existing ids
and classes (`top-nav`, `nav-toggle`, `nav-links`, `nav-logo`) because
`assets/js/site.js` queries them by those names (mobile drawer, scroll-shrink,
esc-to-close). See `assets/js/site.js` lines ~40-48 (nav-scrolled) and ~124-180
(drawer) before you change markup.

## CRITICAL — these must be preserved byte-for-byte

1. **The account chip block.** On every page there is a `<div class="nav-account"
   id="nav-account">...</div>` followed immediately by an inline `<style>` and an
   inline `<script>`. These THREE blocks are ONE unit (3298 chars). Copy them
   VERBATIM into the new nav — do not reformat, re-indent, minify, or "improve"
   them. Their inline script's exact bytes are in the CSP sha256 allowlist; any
   change breaks sign-in. The script already handles: popup open/close, outside
   click, Escape, and the `/api/auth/state` fetch that swaps "Sign in" for the
   avatar + first name. It ALSO rewrites the popup contents when signed in.
   Keep the element ids exactly: `nav-account`, `nav-account-chip`,
   `nav-account-pop`, `nav-account-label`, `nav-account-avatar`.

2. **The theme bootstrap script in `<head>`** and **the JSON-LD block** —
   do not touch `<head>` at all.

3. **The `<style>` and `<script>` tag bytes** — the site CSP is a sha256 hash
   allowlist with NO unsafe-inline. Do not add any new inline `<script>` or
   `<style>`. All new CSS goes in the stylesheet (below).

## Layout to build

Desktop (>=1100px): 3-column grid `1fr auto 1fr`.
  - LEFT (right-aligned): Services, How It Works, Status
  - CENTRE: the wordmark
  - RIGHT (left-aligned): About, I Have a Code, [separator], search, theme, account, Get Access
    
Centre column contains the logo image `/logo-favicon.svg` (25x25) + the text
"MySweetPea" in `Fraunces` 600, 1.06rem. The whole centre is one link to `/`.

Each nav link: monospace stack
`ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`, 0.775rem, with a 12x12
inline SVG glyph (stroke-width 1.5, `fill="none"`, `stroke="currentColor"`)
before the label. Use the EXACT glyph paths from the mockup's concept 4.
Current page: `color: var(--sage)` and glyph opacity 1. Others: `var(--text-dim)`,
glyph opacity .6, hover -> `var(--primary-bright)`.

## Mobile (<=1099px) — THIS IS A HARD REQUIREMENT, get it right

Below 1100px the 3-column grid must collapse to a hamburger drawer, keeping the
SITE'S EXISTING mobile pattern (read the current CSS at the `@media (max-width:
768px)` block in `assets/css/site.css` around line 2017, and the v32/v35 blocks
near the end of that file, lines 7809-7889).

Requirements:
  - Hamburger visible, drawer hidden until opened (existing JS toggles
    `.nav-open` on `#nav-links`).
  - Drawer items are full-width cards, LEFT-aligned, min 44px tall, using
    `var(--card-bg)` + `var(--border)`.
  - The CENTRE wordmark must NOT be a grid centre on mobile — it sits left
    (brand position) beside the hamburger. Do not let the centred layout leak
    into mobile.
  - Search + theme move INSIDE the drawer, same shape (999px radius pills),
    side by side, centred as a pair.
  - Account chip + Get Access: full width, 44px+.
  - NO nested scroll container on the drawer (site rule: menu grows in normal
    page flow and the PAGE scrolls). Do not add max-height/overflow.
  - No horizontal overflow at 390px, 768px, 1024px.

## Where the CSS goes

`workers/site/assets/css/premium.css` — APPEND a new section at the end, after
the existing "=== 11. Minimal nav" section. premium.css loads LAST so it wins at
equal specificity. Use the existing tokens only (defined in site.css :root):
  --bg #0C1316, --primary #8FAFB5, --primary-dim #6B9AA6, --primary-bright #C5D5D8,
  --primary-glow rgba(143,175,181,.12), --ice #EEF2F3, --sage #A3C9B6,
  --text #EDF3F4, --text-dim #A9BEC2, --text-faint #74878C,
  --border rgba(143,175,181,.09), --border-primary rgba(143,175,181,.28),
  --card-bg rgba(19,30,34,.55), --radius-sm 12px,
  --transition .35s cubic-bezier(.4,0,.2,1)
Do NOT invent new colour tokens. The existing "=== 11" block already styles
`.top-nav .nav-btn` etc — supersede it cleanly rather than leaving contradictions;
if part of it is now wrong, EDIT that block instead of stacking overrides.

Light theme is driven by `[data-theme="light"]` on `<html>` (a MANUAL toggle —
NOT prefers-color-scheme). Every new rule that changes colour needs a light
variant. Light tokens: --bg #E9EFEA, --text #1B2B31, --text-dim #3E5A52,
--primary-bright #2F5A44, --primary #3E6B77, --sage #2F5A44.
The ice button becomes `#1B2B31` bg with `#EDF3F4` text in light theme.

## The two action states (REQUIRED, already designed)

Signed OUT: account chip reads "Sign in" as a quiet monospace TEXT link (person
glyph 15x15 + label), then the `Get Access` ice pill (999px, --ice bg, #0C1316
text, 600 weight, hover translateY(-1px) + glow).
Signed IN: the existing chip JS swaps the label to the user's first name and
shows the avatar. The chip then takes the ICE PILL treatment (same slot/weight
the CTA has) and **`Get Access` must be hidden**. A member already has access —
offering it again reads as a bug.
Implement the signed-in state with CSS only, driven by the chip's existing
markup: when the label is not "Sign in" / when the avatar is shown. Do NOT add
new inline JS (CSP). A robust pure-CSS approach: the chip script sets
`label.textContent` and un-hides `#nav-account-avatar`; use
`:has()`-free selectors where possible — prefer `.nav-account:has(#nav-account-avatar:not([hidden]))`
but ALSO provide a JS-free-safe fallback because `:has()` is unreliable on the
user's iOS Safari. Recommended: add ONE tiny rule to the EXISTING allowed
inline script? NO — instead have the existing script's `onload`/`style.display`
side effects drive it, and if that cannot be done without new JS, then style the
signed-in state via a class the existing script already sets, or accept the
chip's own `.nav-account-chip` styling and simply hide `.nav-cta` with
`.nav-account:has(...)`. Decide, and DOCUMENT your decision in a comment.

## Signed-in state — IMPLEMENT EXACTLY THIS (decided, do not redesign)

`:has()` is unreliable on the user's iOS Safari and no new inline JS is allowed
(CSP). So the signed-in state is driven from `assets/js/site.js`, which is an
EXTERNAL file (no CSP impact).

ADD this self-contained IIFE at the END of `workers/site/assets/js/site.js`,
after all existing blocks. Do not modify any other part of site.js:

```js
/* === Nav: reflect the signed-in state (nav v3) ===
   The account chip's inline script swaps its label to the user's first name and
   un-hides the avatar once /api/auth/state reports a session. We only READ those
   two mutations and tag the nav, so the stylesheet can promote the chip to the
   primary action and hide "Get Access". Pure CSS would need :has(), which the
   user's iOS Safari does not support reliably; a class set here avoids both that
   and any new inline script (the CSP is a sha256 allowlist). */
(function () {
    'use strict';
    var nav = document.querySelector('.top-nav');
    var label = document.getElementById('nav-account-label');
    var avatar = document.getElementById('nav-account-avatar');
    if (!nav || !label || !avatar) return;

    function sync() {
        var signedIn =
            (label.textContent || '').trim() !== 'Sign in' &&
            (avatar.style.display === 'inline-block' || !avatar.hidden);
        nav.classList.toggle('nav-signed-in', signedIn);
    }

    new MutationObserver(sync).observe(label, { childList: true, characterData: true, subtree: true });
    new MutationObserver(sync).observe(avatar, { attributes: true, attributeFilter: ['style', 'hidden'] });
    sync();
})();
```

Then in `premium.css`, the signed-in presentation hangs off `.top-nav.nav-signed-in`:
  - `.top-nav.nav-signed-in .nav-cta { display: none; }`
  - `.top-nav.nav-signed-in .nav-account-chip { ...ice pill treatment... }`
    (bg `var(--ice)`, color `#0C1316`, weight 600, radius 999px, hover lift+glow)
  - light theme: bg `#1B2B31`, color `#EDF3F4`
This mirrors the approved mockup's "Signed in" stage.

NOTE: the account chip is inside `.nav-account` which sits in the RIGHT column,
and the popup opens from it — make sure the pill treatment does not clip the
popup (`z-index`/`overflow`) and that the popup still opens.

## Output contract

When done, print exactly this block and then STOP:

    READY TO DEPLOY
    pages changed: N
    account chip preserved verbatim: yes/no
    new inline script/style added: yes/no (must be no)
    css section added at: premium.css line X
    mobile breakpoint(s) used: <list>
    open questions: <list or none>

Do NOT commit. Do NOT deploy. Do NOT run wrangler.
