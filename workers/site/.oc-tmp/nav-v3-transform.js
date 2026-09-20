/* Nav v3 transform — replaces <nav class="top-nav"> on all 14 pages.
 * The account-chip unit (div + inline <style> + inline <script>) is extracted
 * from each page and re-inserted VERBATIM (CSP sha256 allowlist).
 * Scratch file — lives in workers/site/.oc-tmp/ only. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES = ['404.html','about.html','changelog.html','contact.html','error.html','form.html','index.html','pricing.html','redeem.html','services.html','status.html','success.html','suggest.html','support.html'];

/* exact glyphs from the approved mockup, concept 4 (.oc-tmp/nav-options.html) */
const G = {
  svc:  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><rect x=".8" y=".8" width="4.4" height="4.4" rx="1"/><rect x="6.8" y=".8" width="4.4" height="4.4" rx="1"/><rect x=".8" y="6.8" width="4.4" height="4.4" rx="1"/><rect x="6.8" y="6.8" width="4.4" height="4.4" rx="1"/></svg>',
  hiw:  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 6h7.5M6 3.2 8.8 6 6 8.8"/></svg>',
  sta:  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 6h1.8l1.3-2.8 1.8 5.6L7.2 6H11"/></svg>',
  abt:  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="6" cy="6" r="5"/><path d="M6 5.3v3.1M6 3.5h.01"/></svg>',
  code: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="3.6" cy="6" r="2.3"/><path d="M5.9 6H11M9.3 6v1.9M10.7 6v1.5"/></svg>'
};

/* which item is the current page (drives the sage tint via aria-current) */
const CURRENT = {
  'index.html':    'logo',
  'services.html': 'svc',
  'pricing.html':  'hiw',
  'status.html':   'sta',
  'about.html':    'abt',
  'redeem.html':   'code'
};
const cur = (page, slot) => CURRENT[page] === slot ? ' aria-current="page"' : '';

const CHIP_START = '<div class="nav-account" id="nav-account">';
const NAV_START  = '<nav class="top-nav"';
const NAV_END    = '</nav>';

const chips = new Set();
const actionsSet = new Set();
let failed = false;

for (const page of PAGES) {
  const file = path.join(ROOT, page);
  const html = fs.readFileSync(file, 'utf8');

  /* --- locate the nav block --- */
  const navStart = html.indexOf(NAV_START);
  const navEnd = html.indexOf(NAV_END, navStart) + NAV_END.length;
  if (navStart < 0 || navEnd < NAV_END.length) { console.error(`${page}: top-nav block not found`); failed = true; continue; }
  if (html.indexOf(NAV_START, navStart + 1) !== -1) { console.error(`${page}: multiple top-nav blocks`); failed = true; continue; }
  const oldNav = html.slice(navStart, navEnd);

  /* --- extract the verbatim account-chip unit (div + style + script) --- */
  const c1 = oldNav.indexOf(CHIP_START);
  if (c1 < 0) { console.error(`${page}: account chip not found inside nav`); failed = true; continue; }
  const styleEnd = oldNav.indexOf('</style>', c1);
  const scriptEnd = oldNav.indexOf('</script>', styleEnd);
  if (styleEnd < 0 || scriptEnd < 0) { console.error(`${page}: chip style/script end not found`); failed = true; continue; }
  const chip = oldNav.slice(c1, scriptEnd + '</script>'.length);
  chips.add(chip);

  /* --- extract the search + theme buttons, byte-identical --- */
  const a1 = oldNav.indexOf('<div class="nav-actions">');
  const a2 = oldNav.indexOf('</div>', a1);
  if (a1 < 0 || a2 < 0) { console.error(`${page}: nav-actions not found`); failed = true; continue; }
  const actions = oldNav.slice(a1, a2 + '</div>'.length);
  actionsSet.add(actions);

  /* --- build the new nav --- */
  const newNav = `<nav class="top-nav" aria-label="Primary navigation">
    <a href="/" class="nav-logo"${cur(page, 'logo')}>
        <img src="/logo-favicon.svg" alt="" width="25" height="25">
        <span class="nav-brand">MySweetPea</span>
    </a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Toggle navigation menu">
        <span class="nav-toggle-bar"></span>
        <span class="nav-toggle-bar"></span>
        <span class="nav-toggle-bar"></span>
    </button>
    <div class="nav-links" id="nav-links">
        <div class="nav-group nav-group-l">
            <a href="/services.html" class="nav-btn"${cur(page, 'svc')}>${G.svc}Services</a>
            <a href="/pricing.html" class="nav-btn"${cur(page, 'hiw')}>${G.hiw}How It Works</a>
            <a href="/status.html" class="nav-btn"${cur(page, 'sta')}>${G.sta}Status</a>
        </div>
        <div class="nav-group nav-group-r">
            <a href="/about.html" class="nav-btn"${cur(page, 'abt')}>${G.abt}About</a>
            <a href="/redeem.html" class="nav-btn nav-code"${cur(page, 'code')}>${G.code}I Have a Code</a>
            <span class="nav-sep" aria-hidden="true"></span>
            ${actions}
            ${chip}
            <a href="/form.html" class="nav-cta">Get Access</a>
        </div>
    </div>
</nav>`;

  fs.writeFileSync(file, html.slice(0, navStart) + newNav + html.slice(navEnd), 'utf8');
  console.log(`${page}: nav replaced (chip ${chip.length} chars, aria-current=${CURRENT[page] || 'none'})`);
}

if (chips.size !== 1) { console.error(`CHIP MISMATCH: ${chips.size} distinct chip units across pages`); failed = true; }
if (actionsSet.size !== 1) { console.error(`ACTIONS MISMATCH: ${actionsSet.size} distinct nav-actions blocks`); failed = true; }
const chipLen = chips.values().next().value.length;
console.log(`chip unit length: ${chipLen} chars (expected 3298)${chipLen === 3298 ? '' : '  <-- MISMATCH'}`);
process.exit(failed || chipLen !== 3298 ? 1 : 0);
