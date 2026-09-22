/* home-page.js — home runtime: garden live-line, grow lines, count-ups */

(function(){
  'use strict';
  function initMotion(){
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* grow-lines: observe vines + eyebrows */
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, {threshold:.2, rootMargin:'0px 0px -8% 0px'});
  document.querySelectorAll('.vine-divider.reveal-grow, .sec-eyebrow.reveal, .step').forEach(function(el){ io.observe(el); });

  /* count-up numerals in record tiles */
  function animateCount(el){
    var target = parseFloat(el.getAttribute('data-count'));
    var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    var suffix = el.getAttribute('data-suffix') || '';
    if (!isFinite(target)) { el.textContent = (el.getAttribute('data-count') || '') + suffix; return; }
    if (reduce || !(target > 0)) { el.textContent = target.toFixed(dec) + suffix; return; }
    var t0 = null, dur = 1100;
    function step(ts){
      if(!t0) t0 = ts;
      var p = Math.min((ts - t0)/dur, 1);
      var eased = 1 - Math.pow(1-p, 4);
      el.textContent = (target*eased).toFixed(dec) + suffix;
      if(p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var cio = new IntersectionObserver(function(entries){
    entries.forEach(function(e){ if(e.isIntersecting){ animateCount(e.target); cio.unobserve(e.target); } });
  }, {threshold:.4});
  document.querySelectorAll('.record .cnt').forEach(function(el){ cio.observe(el); });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMotion);
  else initMotion();

/* garden live line: paints the shared status line under the garden grid.
   Kuma contract: heartbeatList keyed by monitor id (1-9 = our services); status===1 means up. */
  var live = document.getElementById('gardenLive');
  if (live) {
    var txt = live.querySelector('.gl-txt');
    var aborter = ('AbortController' in window) ? new AbortController() : null;
    var abortTimer = aborter ? setTimeout(function(){ aborter.abort(); }, 10000) : 0;
    fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/public', aborter ? { signal: aborter.signal } : {})
      .then(function(r){ if (abortTimer) clearTimeout(abortTimer); return r.ok ? r.json() : Promise.reject(); })
      .then(function(data){
        var hb = data && data.heartbeatList;
        if (!hb) throw new Error('no data');
        var up = 0, seen = 0;
        for (var id = 1; id <= 9; id++) {
          var beats = hb[String(id)];
          if (beats && beats.length) { seen++; if (beats[beats.length - 1].status === 1) up++; }
        }
        if (txt) txt.textContent = seen ? (up + '/' + seen + ' services live') : 'live status unavailable';
      })
      .catch(function(){ if (txt) txt.textContent = 'live status unavailable'; });
  }
})();
