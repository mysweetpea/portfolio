/* ==========================================================================
   MySweetPea — Shared Site Script (site.js) — v2
   Scroll progress, nav shrink, reveal (JS stagger), glow cards, drawer nav,
   "More" popover, theme toggle, back-to-top, counters, command palette,
   lazy petal canvas, form validation + toasts.
   ========================================================================== */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    function requestFrameOnce(callback) {
        var queued = false;
        return function () {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () {
                queued = false;
                callback();
            });
        };
    }

    /* === Theme toggle (persisted, respects OS preference) === */
    (function themeInit() {
        var stored = null;
        try { stored = localStorage.getItem('msp-theme'); } catch (e) {}
        var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
        var theme = stored || (prefersLight ? 'light' : 'dark');
        document.documentElement.setAttribute('data-theme', theme);

        document.addEventListener('click', function (event) {
            var btn = event.target.closest('.theme-toggle');
            if (!btn) return;
            var current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
            var next = current === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('msp-theme', next); } catch (e) {}
        });
    })();

    /* === Scroll progress bar === */
    var progress = document.getElementById('scrollProgress');
    if (progress) {
        var updateProgress = requestFrameOnce(function () {
            var max = document.documentElement.scrollHeight - window.innerHeight;
            progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
        });
        updateProgress();
        window.addEventListener('scroll', updateProgress, { passive: true });
        window.addEventListener('resize', updateProgress, { passive: true });
    }

    /* === Nav shrink on scroll === */
    var nav = document.querySelector('.top-nav');
    if (nav) {
        var updateNav = requestFrameOnce(function () {
            nav.classList.toggle('nav-scrolled', window.scrollY > 40);
        });
        updateNav();
        window.addEventListener('scroll', updateNav, { passive: true });
    }

    /* === Back to top visibility === */
    var backToTop = document.querySelector('.back-to-top');
    if (backToTop) {
        var updateBtt = requestFrameOnce(function () {
            backToTop.classList.toggle('show', window.scrollY > 600);
        });
        updateBtt();
        window.addEventListener('scroll', updateBtt, { passive: true });
    }

    /* === Scroll reveal with JS-driven stagger === */
    var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

    /* Assign stagger indices within each reveal group so long pages don't
       accumulate huge hardcoded delays. */
    (function assignStagger() {
        var groups = {};
        revealEls.forEach(function (el) {
            var parent = el.parentElement || document.body;
            if (!groups[parent]) groups[parent] = 0;
            if (!el.style.getPropertyValue('--stagger') &&
                !el.className.match(/reveal-delay-/)) {
                el.style.setProperty('--stagger', Math.min(groups[parent], 6));
            }
            groups[parent]++;
        });
    })();

    function forceRevealAll() {
        revealEls.forEach(function (el) { el.classList.add('visible'); });
    }

    if (revealEls.length) {
        if (reduceMotion.matches || !('IntersectionObserver' in window)) {
            forceRevealAll();
        } else {
            var revealObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                        revealObserver.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

            revealEls.forEach(function (el) { revealObserver.observe(el); });

            window.addEventListener('load', function () {
                revealEls.forEach(function (el) {
                    var rect = el.getBoundingClientRect();
                    if (rect.top < window.innerHeight && rect.bottom > 0) {
                        el.classList.add('visible');
                        revealObserver.unobserve(el);
                    }
                });
            }, { once: true });

            window.setTimeout(forceRevealAll, 2500);
        }
    }

    /* === Glow-card mouse tracking === */
    if (finePointer.matches && !reduceMotion.matches) {
        document.querySelectorAll('.glow-card').forEach(function (card) {
            var rafId = null;
            var mouseX = 0, mouseY = 0;
            card.addEventListener('pointermove', function (event) {
                var rect = card.getBoundingClientRect();
                mouseX = event.clientX - rect.left;
                mouseY = event.clientY - rect.top;
                if (rafId !== null) return;
                rafId = requestAnimationFrame(function () {
                    card.style.setProperty('--mouse-x', mouseX + 'px');
                    card.style.setProperty('--mouse-y', mouseY + 'px');
                    rafId = null;
                });
            }, { passive: true });
        });
    }

    /* === Mobile drawer nav === */
    var navToggle = document.querySelector('.nav-toggle');
    var navLinks = document.getElementById('nav-links');
    if (navToggle && navLinks) {
        function setDrawer(open) {
            navLinks.classList.toggle('nav-open', open);
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            document.body.style.overflow = open ? 'hidden' : '';
        }
        navToggle.addEventListener('click', function () {
            setDrawer(!navLinks.classList.contains('nav-open'));
        });
        navLinks.addEventListener('click', function (event) {
            if (event.target.closest('a')) setDrawer(false);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && navLinks.classList.contains('nav-open')) {
                setDrawer(false);
                navToggle.focus();
            }
        });
        window.addEventListener('resize', function () {
            if (window.innerWidth > 860) setDrawer(false);
        }, { passive: true });
    }

    /* === "More" popover menu (replaces <details>) === */
    (function moreMenu() {
        var btn = document.querySelector('.nav-more-btn');
        var menu = document.querySelector('.nav-more-menu');
        if (!btn || !menu) return;
        var items = Array.prototype.slice.call(menu.querySelectorAll('a'));

        function setOpen(open) {
            menu.classList.toggle('open', open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        function isOpen() { return menu.classList.contains('open'); }

        btn.addEventListener('click', function (event) {
            event.stopPropagation();
            setOpen(!isOpen());
        });
        document.addEventListener('click', function (event) {
            if (isOpen() && !menu.contains(event.target)) setOpen(false);
        });
        document.addEventListener('keydown', function (event) {
            if (!isOpen()) return;
            if (event.key === 'Escape') { setOpen(false); btn.focus(); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                var idx = items.indexOf(document.activeElement);
                var next = event.key === 'ArrowDown'
                    ? (idx + 1) % items.length
                    : (idx - 1 + items.length) % items.length;
                items[next].focus();
            }
        });
    })();

    /* === Animated counters ([data-target]) === */
    var counters = document.querySelectorAll('[data-target]');
    if (counters.length && 'IntersectionObserver' in window) {
        var counterObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el = entry.target;
                var target = parseInt(el.getAttribute('data-target'), 10);
                counterObserver.unobserve(el);
                if (isNaN(target)) return;
                var suffix = el.getAttribute('data-suffix') || '';
                var current = 0;
                var increment = target / 30;
                var timer = setInterval(function () {
                    current += increment;
                    if (current >= target) { current = target; clearInterval(timer); }
                    el.textContent = Math.floor(current) + suffix;
                }, 30);
            });
        }, { threshold: 0.4 });
        counters.forEach(function (el) { counterObserver.observe(el); });
    }

    /* === Toast helper === */
    window.mspToast = function (message, type) {
        var toast = document.createElement('div');
        toast.className = 'toast' + (type ? ' toast-' + type : '');
        toast.setAttribute('role', 'status');
        toast.innerHTML = '<span class="toast-icon" aria-hidden="true">&#10003;</span>' +
            '<span></span>';
        toast.lastChild.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(function () { toast.classList.add('show'); });
        setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () { toast.remove(); }, 350);
        }, 2200);
    };

    /* === Form field validation (inline messages) === */
    document.querySelectorAll('.form-input[required], .form-select[required], .form-textarea[required]')
        .forEach(function (field) {
            var msg = document.createElement('div');
            msg.className = 'field-msg';
            msg.setAttribute('aria-live', 'polite');
            field.insertAdjacentElement('afterend', msg);

            function validate(showSuccess) {
                var value = field.value.trim();
                var valid = field.checkValidity() && value.length > 0;
                field.classList.toggle('invalid', !valid && value.length > 0);
                field.classList.toggle('valid', valid);
                if (!valid && value.length > 0) {
                    msg.textContent = field.validity.typeMismatch
                        ? 'Please enter a valid value.'
                        : 'This field is required.';
                    msg.className = 'field-msg error';
                } else if (valid && showSuccess) {
                    msg.textContent = 'Looks good.';
                    msg.className = 'field-msg success';
                } else {
                    msg.textContent = '';
                    msg.className = 'field-msg';
                }
                return valid;
            }
            field.addEventListener('blur', function () { validate(true); });
            field.addEventListener('input', function () {
                if (field.classList.contains('invalid')) validate(false);
            });
        });

    /* === Command palette (Ctrl+K / Cmd+K) === */
    (function commandPalette() {
        var trigger = document.querySelector('.nav-search');
        if (!trigger) return;

        var PAGES = [
            { name: 'Home', url: '/index.html', kind: 'page' },
            { name: 'Services', url: '/services.html', kind: 'page' },
            { name: 'How It Works', url: '/pricing.html', kind: 'page' },
            { name: 'Get Access', url: '/form.html', kind: 'page' },
            { name: 'I Have a Code', url: '/redeem.html', kind: 'page' },
            { name: 'Donate', url: '/support.html', kind: 'page' },
            { name: 'Suggest a Service', url: '/suggest.html', kind: 'page' },
            { name: 'Contact', url: '/contact.html', kind: 'page' },
            { name: 'Status', url: '/status.html', kind: 'page' },
            { name: 'About', url: '/about.html', kind: 'page' }
        ];

        var backdrop = null, input = null, list = null, selected = 0, results = [];

        function build() {
            backdrop = document.createElement('div');
            backdrop.className = 'cmdk-backdrop';
            backdrop.innerHTML =
                '<div class="cmdk" role="dialog" aria-modal="true" aria-label="Search">' +
                '<input class="cmdk-input" type="text" placeholder="Search pages and services…" aria-label="Search pages and services">' +
                '<div class="cmdk-list" role="listbox"></div>' +
                '<div class="cmdk-hint">&uarr;&darr; to navigate &middot; Enter to open &middot; Esc to close</div>' +
                '</div>';
            document.body.appendChild(backdrop);
            input = backdrop.querySelector('.cmdk-input');
            list = backdrop.querySelector('.cmdk-list');

            backdrop.addEventListener('click', function (e) {
                if (e.target === backdrop) close();
            });
            input.addEventListener('input', render);
            input.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    selected = e.key === 'ArrowDown'
                        ? (selected + 1) % results.length
                        : (selected - 1 + results.length) % results.length;
                    paint();
                } else if (e.key === 'Enter' && results[selected]) {
                    window.location.href = results[selected].url;
                } else if (e.key === 'Escape') {
                    close();
                }
            });
        }
        function render() {
            var q = input.value.trim().toLowerCase();
            results = PAGES.filter(function (p) {
                return !q || p.name.toLowerCase().indexOf(q) !== -1;
            });
            selected = 0;
            paint();
        }
        function paint() {
            if (!results.length) {
                list.innerHTML = '<div class="cmdk-empty">No matches found.</div>';
                return;
            }
            list.innerHTML = results.map(function (p, i) {
                return '<a class="cmdk-item' + (i === selected ? ' selected' : '') +
                    '" href="' + p.url + '" role="option">' + p.name +
                    '<span class="cmdk-kind">' + p.kind + '</span></a>';
            }).join('');
        }
        function open() {
            if (!backdrop) build();
            backdrop.classList.add('open');
            input.value = '';
            render();
            setTimeout(function () { input.focus(); }, 30);
        }
        function close() {
            if (backdrop) backdrop.classList.remove('open');
        }
        trigger.addEventListener('click', open);
        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                open();
            }
        });
    })();

    /* === Falling frost petals — lazily mounted === */
    var canvas = document.getElementById('petalCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var petals = [];
    var width = 0, height = 0, dpr = 1;
    var rafId = null, resizeTimer = null, lastViewportWidth = 0;
    var PETAL_COUNT = 22;

    function resize(force) {
        var nextWidth = window.innerWidth;
        var nextHeight = window.innerHeight;
        if (!force && nextWidth === lastViewportWidth) return;
        width = nextWidth; height = nextHeight; lastViewportWidth = nextWidth;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function createPetal() {
        return {
            x: Math.random() * width, y: -20,
            size: 3 + Math.random() * 6,
            speedY: 0.35 + Math.random() * 0.9,
            speedX: -0.3 + Math.random() * 0.6,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: -0.012 + Math.random() * 0.024,
            opacity: 0.08 + Math.random() * 0.16,
            sway: Math.random() * Math.PI * 2,
            swaySpeed: 0.008 + Math.random() * 0.014
        };
    }
    function drawPetal(petal) {
        ctx.save();
        ctx.translate(petal.x, petal.y);
        ctx.rotate(petal.rotation);
        ctx.globalAlpha = petal.opacity;
        var light = document.documentElement.getAttribute('data-theme') === 'light';
        var gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, petal.size);
        gradient.addColorStop(0, light ? '#7EAD93' : '#C4E1CC');
        gradient.addColorStop(0.5, light ? '#5D8D72' : '#A3C9B6');
        gradient.addColorStop(1, light ? 'rgba(64, 105, 81, 0.24)' : 'rgba(93, 122, 110, 0.28)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, -petal.size);
        ctx.bezierCurveTo(petal.size * 0.6, -petal.size * 0.5, petal.size * 0.6, petal.size * 0.5, 0, petal.size);
        ctx.bezierCurveTo(-petal.size * 0.6, petal.size * 0.5, -petal.size * 0.6, -petal.size * 0.5, 0, -petal.size);
        ctx.fill();
        ctx.restore();
    }
    function animate() {
        ctx.clearRect(0, 0, width, height);
        for (var i = 0; i < petals.length; i++) {
            var petal = petals[i];
            petal.sway += petal.swaySpeed;
            petal.x += petal.speedX + Math.sin(petal.sway) * 0.4;
            petal.y += petal.speedY;
            petal.rotation += petal.rotSpeed;
            if (petal.y > height + 20) petals[i] = createPetal();
            if (petal.x < -20) petal.x = width + 20;
            if (petal.x > width + 20) petal.x = -20;
            drawPetal(petals[i]);
        }
        rafId = requestAnimationFrame(animate);
    }
    function start() {
        if (rafId !== null || reduceMotion.matches || document.hidden) return;
        resize(true);
        petals.length = 0;
        for (var i = 0; i < PETAL_COUNT; i++) {
            var petal = createPetal();
            petal.y = Math.random() * height;
            petals.push(petal);
        }
        animate();
    }
    function stop() {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        petals.length = 0;
        ctx.clearRect(0, 0, width, height);
    }

    window.addEventListener('resize', function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
            if (window.innerWidth !== lastViewportWidth) resize(false);
        }, 150);
    }, { passive: true });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start();
    });
    reduceMotion.addEventListener('change', function (event) {
        if (event.matches) { stop(); forceRevealAll(); } else { start(); }
    });

    /* Defer canvas startup until the browser is idle. */
    if ('requestIdleCallback' in window) {
        requestIdleCallback(function () { start(); }, { timeout: 2000 });
    } else {
        window.addEventListener('load', function () { start(); }, { once: true });
    }
})();
