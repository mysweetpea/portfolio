// Unit test: parse/dedupe/downgrade pipeline against commits-fixture.json (53 real commits).
// The pure functions below are the SAME logic pasted into workers/dashboard/src/index.ts.
// Run: node test/pipeline-test.mjs   (from workers/dashboard)
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./commits-fixture.json', import.meta.url), 'utf8'));

// ---------- shared pipeline (mirror of worker code) ----------
const APP_SERVICE = {
  'vaultwarden': 'vaultwarden',
  'matrix-synapse': 'matrix', 'matrix-mas': 'matrix', 'element-web': 'matrix', 'matrix-rtc': 'matrix',
  'affine': 'affine', 'koalasync': 'koalasync', 'jellyfin': 'jellyfin', 'seerr': 'seerr',
  'nextcloud': 'nextcloud', 'immich': 'immich', 'open-webui': 'open-webui',
};
const SERVICE_NAME = {
  'vaultwarden': 'Vaultwarden', 'matrix': 'Matrix / Element', 'affine': 'AFFiNE', 'koalasync': 'KoalaSync',
  'jellyfin': 'Jellyfin', 'seerr': 'Seerr', 'nextcloud': 'Nextcloud', 'immich': 'Immich', 'open-webui': 'Open WebUI',
};
const APP_RELEASE = {
  'vaultwarden':    { repo: 'dani-garcia/vaultwarden', prefix: '' },
  'matrix-synapse': { repo: 'element-hq/synapse', prefix: 'v' },
  'element-web':    { repo: 'element-hq/element-web', prefix: 'v' },
  'matrix-mas':     { repo: 'element-hq/matrix-authentication-service', prefix: 'v' },
  'affine':         { repo: 'toeverything/AFFiNE', prefix: null },
  'koalasync':      { repo: 'Shik3i/KoalaSync', prefix: 'v' },
  'seerr':          { repo: 'seerr-team/seerr', prefix: 'v' },
  'nextcloud':      { repo: 'nextcloud/server', prefix: 'v' },
  'immich':         { repo: 'immich-app/immich', prefix: 'v' },
  'open-webui':     { repo: 'open-webui/open-webui', prefix: 'v' },
};

const SUBJECT_RE = /^build: automatic update of (\S+)/m;
const TAGLINE_RE = /updates image (\S+) tag '([^']*)' to '([^']*)'/g;
const isVersionLike = (t) => /^v?\d+(\.\d+)+/.test(String(t || ''));
const isShaLike = (t) => /^[A-Za-z]+-[0-9a-f]{6,}$/.test(String(t || '')) || /^[0-9a-f]{7,40}$/.test(String(t || ''));
function parseVer(t) {
  const m = String(t || '').replace(/^v/, '').match(/^\d+(\.\d+)*/);
  if (!m) return null;
  const parts = m[0].split('.').map(Number);
  return parts.every((n) => isFinite(n)) ? parts : null;
}
function cmpVer(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function parseUpdateCommit(c) {
  const msg = String((c && c.commit && c.commit.message) || '');
  const sm = msg.match(SUBJECT_RE);
  if (!sm) return null;
  const app = sm[1].split('/').pop();
  if (!APP_SERVICE[app]) return null;
  const tm = TAGLINE_RE.exec(msg);
  TAGLINE_RE.lastIndex = 0;
  if (!tm) return null;
  const date = String((c.commit.author && c.commit.author.date) || '').slice(0, 10);
  return { app, image: tm[1], from: tm[2], to: tm[3], date, sha: String(c.sha || '').slice(0, 7) };
}

function buildUpdate(e) {
  const rel = APP_RELEASE[e.app];
  let releaseUrl = null;
  if (rel && rel.prefix !== null && isVersionLike(e.to)) {
    const tag = rel.prefix + String(e.to).replace(/^v/, '');
    releaseUrl = 'https://github.com/' + rel.repo + '/releases/tag/' + tag;
  } else if (rel && rel.prefix === null) {
    releaseUrl = 'https://github.com/' + rel.repo + '/releases';
  }
  let kind = 'update';
  if (isVersionLike(e.from) && isVersionLike(e.to)) kind = 'version';
  else if (isShaLike(e.from) || isShaLike(e.to)) kind = 'build';
  return { service: APP_SERVICE[e.app], app: e.app, name: SERVICE_NAME[APP_SERVICE[e.app]], from: e.from, to: e.to, date: e.date, sha: e.sha, releaseUrl, kind };
}

export function runPipeline(rawCommits, nowMs) {
  const now = nowMs || Date.now();
  const cutoff = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
  const parsed = [];
  for (const c of rawCommits) {
    const e = parseUpdateCommit(c);
    if (e && e.date >= cutoff) parsed.push(e);
  }
  // dedupe by (service, from, to) — keep EARLIEST date
  const best = new Map();
  for (const e of parsed) {
    const k = APP_SERVICE[e.app] + '|' + e.from + '|' + e.to;
    const prev = best.get(k);
    if (!prev || e.date < prev.date) best.set(k, e);
  }
  const deduped = Array.from(best.values());
  // drop downgrades — ONLY when BOTH tags are version-like
  const kept = [], droppedDowngrades = [];
  for (const e of deduped) {
    const f = parseVer(e.from), t = parseVer(e.to);
    if (f && t && cmpVer(t, f) < 0) { droppedDowngrades.push(e); continue; }
    kept.push(e);
  }
  kept.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { parsed, deduped, kept: kept.map(buildUpdate), droppedDowngrades };
}

// reconcile: keep when to is non-version, app not reconcilable, runtime unknown, or to <= running
export function reconcile(updates, running) {
  const RECONCILABLE = { 'vaultwarden': 1, 'matrix-synapse': 1, 'seerr': 1, 'nextcloud': 1, 'immich': 1, 'open-webui': 1 };
  return updates.filter((u) => {
    if (!RECONCILABLE[u.app]) return true;
    const run = running[u.app];
    if (!run) return true;
    const to = parseVer(u.to);
    if (!to) return true;
    return cmpVer(to, run) <= 0;
  });
}

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

const { parsed, deduped, kept, droppedDowngrades } = runPipeline(ghCommits, new Date('2026-09-17T00:00:00Z').getTime());

check('53 raw -> 45 after dedupe', deduped.length === 45, deduped.length);
check('45 -> 44 after downgrade filter', kept.length === 44, kept.length);
check('exactly 1 downgrade dropped', droppedDowngrades.length === 1, JSON.stringify(droppedDowngrades));
const d = droppedDowngrades[0] || {};
check('dropped = nextcloud 34.0.1 -> 34.0.0 (2026-06-29)', d.app === 'nextcloud' && d.from === '34.0.1' && d.to === '34.0.0' && d.date === '2026-06-29', JSON.stringify(d));

const affineKept = kept.filter((u) => u.app === 'affine');
check('both AFFiNE entries survive', affineKept.length === 2, JSON.stringify(affineKept));
check('AFFiNE kinds are build', affineKept.every((u) => u.kind === 'build'));

const kinds = {};
kept.forEach((u) => { kinds[u.kind] = (kinds[u.kind] || 0) + 1; });
console.log('kinds:', JSON.stringify(kinds), 'services:', JSON.stringify(kept.reduce((m, u) => { m[u.name] = (m[u.name] || 0) + 1; return m; }, {})));

check('dedupe keeps earliest date (seerr latest->v3.3.0 = 2026-06-30)', (() => {
  const u = kept.find((x) => x.app === 'seerr' && x.from === 'latest' && x.to === 'v3.3.0');
  return u && u.date === '2026-06-30' && u.sha === '48a3e56';
})());
check('newest first ordering', kept.every((u, i) => i === 0 || kept[i - 1].date >= u.date));
check('nextcloud 34.0.3->34.0.4 release URL', (() => {
  const u = kept.find((x) => x.app === 'nextcloud' && x.to === '34.0.4');
  return u && u.releaseUrl === 'https://github.com/nextcloud/server/releases/tag/v34.0.4';
})());
check('vaultwarden bare tag URL', (() => {
  const u = kept.find((x) => x.app === 'vaultwarden' && x.to === '1.37.3');
  return u && u.releaseUrl === 'https://github.com/dani-garcia/vaultwarden/releases/tag/1.37.3';
})());
check('vaultwarden testing->1.37.2 kind=update', (() => {
  const u = kept.find((x) => x.app === 'vaultwarden' && x.from === 'testing');
  return u && u.kind === 'update';
})());

// reconcile expectations from the brief (live runtimes as of research: nc 34.0.4, synapse 1.161.0, immich 3.2.2, vw 1.37.3, seerr 3.4.1, webui 0.11.3)
const live = runPipeline(ghCommits, new Date('2026-09-17T00:00:00Z').getTime()).kept;
const running = { 'vaultwarden': [1, 37, 3], 'matrix-synapse': [1, 161, 0], 'seerr': [3, 4, 1], 'nextcloud': [34, 0, 4], 'immich': [3, 2, 2], 'open-webui': [0, 11, 3] };
const announced = reconcile(live, running);
check('reconcile suppresses all nextcloud 35.0.0 commits', !announced.some((u) => u.app === 'nextcloud' && u.to === '35.0.0'));
check('reconcile keeps nextcloud 34.0.3 -> 34.0.4', announced.some((u) => u.app === 'nextcloud' && u.from === '34.0.3' && u.to === '34.0.4'));
check('reconcile keeps immich chain fully', announced.filter((u) => u.app === 'immich').length === live.filter((u) => u.app === 'immich').length);
check('reconcile keeps element-web (not reconcilable) at synapse runtime', announced.filter((u) => u.app === 'element-web').length === live.filter((u) => u.app === 'element-web').length);
console.log('announced after live reconcile:', announced.length, 'of', live.length);

if (failures) { console.error(failures + ' FAILURES'); process.exit(1); }
console.log('ALL CHECKS PASSED');
