// Unit test: library-growth math against growth-fixtures.json (REAL captured
// data, 29 days of Jellyfin DateCreated buckets, captured 2026-09-17).
//
// The growth math is IMPORTED from ../src/lib/growth.mjs — the SAME module the
// worker ships (same pattern as pipeline-test.mjs). The brief's verified
// numbers are asserted EXACTLY: 4938 / 171 / 17 / 29 / 4560 / 378 / cap 77.
//
// Run: node test/growth-test.mjs   (from workers/dashboard)
import { readFileSync } from 'node:fs';
import {
  WINDOW_DAYS, IMPORT_ERA, CAP_FLOOR, bucketByDay, computeGrowth,
} from '../src/lib/growth.mjs';

const fixture = JSON.parse(readFileSync(new URL('./growth-fixtures.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (label, cond, extra) => {
  if (cond) console.log('PASS', label);
  else { failures++; console.error('FAIL', label, extra || ''); }
};

const TODAY = '2026-09-17';
const g = computeGrowth(fixture.days, TODAY);

// ---------- window shape ----------
check('windowDays constant is 30', WINDOW_DAYS === 30, WINDOW_DAYS);
check('windowStart is 2026-08-19 (today - 29 days)', g.windowStart === '2026-08-19', g.windowStart);
check('daily has exactly 30 entries (zero-filled)', g.daily.length === 30, g.daily.length);
check('daily is ascending', g.daily.every((d, i) => i === 0 || g.daily[i - 1].date < d.date));
check('daily starts at windowStart', g.daily[0].date === '2026-08-19', g.daily[0]);
check('daily ends today', g.daily[29].date === '2026-09-17', g.daily[29]);
check('windowStart day is zero-filled', g.daily[0].total === 0 && g.daily[0].m === 0 && g.daily[0].s === 0 && g.daily[0].e === 0, g.daily[0]);
check('daily entry shape {date,m,s,e,total}', g.daily.every((d) => typeof d.date === 'string' && typeof d.m === 'number' && typeof d.s === 'number' && typeof d.e === 'number' && d.total === d.m + d.s + d.e));

// ---------- headline numbers (fixture ground truth) ----------
check('totals.all === 4938', g.totals.all === 4938, g.totals.all);
check('totals.movies === 204', g.totals.movies === 204, g.totals.movies);
check('totals.series === 204', g.totals.series === 204, g.totals.series);
check('totals.episodes === 4530', g.totals.episodes === 4530, g.totals.episodes);
check('totals.all === sum of the three', g.totals.all === g.totals.movies + g.totals.series + g.totals.episodes);
check('addedThisWeek === 171 (last 7 days 09-11..17)', g.addedThisWeek === 171, g.addedThisWeek);
check('addedToday === 17', g.addedToday === 17, g.addedToday);
check('streakDays === 29 (all 29 fixture days > 0)', g.streakDays === 29, g.streakDays);

// ---------- import/pipeline era split ----------
check('importEnd === 2026-08-29', g.importEnd === '2026-08-29', g.importEnd);
check('IMPORT_ERA matches fixture era', IMPORT_ERA.start === '2026-08-20' && IMPORT_ERA.end === '2026-08-29', JSON.stringify(IMPORT_ERA));
check('importTotal === 4560', g.importTotal === 4560, g.importTotal);
check('pipelineTotal === 378', g.pipelineTotal === 378, g.pipelineTotal);
check('import + pipeline === totals.all', g.importTotal + g.pipelineTotal === g.totals.all);
check('importVisible true (era end >= windowStart)', g.importVisible === true && IMPORT_ERA.end >= g.windowStart);

// ---------- cap ----------
check('capValue === 77 (max(60, ceil(2.5 x median 30.5)))', g.capValue === 77, g.capValue);
const pipelineDays = g.daily.filter((d) => d.date > IMPORT_ERA.end);
const importDays = g.daily.filter((d) => d.date >= IMPORT_ERA.start && d.date <= IMPORT_ERA.end);
check('no pipeline day exceeds cap (max 53)', pipelineDays.every((d) => d.total <= g.capValue), Math.max(...pipelineDays.map((d) => d.total)));
check('>= 1 import day exceeds cap', importDays.some((d) => d.total > g.capValue), importDays.filter((d) => d.total > g.capValue).length);
check('cap is window-scoped, never all-time', g.capValue < 1000);

// ---------- payload shape (§4 exact keys) ----------
check('payload carries all §4 keys', ['generated', 'windowDays', 'windowStart', 'partial', 'daily', 'totals', 'addedThisWeek', 'addedToday', 'streakDays', 'importTotal', 'pipelineTotal', 'importEnd', 'importVisible', 'capValue'].every((k) => k in g));
check('partial defaults false', g.partial === false);
check('windowDays field echoes 30', g.windowDays === 30);
check('generated is a number (ms)', typeof g.generated === 'number' && isFinite(g.generated));

// ---------- cap floor + degenerate inputs ----------
const zeroDay = computeGrowth({}, TODAY);
check('all-zero window: capValue === 60 (floor holds, never NaN)', zeroDay.capValue === CAP_FLOOR && zeroDay.capValue === 60, zeroDay.capValue);
check('empty input: totals all 0', zeroDay.totals.all === 0 && zeroDay.totals.movies === 0 && zeroDay.totals.series === 0 && zeroDay.totals.episodes === 0);
check('empty input: streak 0, week 0, today 0', zeroDay.streakDays === 0 && zeroDay.addedThisWeek === 0 && zeroDay.addedToday === 0);
check('empty input: still a full 30-day zero axis', zeroDay.daily.length === 30 && zeroDay.daily.every((d) => d.total === 0));

// ---------- fixture.counts is the ground truth (do not duplicate literals) ----------
const counts = fixture.counts || {};
check('fixture.counts present (movies/series/episodes)',
  typeof counts.movies === 'number' && typeof counts.series === 'number' && typeof counts.episodes === 'number',
  JSON.stringify(counts));
check('totals match fixture.counts (single source of truth)',
  g.totals.movies === counts.movies && g.totals.series === counts.series && g.totals.episodes === counts.episodes,
  JSON.stringify(g.totals) + ' vs ' + JSON.stringify(counts));

// ---------- partial flag propagates (MAX_PAGES contract) ----------
check('partial defaults false', g.partial === false);
check('partial:true propagates through computeGrowth', computeGrowth(fixture.days, TODAY, { partial: true }).partial === true);

// ---------- input validation + hostile shapes ----------
check('non-array input returns an empty bucket (no crash)', Object.keys(bucketByDay(null)).length === 0 && Object.keys(bucketByDay(undefined)).length === 0 && Object.keys(bucketByDay('nope')).length === 0);
// prototype-key Type must not poison a bucket (own-property guard)
const protoBucket = bucketByDay([{ Type: 'constructor', DateCreated: '2026-09-17T00:00:00Z' }, { Type: '__proto__', DateCreated: '2026-09-17T00:00:00Z' }, { Type: 'Movie', DateCreated: '2026-09-17T00:00:00Z' }]);
const protoDay = protoBucket['2026-09-17'] || {};
check('prototype-key Type values are ignored', protoDay.m === 1 && Object.keys(protoDay).sort().join(',') === 'e,m,s', JSON.stringify(Object.keys(protoDay)));
let threw = false;
try { computeGrowth({}, 'not-a-date'); } catch (e) { threw = /YYYY-MM-DD/.test(String(e && e.message)); }
check('invalid todayStr throws a clear error (not an opaque RangeError)', threw);

// ---------- gap-day streak ----------
const holed = computeGrowth({
  '2026-09-17': { m: 1, s: 0, e: 0 },
  '2026-09-16': { m: 2, s: 0, e: 0 },
  // 2026-09-15 deliberately missing = gap
  '2026-09-14': { m: 3, s: 0, e: 0 },
  '2026-09-13': { m: 4, s: 0, e: 0 },
}, TODAY);
check('streak stops at the hole (2, not 4)', holed.streakDays === 2, holed.streakDays);
check('gap day still renders as a zero bar', holed.daily.find((d) => d.date === '2026-09-15').total === 0);
check('holed window totals only count present days', holed.totals.all === 10, holed.totals.all);

// streak counts today even when only today has data
const onlyToday = computeGrowth({ '2026-09-17': { m: 5, s: 1, e: 2 } }, TODAY);
check('streak of 1 when only today has additions', onlyToday.streakDays === 1, onlyToday.streakDays);
check('a zero TODAY breaks the streak at 0', computeGrowth({ '2026-09-16': { m: 9, s: 9, e: 9 } }, TODAY).streakDays === 0);

// ---------- bucketByDay: raw items -> days ----------
const raw = [
  { Type: 'Movie', DateCreated: '2026-09-17T06:40:16.123Z' },
  { Type: 'Movie', DateCreated: '2026-09-17T09:01:00.000Z' },
  { Type: 'Series', DateCreated: '2026-09-16T22:10:00.000Z' },
  { Type: 'Episode', DateCreated: '2026-09-16T22:11:30.500Z' },
  { Type: 'Episode', DateCreated: '2026-09-15T00:00:00.000Z' },
  { Type: 'Audio', DateCreated: '2026-09-15T00:00:00.000Z' },  // unknown type ignored
  { Type: 'Movie', DateCreated: null },                         // malformed skipped
  { Type: 'Series' },                                           // missing skipped
  { Type: 'Episode', DateCreated: 'garbage' },                  // garbage skipped
  null,                                                         // null item skipped
];
const days = bucketByDay(raw);
check('bucketByDay accumulates movies per day', days['2026-09-17'].m === 2, JSON.stringify(days));
check('bucketByDay accumulates series + episodes per day', days['2026-09-16'].s === 1 && days['2026-09-16'].e === 1);
check('bucketByDay slices DateCreated to the UTC day', days['2026-09-15'].e === 1);
check('bucketByDay ignores unknown types', !('m' in (days['2026-09-15'] || {})) || days['2026-09-15'].m === 0);
check('bucketByDay: malformed DateCreated (null/garbage/missing) skipped, no crash', Object.keys(days).length === 3);
const fromRaw = computeGrowth(days, TODAY);
check('bucketByDay output computes cleanly (5 items in window)', fromRaw.totals.all === 5, fromRaw.totals.all);

// ---------- era roll-off behavior ----------
// From ~2026-09-28 the whole import era is outside the window: importVisible
// must flip false and the footer target becomes "+pipeline this month".
const afterRollOff = computeGrowth(fixture.days, '2026-09-28');
check('importVisible flips false once the era rolls off', afterRollOff.importVisible === false, afterRollOff.importVisible);
check('post-roll-off importTotal is 0 (era outside window)', afterRollOff.importTotal === 0, afterRollOff.importTotal);
check('post-roll-off totals are window-scoped (fixture days before 08-30 dropped)', afterRollOff.totals.all < g.totals.all, afterRollOff.totals.all);

// far-future today: window contains only zero days
const farFuture = computeGrowth(fixture.days, '2026-12-31');
check('far-future window: totals 0, streak 0, cap floor 60, no crash', farFuture.totals.all === 0 && farFuture.streakDays === 0 && farFuture.capValue === 60);

if (failures) { console.error(failures + ' FAILURES'); process.exit(1); }
console.log('ALL CHECKS PASSED');
