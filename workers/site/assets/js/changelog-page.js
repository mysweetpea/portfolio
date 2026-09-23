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
        // Progressive reveal: show the most recent weeks, archive the rest.
        // Filtering always shows everything (the user asked to see it all).
        var visibleWeeks = filtering ? weeks.length : (renderFeed.expanded ? weeks.length : 2);
        weeks.forEach(function (wk, wi) {
            var rows = wk.items.filter(passes);
            if (!rows.length) return;
            if (wi >= visibleWeeks) return;
            shown += rows.length;
            var block = el('div', 'cl2-wk');
            block.appendChild(el('div', 'cl2-week-label', wk.label));
            var panel = el('div', 'cl2-panel');
            var head = el('div', 'cl2-panel-head');
            head.appendChild(el('span', null, 'Commits \u00B7 daily'));
            head.appendChild(el('span', 'cl2-panel-count',
                rows.length + (rows.length === 1 ? ' change' : ' changes')));
            panel.appendChild(head);
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
            block.appendChild(panel);
            if (!filtering && wk.noise > 0) {
                block.appendChild(el('div', 'cl2-noise',
                    wk.noise + ' automatic service updates this week'));
            }
            feed.appendChild(block);
        });
        // "Show older activity" control when archive weeks are hidden (unfiltered view only)
        var hidden = !filtering && !renderFeed.expanded &&
            weeks.some(function (wk, wi) { return wi >= visibleWeeks && wk.items.length > 0; });
        var existing = document.getElementById('cl2-more');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        if (hidden) {
            var total = 0;
            weeks.forEach(function (wk, wi) { if (wi >= visibleWeeks) total += wk.items.length; });
            var more = el('button', 'cl2-chip cl2-more', 'Show older activity \u00B7 ' + total + ' more');
            more.id = 'cl2-more';
            more.type = 'button';
            more.addEventListener('click', function () {
                renderFeed.expanded = true;
                renderFeed();
            });
            feed.appendChild(more);
        }
        if (!shown) {
            feed.textContent = '';
            feed.appendChild(el('div', 'cl2-empty', 'Nothing matches those filters yet.'));
        }
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

    if (chipsBox) {
        chipsBox.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('.cl2-chip') : null;
            if (!btn) return;
            var f = btn.getAttribute('data-f');
            if (!f || !(f in active)) return;
            if (f === 'all') {
                Object.keys(active).forEach(function (k) { active[k] = false; });
                active.all = true;
            } else {
                active[f] = !active[f];
                active.all = !anyOn(REPO_KEYS) && !anyOn(CAT_KEYS);
            }
            Array.prototype.forEach.call(chipsBox.querySelectorAll('.cl2-chip'), function (b) {
                var key = b.getAttribute('data-f');
                if (key in active) b.classList.toggle('on', !!active[key]);
            });
            if (data) renderFeed();
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
