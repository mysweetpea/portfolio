/* === Live status from Uptime Kuma === */
    (function () {
        var summary = document.getElementById('status-summary');
        var summaryText = summary ? summary.querySelector('strong') : null;
        var summaryTime = summary ? summary.querySelector('time') : null;
        var rows = document.querySelectorAll('.status-line[data-service-key]');
        var metricUptime = null;
        var metricLive = null;
        var metricIncidents = null;

        // Map our service keys to Uptime Kuma monitor IDs
        var MONITOR_IDS = {
            vaultwarden: 1, matrix: 2, affine: 3, koalasync: 4,
            jellyfin: 5, seerr: 6, nextcloud: 7, immich: 8, openwebui: 9
        };
        // Reverse map: monitor ID -> service key
        var ID_TO_KEY = {};
        Object.keys(MONITOR_IDS).forEach(function (k) { ID_TO_KEY[MONITOR_IDS[k]] = k; });
        // Status page slug in Uptime Kuma (public URL /status/public)
        var STATUS_SLUG = 'public';

        // 40-tick recent-checks strip, oldest -> newest left -> right.
        // Slots without a beat are padded with t-none on the LEFT.
        var STRIP_TICKS = 40;

        function fmtHM(d) {
            if (!d || isNaN(d.getTime())) return '?';
            var hh = String(d.getHours()).padStart(2, '0');
            var mm = String(d.getMinutes()).padStart(2, '0');
            return hh + ':' + mm;
        }

        function renderStrip(card, list) {
            var strip = card.querySelector('.sc-strip');
            if (!strip) return;
            strip.textContent = '';
            // Kuma returns beats NEWEST-FIRST; normalize to oldest -> newest so
            // slice(-STRIP_TICKS) takes the MOST RECENT checks and ticks run
            // left-to-right = oldest-to-newest (was silently wrong before).
            var all = list.slice().sort(function (a, b) {
                return String(a.time).localeCompare(String(b.time));
            });
            var beats = all.slice(-STRIP_TICKS);
            var pad = STRIP_TICKS - beats.length;
            var i, tick;
            // Latency scaling: per-service min-max over THIS strip's pings so a
            // quiet 100ms service and a spiky 1s service both use the full band.
            var pings = [];
            for (i = 0; i < beats.length; i++) {
                if (beats[i] && typeof beats[i].ping === 'number' && beats[i].status === 1) pings.push(beats[i].ping);
            }
            var pmin = pings.length ? Math.min.apply(null, pings) : 0;
            var pmax = pings.length ? Math.max.apply(null, pings) : 0;
            var pspan = Math.max(pmax - pmin, 1);
            for (i = 0; i < pad; i++) {
                tick = document.createElement('i');
                tick.className = 't-none';
                strip.appendChild(tick);
            }
            beats.forEach(function (h) {
                tick = document.createElement('i');
                var isDown = h && h.status === 0;
                tick.className = isDown ? 't-down' : '';
                // Height = measured response time (floor 18% so ticks stay
                // visible; down beats stay full-height in error red).
                if (!isDown && h && typeof h.ping === 'number') {
                    var frac = 0.18 + 0.82 * ((h.ping - pmin) / pspan);
                    tick.style.setProperty('--h', Math.round(frac * 100) + '%');
                }
                if (h && h.time) {
                    var t = h.time;
                    tick.setAttribute('data-tip',
                        (isDown ? 'DOWN' : (typeof h.ping === 'number' ? h.ping + ' ms' : 'up')) +
                        ' · ' + t.slice(11, 16) + ' srv');
                }
                strip.appendChild(tick);
            });
        }

        function setRow(row, up, pct, list) {
            var badge = row.querySelector('.status-badge');
            var label = row.querySelector('.badge-label');
            var dot = row.querySelector('.status-dot');
            var uptimeEl = row.querySelector('.sc-uptime');
            var checksEl = row.querySelector('.sc-checks');
            var pctEl = row.querySelector('.line-pct');
            if (badge) {
                badge.classList.remove('status-online', 'status-down');
                badge.classList.add(up ? 'status-online' : 'status-down');
            }
            if (label) label.textContent = up ? 'Operational' : 'Down';
            if (dot) dot.classList.toggle('status-down', !up);
            var win = (window.UPTIME_WIN && window.UPTIME_WIN[row.dataset.serviceKey]) || null;
            if (uptimeEl) uptimeEl.textContent = (pct != null) ? ((win ? win + 'd ' : '') + pct + '%') : 'uptime —';
            if (pctEl) pctEl.textContent = (pct != null) ? pct + '%' : '—';
            if (checksEl && list && list.length) {
                var h = list[list.length - 1];
                var t = h && h.time ? new Date(String(h.time).replace(' ', 'T')) : null;
                checksEl.textContent = (t && !isNaN(t)) ? ('last ' + fmtHM(t) + ' srv') : 'last —';
            }
            // Avg latency over the strip window (up beats only) — the strip's
            // heights encode per-beat ping; this chip gives the scale anchor.
            var latEl = row.querySelector('.line-lat');
            if (latEl) {
                var lat = [];
                for (var li = 0; li < (list || []).length; li++) {
                    var lb = list[li];
                    if (lb && lb.status === 1 && typeof lb.ping === 'number') lat.push(lb.ping);
                }
                latEl.textContent = lat.length
                    ? '~' + Math.round(lat.reduce(function (a, b) { return a + b; }, 0) / lat.length) + ' ms'
                    : '— ms';
            }
            row.classList.toggle('is-down', !up);
            renderStrip(row, list || []);
        }

        // Fetch the status page heartbeat (single call, object keyed by monitor ID)
        fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/' + STATUS_SLUG)
            .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
            .then(function (data) {
                if (!data || !data.heartbeatList) return Promise.reject();
                var hb = data.heartbeatList; // { "<monitorId>": [heartbeats...], ... }
                // uptimeList keys are "<monitorId>_<durationDays>" (e.g. "1_24"),
                // values are fractions 0..1 — normalize to a monitorId -> pct map
                var uptimePct = {}; var uptimeWin = {};
                if (data.uptimeList) {
                    Object.keys(data.uptimeList).forEach(function (k) {
                        var parts = k.split('_');
                        var id = parts[0], days = parts[1] ? parseInt(parts[1], 10) : 0;
                        var v = data.uptimeList[k];
                        if (typeof v === 'number' && (uptimePct[id] == null || days > uptimeWin[id])) {
                            uptimePct[id] = Math.round(v * 1000) / 10; uptimeWin[id] = days;
                        }
                    });
                }
                window.UPTIME_WIN = uptimeWin;
                var upCount = 0, total = 0;
                var uptimeSum = 0, uptimeCount = 0;
                Object.keys(hb).forEach(function (id) {
                    var key = ID_TO_KEY[id];
                    if (!key) return;
                    var row = document.querySelector('.status-line[data-service-key="' + key + '"]');
                    if (!row) return;
                    var list = hb[id];
                    if (!list || !list.length) return;
                    var h = list[list.length - 1];
                    var up = h.status === 1;
                    if (up) upCount++;
                    total++;
                    var pct = uptimePct[id] != null ? uptimePct[id] : null;
                    if (pct != null) { uptimeSum += pct; uptimeCount++; }
                    setRow(row, up, pct, list);
                });
                if (summaryText) summaryText.textContent = upCount + ' of ' + total + ' operational';
                if (summaryTime) summaryTime.textContent = 'Updated ' + new Date().toLocaleDateString();
                // Connect the metric cards to real data
                if (uptimeCount) {
                    var avg = Math.round((uptimeSum / uptimeCount) * 10) / 10;
                    var wins = Object.keys(uptimeWin).map(function (k) { return uptimeWin[k]; });
                    var win = wins.length ? Math.min.apply(null, wins) : null;
                    var headPct = document.getElementById('summary-pct');
                    if (headPct) headPct.textContent = (win ? win + 'd avg ' : '') + avg + '%';
                }
            })
            .catch(function () {
                // Status feed unreachable (network error, CORS, non-OK, or malformed
                // payload). The static markup says "9 of 9 operational" — showing that
                // during a monitoring outage would fabricate an all-green page exactly
                // when accuracy matters most. Mark every card unknown and say so.
                // Strips are left EMPTY — never fake beats.
                if (summaryText) summaryText.textContent = 'Status unavailable';
                if (summaryTime) summaryTime.textContent = 'Live data unreachable';
                if (summary) {
                    summary.classList.remove('status-all-online');
                    summary.classList.add('status-degraded');
                }
                rows.forEach(function (card) {
                    var dot = card.querySelector('.status-dot');
                    if (dot) {
                        dot.classList.add('status-unknown');
                        dot.style.animation = 'none';
                    }
                    var badge = card.querySelector('.status-badge');
                    if (badge) {
                        badge.classList.remove('status-online', 'status-down');
                        badge.classList.add('status-unknown');
                    }
                    var label = card.querySelector('.badge-label');
                    if (label) label.textContent = 'Unknown';
                    var checksEl = card.querySelector('.sc-checks');
                    if (checksEl) checksEl.textContent = 'live data unavailable';
                });
                if (metricUptime) metricUptime.textContent = '—';
                if (metricLive) metricLive.textContent = '—';
            });
    })();

    /* === Incidents from n8n webhook (Telegram bot /incident command) === */
    (function () {
        var panel = document.querySelector('.incidents-panel');
        if (!panel) return;
        var title = panel.querySelector('.incidents-title');
        var empty = panel.querySelector('.incidents-empty');
        var container = panel.querySelector('.incident-item');
        if (container) container.remove();

        fetch('https://subscribe.mysweetpea.cc/webhook/incidents')
            .then(function (r) { return r.text().then(function(t){ if(t){try{return JSON.parse(t);}catch(e){return [];}} return []; }); })
            .then(function (data) {
                var list = Array.isArray(data) ? data : (data && data.incidents) || [];
                if (!list.length) {
                    if (empty) empty.hidden = false;
                    return;
                }
                if (empty) empty.hidden = true;
                // Update the Active incidents metric
                var activeCount = list.filter(function (i) { return i.status !== 'resolved'; }).length;
                var countEl = document.getElementById('active-incidents-count');
                var barEl = document.getElementById('active-incidents-bar');
                if (countEl) countEl.textContent = activeCount;
                if (barEl) barEl.style.width = Math.min(100, activeCount * 20) + '%';
                list.forEach(function (inc) {
                    var item = document.createElement('div');
                    item.className = 'incident-item ' + (inc.status === 'resolved' ? 'incident-resolved' : 'incident-active');
                    var date = document.createElement('div');
                    date.className = 'incident-date';
                    date.textContent = inc.date || new Date().toLocaleDateString();
                    var body = document.createElement('div');
                    body.className = 'incident-body';
                    var strong = document.createElement('strong');
                    strong.textContent = inc.title || 'Incident';
                    body.appendChild(strong);
                    if (inc.description) body.appendChild(document.createTextNode(' — ' + inc.description));
                    var badge = document.createElement('span');
                    badge.className = 'incident-badge';
                    badge.textContent = inc.status === 'resolved' ? 'Resolved' : 'Active';
                    body.appendChild(badge);
                    item.appendChild(date);
                    item.appendChild(body);
                    panel.appendChild(item);
                });
            })
            .catch(function () { /* keep static fallback */ });
    })();
