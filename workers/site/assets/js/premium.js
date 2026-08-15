/* ==========================================================================
   MySweetPea — Premium Pack JS (2026-08)
   Count-up stats, rippling ASCII hero, toast notifications, live service
   dots, footer status widget. Loaded after site.js on all pages.
   ========================================================================== */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    /* === 1. Count-up stats (hero proof row) === */
    function animateCount(el) {
        var target = parseFloat(el.getAttribute('data-count'));
        if (isNaN(target)) return;
        var suffix = el.getAttribute('data-suffix') || '';
        var decimals = (String(target).split('.')[1] || '').length;
        var duration = 1200;
        var start = null;
        function step(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            var val = target * eased;
            el.textContent = (decimals ? val.toFixed(decimals) : Math.round(val)) + suffix;
            if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    var proofStats = document.querySelectorAll('.proof-value[data-count]');
    if (proofStats.length) {
        if (reduceMotion.matches) {
            proofStats.forEach(function (el) {
                el.textContent = el.getAttribute('data-count') + (el.getAttribute('data-suffix') || '');
            });
        } else {
            var proofObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        animateCount(entry.target);
                        proofObserver.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.4 });
            proofStats.forEach(function (el) { proofObserver.observe(el); });
        }
    }

    /* === 2. Rippling ASCII hero (openclaw.ai-style) ===
       A 220x26 char grid where each cell's brightness is a sine wave
       radiating from the center (distance d, time t):
         b = (0.5 + 0.5*sin(d*0.3 - t*0.35))^3.5
       Mapped through the dither ramp ' .:-=+xX#8@' with a 4x4 threshold
       pattern for organic anti-aliasing. The center stays a calm dark
       void — the site logo floats there. Pauses off-screen / hidden tab. */
    var asciiPre = document.getElementById('asciiRipple');
    if (asciiPre) {
        var asciiLogo = document.createElement('img');
        asciiLogo.className = 'ascii-logo';
        asciiLogo.src = '/logo.svg';
        asciiLogo.alt = '';
        asciiLogo.width = 150;
        asciiLogo.height = 150;
        asciiLogo.loading = 'eager';
        asciiLogo.decoding = 'async';
        asciiPre.parentNode.appendChild(asciiLogo);

        var COLS = 220, ROWS = 26;
        var RAMP = ' .:-=+xX#8@';
        var THRESH = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
        var CELLS = [];
        for (var r = 0; r < ROWS; r++) {
            for (var c = 0; c < COLS; c++) {
                var dx = c - COLS / 2;
                var dy = (ROWS - 1 - r) * 1.9;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var envelope = Math.pow(Math.sin(Math.atan2(dy, dx)), 2);
                var fadeIn = Math.min(Math.max(1.15 - dist / 110, 0), 1);
                var fadeOut = Math.min(Math.max((dist - 24) / 18, 0), 1);
                CELLS.push({
                    dist: dist,
                    env: envelope * fadeIn * fadeOut * 1.4,
                    thr: (THRESH[r % 4][c % 4] + 0.5) / 16
                });
            }
        }

        function renderRipple(t) {
            var out = '';
            for (var i = 0; i < CELLS.length; i++) {
                var cell = CELLS[i];
                var wave = Math.pow(0.5 + 0.5 * Math.sin(cell.dist * 0.3 - t * 0.35), 3.5) * cell.env;
                if (wave < 0.05) wave = 0;
                wave = Math.min(Math.max(wave, 0), 1);
                var v = wave * 10;
                var idx = Math.min(10, Math.floor(v) + (v % 1 > cell.thr ? 1 : 0));
                out += RAMP.charAt(idx);
                if ((i + 1) % COLS === 0) out += '\n';
            }
            asciiPre.textContent = out;
        }

        var rafId = 0, running = false, visible = true, reduced = false;
        var lastTs = 0;
        function frame(ts) {
            if (!visible || !running) { rafId = 0; return; }
            if (ts - lastTs >= 100) { lastTs = ts; renderRipple(ts / 1000); }
            rafId = requestAnimationFrame(frame);
        }
        function start() { if (!running && !reduced) { running = true; lastTs = 0; rafId = requestAnimationFrame(frame); } }
        function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
        document.addEventListener('visibilitychange', function () {
            visible = !document.hidden;
            visible ? start() : stop();
        });
        var asciiObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) start(); else stop();
            });
        }, { rootMargin: '160px 0px' });
        asciiObserver.observe(asciiPre);

        // Reduced-motion: render one static frame instead of animating
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            reduced = true;
            renderRipple(1.2);
        } else {
            renderRipple(0);
            start();
        }
    }

    /* === 3. Toast notifications === */
    var toastStack = null;
    function ensureToastStack() {
        if (!toastStack) {
            toastStack = document.createElement('div');
            toastStack.className = 'toast-stack';
            toastStack.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastStack);
        }
        return toastStack;
    }
    window.showToast = function (message, type) {
        var stack = ensureToastStack();
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + (type || 'info');
        var text = document.createElement('span');
        text.textContent = message;
        var close = document.createElement('button');
        close.className = 'toast-close';
        close.setAttribute('aria-label', 'Dismiss');
        close.textContent = '\u00d7';
        close.addEventListener('click', function () { dismiss(); });
        toast.appendChild(text);
        toast.appendChild(close);
        stack.appendChild(toast);
        function dismiss() {
            toast.classList.add('toast-out');
            setTimeout(function () { toast.remove(); }, 260);
        }
        setTimeout(dismiss, 5000);
        return toast;
    };

    /* === 4. Live status dots on service cards (services page) === */
    var SERVICE_MONITORS = {
        vaultwarden: 1, matrix: 2, affine: 3, koalasync: 4,
        jellyfin: 5, seerr: 6, nextcloud: 7, immich: 8, openwebui: 9
    };
    var cards = document.querySelectorAll('.service-card[data-service]');
    if (cards.length) {
        fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/homelab')
            .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
            .then(function (data) {
                var hb = data && data.heartbeatList;
                if (!hb) return;
                cards.forEach(function (card) {
                    var key = card.getAttribute('data-service');
                    var id = SERVICE_MONITORS[key];
                    if (!id) return;
                    var list = hb[id];
                    if (!list || !list.length) return;
                    var up = list[list.length - 1].status === 1;
                    var dot = card.querySelector('.status-dot');
                    if (!dot) return;
                    dot.classList.remove('status-down', 'status-unknown');
                    if (!up) dot.classList.add('status-down');
                    dot.title = up ? 'Operational' : 'Down';
                    dot.setAttribute('aria-label', up ? 'Status: operational' : 'Status: down');
                });
            })
            .catch(function () {
                cards.forEach(function (card) {
                    var dot = card.querySelector('.status-dot');
                    if (dot) dot.classList.add('status-unknown');
                });
            });
    }

    /* === 5. Footer status widget === */
    var footerStatus = document.getElementById('footerStatus');
    var footerStatusText = document.getElementById('footerStatusText');
    if (footerStatus && footerStatusText) {
        fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/homelab')
            .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
            .then(function (data) {
                var hb = data && data.heartbeatList;
                if (!hb) throw new Error('no data');
                var down = 0, total = 0;
                Object.keys(hb).forEach(function (id) {
                    var list = hb[id];
                    if (!list || !list.length) return;
                    total++;
                    if (list[list.length - 1].status !== 1) down++;
                });
                if (down === 0) {
                    footerStatusText.textContent = 'All systems operational';
                    footerStatus.classList.add('online');
                } else {
                    footerStatusText.textContent = down + ' of ' + total + ' services down';
                    footerStatus.classList.add('offline');
                }
            })
            .catch(function () {
                footerStatusText.textContent = 'Status unavailable';
                footerStatus.classList.add('degraded');
            });
    }
})();
