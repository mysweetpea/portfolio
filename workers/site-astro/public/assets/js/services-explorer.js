/* ==========================================================================
   services-explorer.js — minimal interactive services explorer.

   BEHAVIOUR: click an icon to reveal that service's description. Click the same
   icon again to collapse it. One open at a time.

   ── THIS IS A DISCLOSURE, NOT TABS ─────────────────────────────────────────
   The trigger is a <button aria-expanded> controlling a region, so the
   accessibility model is "expanded / collapsed" rather than "selected". The
   consequence is that ZERO panels start open, which is the requirement: the
   descriptions must not show until something is clicked. A tabs pattern would
   have demanded one be selected from the start and would have misdescribed the
   interaction.

   Arrow keys move focus across the rail (a natural expectation for a horizontal
   control strip). Enter/Space activate — native <button> behaviour, no code.

   ── PROGRESSIVE ENHANCEMENT ────────────────────────────────────────────────
   Do NOT add `hidden` to the panels in the markup. All nine render server-side
   so the section is a complete readable list without JavaScript. THIS script is
   what collapses it, and only after setting [data-enhanced] — which is the sole
   selector the hiding CSS is scoped to. If JS fails, users get MORE content,
   never less.

   Kept as a small external file because the site's CSP is a sha256 allowlist
   with limited headroom (see _headers) — external scripts cost nothing.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.querySelector('[data-explorer]');
  if (!root) return;

  var nodes = Array.prototype.slice.call(root.querySelectorAll('.ms-node'));
  var panels = Array.prototype.slice.call(root.querySelectorAll('.ms-panel'));
  if (!nodes.length || nodes.length !== panels.length) return;

  var rail = root.querySelector('.ms-rail');
  var hint = root.querySelector('[data-hint]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Look panels up by the id in aria-controls, so panel order can never drift
  // out of sync with the rail.
  var byId = {};
  panels.forEach(function (p) { byId[p.id] = p; });

  var openId = null;

  function nodeFor(id) { return document.getElementById('svc-tab-' + id); }
  function panelFor(id) { return byId['svc-panel-' + id]; }

  function setHint(on) {
    if (hint) hint.classList.toggle('ms-hint-off', !on);
  }

  function collapse(id) {
    var n = nodeFor(id), p = panelFor(id);
    if (!n || !p) return;
    n.setAttribute('aria-expanded', 'false');
    p.hidden = true;
    p.classList.remove('ms-panel-in');
    if (openId === id) openId = null;
  }

  function expand(id) {
    var n = nodeFor(id), p = panelFor(id);
    if (!n || !p) return;
    n.setAttribute('aria-expanded', 'true');
    p.hidden = false;
    // Restart the entrance animation. Removing and re-adding a class in the same
    // frame can be coalesced away, so force a reflow in between.
    p.classList.remove('ms-panel-in');
    if (!reduce) {
      void p.offsetWidth;
      p.classList.add('ms-panel-in');
    }
    openId = id;
    setHint(false);
  }

  function toggle(id) {
    if (openId === id) { collapse(id); setHint(true); }
    else {
      if (openId) collapse(openId);
      expand(id);
    }
  }

  nodes.forEach(function (n) {
    n.addEventListener('click', function () {
      toggle(n.getAttribute('data-service'));
    });
  });

  // Arrow / Home / End move focus between the rail buttons.
  if (rail) {
    rail.addEventListener('keydown', function (e) {
      var i = nodes.indexOf(document.activeElement);
      if (i === -1) return;
      var next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % nodes.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + nodes.length) % nodes.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = nodes.length - 1;
      if (next < 0) return;
      e.preventDefault();
      nodes[next].focus();
    });
  }

  // Escape collapses the open panel and returns focus to its trigger.
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !openId) return;
    var id = openId;
    collapse(id);
    setHint(true);
    var n = nodeFor(id);
    if (n) n.focus({ preventScroll: true });
  });

  // Start fully collapsed. Done explicitly rather than relying on the markup, so
  // a restored form state or a partial reload can never leave a panel open.
  panels.forEach(function (p) { p.hidden = true; });
  setHint(true);

  // Only NOW is it safe for the CSS to hide anything.
  root.setAttribute('data-enhanced', '');
})();
