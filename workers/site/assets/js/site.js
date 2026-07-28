/* ==========================================================================
   MySweetPea — Shared Site Script (site.js)
   Handles: scroll progress bar, nav shrink, reveal animations,
            glow-card hover, falling petal canvas
            (with reduced-motion + tab-visibility guards)
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

    /* === Scroll reveal animations === */
    var revealEls = document.querySelectorAll('.reveal');
    if (revealEls.length) {
        if (reduceMotion.matches || !('IntersectionObserver' in window)) {
            revealEls.forEach(function (el) { el.classList.add('visible'); });
        } else {
            var revealObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                        revealObserver.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });
            revealEls.forEach(function (el) { revealObserver.observe(el); });
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

    /* === Falling petals canvas === */
    var canvas = document.getElementById('petalCanvas');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var petals = [];
    var W, H, rafId = null;

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }

    function createPetal() {
        return {
            x: Math.random() * W,
            y: -20,
            size: 4 + Math.random() * 8,
            speedY: 0.5 + Math.random() * 1.5,
            speedX: -0.5 + Math.random() * 1,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: -0.02 + Math.random() * 0.04,
            opacity: 0.12 + Math.random() * 0.25,
            sway: Math.random() * Math.PI * 2,
            swaySpeed: 0.01 + Math.random() * 0.02
        };
    }

    function drawPetal(p) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        var grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
        grad.addColorStop(0, '#F0F8F6');
        grad.addColorStop(0.5, '#5EB8A8');
        grad.addColorStop(1, 'rgba(94, 184, 168, 0.3)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.bezierCurveTo(p.size * 0.6, -p.size * 0.5, p.size * 0.6, p.size * 0.5, 0, p.size);
        ctx.bezierCurveTo(-p.size * 0.6, p.size * 0.5, -p.size * 0.6, -p.size * 0.5, 0, -p.size);
        ctx.fill();
        ctx.strokeStyle = 'rgba(94,184,168,0.4)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.restore();
    }

    function animate() {
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < petals.length; i++) {
            var p = petals[i];
            p.sway += p.swaySpeed;
            p.x += p.speedX + Math.sin(p.sway) * 0.5;
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
        if (rafId !== null || reduceMotion.matches || document.hidden) return;
        resize();
        for (var i = 0; i < 40; i++) {
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

    /* Pause when tab hidden to save battery/CPU */
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start();
    });

    /* Respect reduced-motion changes at runtime */
    reduceMotion.addEventListener('change', function (e) {
        if (e.matches) stop(); else start();
    });

    start();
})();
