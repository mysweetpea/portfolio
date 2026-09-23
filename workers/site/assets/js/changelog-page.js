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
        var s = String(msg).replace(/^(feat|fix)(\([^)]*\))?:\s*/i, '');
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
        (data.highlights || []).forEach(function (h) {
            var card = el('div', 'cl2-hl');
            var top = el('div', 'cl2-hl-top');
            top.appendChild(el('span', 'cl2-hl-date', dateShort(h.date)));
            top.appendChild(el('span', 'cl2-tag n', h.repo));
            card.appendChild(top);
            card.appendChild(el('h2', null, cleanTitle(h.message)));
            var meta = el('p', 'cl2-hl-meta');
            meta.appendChild(el('span', null, h.repo));
            meta.appendChild(txt(' \u00B7 sha ' + h.sha));
            meta.appendChild(txt(' \u00B7 ' + dateShort(h.date)));
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
        weeks.forEach(function (wk) {
            var rows = wk.items.filter(passes);
            if (!rows.length) return;
            shown += rows.length;
            var block = el('div', 'cl2-wk');
            block.appendChild(el('div', 'cl2-week-label',
                wk.label + ' \u00B7 ' + rows.length + (rows.length === 1 ? ' change' : ' changes')));
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
        if (!shown) {
            feed.textContent = '';
            feed.appendChild(el('div', 'cl2-empty', 'Nothing matches those filters yet.'));
        }
    }

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
                    score.textContent = n + (n === 1 ? ' change' : ' changes') + ' this month';
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
