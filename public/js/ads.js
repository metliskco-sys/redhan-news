/* ============================================
   AD RENDERING — shared by every page.
   Fills any [data-ad="…"] unit with a live
   placement (uploaded image + destination link).

   • No image yet  → a subtle "Advertise here" placeholder so the
                     space is visible and useful, not a hole in the page.
   • Image + link  → the banner, clickable out to the destination.
   • Image, no link→ not shown (a banner that goes nowhere is a bug).
   ============================================ */
(function () {
    var PLACEHOLDER_LINK = '/advertise';
    var observed = new WeakSet();

    function paint(target, ad) {
        var box = target.querySelector('.adunit__link');
        if (!box) return;

        var img = box.querySelector('img');
        if (!img) {
            img = document.createElement('img');
            img.alt = '';
            box.insertBefore(img, box.firstChild);
        }

        var tag = box.querySelector('.adunit__tag');
        if (!tag) {
            tag = document.createElement('span');
            tag.className = 'adunit__tag';
            tag.textContent = 'Advertisement';
            box.insertBefore(tag, box.firstChild);
        }

        var live = !!(ad && ad.image_url && ad.link_url);

        if (live) {
            img.src = ad.image_url;
            img.alt = 'Advertisement';
            box.href = ad.link_url;
            box.target = '_blank';
            box.rel = 'noopener sponsored';
            box.setAttribute('data-external', '1');
            target.classList.add('is-live');
            target.classList.remove('is-vacant');
            box.removeAttribute('aria-label');

            // Count one impression per unit per page view, and bind the click
            countImpression(target);
            bindClick(target);
            return;
        }

        // Placeholder: keep the space, point it at our own media kit
        target.classList.remove('is-live');
        target.classList.add('is-vacant');
        box.href = PLACEHOLDER_LINK;
        box.removeAttribute('target');
        box.removeAttribute('rel');
        box.setAttribute('aria-label', 'Advertise with Redhan');
        img.removeAttribute('src');
    }

    function paintAll(list) {
        var targets = list ||
            Array.prototype.slice.call(document.querySelectorAll('[data-ad]'));
        if (targets.length === 0) return;

        fetch('/api/ads', { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.ok ? r.json() : { ads: [] }; })
            .then(function (data) {
                var byPosition = {};
                (data.ads || []).forEach(function (a) { byPosition[a.position] = a; });

                targets.forEach(function (t) {
                    try {
                        paint(t, byPosition[t.dataset.ad] || null);
                    } catch (err) {
                        // A single broken unit must never take the others down
                        console.error('Ad unit failed:', err);
                    }
                });
            })
            .catch(function (err) {
                console.error('Ad load failed:', err);
                targets.forEach(function (t) {
                    try { paint(t, null); } catch (err) { /* ignore */ }
                });
            });
    }

    // Expose it so pages that render content later (e.g. the article body)
    // can re-paint units that did not exist when this script first ran.
    window.paintAds = paintAll;

    /* ---------------- Impression & click beacons ----------------
       sendBeacon is used where available so tracking never delays or
       breaks navigation; fetch with keepalive is the fallback.        */
    var seen = new WeakSet();

    function beacon(position, type) {
        var body = JSON.stringify({ type: type });
        var url = '/api/ads/' + encodeURIComponent(position) + '/event';

        try {
            if (navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
                return;
            }
        } catch (err) { /* fall through to fetch */ }

        try {
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body,
                keepalive: true
            })['catch'](function () { /* tracking must never break the page */ });
        } catch (err) { /* ignore */ }
    }

    function countImpression(target) {
        var position = target.dataset.ad;
        if (!position || seen.has(target)) return;   // once per unit per view
        seen.add(target);
        beacon(position, 'impression');
    }

    function bindClick(target) {
        var position = target.dataset.ad;
        if (!position || target._adClickBound) return;
        if (typeof target.addEventListener !== 'function') return;
        target._adClickBound = true;

        target.addEventListener('click', function () {
            // Only real banners (image + destination) count as clicks
            if (target.classList.contains('is-live')) {
                beacon(position, 'click');
            }
        });
    }

    /* Watch for units added after load — the in-article slot lives inside a
       JS-rendered template, so it would otherwise never be filled. */
    if ('MutationObserver' in window) {
        var mo = new MutationObserver(function (mutations) {
            var added = [];
            mutations.forEach(function (m) {
                Array.prototype.forEach.call(m.addedNodes || [], function (node) {
                    if (node.nodeType !== 1) return;
                    if (node.matches && node.matches('[data-ad]')) added.push(node);
                    if (node.querySelectorAll) {
                        Array.prototype.forEach.call(node.querySelectorAll('[data-ad]'), function (n) {
                            added.push(n);
                        });
                    }
                });
            });

            var fresh = added.filter(function (n) {
                return !observed.has(n);
            });
            fresh.forEach(function (n) { observed.add(n); });
            if (fresh.length) paintAll(fresh);
        });

        mo.observe(document.body, { childList: true, subtree: true });
    }

    paintAll();
})();
