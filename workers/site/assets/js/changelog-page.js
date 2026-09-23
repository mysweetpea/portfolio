/* === Changelog page: Highlights + Activity console (C3) ===
   Renders /api/commits into highlight cards + week-grouped rows with
   repo/category chip filters. Vanilla JS, zero deps.
   Honest states: fetch failure = visible error, never fake data.
   All dynamic strings go through textContent - never innerHTML. */
(function () {
    'use strict';

    var pulse = document.getElementById('cl2-pulse');
    var hlList = document.getElementById('cl2-hl-list');
    var feed = document.getElementById('cl2-feed');
    var chipsBox = document.getElementById('cl2-chips');
    var score = document.getElementById('cl2-score');
    if (!feed) return;

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var CAT_LABEL = { f: 'Feature', i: 'Improvement', d: 'Fix' };
    var REPO_KEYS = ['repo:portfolio', 'repo:homelab-k8s'];
    var CAT_KEYS = ['cat:f', 'cat:i', 'cat:d'];

    var data = null;
    var active = { all: true, 'repo:portfolio': false, 'repo:homelab-k8s': false, 'cat:f': false, 'cat:i': false, 'cat:d': false };

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function txt(s) { return document.createTextNode(s); }

    function dateShort(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return MONTHS[d.getMonth()] + ' ' + d.getDate();
    }

    function cleanTitle(msg) {
        var s = String(msg);
        // strip conventional prefixes: type(scope): and bare scope: — "form: fix x" -> "Fix x"
        s = s.replace(/^(feat|fix)(\([^)]*\))?:\s*/i, '');
        s = s.replace(/^[a-z][a-z0-9-]{1,15}:\s+/i, '');
        // sentence-case the first word
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function anyOn(keys) {
        for (var i = 0; i < keys.length; i++) { if (active[keys[i]]) return true; }
        return false;
    }

    function passes(item) {
        if (anyOn(REPO_KEYS) && !active['repo:' + item.repo]) return false;
        if (anyOn(CAT_KEYS) && !active['cat:' + item.cat]) return false;
        return true;
    }

    function renderHighlights() {
        if (!hlList) return;
        hlList.textContent = '';
        var hs = (data.highlights || []);
        // No highlights this window: hide the section + vine, keep the page honest.
        var hlSection = document.querySelector('.cl2-highlights');
        if (hlSection) hlSection.hidden = hs.length === 0;
        var vine = document.querySelector('.vine-divider.reveal-grow');
        if (vine) vine.hidden = hs.length === 0;
        if (!hs.length) return;
        hs.forEach(function (h) {
            var card = el('div', 'cl2-hl');
            var top = el('div', 'cl2-hl-top');
            top.appendChild(el('span', 'cl2-hl-date', dateShort(h.date)));
            top.appendChild(el('span', 'cl2-tag n', h.repo));
            card.appendChild(top);
            card.appendChild(el('h2', null, cleanTitle(h.message)));
            var meta = el('p', 'cl2-hl-meta');
            meta.appendChild(el('span', null, h.sha));
            meta.appendChild(txt(' \u00B7 ' + dateShort(h.date)));
            meta.appendChild(txt(' \u00B7 ' + (h.repo === 'portfolio' ? 'website' : 'infrastructure')));
            card.appendChild(meta);
            var tags = el('div', 'cl2-tags');
            tags.appendChild(el('span', 'cl2-tag ' + (h.cat || 'i'), CAT_LABEL[h.cat] || 'Improvement'));
            card.appendChild(tags);
            hlList.appendChild(card);
        });
    }

    function renderFeed() {
        var weeks = (data && data.weeks) || [];
        var filtering = !active.all;
        var shown = 0;
        feed.textContent = '';
        // Accordion weeks: every week renders as a collapsed header; the two most
        // recent open by default. Filtering opens everything (you're hunting).
        weeks.forEach(function (wk, wi) {
            var rows = wk.items.filter(passes);
            if (!rows.length) return;
            shown += rows.length;
            var open = filtering || wi < 2;
            var block = el('div', 'cl2-wk' + (open ? ' open' : ''));
            block.setAttribute('data-wk', wi);
            var head = el('button', 'cl2-wk-head');
            head.type = 'button';
            head.setAttribute('aria-expanded', open ? 'true' : 'false');
            head.appendChild(el('span', 'cl2-week-label', wk.label));
            var meta = rows.length + (rows.length === 1 ? ' change' : ' changes');
            if (wk.noise > 0) meta += ' \u00B7 ' + wk.noise + ' auto';
            head.appendChild(el('span', 'cl2-wk-meta', meta));
            head.appendChild(el('span', 'cl2-wk-caret', '\u25BE'));
            head.addEventListener('click', function () {
                var isOpen = block.classList.toggle('open');
                head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                syncExpandToggle();
            });
            block.appendChild(head);
            var body = el('div', 'cl2-wk-body');
            if (!filtering && wk.noise > 0) {
                body.appendChild(el('div', 'cl2-noise',
                    wk.noise + ' automatic service updates hidden this week'));
            }
            var panel = el('div', 'cl2-panel');
            rows.forEach(function (it) {
                var row = el('div', 'cl2-row');
                row.appendChild(el('span', 'cl2-t', dateShort(it.date)));
                var m = el('span', 'cl2-m');
                m.setAttribute('data-when', dateShort(it.date));
                m.appendChild(el('span', 'cl2-mtxt', it.message));
                m.appendChild(el('span', null, ' \u00B7 ' + it.repo));
                row.appendChild(m);
                row.appendChild(el('span', 'cl2-cat ' + (it.cat || 'i'), CAT_LABEL[it.cat] || 'Improvement'));
                panel.appendChild(row);
            });
            body.appendChild(panel);
            block.appendChild(body);
            feed.appendChild(block);
        });
        syncExpandToggle();
        renderGraph();
        if (!shown) {
            feed.appendChild(el('div', 'cl2-empty', 'Nothing matches those filters yet.'));
        }
    }

    /* Expand / collapse all control (lives in the Activity eyebrow row) */
    function syncExpandToggle() {
        var btn = document.getElementById('cl2-expand');
        if (!btn) return;
        var blocks = Array.prototype.slice.call(feed.querySelectorAll('.cl2-wk'));
        if (!blocks.length) { btn.hidden = true; return; }
        var openCount = blocks.filter(function (b) { return b.classList.contains('open'); }).length;
        btn.hidden = false;
        btn.textContent = openCount === blocks.length ? 'Collapse all' : 'Expand all';
    }

    function allWeeksOpen(open) {
        Array.prototype.forEach.call(feed.querySelectorAll('.cl2-wk'), function (b) {
            b.classList.toggle('open', open);
            var h = b.querySelector('.cl2-wk-head');
            if (h) h.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        syncExpandToggle();
    }

    /* === 30-day stacked activity graph (pure DOM; shares the chip filters) === */
    function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

    function renderGraph() {
        var g = document.getElementById('cl2-graph');
        var cap = document.getElementById('cl2-graph-cap');
        var totalEl = document.getElementById('cl2-graph-total');
        var legend = document.getElementById('cl2-legend');
        if (!g) return;
        g.textContent = '';
        if (legend) legend.textContent = '';
        var all = [];
        (data.weeks || []).forEach(function (wk) { all = all.concat(wk.items); });
        if (!all.length) { g.hidden = true; if (cap) cap.hidden = true; return; }
        g.hidden = false; if (cap) cap.hidden = false;

        var now = new Date();
        var days = [];
        var byKey = {};
        for (var i = 29; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            var dy = { date: d, f: 0, i: 0, d: 0, total: 0 };
            days.push(dy);
            byKey[dayKey(d)] = dy;
        }
        var legendCounts = { f: 0, i: 0, d: 0 };
        all.forEach(function (it) {
            var dt = new Date(it.date);
            if (isNaN(dt.getTime())) return;
            var c = it.cat || 'i';
            if (c in legendCounts) legendCounts[c]++;
            var dy = byKey[dayKey(dt)];
            if (!dy || !passes(it)) return;
            if (c in dy) { dy[c]++; dy.total++; }
        });

        var max = 0, grand = 0;
        days.forEach(function (dy) { if (dy.total > max) max = dy.total; grand += dy.total; });
        var H = window.innerWidth <= 760 ? 88 : 128;

        days.forEach(function (dy, idx) {
            var col = el('button', 'cl2-col');
            col.type = 'button';
            var lbl = WEEKDAYS[dy.date.getDay()] + ', ' + dateShort(dy.date.toISOString());
            col.setAttribute('aria-label', lbl + ': ' + dy.total + (dy.total === 1 ? ' change' : ' changes'));
            col.style.transitionDelay = (idx * 14) + 'ms';
            if (dy.total > 0) {
                var bar = el('span', 'cl2-bar');
                [['f', dy.f], ['d', dy.d], ['i', dy.i]].forEach(function (pair) {
                    var c = pair[0], n = pair[1];
                    if (!n) return;
                    var seg = el('span', 'cl2-seg seg-' + c);
                    seg.style.height = Math.max(3, Math.round(n / max * H)) + 'px';
                    bar.appendChild(seg);
                });
                col.appendChild(bar);
            } else {
                col.appendChild(el('span', 'cl2-bar cl2-bar-zero'));
            }
            col.addEventListener('mouseenter', function () { graphCaption(dy); });
            col.addEventListener('focus', function () { graphCaption(dy); });
            col.addEventListener('click', function () { jumpToDay(dy.date); });
            g.appendChild(col);
        });
        if (cap) {
            cap.textContent = 'Hover a day for detail \u00B7 click it to jump to that week';
            if (!active.all) cap.textContent = 'Filtered view \u2014 graph shows matching changes only. ' + cap.textContent;
        }
        if (totalEl) totalEl.textContent = grand + ' in the last 30 days';
        if (legend) {
            [['f', 'Features'], ['i', 'Improvements'], ['d', 'Fixes']].forEach(function (pair) {
                var key = 'cat:' + pair[0];
                var b = el('button', 'cl2-legend-item cl2-chip' + (active[key] ? ' on' : ''));
                b.type = 'button';
                b.setAttribute('data-f', key);
                b.setAttribute('aria-pressed', active[key] ? 'true' : 'false');
                b.appendChild(el('span', 'cl2-dot dot-' + pair[0]));
                b.appendChild(txt(pair[1] + ' \u00B7 ' + legendCounts[pair[0]]));
                legend.appendChild(b);
            });
        }
    }

    function graphCaption(dy) {
        var cap = document.getElementById('cl2-graph-cap');
        if (!cap) return;
        var parts = [];
        if (dy.f) parts.push(dy.f + ' ' + (dy.f === 1 ? 'feature' : 'features'));
        if (dy.i) parts.push(dy.i + ' ' + (dy.i === 1 ? 'improvement' : 'improvements'));
        if (dy.d) parts.push(dy.d + ' ' + (dy.d === 1 ? 'fix' : 'fixes'));
        cap.textContent = WEEKDAYS[dy.date.getDay()] + ', ' + dateShort(dy.date.toISOString()) +
            ' \u2014 ' + (parts.length ? parts.join(' \u00B7 ') : 'no changes');
    }

    function jumpToDay(date) {
        var key = dayKey(date);
        var target = null;
        Array.prototype.some.call(feed.querySelectorAll('.cl2-wk'), function (block) {
            var wi = block.getAttribute('data-wk');
            var wk = (data.weeks || [])[Number(wi)];
            if (!wk) return false;
            var hit = wk.items.some(function (it) {
                var dt = new Date(it.date);
                return !isNaN(dt.getTime()) && dayKey(dt) === key && passes(it);
            });
            if (hit) { target = block; return true; }
            return false;
        });
        if (!target) return;
        target.classList.add('open');
        var h = target.querySelector('.cl2-wk-head');
        if (h) h.setAttribute('aria-expanded', 'true');
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        syncExpandToggle();
    }

    /* Vine divider grow-on-scroll (same mechanics as home-page.js) */
    (function () {
        var vines = document.querySelectorAll('.vine-divider.reveal-grow');
        if (!vines.length) return;
        var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || !('IntersectionObserver' in window)) {
            Array.prototype.forEach.call(vines, function (v) { v.classList.add('visible'); });
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
            });
        }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });
        Array.prototype.forEach.call(vines, function (v) { io.observe(v); });
    })();

    /* Shared filter application: header chips AND graph legend chips */
    function applyFilter(key) {
        if (!(key in active)) return;
        if (key === 'all') {
            Object.keys(active).forEach(function (k) { active[k] = false; });
            active.all = true;
        } else {
            active[key] = !active[key];
            active.all = !anyOn(REPO_KEYS) && !anyOn(CAT_KEYS);
        }
        // sync every chip surface (header row + graph legend)
        Array.prototype.forEach.call(document.querySelectorAll('.cl2-chip'), function (b) {
            var k = b.getAttribute('data-f');
            if (k in active) {
                b.classList.toggle('on', !!active[k]);
                b.setAttribute('aria-pressed', active[k] ? 'true' : 'false');
            }
        });
        if (data) renderFeed();  // renderFeed re-renders the graph too
    }

    if (chipsBox) {
        chipsBox.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('.cl2-chip') : null;
            if (!btn) return;
            applyFilter(btn.getAttribute('data-f'));
        });
    }
    var legendBox = document.getElementById('cl2-legend');
    if (legendBox) {
        legendBox.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('.cl2-chip') : null;
            if (!btn) return;
            applyFilter(btn.getAttribute('data-f'));
        });
    }
    var expandBtn = document.getElementById('cl2-expand');
    if (expandBtn) {
        expandBtn.addEventListener('click', function () {
            var blocks = Array.prototype.slice.call(feed.querySelectorAll('.cl2-wk'));
            var openCount = blocks.filter(function (b) { return b.classList.contains('open'); }).length;
            allWeeksOpen(openCount !== blocks.length);
        });
    }

    (function () {
        var ctl;
        try { ctl = new AbortController(); } catch (e) { ctl = null; }
        if (ctl) setTimeout(function () { ctl.abort(); }, 10000);
        fetch('/api/commits', ctl ? { signal: ctl.signal } : undefined)
            .then(function (res) {
                return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status));
            })
            .then(function (payload) {
                var ok = payload && Array.isArray(payload.weeks) && Array.isArray(payload.highlights) &&
                    payload.weeks.every(function (w) { return w && Array.isArray(w.items); });
                if (!ok) throw new Error('unexpected /api/commits shape');
                data = payload;
                if (pulse) pulse.hidden = false;
                if (score) {
                    var t = payload.totals || {};
                    var n = (t.features || 0) + (t.improvements || 0) + (t.fixes || 0);
                    score.textContent = n + (n === 1 ? ' change' : ' changes') + ' in the last 30 days';
                }
                renderHighlights();
                renderFeed();
            })
            .catch(function (err) {
                console.warn('[cl2] activity feed failed:', err);
                feed.textContent = '';
                feed.appendChild(el('div', 'cl2-empty', "Couldn't load the activity feed. Refresh to try again."));
            });
    })();
})();
