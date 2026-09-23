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

    /* One delegated handler for both actions. site.js's own bus listener runs
       first (registered earlier); this guard is belt-and-braces for the
       coming-soon state and must never fight it. */
    document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || typeof t.closest !== 'function') return;

        /* copy-wallet safety: never copy a placeholder. The address element
           carries its payload in data-wallet (not textContent) so presentational
           child nodes can never leak into the clipboard. Hidden today; when real
           addresses go live the genuine value passes through. */
        var addr = t.closest('[data-action="copy-wallet"]');
        if (addr) {
            var value = addr.getAttribute('data-wallet') || '';
            if (!value || value === 'Coming Soon' || value === 'Loading...') return;
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
        el.textContent = failed ? 'Copy failed — select the address manually' : 'Copied!';
        setTimeout(function () {
            el.textContent = prev;
            el.__dnBusy = false;
        }, 1600);
    }
})();
