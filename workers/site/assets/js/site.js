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

        var gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, petal.size);
        gradient.addColorStop(0, '#EEF2F3');
        gradient.addColorStop(0.5, '#C5D5D8');
        gradient.addColorStop(1, 'rgba(143, 175, 181, 0.25)');
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
