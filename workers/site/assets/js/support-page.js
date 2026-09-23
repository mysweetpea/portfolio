/* === Support (Donate) page guards — dn- page JS =========================
   Static page: crypto wallets are COMING SOON, so the site.js bus actions
   (select-crypto / copy-wallet) must never imply a payable address.
   The FAQ accordion lives in site.js (toggle-faq) + premium.css §9 —
   nothing for it here. Vanilla ES5, zero deps, no fetches, no timers.
   All dynamic text via textContent — never innerHTML. ================== */
(function () {
    'use strict';

    /* 1) copy-wallet safety: never copy a placeholder. Today #wallet-addr is
       hidden and reads "Loading..."; when real addresses go live the same
       guard passes the genuine address through to the clipboard. */
    document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || typeof t.closest !== 'function') return;
        var addr = t.closest('[data-action="copy-wallet"]');
        if (!addr) return;
        var text = (addr.textContent || '').replace(/^\s+|\s+$/g, '');
        if (!text || text === 'Coming Soon' || text === 'Loading...') return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () {});
        }
    });

    /* 2) select-crypto belt-and-braces: options in the crypto card are not
       payable yet — clicking one marks it unavailable (aria-disabled) so
       selection can never imply an address exists. The static "Soon" chips
       in the HTML stay as-is. */
    document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || typeof t.closest !== 'function') return;
        var opt = t.closest('.crypto-option');
        var card = document.getElementById('dn-crypto-card');
        if (!opt || !card || !card.contains(opt)) return;
        opt.classList.add('unavailable');
        opt.setAttribute('aria-disabled', 'true');
    });
})();
