/* ============================================
   SECTIONS — renders the navigation, footer
   section list and the homepage filter chips
   from the live category list, so sections
   created in the desk appear everywhere.
   ============================================ */
(function () {
    var NAV_LIMIT = 8;   // room for every section; the nav scrolls if it ever overflows

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function categoryHref(slug) {
        return '/?category=' + encodeURIComponent(slug);
    }

    /* Applying a filter works whether or not the homepage app is loaded. */
    function applyCategory(category) {
        if (window.app && typeof window.app.setCategory === 'function') {
            window.app.setCategory(category);
            var grid = document.getElementById('articleGrid');
            if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            window.location.href = category === 'all' ? '/' : categoryHref(category);
        }
    }

    function bindChips(container) {
        Array.prototype.forEach.call(container.querySelectorAll('.chip'), function (chip) {
            if (chip._bound) return;
            chip._bound = true;
            chip.addEventListener('click', function (e) {
                e.preventDefault();
                Array.prototype.forEach.call(container.querySelectorAll('.chip'), function (c) {
                    c.classList.remove('is-active');
                });
                chip.classList.add('is-active');
                applyCategory(chip.getAttribute('data-category') || 'all');
            });
        });
    }

    function render(categories) {
        var current = (window.app && window.app.currentCategory) || 'all';

        /* ---------- top navigation ---------- */
        var navList = document.querySelector('.nav-links');
        if (navList) {
            var shown = categories.slice(0, NAV_LIMIT);
            var html = '<li><a href="/" class="nav-link' + (current === 'all' ? ' is-active' : '') +
                '" data-category="all">Home</a></li>';
            html += shown.map(function (c) {
                var active = current === c.slug ? ' is-active' : '';
                return '<li><a href="' + categoryHref(c.slug) + '" class="nav-link' + active +
                    '" data-category="' + esc(c.slug) + '">' + esc(c.name) + '</a></li>';
            }).join('');
            navList.innerHTML = html;
        }

        /* ---------- footer section list ---------- */
        var footers = document.querySelectorAll('.footer-col ul');
        Array.prototype.forEach.call(footers, function (ul) {
            // Only rebuild the column that currently lists categories
            var first = ul.querySelector('a');
            if (!first) return;
            var href = first.getAttribute('href') || '';
            var looksLikeSections = /\/\?category=/.test(href) ||
                ul.querySelector('a[href="/gallery"]');

            if (!looksLikeSections) return;

            var items = categories.map(function (c) {
                return '<li><a href="' + categoryHref(c.slug) + '">' + esc(c.name) + '</a></li>';
            });
            items.push('<li><a href="/gallery">Gallery</a></li>');
            ul.innerHTML = items.join('');
        });

        /* ---------- homepage filter chips ---------- */
        var filters = document.getElementById('categoryFilter');
        if (filters) {
            var chips = ['<button class="chip' + (current === 'all' ? ' is-active' : '') +
                '" data-category="all">All</button>'];
            chips = chips.concat(categories.map(function (c) {
                var active = current === c.slug ? ' is-active' : '';
                return '<button class="chip' + active + '" data-category="' + esc(c.slug) + '">' +
                    esc(c.name) + '</button>';
            }));
            filters.innerHTML = chips.join('');
            bindChips(filters);
        }
    }

    function load() {
        fetch('/api/categories', { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.ok ? r.json() : { categories: [] }; })
            .then(function (data) { render(data.categories || []); })
            .catch(function (err) {
                console.error('Could not load sections:', err);
            });
    }

    // Exposed so the homepage can re-render after a category changes
    window.RedhanSections = { load: load, render: render };

    load();
})();
