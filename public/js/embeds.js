/* ============================================
   EMBEDS — Twitter/X, Facebook, Instagram,
   YouTube, Vimeo, TikTok.
   Renders provider iframes (video) and our own
   styled cards (social), so no third-party
   scripts run on the page.
   ============================================ */
(function () {
    var CONTAINER = '[data-embed]';

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* -------- video: a plain iframe player -------- */
    function videoCard(data) {
        return (
            '<div class="embed embed--video" data-provider="' + esc(data.provider) + '"' +
            (data.aspect ? ' style="--embed-aspect:' + esc(data.aspect) + '"' : '') + '>' +
            '<div class="embed__frame">' + data.html + '</div>' +
            '</div>'
        );
    }

    /* -------- social: our own card, no provider script -------- */
    function socialCard(data) {
        var head = '';
        if (data.author) {
            head = '<div class="embed__author">' +
                '<span class="embed__avatar">' + esc(data.author.charAt(0).toUpperCase()) + '</span>' +
                '<span>' + esc(data.author) + '</span>' +
                '</div>';
        }

        var thumb = data.thumbnail
            ? '<img class="embed__thumb" src="' + esc(data.thumbnail) + '" alt="" loading="lazy">'
            : '';

        // Providers hand back blockquotes/anchors: keep them, drop their scripts
        var body = data.html
            ? '<div class="embed__raw">' + data.html + '</div>'
            : '<p class="embed__fallback">' +
              (data.title ? esc(data.title) : 'Open this post on ' + esc(data.label) + '.') +
              '</p>';

        return (
            '<figure class="embed embed--social" data-provider="' + esc(data.provider) + '">' +
            '<figcaption class="embed__meta">' +
            '<span class="embed__badge">' + esc(data.label) + '</span>' +
            '</figcaption>' +
            head +
            '<div class="embed__body">' + body + '</div>' +
            thumb +
            '<a class="embed__cta" href="' + esc(data.url) + '" target="_blank" rel="noopener noreferrer nofollow">' +
            'View on ' + esc(data.label) +
            '</a>' +
            '</figure>'
        );
    }

    function render(target) {
        var url = target.getAttribute('data-embed');
        if (!url) return;
        if (target.getAttribute('data-embed-done') === '1') return;
        target.setAttribute('data-embed-done', '1');

        target.innerHTML = '<div class="embed embed--loading">Loading embed…</div>';

        fetch('/api/embed/resolve?url=' + encodeURIComponent(url), {
            headers: { Accept: 'application/json' }
        })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (data) {
                if (data && data.error) {
                    target.innerHTML =
                        '<figure class="embed embed--social"><figcaption class="embed__meta">' +
                        '<span class="embed__badge">Link</span></figcaption>' +
                        '<div class="embed__body"><p class="embed__fallback">' + esc(data.error) + '</p></div>' +
                        '<a class="embed__cta" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer nofollow">Open link</a>' +
                        '</figure>';
                    return;
                }

                if (!data || !data.provider) {
                    target.innerHTML = '';
                    return;
                }

                var isVideo = (data.provider === 'youtube' || data.provider === 'vimeo');
                target.innerHTML = isVideo ? videoCard(data) : socialCard(data);
                target.classList.add('is-rendered');
            })
            .catch(function () {
                // Never leave a spinner behind
                target.innerHTML = '';
            });
    }

    function renderAll(root) {
        var nodes = (root || document).querySelectorAll(CONTAINER);
        Array.prototype.forEach.call(nodes, render);
    }

    // API for pages that render content later (the article body)
    window.renderEmbeds = renderAll;

    renderAll(document);

    // Catch embeds added after load
    if ('MutationObserver' in window) {
        var mo = new MutationObserver(function (mutations) {
            Array.prototype.forEach.call(mutations, function (m) {
                Array.prototype.forEach.call(m.addedNodes || [], function (node) {
                    if (node.nodeType !== 1) return;
                    if (node.matches && node.matches(CONTAINER)) render(node);
                    if (node.querySelectorAll) {
                        Array.prototype.forEach.call(node.querySelectorAll(CONTAINER), render);
                    }
                });
            });
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }
})();
