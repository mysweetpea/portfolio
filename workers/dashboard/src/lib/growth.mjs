// Shared library-growth module — single source of truth.
//
// Both the dashboard worker (src/index.ts) and the unit test
// (test/growth-test.mjs) import THIS file, so the test can never drift from
// what actually ships (same pattern as updates-pipeline.mjs). Plain ES module,
// dependency-free, no network — pure functions over Jellyfin item shapes.
//
// The ONLY honest source of "when did the library grow" is `DateCreated` on
// Jellyfin items (server 10.11.11, verified live 2026-09-17). Dead ends that
// must NOT be revisited (all tested and rejected):
//   - `MinDateCreated` query param -> silently ignored by this version
//   - `MinDateLastSaved` -> filters SCAN time, returns wrong items
//   - Playback Reporting plugin -> tracks playback, NOT library additions
//   - Activity log -> only plugin install/uninstall events
//   - Date filters on /Items/Counts -> no such support

// Rolling stats window, and the initial bulk-import era as a HISTORICAL
// CONSTANT (a fact of this library's history — 2026-08-20..29). Deriving the
// era from the oldest visible item breaks once it rolls out of the rolling
// window (the oldest *visible* item becomes a pipeline day). Hardcoded; a
// future re-import updates this constant.
export const WINDOW_DAYS = 30;
export const IMPORT_ERA = { start: '2026-08-20', end: '2026-08-29' };

// Cap floor: keeps the bar scale stable as the import era rolls off and the
// window median drops toward pipeline-day levels (~17/day).
export const CAP_FLOOR = 60;

const TYPE_KEY = { Movie: 'm', Series: 's', Episode: 'e' };
const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** UTC-safe `YYYY-MM-DD` + n days (never use local-time Date math here). */
function addDays(iso, n) {
  return new Date(new Date(iso + 'T00:00:00Z').getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Bucket raw Jellyfin items by UTC day.
 * @param {Array<{Type?:string, DateCreated?:string}>} items
 * @returns {Record<string, {m:number, s:number, e:number}>} "YYYY-MM-DD" -> counts
 * `Type` maps to m/s/e; unknown types ignored; items with no/invalid
 * `DateCreated` are skipped (never crash on null/garbage).
 */
export function bucketByDay(items) {
  const days = {};
  for (const it of (Array.isArray(items) ? items : [])) {
    const k = it && TYPE_KEY[it.Type];
    const d = typeof (it && it.DateCreated) === 'string' && DATE_RE.test(it.DateCreated)
      ? it.DateCreated.slice(0, 10)
      : null;
    if (!k || !d) continue;
    if (!days[d]) days[d] = { m: 0, s: 0, e: 0 };
    days[d][k]++;
  }
  return days;
}

/**
 * Compute the full /api/growth payload (§4 shape) from bucketed days.
 * @param {Record<string, {m?:number, s?:number, e?:number}>} days bucketByDay output
 * @param {string} todayStr pinned "YYYY-MM-DD" (the worker passes the real
 *   current date — never call new Date() in here, so tests can pin time)
 * @param {{partial?:boolean}} [opts] partial=true when the fetcher hit MAX_PAGES
 */
export function computeGrowth(days, todayStr, opts) {
  const today = String(todayStr || '').slice(0, 10);
  const windowStart = addDays(today, -(WINDOW_DAYS - 1));
  const weekStart = addDays(today, -6); // last 7 days = today-6 .. today
  // Fill the window ascending INCLUDING zero days so the chart has a
  // continuous axis; totals are window-scoped only.
  const daily = [];
  const dayTotals = [];
  const totals = { movies: 0, series: 0, episodes: 0, all: 0 };
  let addedThisWeek = 0;
  let addedToday = 0;
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const date = addDays(windowStart, i);
    const b = days[date] || {};
    const m = b.m || 0, s = b.s || 0, e = b.e || 0;
    const total = m + s + e;
    daily.push({ date, m, s, e, total });
    dayTotals.push(total);
    totals.movies += m;
    totals.series += s;
    totals.episodes += e;
    totals.all += total;
    if (date >= weekStart) addedThisWeek += total;
    if (date === today) addedToday = total;
  }
  // Streak: walk back from today while the day has >= 1 addition; a missing
  // day entry is a gap (0 additions). Stops at the first gap.
  let streakDays = 0;
  for (let i = WINDOW_DAYS - 1; i >= 0 && dayTotals[i] > 0; i--) streakDays++;
  // Import/pipeline split is window-scoped (footer can never disagree with
  // the bars — they sum the exact same daily entries).
  let importTotal = 0;
  let pipelineTotal = 0;
  for (const d of daily) {
    if (d.date <= IMPORT_ERA.end) importTotal += d.total;
    else pipelineTotal += d.total;
  }
  // Cap: median over ALL window days (including zero days), x2.5, floored.
  // Import days exceed it and render clamped; pipeline days stay below.
  const sorted = dayTotals.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const capValue = Math.max(CAP_FLOOR, Math.ceil(2.5 * median));
  return {
    generated: Date.now(),
    windowDays: WINDOW_DAYS,
    windowStart,
    partial: !!(opts && opts.partial),
    daily,
    totals,
    addedThisWeek,
    addedToday,
    streakDays,
    importTotal,
    pipelineTotal,
    importEnd: IMPORT_ERA.end,
    importVisible: IMPORT_ERA.end >= windowStart,
    capValue,
  };
}
