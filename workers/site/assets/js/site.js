/* ==========================================================================
   MySweetPea — Shared Site Script (site.js)
   Handles: scroll progress bar, nav shrink, reveal animations,
            glow-card tracking, and falling frost-petal canvas.
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
            }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

            revealEls.forEach(function (el) {
                revealObserver.observe(el);
            });

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
        gradient.addColorStop(0, light ? '#7A9BA4' : '#EEF2F3');
        gradient.addColorStop(0.5, light ? '#5B828D' : '#C5D5D8');
        gradient.addColorStop(1, light ? 'rgba(51, 86, 95, 0.22)' : 'rgba(143, 175, 181, 0.25)');
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
        document.querySelectorAll('.hero-btn-primary, .cta-btn').forEach(function (btn) {
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

    /* === Animated counters (skips non-numeric like N/A) === */
    var numbers = document.querySelectorAll('.stat-card .number');
    if (numbers.length && 'IntersectionObserver' in window && !reduceMotion2.matches) {
        var cObs = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                cObs.unobserve(entry.target);
                var el = entry.target;
                var target = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
                if (isNaN(target)) return;
                var suffix = el.textContent.replace(/[0-9.,]/g, '');
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
    }

    /* === Command palette (Ctrl+K / Cmd+K) === */
    var CMDK_ITEMS = [
        { label: 'Home', url: '/index.html', kind: 'page' },
        { label: 'Pricing', url: '/pricing.html', kind: 'page' },
        { label: 'Support', url: '/support.html', kind: 'page' },
        { label: 'About', url: '/about.html', kind: 'page' },
        { label: 'Suggest a Service', url: '/suggest.html', kind: 'page' },
        { label: 'Get Access', url: '/form.html', kind: 'page' },
        { label: 'Jellyfin — Media', url: '/pricing.html', kind: 'service', icon: '/assets/icons/jellyfin.svg' },
        { label: 'Nextcloud — Files', url: '/pricing.html', kind: 'service', icon: '/assets/icons/nextcloud.svg' },
        { label: 'Immich — Photos', url: '/pricing.html', kind: 'service', icon: '/assets/icons/immich.svg' },
        { label: 'Vaultwarden — Passwords', url: '/pricing.html', kind: 'service', icon: '/assets/icons/vaultwarden.svg' },
        { label: 'Matrix — Chat', url: '/pricing.html', kind: 'service', icon: '/assets/icons/matrix.svg' },
        { label: 'AFFiNE — Notes', url: '/pricing.html', kind: 'service', icon: '/assets/icons/affine.svg' },
        { label: 'Syncthing — Sync', url: '/pricing.html', kind: 'service', icon: '/assets/icons/syncthing.svg' },
        { label: 'Open WebUI — AI', url: '/pricing.html', kind: 'service', icon: '/assets/icons/openwebui.svg' },
        { label: 'Seerr — Requests', url: '/pricing.html', kind: 'service', icon: '/assets/icons/seerr.svg' }
    ];

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
    var cmdkFiltered = CMDK_ITEMS;

    function cmdkRender() {
        if (!cmdkFiltered.length) {
            cmdkList.innerHTML = '<div class="cmdk-empty">No matches found.</div>';
            return;
        }
        cmdkList.innerHTML = cmdkFiltered.map(function (item, i) {
            var icon = item.icon ? '<img src="' + item.icon + '" alt="" loading="lazy">' : '';
            return '<a class="cmdk-item' + (i === cmdkActive ? ' active' : '') + '" href="' + item.url + '" role="option" data-i="' + i + '">' +
                icon + '<span>' + item.label + '</span><span class="cmdk-kind">' + item.kind + '</span></a>';
        }).join('');
    }

    function cmdkOpen() {
        backdrop.classList.add('open');
        cmdkInput.value = '';
        cmdkFiltered = CMDK_ITEMS;
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
        cmdkFiltered = CMDK_ITEMS.filter(function (item) { return item.label.toLowerCase().indexOf(q) !== -1; });
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
