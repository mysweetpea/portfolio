/* home-page.js — v2 additions runtime (grow lines, count-ups, status telemetry) */

(function(){
  'use strict';
  function setMeta(txt){ var m = document.getElementById('hsMeta'); if(m && txt) m.textContent = txt; }
  var gardenEl = null, gardenTxt = null;
  function gardenState(cls, txt){
    if(!gardenEl){ gardenEl = document.getElementById('gardenLive'); gardenTxt = gardenEl ? gardenEl.querySelector('.gl-txt') : null; }
    if(!gardenEl) return;
    gardenEl.classList.remove('is-degraded','is-offline');
    if(cls) gardenEl.classList.add(cls);
    if(gardenTxt && txt) gardenTxt.textContent = txt;
  }
  function tryFetch(){
    try {
      fetch('https://status.mysweetpea.cc/api/status-page/heartbeat/public', {mode:'cors'})
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(d){
          if(!d || !d.heartbeatList) { setMeta('live · status unavailable'); gardenState('is-degraded','live status unavailable'); return; }
          /* Kuma public payload: heartbeatList[monitorId] = beat array (status===1 means UP);
             uptimeList['<monitorId>_24'] = 24h uptime as a FRACTION 0-1 (hence *100). */
          var hb = d.heartbeatList, total = 0, up = 0, sum = 0, n = 0;
          Object.keys(hb).forEach(function(k){
            var beats = hb[k]; if(!beats || !beats.length) return;
            var last = beats[beats.length-1]; total++;
            if(last.status === 1){ up++; var v24 = d.uptimeList && d.uptimeList[k + '_24'];
              if(typeof v24 === 'number'){ sum += v24; n++; } }
          });
          if(total === 0){ setMeta('live · status unavailable'); gardenState('is-degraded','live status unavailable'); return; }
          var avg = n ? (sum/n*100) : null;
          setMeta('live · ' + up + '/' + total + (avg !== null ? ' · ' + avg.toFixed(1) + '% 24h' : ''));
          if(up === total) gardenState(null, 'all ' + total + ' services live');
          else if(up === 0) gardenState('is-offline', 'services offline');
          else gardenState('is-degraded', up + ' of ' + total + ' services live');
        })
        .catch(function(){ setMeta('live · status unavailable'); gardenState('is-degraded','live status unavailable'); });
    } catch(e){}
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryFetch);
  else tryFetch();
})();

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
