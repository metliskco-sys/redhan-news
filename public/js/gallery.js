/* ============================================
   GALLERY — data, filtering, lightbox
   ============================================ */
(function () {
    var grid = document.getElementById('galGrid');
    if (!grid) return;

    var SHOTS = [
        { file: 1, tag: 'night',    title: 'Moonrise over the lagoon', meta: 'Baa Atoll · 2026' },
        { file: 2, tag: 'surf',     title: 'Breaking swell at dawn', meta: 'Malé · 2026' },
        { file: 3, tag: 'islands',  title: 'Palm island from above', meta: 'North Ari Atoll · 2026' },
        { file: 4, tag: 'reef',     title: 'Atoll rings and drop-off', meta: 'Raa Atoll · 2026' },
        { file: 5, tag: 'life',     title: 'Dhoni heading out', meta: 'Malé · 2025' },
        { file: 6, tag: 'life',     title: 'Morning market', meta: 'Malé · 2025' },
        { file: 7, tag: 'life',     title: 'Bodu beru night', meta: 'Malé · 2026' },
        { file: 8, tag: 'reef',     title: 'Whale shark corridor', meta: 'South Ari · 2026' },
        { file: 9, tag: 'reef',     title: 'Coral garden', meta: 'Addu Atoll · 2026' }
    ];

    var visible = SHOTS.slice();

    /* ---------- Render ---------- */
    function render() {
        grid.innerHTML = visible.map(function (s, i) {
            var src = '/images/gal-' + s.file + '.svg';
            return (
                '<button class="gal-item reveal" data-i="' + SHOTS.indexOf(s) + '" aria-label="' + s.title + '">' +
                    '<img src="' + src + '" alt="' + s.title + '" loading="lazy">' +
                    '<span class="gal-item__zoom">' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                            '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.6-3.6M11 8v6M8 11h6"></path>' +
                        '</svg>' +
                    '</span>' +
                    '<span class="gal-item__cap"><b>' + s.title + '</b><span>' + s.meta + '</span></span>' +
                '</button>'
            );
        }).join('');

        observeReveal();
        bindItems();
    }

    /* ---------- Scroll reveal ---------- */
    function observeReveal() {
        var items = Array.prototype.slice.call(grid.querySelectorAll('.reveal'));
        if (!('IntersectionObserver' in window)) {
            items.forEach(function (el) { el.classList.add('is-in'); });
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-in');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
        items.forEach(function (el, i) {
            el.style.transitionDelay = (i % 3) * 60 + 'ms';
            io.observe(el);
        });
    }

    /* ---------- Filters ---------- */
    document.getElementById('galFilters').addEventListener('click', function (e) {
        var btn = e.target.closest('.chip');
        if (!btn) return;
        Array.prototype.forEach.call(this.querySelectorAll('.chip'), function (c) {
            c.classList.remove('is-active');
        });
        btn.classList.add('is-active');
        var f = btn.dataset.filter;
        visible = f === 'all' ? SHOTS.slice() : SHOTS.filter(function (s) { return s.tag === f; });
        render();
    });

    /* ---------- Lightbox ---------- */
    var lb = document.getElementById('lightbox');
    var lbImg = document.getElementById('lightboxImg');
    var lbTitle = document.getElementById('lightboxTitle');
    var lbMeta = document.getElementById('lightboxMeta');
    var current = 0;

    function open(index) {
        current = index;
        var s = SHOTS[index];
        if (!s) return;
        lbImg.src = '/images/gal-' + s.file + '.svg';
        lbImg.alt = s.title;
        lbTitle.textContent = s.title;
        lbMeta.textContent = s.meta + ' · Redhan Gallery';
        lb.style.display = 'flex';
        requestAnimationFrame(function () { lb.classList.add('is-open'); });
        document.body.style.overflow = 'hidden';
    }

    function close() {
        lb.classList.remove('is-open');
        setTimeout(function () { lb.style.display = 'none'; }, 320);
        document.body.style.overflow = '';
    }

    function step(dir) {
        current = (current + dir + SHOTS.length) % SHOTS.length;
        open(current);
    }

    Array.prototype.forEach.call(lb.querySelectorAll('[data-close]'), function (el) {
        el.addEventListener('click', close);
    });
    document.getElementById('lightboxPrev').addEventListener('click', function () { step(-1); });
    document.getElementById('lightboxNext').addEventListener('click', function () { step(1); });

    document.addEventListener('keydown', function (e) {
        if (!lb.classList.contains('is-open')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') step(-1);
        if (e.key === 'ArrowRight') step(1);
    });

    function bindItems() {
        Array.prototype.forEach.call(grid.querySelectorAll('.gal-item'), function (el) {
            el.addEventListener('click', function () {
                open(parseInt(el.dataset.i, 10));
            });
        });
    }

    render();

    /* ---------- Chrome ---------- */
    var now = new Date();
    var d = document.getElementById('todayDate');
    if (d) {
        d.textContent = now.toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    }
    var y = document.getElementById('year');
    if (y) y.textContent = String(now.getFullYear());

    var toggle = document.getElementById('mobileNavToggle');
    var nav = document.getElementById('mainNav');
    if (toggle && nav) {
        toggle.addEventListener('click', function () { nav.classList.toggle('is-open'); });
    }
})();
