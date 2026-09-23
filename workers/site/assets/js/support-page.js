/* === Support (Donate) page guards — dn- page JS =========================
   Static page: crypto wallets are COMING SOON, so the site.js bus actions
   (select-crypto / copy-wallet) must never imply a payable address.
   The FAQ accordion lives in site.js (toggle-faq) + premium.css §9 —
   nothing for it here. Vanilla ES5 (site-wide convention; the clipboard/
   closest APIs already require modern browsers, kept for style consistency
   with the other page scripts), zero deps, no fetches, no timers.
   All dynamic text via textContent — never innerHTML. ================== */
(function () {
    'use strict';

    /* Vine divider grows in on scroll (same grammar as home/changelog pages). */
    var vine = document.querySelector('.vine-divider.reveal-grow');
    if (vine && 'IntersectionObserver' in window &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        vine.style.opacity = '0';
        vine.style.transform = 'scaleX(0.25)';
        vine.style.transition = 'opacity .8s ease, transform .8s cubic-bezier(.22,1,.36,1)';
        new IntersectionObserver(function (entries, obs) {
            entries.forEach(function (en) {
                if (en.isIntersecting) {
                    vine.style.opacity = '';
                    vine.style.transform = '';
                    obs.disconnect();
                }
            });
        }, { threshold: 0.4 }).observe(vine);
        /* Safety net: if the observer never fires (odd viewport, clipped
           ancestor), the divider must not stay invisible. */
        setTimeout(function () {
            vine.style.opacity = '';
            vine.style.transform = '';
        }, 3000);
    }

    /* One delegated handler for both actions. site.js's own bus listener runs
       first (registered earlier); this guard is belt-and-braces for the
       coming-soon state and must never fight it. */
    document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || typeof t.closest !== 'function') return;

        /* copy-wallet safety: never copy a placeholder. The address element
           carries its payload in data-wallet (not textContent) so presentational
           child nodes can never leak into the clipboard. Gate is data-driven:
           empty attr = no address = no copy. When real addresses go live the
           genuine value passes through — no string sync with the markup. */
        var addr = t.closest('[data-action="copy-wallet"]');
        if (addr) {
            if (addr.__dnBusy) return; /* feedback already running — no double write */
            var value = addr.getAttribute('data-wallet') || '';
            if (!value.trim()) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value).then(function () {
                    flashCopied(addr, false);
                }).catch(function () {
                    flashCopied(addr, true);
                });
            } else {
                flashCopied(addr, true); /* insecure context / unsupported: say so */
            }
            return;
        }

        /* select-crypto: options are not payable yet — clicking one marks it
           unavailable (aria-disabled) so selection can never imply an address
           exists. The static "Soon" chips in the HTML stay as-is. */
        var opt = t.closest('.crypto-option');
        var card = document.getElementById('dn-crypto-card');
        if (opt && card && card.contains(opt)) {
            opt.classList.add('unavailable');
            opt.setAttribute('aria-disabled', 'true');
        }
    });

    /* Transient copy feedback — success by default, failure shows a plain
       "Copy failed" so a silent no-op is impossible. Restores the prior
       label via textContent only. */
    function flashCopied(el, failed) {
        if (el.__dnBusy) return;
        el.__dnBusy = true;
        var prev = el.getAttribute('data-label') || el.textContent;
        el.setAttribute('data-label', prev);
        el.textContent = failed ? 'Copy failed' : 'Copied!';
        setTimeout(function () {
            el.textContent = prev;
            el.__dnBusy = false;
        }, 1600);
    }
})();
