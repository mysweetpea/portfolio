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
console.log('\n✓ build complete -> dist/');
