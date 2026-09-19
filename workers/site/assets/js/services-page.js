// FAQ Toggle
        function toggleFAQ(el) { var item = el.parentElement; var open = item.classList.toggle('open'); el.setAttribute('aria-expanded', String(open)); }

        // Screenshot lightbox
        var SERVICES = {
            vaultwarden: { name:'Vaultwarden', icon:'<img src="/assets/icons/vaultwarden.svg" width="40" height="40" loading="lazy" decoding="async" alt="Vaultwarden">', shot:'/assets/screenshots/vaultwarden.webp', github:'https://github.com/dani-garcia/vaultwarden', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A safe place to store all your passwords — like a locked drawer for your digital life.', replaces:'Think of it like LastPass or 1Password.', desc:'Vaultwarden is a password manager that remembers all your passwords so you do not have to. It creates strong, unique passwords for every website and fills them in automatically. Your vault is encrypted end-to-end — even we cannot see your passwords.', url:'https://vault.mysweetpea.cc' },
            matrix: { name:'Matrix / Element', icon:'<img src="/assets/icons/matrix.svg" width="40" height="40" loading="lazy" decoding="async" alt="Matrix">', shot:'/assets/screenshots/element.webp', github:'https://github.com/element-hq/element-web', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A private chat app for messaging friends — nobody else can read your messages.', replaces:'Think of it like Discord or Slack, but private.', desc:'Matrix is a private, encrypted chat system. Element is the app you use to access it. Create rooms, send messages, share files, all encrypted.', url:'https://chat.mysweetpea.cc' },
            affine: { name:'AFFiNE', icon:'<img src="/assets/icons/affine.svg" width="40" height="40" loading="lazy" decoding="async" alt="AFFiNE">', shot:'/assets/screenshots/affine.webp', github:'https://github.com/toeverything/AFFiNE', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A place to write notes, build wikis, and sketch ideas — all kept private.', replaces:'Think of it like Notion and Miro in one.', desc:'AFFiNE is a free alternative to Notion. Create documents, wikis, whiteboards, and knowledge bases. All your notes are stored privately on our server.', url:'https://notes.mysweetpea.cc' },
            koalasync: { name:'KoalaSync', icon:'<img src="/assets/icons/koalasync.svg" alt="KoalaSync logo" width="40" height="40" loading="lazy" decoding="async">', shot:'/assets/screenshots/koalasync.webp', github:'https://github.com/Shik3i/KoalaSync', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'Watch movies and shows together with friends in real-time — everyone sees the same scene.', replaces:'Think of it like a shared remote for your watch party.', desc:'KoalaSync lets you watch movies and shows together with friends in real-time. Works with Jellyfin, YouTube, and other video sites.', url:'https://sync.mysweetpea.cc' },
            jellyfin: { name:'Jellyfin / Moonfin', icon:'<img src="/assets/icons/jellyfin.svg" width="40" height="40" loading="lazy" decoding="async" alt="Jellyfin">', shot:'/assets/screenshots/jellyfin.webp', github:'https://github.com/jellyfin/jellyfin', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'Your own private movie and TV library — stream it on any device.', replaces:'Think of it like Netflix, but it is your own collection.', desc:'Jellyfin is your own private Netflix — a free, open-source media server that streams your movie and TV collection to any device. Moonfin is a premium web interface that runs on top of Jellyfin.', url:'https://media.mysweetpea.cc/Moonfin/Web/' },
            seerr: { name:'Seerr', icon:'<img src="/assets/icons/seerr.svg" alt="Seerr logo" width="40" height="40" loading="lazy" decoding="async">', shot:'/assets/screenshots/seerr.webp', github:'https://github.com/seerr-team/seerr', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A wish list for movies and shows — request anything you want to watch.', replaces:'Think of it like a request box for your media library.', desc:'Seerr is like a wish list for movies and shows. Browse what is trending, see what is already available, and request anything you want to watch. Your request is processed automatically and the content appears in Jellyfin.', url:'https://request.mysweetpea.cc' },
            nextcloud: { name:'Nextcloud', icon:'<img src="/assets/icons/nextcloud.svg" width="40" height="40" loading="lazy" decoding="async" alt="Nextcloud">', shot:'/assets/screenshots/nextcloud.webp', github:'https://github.com/nextcloud/server', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'Your private place for files, calendar, and contacts — like a personal Google Workspace.', replaces:'Think of it like Google Drive, but private.', desc:'Nextcloud is your private Google Workspace replacement. Sync files across devices, share documents, manage your calendar and contacts — all stored on our own hardware.', url:'https://cloud.mysweetpea.cc' },
            immich: { name:'Immich', icon:'<img src="/assets/icons/immich.svg" width="40" height="40" loading="lazy" decoding="async" alt="Immich">', shot:'/assets/screenshots/immich.webp', github:'https://github.com/immich-app/immich', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'Back up your photos and videos privately — search them and keep them safe.', replaces:'Think of it like Google Photos, but private.', desc:'Immich is a self-hosted photo and video backup, like Google Photos without the tracking. Back up your memories, search them with AI, and keep them private on our own server.', url:'https://photos.mysweetpea.cc' },
            openwebui: { name:'Open WebUI', icon:'<img src="/assets/icons/openwebui.svg" width="40" height="40" loading="lazy" decoding="async" alt="Open WebUI">', shot:'/assets/screenshots/openwebui.webp', github:'https://github.com/open-webui/open-webui', tier:'sweetpea', tierLabel:'Sweet Pea', plain:'A private AI chat assistant — your conversations stay on our servers.', replaces:'Think of it like ChatGPT, but private.', desc:'Open WebUI is a private AI chat interface running entirely on our own hardware. Chat with open-source models without your conversations ever leaving our servers.', url:'https://ai.mysweetpea.cc' },
        };

        var lastLightboxTrigger = null;
        function getLightboxFocusables(lb) {
            return Array.prototype.slice.call(lb.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(function(el) {
                return el.offsetParent !== null;
            });
        }
        function openLightbox(serviceId, trigger) {
            var s = SERVICES[serviceId];
            var lb = document.getElementById('serviceLightbox');
            if (!s || !lb) return;
            lastLightboxTrigger = trigger || document.activeElement;
            var img = document.getElementById('lightboxShot');
            if (img) { img.src = s.shot; img.alt = s.name + ' screenshot'; }
            var nameEl = document.getElementById('lightboxName');
            if (nameEl) nameEl.textContent = s.name;
            var plainEl = document.getElementById('lightboxPlain');
            if (plainEl) plainEl.textContent = s.plain || '';
            var icoEl = document.getElementById('lightboxIco');
            if (icoEl) icoEl.innerHTML = s.icon;
            var ghEl = document.getElementById('lightboxGithub');
            if (ghEl) { ghEl.href = s.github || '#'; ghEl.style.display = s.github ? '' : 'none'; }
            var opEl = document.getElementById('lightboxOpen');
            if (opEl) { opEl.href = s.url || '#'; opEl.style.display = s.url ? '' : 'none'; }
            var tierEl = document.getElementById('lightboxTier');
            if (tierEl) tierEl.textContent = String(s.tierLabel || 'Sweet Pea').toUpperCase();
            lb.setAttribute('aria-label', s.name + ' screenshot');
            lb.classList.add('active'); lb.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            window.setTimeout(function() { var c = lb.querySelector('.lightbox-close'); if (c) c.focus(); }, 0);
        }
        function closeLightbox() {
            var lb = document.getElementById('serviceLightbox');
            if (!lb) return;
            lb.classList.remove('active'); lb.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            if (lastLightboxTrigger && typeof lastLightboxTrigger.focus === 'function') lastLightboxTrigger.focus();
            lastLightboxTrigger = null;
        }

        var serviceLightbox = document.getElementById('serviceLightbox');
        if (serviceLightbox) {
            serviceLightbox.addEventListener('click', function(e) {
                if (e.target === this) closeLightbox();
            });
            var closeBtn = serviceLightbox.querySelector('.lightbox-close');
            if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
        }
    
        document.querySelectorAll('.service-card[data-service]').forEach(function(card) {
            card.addEventListener('click', function() { openLightbox(card.dataset.service, card); });
            card.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openLightbox(card.dataset.service, card);
                }
            });
        });

        /* GitHub links on cards: navigate in a new tab, but do NOT trigger the card lightbox */
        document.querySelectorAll('.gh-link').forEach(function(a) {
            a.addEventListener('click', function(e) { e.stopPropagation(); });
            a.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
        });

        /* === Services filter bar (hides tier dividers + groups, animated) === */
        (function () {
            /* derive tier counts from the DOM so badges can't desync (OCR final audit) */
            (function () {
                function countTier(t) {
                    var g = document.querySelector('[data-tier-group="' + t + '"]');
                    return g ? g.querySelectorAll('.service-card, .coming-soon-card').length : 0;
                }
                var map = { all: countTier('sweetpea') + countTier('coming-soon'), sweetpea: countTier('sweetpea'), 'coming-soon': countTier('coming-soon') };
                document.querySelectorAll('.filter-btn .f-count').forEach(function (el) {
                    var btn = el.closest('.filter-btn'); if (!btn) return;
                    var v = map[btn.getAttribute('data-filter')];
                    if (typeof v === 'number') el.textContent = v;
                });
            })();
            var filterBtns = document.querySelectorAll('.filter-btn');
            var groups = document.querySelectorAll('[data-tier-group]');
            var dividers = document.querySelectorAll('[data-tier-divider]');
            function applyFilter(filter) {
                groups.forEach(function (group) {
                    var tier = group.getAttribute('data-tier-group');
                    var show = filter === 'all' || tier === filter;
                    group.classList.toggle('filter-hidden', !show);
                    group.style.display = show ? '' : 'none';
                });
                dividers.forEach(function (divider) {
                    var tier = divider.getAttribute('data-tier-divider');
                    var show = filter === 'all' || tier === filter;
                    divider.classList.toggle('filter-hidden', !show);
                    divider.style.display = show ? '' : 'none';
                });
            }
            filterBtns.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    filterBtns.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); b.classList.remove('active'); });
                    btn.classList.add('active');
                    var filter = btn.getAttribute('data-filter');
                    /* Animate: fade out, apply filter, fade in + re-trigger card animation */
                    groups.forEach(function (g) { g.classList.add('filtering'); });
                    setTimeout(function () {
                        applyFilter(filter);
                        groups.forEach(function (g) {
                            g.classList.remove('filtering');
                            Array.prototype.forEach.call(g.querySelectorAll('.service-card, .coming-soon-card'), function (card) {
                                card.classList.remove('card-anim');
                                void card.offsetWidth;
                                card.classList.add('card-anim');
                            });
                        });
                    }, 150);
                });
            });
        })();
        document.addEventListener('keydown', function(e) {
            var lb = document.getElementById('serviceLightbox');
            if (!lb || !lb.classList.contains('active')) return;
            if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); return; }
            if (e.key === 'Tab') {
                var focusables = getLightboxFocusables(lb);
                if (!focusables.length) return;
                var first = focusables[0], last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
