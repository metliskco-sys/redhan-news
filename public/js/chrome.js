/* ============================================
   PAGE CHROME — dates, year, mobile nav, reveal
   Used by the content pages (about, contact,
   advertise, careers, privacy, terms, cookies).
   ============================================ */
(function () {
    var now = new Date();

    var d = document.getElementById('todayDate');
    if (d) {
        d.textContent = now.toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    var y = document.getElementById('year');
    if (y) y.textContent = String(now.getFullYear());

    /* Mobile menu. The toggle must land on the .nav-links <ul>: the CSS rule is
       `.nav-links.is-open`, so toggling the wrapping <nav> did nothing. */
    function menuLinks() {
        return document.querySelector('.nav-links');
    }

    function toggleMobileNav() {
        var links = menuLinks();
        if (!links) return false;
        var open = links.classList.toggle('is-open');
        var btn = document.getElementById('mobileNavToggle');
        if (btn) {
            btn.setAttribute('aria-expanded', String(open));
            btn.classList.toggle('is-active', open);
        }
        document.body.classList.toggle('nav-open', open);
        return open;
    }

    function closeMobileNav() {
        var links = menuLinks();
        if (!links) return;
        links.classList.remove('is-open');
        var btn = document.getElementById('mobileNavToggle');
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            btn.classList.remove('is-active');
        }
        document.body.classList.remove('nav-open');
    }

    // Dismiss on link tap, Escape, or a tap outside the header
    document.addEventListener('click', function (e) {
        var links = menuLinks();
        if (!links || !links.classList.contains('is-open')) return;
        if (e.target.closest && (e.target.closest('.nav-links a') || e.target.closest('#mobileNavToggle'))) {
            setTimeout(closeMobileNav, 120);
            return;
        }
        if (e.target.closest && !e.target.closest('.site-header')) closeMobileNav();
    }, true);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeMobileNav();
    });

    var toggle = document.getElementById('mobileNavToggle');
    if (toggle) toggle.addEventListener('click', toggleMobileNav);

    // Scroll reveal for anything marked .reveal
    var items = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (items.length === 0) return;
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
    items.forEach(function (el) { io.observe(el); });
})();
