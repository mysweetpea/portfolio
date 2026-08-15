/* ==========================================================================
   MySweetPea — Shared Site Script (site.js)
   Handles: scroll progress bar, nav shrink, reveal animations,
            glow-card tracking, and falling frost-petal canvas.
   ========================================================================== */
(function () {
    'use strict';

    /* Mark html as JS-enabled so reveal animations only hide content
       when JS is actually running (prevents blank/unfinished pages). */
    document.documentElement.classList.add('js');

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

    /* === Scroll reveal animations === */
    var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

    function forceRevealAll() {
        revealEls.forEach(function (el) {
            el.classList.add('visible');
        });
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
            }, { threshold: 0.1, rootMargin: '0px 0px -10% 0px' });

            revealEls.forEach(function (el) {
                revealObserver.observe(el);
            });
        }
    }

    /* === Smooth auto-grow textareas ===
       Grows the textarea height smoothly as the user types, so it never
       shows a scrollbar and feels elegant. Respects reduced-motion. */
    var autoGrow = reduceMotion.matches ? false : true;
    document.querySelectorAll('textarea.form-input, textarea').forEach(function (ta) {
        if (!autoGrow) return;
        ta.style.overflow = 'hidden';
        ta.style.resize = 'none';
        ta.style.transition = 'height .18s ease';
        function grow() {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        }
        grow();
        ta.addEventListener('input', grow);
        window.addEventListener('resize', grow);
    });

    /* === Glow-card mouse tracking === */
    if (finePointer.matches && !reduceMotion.matches) {
        document.querySelectorAll('.glow-card').forEach(function (card) {
            var rafId = null;
            var mouseX = 0;
            var mouseY = 0;

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


    /* === Mobile hamburger navigation === */
    var navToggle = document.querySelector('.nav-toggle');
    var navLinks = document.getElementById('nav-links');
    if (navToggle && navLinks) {
        navToggle.addEventListener('click', function () {
            var open = navLinks.classList.toggle('nav-open');
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        /* Close menu when a link is chosen */
        navLinks.addEventListener('click', function (event) {
            if (event.target.closest('a')) {
                navLinks.classList.remove('nav-open');
                navToggle.setAttribute('aria-expanded', 'false');
            }
        });

        /* Close on Escape and return focus to the toggle */
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && navLinks.classList.contains('nav-open')) {
                navLinks.classList.remove('nav-open');
                navToggle.setAttribute('aria-expanded', 'false');
                navToggle.focus();
            }
        });

        /* Focus trap: keep Tab cycling within the open mobile menu */
        navLinks.addEventListener('keydown', function (event) {
            if (!navLinks.classList.contains('nav-open')) return;
            if (event.key !== 'Tab') return;
            var focusables = Array.prototype.slice.call(navLinks.querySelectorAll('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'));
            if (!focusables.length) return;
            var first = focusables[0];
            var last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        });

        /* Move focus into the menu when it opens */
        navToggle.addEventListener('click', function () {
            if (navLinks.classList.contains('nav-open')) {
                var firstLink = navLinks.querySelector('a[href], button, summary');
                if (firstLink) firstLink.focus();
            }
        });

        /* Reset state if resized back to desktop */
        window.addEventListener('resize', function () {
            if (window.innerWidth > 768) {
                navLinks.classList.remove('nav-open');
                navToggle.setAttribute('aria-expanded', 'false');
            }
        }, { passive: true });
    }

    /* === Falling frost petals canvas === */
    var canvas = document.getElementById('petalCanvas');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var petals = [];
    var width = 0;
    var height = 0;
    var dpr = 1;
    var rafId = null;
    var resizeTimer = null;
    var lastViewportWidth = 0;
    var PETAL_COUNT = 22;

    function resize(force) {
        var nextWidth = window.innerWidth;
        var nextHeight = window.innerHeight;

        /* Ignore mobile browser-chrome height changes unless explicitly forced. */
        if (!force && nextWidth === lastViewportWidth) return;

        width = nextWidth;
        height = nextHeight;
        lastViewportWidth = nextWidth;
        dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function createPetal() {
        return {
            x: Math.random() * width,
            y: -20,
            size: 3 + Math.random() * 6,
            speedY: 0.35 + Math.random() * 0.9,
            speedX: -0.3 + Math.random() * 0.6,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: -0.012 + Math.random() * 0.024,
            opacity: 0.08 + Math.random() * 0.16,
            sway: Math.random() * Math.PI * 2,
            swaySpeed: 0.008 + Math.random() * 0.014,
            tone: Math.random() // 0 = frost/ice, 1 = sage/green
        };
    }

    function drawPetal(petal) {
        ctx.save();
        ctx.translate(petal.x, petal.y);
        ctx.rotate(petal.rotation);
        ctx.globalAlpha = petal.opacity;

        var light = document.documentElement.getAttribute('data-theme') === 'light';
        var gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, petal.size);
        if (petal.tone > 0.5) {
            /* sage/green tone */
            gradient.addColorStop(0, light ? '#7EAD93' : '#C4E1CC');
            gradient.addColorStop(0.5, light ? '#5D8D72' : '#A3C9B6');
            gradient.addColorStop(1, light ? 'rgba(64, 105, 81, 0.24)' : 'rgba(93, 122, 110, 0.28)');
        } else {
            /* frost/ice tone */
            gradient.addColorStop(0, light ? '#A9C4C9' : '#DDE6E8');
            gradient.addColorStop(0.5, light ? '#7E9FA8' : '#B8CDD2');
            gradient.addColorStop(1, light ? 'rgba(94, 130, 145, 0.22)' : 'rgba(143, 175, 181, 0.26)');
        }
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
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

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
        if (document.hidden) stop();
        else start();
    });

    reduceMotion.addEventListener('change', function (event) {
        if (event.matches) {
            stop();
            forceRevealAll();
        } else {
            start();
        }
    });

    start();
    window.addEventListener('load', function () {
        if (rafId === null) start();
    }, { once: true });
})();


/* ==========================================================================
   Premium pack: theme toggle, back-to-top, magnetic CTAs, counters,
   command palette (Ctrl+K)
   ========================================================================== */
(function () {
    'use strict';

    var reduceMotion2 = window.matchMedia('(prefers-reduced-motion: reduce)');

    /* === Theme: load saved or system preference === */
    var root = document.documentElement;
    var saved = null;
    try { saved = localStorage.getItem('msp-theme'); } catch (e) {}
    if (saved) root.setAttribute('data-theme', saved);
    else if (window.matchMedia('(prefers-color-scheme: light)').matches) root.setAttribute('data-theme', 'light');

    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            root.setAttribute('data-theme', next);
            try { localStorage.setItem('msp-theme', next); } catch (e) {}
        });
    });

    /* === Back to top === */
    var btt = document.querySelector('.back-to-top');
    if (btt) {
        var bttTick = false;
        window.addEventListener('scroll', function () {
            if (bttTick) return;
            bttTick = true;
            requestAnimationFrame(function () {
                btt.classList.toggle('visible', window.scrollY > 600);
                bttTick = false;
            });
        }, { passive: true });
    }

    /* === Magnetic CTAs (fine pointers only) === */
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduceMotion2.matches) {
        document.querySelectorAll('.hero-btn-primary, .cta-btn, .form-submit, .nav-cta, .compare-cta').forEach(function (btn) {
            var raf = null;
            btn.addEventListener('pointermove', function (e) {
                if (raf !== null) return;
                raf = requestAnimationFrame(function () {
                    var r = btn.getBoundingClientRect();
                    var dx = (e.clientX - r.left - r.width / 2) / r.width;
                    var dy = (e.clientY - r.top - r.height / 2) / r.height;
                    btn.style.transform = 'translate(' + (dx * 6) + 'px,' + (dy * 4 - 2) + 'px)';
                    raf = null;
                });
            }, { passive: true });
            btn.addEventListener('pointerleave', function () {
                btn.style.transform = '';
            });
        });
    }

    /* === Animated counters (uses data-target/data-suffix, falls back to text) === */
    var numbers = document.querySelectorAll('.stat-card .number, .number[data-target]');
    if (numbers.length && 'IntersectionObserver' in window && !reduceMotion2.matches) {
        var cObs = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                cObs.unobserve(entry.target);
                var el = entry.target;
                var target = parseFloat(el.getAttribute('data-target'));
                var suffix = el.getAttribute('data-suffix') || '';
                if (isNaN(target)) {
                    target = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
                    suffix = suffix || el.textContent.replace(/[0-9.,]/g, '');
                }
                if (isNaN(target)) return;
                var start = performance.now(), dur = 1400;
                (function tick(now) {
                    var t = Math.min((now - start) / dur, 1);
                    var eased = 1 - Math.pow(1 - t, 3);
                    el.textContent = Math.round(target * eased) + suffix;
                    if (t < 1) requestAnimationFrame(tick);
                })(start);
            });
        }, { threshold: 0.4 });
        numbers.forEach(function (n) { cObs.observe(n); });
    } else {
        /* Reduced motion / no IO: set final values immediately */
        document.querySelectorAll('.number[data-target]').forEach(function (el) {
            el.textContent = el.getAttribute('data-target') + (el.getAttribute('data-suffix') || '');
        });
    }

    /* === Command palette (Ctrl+K / Cmd+K) — dynamic index ===
       Pages are discovered from the nav links (present on every page) and
       services from the services page DOM — new pages or service cards
       appear in search automatically, no code changes needed. */
    var CMDK_ITEMS = [];
    var CMDK_SERVICES_LOADED = false;

    function cmdkBuildIndex() {
        var items = [];
        var seen = {};

        // 1. Pages from nav links (skip external links like GitHub)
        document.querySelectorAll('.nav-logo[href], .nav-btn, .nav-more-menu a').forEach(function (a) {
            var href = a.getAttribute('href');
            if (!href || href.indexOf('http') === 0 || href.indexOf('mailto:') === 0) return;
            var label = a.textContent.trim();
            if (!label || seen[href]) return;
            seen[href] = true;
            items.push({ label: label, url: href, kind: 'page' });
        });

        // 2. Services from the services page (fetched once, cached)
        if (!CMDK_SERVICES_LOADED) {
            CMDK_SERVICES_LOADED = true;
            fetch('/services.html')
                .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
                .then(function (html) {
                    var doc = new DOMParser().parseFromString(html, 'text/html');
                    doc.querySelectorAll('.service-card[data-service]').forEach(function (card) {
                        var h3 = card.querySelector('h3');
                        if (!h3) return;
                        var nameEl = h3.cloneNode(true);
                        nameEl.querySelectorAll('.live-badge, .status-dot, .acct-pill').forEach(function (n) { n.remove(); });
                        var name = nameEl.textContent.trim();
                        var icon = card.querySelector('.service-icon img');
                        var desc = card.querySelector('p');
                        items.push({
                            label: name,
                            url: '/services.html',
                            kind: 'service',
                            icon: icon ? icon.getAttribute('src') : '',
                            desc: desc ? desc.textContent.trim() : ''
                        });
                    });
                    CMDK_ITEMS = items;
                    if (backdrop.classList.contains('open')) cmdkRender();
                })
                .catch(function () { /* nav-only index is fine */ });
        }
        return items;
    }

    var backdrop = document.createElement('div');
    backdrop.className = 'cmdk-backdrop';
    backdrop.innerHTML =
        '<div class="cmdk" role="dialog" aria-modal="true" aria-label="Quick navigation">' +
            '<input class="cmdk-input" type="text" placeholder="Jump to a page or service..." aria-label="Search pages and services">' +
            '<div class="cmdk-list" role="listbox"></div>' +
            '<div class="cmdk-hint"><span><kbd>&#x2191;&#x2193;</kbd> navigate</span><span><kbd>&#x23CE;</kbd> open</span><span><kbd>esc</kbd> close</span></div>' +
        '</div>';
    document.body.appendChild(backdrop);

    var cmdkInput = backdrop.querySelector('.cmdk-input');
    var cmdkList = backdrop.querySelector('.cmdk-list');
    var cmdkActive = 0;
    var cmdkFiltered = [];

    function cmdkRender() {
        if (!cmdkFiltered.length) {
            cmdkList.innerHTML = '<div class="cmdk-empty">No matches found.</div>';
            return;
        }
        cmdkList.innerHTML = cmdkFiltered.map(function (item, i) {
            var icon = item.icon ? '<img src="' + item.icon + '" alt="" loading="lazy">' : '';
            var desc = item.desc ? '<span class="cmdk-desc">' + item.desc + '</span>' : '';
            return '<a class="cmdk-item' + (i === cmdkActive ? ' active' : '') + '" href="' + item.url + '" role="option" data-i="' + i + '">' +
                icon + '<span class="cmdk-label">' + item.label + desc + '</span><span class="cmdk-kind">' + item.kind + '</span></a>';
        }).join('');
    }

    function cmdkOpen() {
        backdrop.classList.add('open');
        cmdkInput.value = '';
        cmdkFiltered = cmdkBuildIndex();
        cmdkActive = 0;
        cmdkRender();
        cmdkInput.focus();
    }
    function cmdkClose() {
        backdrop.classList.remove('open');
    }

    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            backdrop.classList.contains('open') ? cmdkClose() : cmdkOpen();
            return;
        }
        if (!backdrop.classList.contains('open')) return;
        if (e.key === 'Escape') cmdkClose();
        else if (e.key === 'ArrowDown') { e.preventDefault(); cmdkActive = Math.min(cmdkActive + 1, cmdkFiltered.length - 1); cmdkRender(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkActive = Math.max(cmdkActive - 1, 0); cmdkRender(); }
        else if (e.key === 'Enter' && cmdkFiltered[cmdkActive]) { window.location.href = cmdkFiltered[cmdkActive].url; }
    });

    cmdkInput.addEventListener('input', function () {
        var q = cmdkInput.value.trim().toLowerCase();
        cmdkFiltered = CMDK_ITEMS.filter(function (item) {
            if (item.label.toLowerCase().indexOf(q) !== -1) return true;
            if (item.desc && item.desc.toLowerCase().indexOf(q) !== -1) return true;
            return false;
        });
        cmdkActive = 0;
        cmdkRender();
    });


    /* === Search trigger buttons open the palette === */
    document.querySelectorAll('.nav-search').forEach(function (btn) {
        btn.addEventListener('click', cmdkOpen);
    });

    backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) cmdkClose();
    });
})();

/* === Global copy-email buttons (class="copy-email-btn" data-copy="...") ===
   Copies the address and shows "Copied!" feedback so users know it worked. */
(function() {
    document.addEventListener('click', function(e) {
        var btn = e.target.closest('.copy-email-btn');
        if (!btn) { return; }
        var text = btn.getAttribute('data-copy') || btn.getAttribute('data-email') || '';
        if (!text) { return; }
        var done = function() {
            var orig = btn.textContent;
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(function() { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(done);
        } else {
            var ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (err) {}
            document.body.removeChild(ta); done();
        }
    });
})();

/* ==========================================================================
   v35: Scroll-linked hero fade, welcome modal, card stagger, auto theme
   ========================================================================== */
(function () {
    'use strict';

    /* === Scroll-linked hero fade ===
       Only fade the hero once the user has scrolled past most of it,
       so the headline, buttons, and steps stay readable while on screen. */
    var hero = document.querySelector('.hero');
    if (hero) {
        var heroTick = false;
        function heroFadeThreshold() {
            return Math.max(hero.offsetHeight * 0.85, window.innerHeight * 0.6);
        }
        window.addEventListener('scroll', function () {
            if (heroTick) return;
            heroTick = true;
            requestAnimationFrame(function () {
                hero.classList.toggle('hero-faded', window.scrollY > heroFadeThreshold());
                heroTick = false;
            });
        }, { passive: true });
        window.addEventListener('resize', function () { hero.classList.toggle('hero-faded', window.scrollY > heroFadeThreshold()); });
    }

    /* === Card entrance stagger (index-based) === */
    var grids = document.querySelectorAll('.features-grid, .services-grid, .coming-soon-grid, .testimonials-grid, .members-teaser-grid');
    grids.forEach(function (grid) {
        Array.prototype.forEach.call(grid.children, function (card, i) {
            var delay = Math.min(i * 0.08, 0.5);
            card.style.transitionDelay = delay + 's';
        });
    });

    /* === Auto theme from OS preference (only if no saved choice) === */
    var root = document.documentElement;
    var savedTheme = null;
    try { savedTheme = localStorage.getItem('msp-theme'); } catch (e) {}
    if (!savedTheme && window.matchMedia('(prefers-color-scheme: light)').matches) {
        root.setAttribute('data-theme', 'light');
    }

    /* === First-visit welcome modal — removed per request === */
})();

/* ==========================================================================
   v37: Garden pollen particles + vine dividers
   ========================================================================== */
(function () {
    'use strict';
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduceMotion.matches) return;

    /* === Floating garden pollen particles === */
    var pollen = document.createElement('div');
    pollen.className = 'garden-pollen';
    pollen.setAttribute('aria-hidden', 'true');
    document.body.appendChild(pollen);

    var COUNT = 14;
    for (var i = 0; i < COUNT; i++) {
        var span = document.createElement('span');
        var size = 3 + Math.random() * 5;
        span.style.width = size + 'px';
        span.style.height = size + 'px';
        span.style.left = (Math.random() * 100) + '%';
        span.style.animationDuration = (12 + Math.random() * 14) + 's';
        span.style.animationDelay = (Math.random() * 12) + 's';
        pollen.appendChild(span);
    }

    /* === Vine divider SVG (injected into .vine-divider elements) === */
    var vineSvg = '<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        /* main stems */
        '<path d="M32 6C22 10 16 20 18 32c2 12 12 20 14 26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M32 6c10 4 16 14 14 26-2 12-12 20-14 26" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".5"/>' +
        /* leaves along left stem */
        '<path d="M20 18c-4-1-7-5-6-9 4 0 7 4 6 9Z" fill="currentColor" opacity=".6"/>' +
        '<path d="M19 26c-4-1-7-5-6-9 4 0 7 4 6 9Z" fill="currentColor" opacity=".5"/>' +
        '<path d="M19 34c-4-1-7-5-6-9 4 0 7 4 6 9Z" fill="currentColor" opacity=".4"/>' +
        /* leaves along right stem */
        '<path d="M44 18c4-1 7-5 6-9-4 0-7 4-6 9Z" fill="currentColor" opacity=".6"/>' +
        '<path d="M45 26c4-1 7-5 6-9-4 0-7 4-6 9Z" fill="currentColor" opacity=".5"/>' +
        '<path d="M45 34c4-1 7-5 6-9-4 0-7 4-6 9Z" fill="currentColor" opacity=".4"/>' +
        /* tendrils (curls) */
        '<path d="M18 32c-5-1-8-5-7-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>' +
        '<path d="M46 32c5-1 8-5 7-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>' +
        /* center bloom */
        '<circle cx="32" cy="32" r="3" fill="currentColor" opacity=".8"/>' +
        '<circle cx="32" cy="32" r="5.5" fill="none" stroke="currentColor" stroke-width="1" opacity=".4"/>' +
        '</svg>';
    document.querySelectorAll('.vine-divider').forEach(function (el) {
        el.innerHTML = vineSvg;
    });
})();

/* ==========================================================================
   v40: Live status, notify buttons, dashboard teaser, redeem live check
   ========================================================================== */
(function () {
    'use strict';

    /* === Live service status pill (home page) ===
       Shows REAL data from Uptime Kuma. Never claims "all operational"
       when the API is unreachable — that would hide real outages. */
    var homeStatus = document.getElementById('homeStatus');
    var homeStatusText = document.getElementById('homeStatusText');
    var homeStatusDot = document.getElementById('homeStatusDot');
    if (homeStatus && homeStatusText) {
        var STATUS_NAMES = {
            1: 'Vaultwarden', 2: 'Matrix', 3: 'AFFiNE', 4: 'KoalaSync',
            5: 'Jellyfin', 6: 'Seerr', 7: 'Nextcloud', 8: 'Immich', 9: 'Open WebUI'
        };
        fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/homelab')
            .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
            .then(function (data) {
                var hb = data && data.heartbeatList;
                if (!hb) throw new Error('no data');
                var down = [];
                Object.keys(hb).forEach(function (id) {
                    var list = hb[id];
                    if (!list || !list.length) return;
                    var last = list[list.length - 1];
                    if (last.status !== 1) {
                        down.push(STATUS_NAMES[id] || ('Service ' + id));
                    }
                });
                if (down.length === 0) {
                    homeStatusText.textContent = 'All systems operational';
                    homeStatus.classList.remove('degraded', 'offline');
                    homeStatus.classList.add('online');
                } else {
                    homeStatusText.textContent = down.length + ' of 9 services down: ' + down.join(', ');
                    homeStatus.classList.remove('online');
                    homeStatus.classList.add('offline');
                }
            })
            .catch(function () {
                // API unreachable — say so honestly instead of faking "operational".
                homeStatusText.textContent = 'Status unavailable — check the status page';
                homeStatus.classList.remove('online');
                homeStatus.classList.add('degraded');
            });
    }

    /* === Notify-me buttons (coming-soon services) — removed per request === */

    /* === Redeem: live invite-code check === */
    var rcCode = document.getElementById('rc-code');
    var rcHint = document.getElementById('rc-code-hint');
    var rcIcon = document.getElementById('rc-code-icon');
    if (rcCode && rcHint) {
        var checkTimer = null;
        function resetRcIcon() {
            if (rcIcon) rcIcon.classList.remove('show', 'valid', 'invalid');
        }
        rcCode.addEventListener('input', function () {
            clearTimeout(checkTimer);
            resetRcIcon();
            var code = rcCode.value.trim();
            if (code.length < 8) { rcHint.textContent = 'Enter the code exactly as it appears in your email.'; rcHint.classList.remove('success', 'error'); return; }
            checkTimer = setTimeout(function () {
                fetch('https://subscribe.mysweetpea.cc/webhook/check-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ invite_code: code })
                }).then(function (r) { return r.text().then(function(t){ if(t){try{return JSON.parse(t);}catch(e){return {ok:r.ok};}} return {ok:r.ok}; }); })
                  .then(function (data) {
                      if (data.ok) {
                          rcHint.textContent = 'Code looks good — continue with your details.';
                          rcHint.classList.remove('error');
                          rcHint.classList.add('success');
                          if (rcIcon) { rcIcon.classList.add('show', 'valid'); rcIcon.classList.remove('invalid'); rcIcon.textContent = '✓'; }
                      } else {
                          rcHint.textContent = data.msg || 'That code doesn\'t look right.';
                          rcHint.classList.remove('success');
                          rcHint.classList.add('error');
                          if (rcIcon) { rcIcon.classList.add('show', 'invalid'); rcIcon.classList.remove('valid'); rcIcon.textContent = '×'; }
                      }
                  })
                  .catch(function () { /* leave default hint */ });
            }, 600);
        });
    }
})();

/* === Update meta theme-color on theme change === */
(function () {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    function update() {
        var light = document.documentElement.getAttribute('data-theme') === 'light';
        meta.setAttribute('content', light ? '#D8E1DD' : '#0C1316');
    }
    update();
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () { setTimeout(update, 50); });
    });
})();

/* ==========================================================================
   v42: View-switcher (no-scroll tabs) — pricing + services
   ========================================================================== */
(function () {
    'use strict';
    document.querySelectorAll('.view-switcher').forEach(function (switcher) {
        var tabs = switcher.querySelectorAll('.view-tab');
        var panels = switcher.querySelectorAll('.view-panel');

        function activate(view) {
            tabs.forEach(function (t) {
                var active = t.getAttribute('data-view') === view;
                t.classList.toggle('active', active);
                t.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            panels.forEach(function (p) {
                var active = p.getAttribute('data-view') === view;
                p.classList.toggle('active', active);
                // Reveal any .reveal elements inside the now-active panel so
                // FAQ/content isn't stuck hidden when switching tabs.
                if (active) {
                    p.querySelectorAll('.reveal').forEach(function (el) {
                        el.classList.add('visible');
                    });
                }
            });
        }

        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                activate(tab.getAttribute('data-view'));
            });
        });

        // Support deep-linking: ?view=services opens that tab
        var params = new URLSearchParams(window.location.search);
        var initial = params.get('view');
        if (initial) activate(initial);
    });
})();

/* ==========================================================================
   v45: Global click delegation — CSP-safe replacement for inline onclick
   handlers. The worker's strict CSP (script-src nonce-only) blocks inline
   event handler attributes, so every page's onclick=... is bound here via
   data-action attributes. Keep this in sync with the pages.
   ========================================================================== */
(function () {
    'use strict';

    document.addEventListener('click', function (event) {
        var el = event.target.closest('[data-action]');
        if (!el) return;
        var action = el.getAttribute('data-action');

        if (action === 'close-portal') {
            var portal = document.getElementById('portalReveal');
            if (portal) {
                portal.classList.remove('open');
                portal.setAttribute('aria-hidden', 'true');
                var v = portal.querySelector('video');
                if (v) v.pause();
            }
            return;
        }
        if (action === 'back-to-top') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (action === 'toggle-faq') {
            var item = el.parentElement;
            var open = item.classList.toggle('open');
            el.setAttribute('aria-expanded', String(open));
            return;
        }
        if (action === 'close-modal') {
            if (typeof closeModal === 'function') closeModal();
            return;
        }
        if (action === 'select-crypto') {
            if (typeof selectCrypto === 'function') selectCrypto(el, el.getAttribute('data-type'));
            return;
        }
        if (action === 'copy-wallet') {
            if (typeof copyWallet === 'function') copyWallet();
            return;
        }
    });
})();

/* ==========================================================================
   v45: Hermes-style portal easter egg — click "Support the Project" on
   about.html to reveal the girl-with-moon full-screen (like hermes-agent.nousresearch.com)
   ========================================================================== */
(function () {
    'use strict';
    var supportCta = document.getElementById('supportCta');
    if (!supportCta) return;
    supportCta.addEventListener('click', function (e) {
        var portal = document.getElementById('portalReveal');
        if (!portal) return;
        e.preventDefault();
        portal.classList.add('open');
        portal.setAttribute('aria-hidden', 'false');
        var v = portal.querySelector('video');
        if (v) { v.currentTime = 0; v.play().catch(function () {}); }
        document.body.style.overflow = 'hidden';
    });
    var portal = document.getElementById('portalReveal');
    if (portal) {
        portal.addEventListener('click', function (e) {
            if (e.target === portal) {
                portal.classList.remove('open');
                portal.setAttribute('aria-hidden', 'true');
                var v = portal.querySelector('video');
                if (v) v.pause();
                document.body.style.overflow = '';
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && portal.classList.contains('open')) {
                portal.classList.remove('open');
                portal.setAttribute('aria-hidden', 'true');
                var v = portal.querySelector('video');
                if (v) v.pause();
                document.body.style.overflow = '';
            }
        });
    }
})();

/* ==========================================================================
   v44: Home value-tabs (Privacy / Ownership / Community)
   ========================================================================== */
(function () {
    'use strict';
    var tabs = document.querySelectorAll('.value-tab');
    var cards = document.querySelectorAll('.features-grid .feature-card');
    if (!tabs.length || !cards.length) return;

    function show(value) {
        tabs.forEach(function (t) {
            t.classList.toggle('active', t.getAttribute('data-value') === value);
        });
        cards.forEach(function (c) {
            c.classList.toggle('show', c.getAttribute('data-value') === value);
        });
    }

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            show(tab.getAttribute('data-value'));
        });
    });

    // Show the first value's cards by default
    var initial = tabs[0].getAttribute('data-value');
    show(initial);
})();
