#!/usr/bin/env node
/**
 * build.mjs — the whole build for the MySweetPea marketing site.
 *
 *  1. bundle the layered CSS (Astro can't preserve the layer order — see below)
 *  2. run astro build  -> dist/
 *  3. post-build: recompute the CSP sha256 allowlist in dist/_headers
 *
 * WHY CSS IS BUNDLED OUTSIDE ASTRO
 * The site's cascade depends on `@layer legacy, redesign` with EVERY stylesheet
 * inside a layer — un-layered styles beat all layered styles, so one missed sheet
 * silently flips precedence. Astro splits/hoists imported CSS into per-component
 * links and would destroy that ordering. esbuild's CSS bundler resolves @import
 * and preserves layer() semantics, so we hand it a single entry file and drop the
 * result into public/ (which Astro copies verbatim).
 *
 * WHY CSP IS GENERATED HERE
 * The site's CSP is a static sha256 allowlist for inline scripts (`script-src`
 * has no 'unsafe-inline'). It is at ~1,219 of the 2,000-char `_headers` line
 * limit — i.e. ~14 inline scripts from a FAILED DEPLOY. Hand-maintaining 16
 * hashes across 14 pages is what the build now replaces.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUB = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');
const step = (n, m) => console.log(`\n▸ ${n}  ${m}`);

// ── 1. layered CSS ────────────────────────────────────────────────────────────
step('1/3', 'Bundling layered CSS');
mkdirSync(join(PUB, 'assets', 'css'), { recursive: true });
await build({
  entryPoints: [join(ROOT, 'src', 'styles', 'style.css')],
  bundle: true,
  target: 'chrome110',
  // keep url(/assets/...) verbatim — they are served from the site root, not
  // resolved relative to the CSS file (esbuild would try to inline them)
  external: ['/assets/*'],
  outfile: join(PUB, 'assets', 'css', 'bundle.css'),
  logLevel: 'warning',
});
const css = readFileSync(join(PUB, 'assets', 'css', 'bundle.css'), 'utf8');
if (!css.startsWith('@layer legacy, redesign;')) {
  throw new Error('CSS bundle is missing the layer declaration — cascade order is not guaranteed');
}
console.log(`   bundle.css  ${(css.length / 1024).toFixed(1)} KB  (layer decl OK)`);

// ── 2. astro build ────────────────────────────────────────────────────────────
step('2/3', 'Running astro build');
execFileSync('npx', ['astro', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });

// ── 3. regenerate the CSP allowlist ───────────────────────────────────────────
step('3/3', 'Regenerating CSP hashes');
const headersPath = join(DIST, '_headers');
if (!existsSync(headersPath)) throw new Error('dist/_headers missing — did the build copy public/ ?');

const hashes = new Set();
let pages = 0;
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.html')) continue;
    pages++;
    const html = readFileSync(p, 'utf8');
    // inline <script> with a body and no src — exactly what the CSP must allow
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const body = m[1];
      if (!body.trim()) continue;
      hashes.add("'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'");
    }
  }
};
walk(DIST);

let headers = readFileSync(headersPath, 'utf8');
const sorted = [...hashes].sort().join(' ');
const cspLine = headers.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:'));
if (!cspLine) throw new Error('no CSP line found in _headers');

const rebuilt = cspLine.replace(/script-src [^;]+;/, `script-src 'self' ${sorted};`);
if (rebuilt.length > 2000) {
  throw new Error(`CSP line is ${rebuilt.length} chars — Cloudflare's _headers limit is 2000. ` +
                  `Move inline scripts to external files before adding more.`);
}
headers = headers.replace(cspLine, rebuilt);
writeFileSync(headersPath, headers, 'utf8');

console.log(`   ${pages} page(s), ${hashes.size} unique inline-script hash(es)`);
console.log(`   CSP line: ${rebuilt.length} / 2000 chars (was ${cspLine.length})`);

// ── 4. Verify the service worker's CORE precache actually exists ──────────
// The SW is stale-while-revalidate: if CORE lists a path that is not shipped,
// `cache.addAll` REJECTS and the whole install fails silently — the SW never
// activates and users keep an older cache. And if CORE lists a file the pages
// no longer request (e.g. the pre-Astro site.css), returning visitors precache
// something useless while the real stylesheet is only fetched lazily.
// Both are silent failures, so assert instead of hoping.
const swPath = join(DIST, 'sw.js');
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, 'utf8');
  const cacheName = (sw.match(/const CACHE = '([^']+)'/) || [])[1] || '(none)';
  const core = ((sw.match(/const CORE = \[([\s\S]*?)\]/) || [])[1] || '')
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);

  const missing = core.filter((p) => {
    if (p === '/') return false;
    const f = join(DIST, p.replace(/^\//, ''));
    return !existsSync(f) && !existsSync(f + '.html');
  });

  console.log(`\n▸ 4/4  Service worker`);
  console.log(`    cache: ${cacheName} | precache entries: ${core.length}`);
  if (missing.length) {
    console.error(`\n✗ FATAL: sw.js CORE lists ${missing.length} path(s) that are NOT in dist/:`);
    missing.forEach((m) => console.error(`    ${m}`));
    console.error('  cache.addAll() would reject and the SW would never install.');
    process.exit(1);
  }
  console.log('    all precache paths exist ✓');
  // Lint the thing that bit us: the old stylesheets must not be precached.
  const stale = core.filter((p) => /\/assets\/css\/(site|premium|fonts)\.css$/.test(p));
  if (stale.length) {
    console.warn(`    ⚠️ CORE precaches pre-Astro stylesheets: ${stale.join(', ')}`);
    console.warn('       converted pages load bundle.css instead — see sw.js notes.');
  }
}

console.log('\n✓ build complete -> dist/');
