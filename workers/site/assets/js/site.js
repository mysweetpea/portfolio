/* ==========================================================================
   MySweetPea — Shared Site Script (site.js)
   Handles: scroll progress bar, nav shrink, reveal animations,
            glow-card tracking, falling frost-petal canvas
   ========================================================================== */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    /* === Scroll progress bar === */
    var progress = document.getElementById('scrollProgress');
    if (progress) {
        var ticking = false;
        window.addEventListener('scroll', function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(function () {
                var max = document.documentElement.scrollHeight - window.innerHeight;
                progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
                ticking = false;
            });
        }, { passive: true });
    }

    /* === Nav shrink on scroll === */
    var nav = document.querySelector('.top-nav');
    if (nav) {
        window.addEventListener('scroll', function () {
            nav.classList.toggle('nav-scrolled', window.scrollY > 40);
        }, { passive: true });
    }

    /* === Scroll reveal animations ===
       Strategy: staggered reveal on load for above-fold elements,
       IntersectionObserver for the rest, plus a safety-net timer that
       force-reveals everything so content can never get stuck hidden. */
    var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

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

            /* Reveal anything already in the viewport immediately after load
               (covers browsers where the observer races first paint) */
            window.addEventListener('load', function () {
                revealEls.forEach(function (el) {
                    var rect = el.getBoundingClientRect();
                    if (rect.top < window.innerHeight && rect.bottom > 0) {
                        el.classList.add('visible');
                        revealObserver.unobserve(el);
                    }
                });
            });

            /* Safety net: nothing stays hidden longer than 2.5s */
            setTimeout(forceRevealAll, 2500);
        }
    }

    /* === Glow card mouse tracking === */
    document.querySelectorAll('.glow-card').forEach(function (card) {
        card.addEventListener('mousemove', function (e) {
            var rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', (e.clientX - rect.left) + 'px');
            card.style.setProperty('--mouse-y', (e.clientY - rect.top) + 'px');
        });
    });
    /* === Falling frost petals canvas === */
    var canvas = document.getElementById('petalCanvas');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var petals = [];
    var W, H, rafId = null;
    var PETAL_COUNT = 22;

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }

    function createPetal() {
        return {
            x: Math.random() * W,
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

    function drawPetal(p) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        var grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
        grad.addColorStop(0, '#EEF2F3');
        grad.addColorStop(0.5, '#C5D5D8');
        grad.addColorStop(1, 'rgba(143, 175, 181, 0.25)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.bezierCurveTo(p.size * 0.6, -p.size * 0.5, p.size * 0.6, p.size * 0.5, 0, p.size);
        ctx.bezierCurveTo(-p.size * 0.6, p.size * 0.5, -p.size * 0.6, -p.size * 0.5, 0, -p.size);
        ctx.fill();
        ctx.restore();
    }

    function animate() {
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < petals.length; i++) {
            var p = petals[i];
            p.sway += p.swaySpeed;
            p.x += p.speedX + Math.sin(p.sway) * 0.4;
            p.y += p.speedY;
            p.rotation += p.rotSpeed;
            if (p.y > H + 20) petals[i] = createPetal();
            if (p.x < -20) p.x = W + 20;
            if (p.x > W + 20) p.x = -20;
            drawPetal(petals[i]);
        }
        rafId = requestAnimationFrame(animate);
    }

    function start() {
        if (rafId !== null || reduceMotion.matches) return;
        resize();
        petals.length = 0;
        for (var i = 0; i < PETAL_COUNT; i++) {
            var p = createPetal();
            p.y = Math.random() * H;
            petals.push(p);
        }
        animate();
    }

    function stop() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        petals.length = 0;
        if (ctx) ctx.clearRect(0, 0, W || 0, H || 0);
    }

    window.addEventListener('resize', resize, { passive: true });

    /* Pause when tab hidden, always restart when visible */
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start();
    });

    /* Respect reduced-motion changes at runtime */
    reduceMotion.addEventListener('change', function (e) {
        if (e.matches) stop(); else start();
    });

    /* Start on load — and again shortly after, in case the first
       attempt ran before the canvas had its final dimensions */
    start();
    window.addEventListener('load', function () {
        if (rafId === null) start();
    });
})();
