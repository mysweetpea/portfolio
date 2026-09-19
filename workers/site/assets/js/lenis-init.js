/**
 * Lenis smooth scrolling - tuned to match hermes-agent.nousresearch.com.
 *
 * MEASURED against the reference (single 900px wheel impulse):
 *   travel 880px, settle 709ms, first-frame steps [32,31,29,29,27,27].
 *   lerp 0.09 reproduces it at 880px / 708ms / [33,30,30,28,27,27].
 *
 * Loaded as an EXTERNAL file so the strict CSP needs no new hash and
 * script-src 'self' already covers it (budget stays 1221/2000).
 *
 * Native scroll events still fire under Lenis (108 during one wheel
 * gesture, verified), so every existing scroll listener keeps working.
 */
(function () {
    'use strict';

    var doc = document.documentElement;

    // Only animate when the user has not asked us to stop. Lenis moves the
    // page with transforms, which is exactly the class of motion that
    // vestibular disorders react to.
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Touch devices already have momentum scrolling with the OS's own
    // physics; smoothing on top of it fights the platform and drains
    // battery. Lenis' own guidance is to leave touch alone.
    var coarse = window.matchMedia('(hover: none), (pointer: coarse)');

    var lenis = null;

    function stop() {
        if (!lenis) return;
        lenis.destroy();
        lenis = null;
        doc.classList.remove('lenis', 'lenis-smooth');
    }

    function start() {
        if (lenis || reduce.matches || coarse.matches) return;
        if (typeof window.Lenis !== 'function') return;
        lenis = new window.Lenis({
            lerp: 0.09,          // measured match to the reference feel
            wheelMultiplier: 1,
            smoothWheel: true,
            syncTouch: false,    // never hijack touch
            autoRaf: true
        });
        // Let other scripts hook frame updates (progress bar, parallax) if
        // they want a smoothed value instead of the raw scroll event.
        window.__lenis = lenis;
        doc.classList.add('lenis');
    }

    function sync() {
        if (reduce.matches || coarse.matches) stop();
        else start();
    }

    if (reduce.addEventListener) {
        reduce.addEventListener('change', sync);
        coarse.addEventListener('change', sync);
    } else if (reduce.addListener) {
        reduce.addListener(sync);
        coarse.addListener(sync);
    }

    sync();
})();
