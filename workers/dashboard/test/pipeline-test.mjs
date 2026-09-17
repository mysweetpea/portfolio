// Unit test: parse/dedupe/downgrade/reconcile pipeline against commits-fixture.json
// (53 real commits from homelab-k8s history).
//
// The pipeline is IMPORTED from ../src/lib/updates-pipeline.mjs — the SAME
// module the worker ships. This suite therefore validates shipped behavior,
// not a hand-copied snapshot (it used to mirror the worker code, which meant
// production could silently drift while tests stayed green).
//
// Contract: runPipeline() returns RAW entries (with .app) at every stage.
// Callers reconcile() raw entries, THEN buildUpdate() survivors for display.
//
// Run: node test/pipeline-test.mjs   (from workers/dashboard)
import { readFileSync } from 'node:fs';
import {
  RUNTIME_PROBES, parseVer, runPipeline, reconcile, buildUpdate,
} from '../src/lib/updates-pipeline.mjs';

const fixture = JSON.parse(readFileSync(new URL('./commits-fixture.json', import.meta.url), 'utf8'));

// ---------- assertions ----------
let failures = 0;
const check = (label, cond, extra) => {
  if (cond) console.log('PASS', label);
  else { failures++; console.error('FAIL', label, extra || ''); }
};

check('fixture has 53 commits', fixture.length === 53, fixture.length);

// simulate GitHub API commit shape the worker parses
const ghCommits = fixture.map((f) => ({
  sha: f.sha,
  commit: { author: { date: f.date + 'T12:00:00Z' }, message: 'build: automatic update of ' + f.app + '\n\nupdates image ' + f.image + " tag '" + f.from + "' to '" + f.to + "'" },
}));

const nowMs = new Date('2026-09-17T00:00:00Z').getTime();
const { parsed, deduped, kept, droppedDowngrades } = runPipeline(ghCommits, nowMs);

check('53 raw -> 45 after dedupe', deduped.length === 45, deduped.length);
check('45 -> 44 after downgrade filter', kept.length === 44, kept.length);
check('exactly 1 downgrade dropped', droppedDowngrades.length === 1, JSON.stringify(droppedDowngrades));
const d = droppedDowngrades[0] || {};
check('dropped = nextcloud 34.0.1 -> 34.0.0 (2026-06-29)', d.app === 'nextcloud' && d.from === '34.0.1' && d.to === '34.0.0' && d.date === '2026-06-29', JSON.stringify(d));

// built-shape checks
const built = kept.map(buildUpdate);
const affineKept = built.filter((u) => u.service === 'affine' && u.kind === 'build');
check('both AFFiNE entries survive', affineKept.length === 2, JSON.stringify(affineKept));

const kinds = {};
built.forEach((u) => { kinds[u.kind] = (kinds[u.kind] || 0) + 1; });
console.log('kinds:', JSON.stringify(kinds), 'services:', JSON.stringify(built.reduce((m, u) => { m[u.name] = (m[u.name] || 0) + 1; return m; }, {})));

check('dedupe keeps earliest date (seerr latest->v3.3.0 = 2026-06-30)', (() => {
  const u = kept.find((x) => x.app === 'seerr' && x.from === 'latest' && x.to === 'v3.3.0');
  return u && u.date === '2026-06-30' && u.sha === '48a3e56';
})());
check('newest first ordering', kept.every((u, i) => i === 0 || kept[i - 1].date >= u.date));
check('nextcloud 34.0.3->34.0.4 release URL', (() => {
  const u = built.find((x) => x.service === 'nextcloud' && x.to === '34.0.4');
  return u && u.releaseUrl === 'https://github.com/nextcloud/server/releases/tag/v34.0.4';
})());
check('vaultwarden bare tag URL', (() => {
  const u = built.find((x) => x.service === 'vaultwarden' && x.to === '1.37.3');
  return u && u.releaseUrl === 'https://github.com/dani-garcia/vaultwarden/releases/tag/1.37.3';
})());
check('vaultwarden testing->1.37.2 kind=update', (() => {
  const u = built.find((x) => x.service === 'vaultwarden' && x.from === 'testing');
  return u && u.kind === 'update';
})());

// --- regression guards for review findings (2026-09-17) ---
check('matrix apps stay distinct (element-web + synapse both present)', (() => {
  const tos = built.filter((x) => x.name === 'Matrix / Element').map((x) => x.to);
  return tos.includes('v1.12.28') && tos.includes('v1.161.0');
})());
check('reconcile gate derives from RUNTIME_PROBES (no separate RECONCILABLE list)', (() => {
  const ew = kept.filter((x) => x.app === 'element-web' && x.to === 'v1.12.28');
  if (!ew.length) return false;
  const out = reconcile(ew, { 'matrix-synapse': [1, 161, 0] });
  return out.length === ew.length && !RUNTIME_PROBES['element-web'];
})());
check('malformed-date commits are skipped (no crash, empty date path)', (() => {
  const bad = [{ sha: '0badf00d', commit: { author: {}, message: "build: automatic update of nextcloud\n\nupdates image library/nextcloud tag '1.0.0' to '2.0.0'" } }];
  const r = runPipeline(bad, nowMs);
  return r.parsed.length === 0 && r.kept.length === 0;
})());
check('prerelease tags parse via numeric prefix (documented semantics)', (() => {
  const a = parseVer('34.0.0-rc.1'), b = parseVer('34.0.0');
  return a && b && a.join('.') === b.join('.');
})());

// reconcile expectations from the brief (live runtimes as of research: nc 34.0.4, synapse 1.161.0, immich 3.2.2, vw 1.37.3, seerr 3.4.1, webui 0.11.3)
const running = { 'vaultwarden': [1, 37, 3], 'matrix-synapse': [1, 161, 0], 'seerr': [3, 4, 1], 'nextcloud': [34, 0, 4], 'immich': [3, 2, 2], 'open-webui': [0, 11, 3] };
const announced = reconcile(kept, running);
check('reconcile suppresses all nextcloud 35.0.0 commits', !announced.some((u) => u.app === 'nextcloud' && u.to === '35.0.0'));
check('reconcile keeps nextcloud 34.0.3 -> 34.0.4', announced.some((u) => u.app === 'nextcloud' && u.from === '34.0.3' && u.to === '34.0.4'));
check('reconcile keeps immich chain fully', announced.filter((u) => u.app === 'immich').length === kept.filter((u) => u.app === 'immich').length);
check('reconcile keeps element-web (not reconcilable) at synapse runtime', announced.filter((u) => u.app === 'element-web').length === kept.filter((u) => u.app === 'element-web').length);
console.log('announced after live reconcile:', announced.length, 'of', kept.length);

if (failures) { console.error(failures + ' FAILURES'); process.exit(1); }
console.log('ALL CHECKS PASSED');
