/* ==========================================================================
   services-explorer.js — the compact interactive services explorer.
   ==========================================================================
   Behaviour: one icon node is "current"; its panel shows beneath, the rest are
   hidden. Click or Enter/Space selects; ArrowLeft/Right/Home/End move between
   nodes (the standard ARIA tabs keyboard model).

   ⚠️ PROGRESSIVE ENHANCEMENT — do NOT add `hidden` to the panels in the markup.
   All nine render server-side so the section is a complete readable list
   without JavaScript. THIS script is what collapses it. If you hide them in
   the HTML too, users without JS lose eight of the nine services.

   Kept as a small external file because the site's CSP is a sha256 allowlist
   with limited headroom (see _headers) — external scripts cost nothing.
   ========================================================================== */
(function () {
  "use strict";

  var root = document.querySelector("[data-explorer]");
  if (!root) return;

  var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
  var panels = Array.prototype.slice.call(root.querySelectorAll('[role="tabpanel"]'));
  if (!tabs.length || tabs.length !== panels.length) return;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function select(idx, focus) {
    tabs.forEach(function (t, i) {
      var on = i === idx;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    if (focus) tabs[idx].focus();
  }

  // Initial state: first node current. This is the only place panels get hidden,
  // and it happens only now that we know JS is running.
  select(0, false);
  root.setAttribute("data-enhanced", "");

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { select(i, false); });

    t.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next === null) return;
      e.preventDefault();
      select(next, true);
    });
  });

  // The panel is a real focusable region (tabindex=0); make sure its outline is
  // never clipped by the rounded container.
  panels.forEach(function (p) {
    p.addEventListener("focus", function () { p.classList.add("is-focused"); });
    p.addEventListener("blur", function () { p.classList.remove("is-focused"); });
  });

  if (!reduce) {
    // Fade the incoming panel on change only after enhancement, so no-JS users
    // never see a transition they didn't ask for.
    root.addEventListener("click", function () {
      var active = root.querySelector('[role="tabpanel"]:not([hidden])');
      if (!active) return;
      active.classList.remove("ms-panel-in");
      void active.offsetWidth; // restart the animation
      active.classList.add("ms-panel-in");
    });
  }
})();
