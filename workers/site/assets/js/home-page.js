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
    if (!isFinite(target)) { el.textContent = el.getAttribute('data-count') || ''; return; }
    if (reduce || !(target > 0)) { el.textContent = target.toFixed(dec); return; }
    var t0 = null, dur = 1100;
    function step(ts){
      if(!t0) t0 = ts;
      var p = Math.min((ts - t0)/dur, 1);
      var eased = 1 - Math.pow(1-p, 4);
      el.textContent = (target*eased).toFixed(dec);
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
})();
