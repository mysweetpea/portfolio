/* ==========================================================================
   MySweetPea — Premium Pack JS (2026-08)
   Count-up stats, service ticker, toast notifications, live service dots,
   footer status widget. Loaded after site.js on all pages.
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

    /* === 2. Service ticker (duplicate track for seamless loop) === */
    var tickerTrack = document.querySelector('.ticker-track');
    if (tickerTrack) {
        var clone = tickerTrack.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        tickerTrack.parentNode.appendChild(clone);
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
