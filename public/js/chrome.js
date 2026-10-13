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

    var toggle = document.getElementById('mobileNavToggle');
    var nav = document.getElementById('mainNav');
    if (toggle && nav) {
        toggle.addEventListener('click', function () {
            var open = nav.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', String(open));
        });
    }

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
