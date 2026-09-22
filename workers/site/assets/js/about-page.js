/* MySweetPea — about.html only (Exhibit v2, Sep 2026). Standalone file.
   1) Live uptime: fetch the Uptime-Kuma status-page heartbeat and average the
      24h uptime across monitors 1-9 (same fetch/parse pattern as
      status-page.js, but self-contained — no shared code).
   2) Count-up for [data-count] values: IO threshold 0.5, ease-out cubic,
      1200ms, runs once. Respects prefers-reduced-motion (skips animation).
   Honesty rule: if live data is unreachable we keep the server-rendered 99.9
   fallback but SAY so — never fake liveness. */
(function () {
    'use strict';

    var reducedMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- count-up ---------- */

    function decimalsOf(str) {
        var i = String(str).indexOf('.');
        return i === -1 ? 0 : String(str).length - i - 1;
    }

    function animateCount(el) {
        var target = parseFloat(el.getAttribute('data-count'));
        if (isNaN(target)) return;
        var dec = decimalsOf(el.getAttribute('data-count'));
        var t0 = performance.now();
        function tick(t) {
            var p = Math.min(1, (t - t0) / 1200);
            var v = 1 - Math.pow(1 - p, 3);
            // last frame re-reads data-count: the live-value fetch may have updated it mid-animation
            var tgt = p < 1 ? target : parseFloat(el.getAttribute('data-count'));
            if (isNaN(tgt)) tgt = target;
            if (p < 1) {
                el.textContent = (v * tgt).toFixed(dec);
                requestAnimationFrame(tick);
            } else {
                el.textContent = tgt.toFixed(dec);
            }
        }
        requestAnimationFrame(tick);
    }

    var pctEl = document.getElementById('aboutUptimePct');
    var pctFired = false;

    if (!reducedMotion && 'IntersectionObserver' in window) {
        var cio = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (!e.isIntersecting) return;
                cio.unobserve(e.target);
                if (e.target === pctEl) pctFired = true;
                animateCount(e.target);
            });
        }, { threshold: 0.5 });
        var nodes = document.querySelectorAll('[data-count]');
        for (var i = 0; i < nodes.length; i++) cio.observe(nodes[i]);
    }

    /* ---------- live uptime (monitors 1-9, 24h windows) ---------- */

    var MONITOR_IDS = {
        vaultwarden: 1,
        matrix: 2,
        affine: 3,
        koalasync: 4,
        jellyfin: 5,
        seerr: 6,
        nextcloud: 7,
        immich: 8,
        openwebui: 9
    };

    var stateEl = document.getElementById('aboutUptimeState');
    var tickerEl = document.getElementById('aboutTickerState');

    function markUnreachable() {
        if (stateEl) {
            var dot = stateEl.querySelector('.about-x-dot');
            if (dot) {
                dot.classList.remove('about-x-dot-on');
                dot.classList.add('about-x-dot-off');
                while (dot.nextSibling) stateEl.removeChild(dot.nextSibling);
                stateEl.appendChild(
                    document.createTextNode('Uptime — live data unreachable')
                );
            } else {
                stateEl.textContent = 'Uptime — live data unreachable';
            }
        }
        if (tickerEl) tickerEl.textContent = 'STATUS UNAVAILABLE';
    }

    var aborter = ('AbortController' in window) ? new AbortController() : null;
    var abortTimer = aborter ? setTimeout(function () { aborter.abort(); }, 10000) : 0;
    fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/public', aborter ? { signal: aborter.signal } : {})
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (data) {
            if (!data || !data.uptimeList || !pctEl) return Promise.reject();
            // uptimeList keys are "<monitorId>_24", values are fractions 0..1
            var sum = 0, n = 0;
            Object.keys(MONITOR_IDS).forEach(function (name) {
                var v = data.uptimeList[MONITOR_IDS[name] + '_24'];
                if (typeof v === 'number' && v >= 0 && v <= 1) { sum += v; n++; }
            });
            if (!n) return Promise.reject();
            var avg = Math.round((sum / n) * 10) / 10;
            var s = avg.toFixed(1);
            if (pctFired || reducedMotion || !('IntersectionObserver' in window)) {
                // animation already ran (or will never run): show the live value.
                // data-count too — a count-up still in flight re-reads it on its final frame.
                pctEl.setAttribute('data-count', s);
                pctEl.textContent = s;
            } else {
                // not fired yet: aim the count-up at the real number
                pctEl.setAttribute('data-count', s);
            }
        })
        .then(function () { if (abortTimer) clearTimeout(abortTimer); })
        .catch(markUnreachable); })();
