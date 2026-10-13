/* ============================================
   SITE-WIDE ANALYTICS — page views, article
   impressions and article click-throughs.
   Fire-and-forget: beacons must never block or
   break a page.
   ============================================ */
(function () {
    /* Beacons tolerate a missing/failed endpoint silently. */
    function hit(path, body) {
        try {
            if (navigator.sendBeacon) {
                navigator.sendBeacon(path, new Blob([JSON.stringify(body)], { type: 'application/json' }));
                return;
            }
        } catch (err) { /* fall through to fetch */ }

        try {
            fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                keepalive: true
            })['catch'](function () { /* analytics must never break the page */ });
        } catch (err) { /* ignore */ }
    }

    /* ---------- Page views ---------- */
    function countPageView() {
        // Ignore the staff desk, the sign-in pages and 404s — they are not
        // reader traffic and would skew the numbers.
        var path = window.location.pathname;
        if (path === '/desk' || path === '/login' || path === '/register') return;

        hit('/api/pages/event', { path: path });
    }

    /* ---------- Article impressions ----------
       Cards are batched: one beacon per group of cards that became
       visible, rather than one per card.                                   */
    var seenArticles = new WeakSet();
    var observer = null;

    function cards() {
        return Array.prototype.slice.call(
            document.querySelectorAll('[data-article-id]')
        );
    }

    function idOf(el) {
        var raw = el.getAttribute('data-article-id');
        var n = parseInt(raw, 10);
        return Number.isInteger(n) && n > 0 ? n : null;
    }

    function observeCards() {
        var list = cards().filter(function (el) {
            return !seenArticles.has(el);
        });

        if (list.length === 0) return;

        var pending = [];

        function flush() {
            if (pending.length === 0) return;
            var ids = pending.slice();
            pending = [];
            ids.forEach(function (id) {
                hit('/api/articles/' + id + '/event', { type: 'impression' });
            });
        }

        list.forEach(function (el) {
            seenArticles.add(el);
            var id = idOf(el);
            if (id) pending.push(id);
        });

        flush();

        // Keep watching for cards added later (filtering re-renders the grid)
        if (!observer && 'IntersectionObserver' in window) {
            observer = new IntersectionObserver(function (entries) {
                var fresh = [];
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    var el = entry.target;
                    if (seenArticles.has(el)) return;
                    seenArticles.add(el);
                    var id = idOf(el);
                    if (id) fresh.push(id);
                });
                if (fresh.length) {
                    fresh.forEach(function (id) {
                        hit('/api/articles/' + id + '/event', { type: 'impression' });
                    });
                }
            }, { threshold: 0.35 });

            cards().forEach(function (el) {
                if (!seenArticles.has(el)) {
                    seenArticles.add(el);
                    observer.observe(el);
                }
            });
        }
    }

    /* ---------- Article clicks ----------
       Any link that points at /article?slug=... counts as a
       click-through for that story.                                    */
    function slugFromHref(href) {
        var m = /\/article\?slug=([^&]+)/.exec(href || '');
        return m ? decodeURIComponent(m[1]) : null;
    }

    // Slug -> id lookup, filled in lazily from the API response already
    // available on the page.
    var slugToId = {};

    function learnSlugs() {
        if (window.__redhanSlugs) {
            Object.assign(slugToId, window.__redhanSlugs);
        }
    }

    document.addEventListener('click', function (e) {
        var link = e.target.closest ? e.target.closest('a[href*="/article?slug="]') : null;
        if (!link) return;

        learnSlugs();
        var slug = slugFromHref(link.getAttribute('href'));
        if (!slug) return;

        var id = slugToId[slug];
        if (!id) return;   // unknown story: still fine, just uncounted

        hit('/api/articles/' + id + '/event', { type: 'click' });
    }, true);

    /* ---------- Wire it up ---------- */
    countPageView();
    learnSlugs();
    observeCards();

    // The home grid re-renders on filter changes
    window.addEventListener('redhan:rendered', observeCards);

    // Safety net: pick up cards that appeared without an event
    setTimeout(observeCards, 1200);
})();
