/* ============================================
   AMBIENT BACKGROUND — site-wide
   Drifting wave fronts + star-like glowing
   phytoplankton, with pointer parallax.
   Load on every page; safe to run when the
   markup is absent.
   ============================================ */
(function () {
    const host = document.querySelector('.ambient');
    if (!host) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const rand = (min, max) => min + Math.random() * (max - min);

    /* ---------- Generate wave fronts ---------- */
    function buildWaves() {
        const wrap = document.createElement('div');
        wrap.className = 'ambient__waves';

        const surf = document.createElement('div');
        surf.className = 'ambient__surf';
        wrap.appendChild(surf);

        // Four long curved fronts, back to front
        const depths = [
            { b: '36%', o: '0.32', d: '20s', dl: '0s' },
            { b: '25%', o: '0.5', d: '16s', dl: '-6s' },
            { b: '13%', o: '0.7', d: '12s', dl: '-9s' },
            { b: '1%', o: '0.95', d: '9s', dl: '-3s' }
        ];

        depths.forEach((cfg, i) => {
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('class', 'ambient__wave');
            svg.setAttribute('viewBox', '0 0 1200 140');
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.setAttribute('aria-hidden', 'true');
            svg.style.setProperty('--b', cfg.b);
            svg.style.setProperty('--o', cfg.o);
            svg.style.setProperty('--d', cfg.d);
            svg.style.setProperty('--dl', cfg.dl);

            const path = document.createElementNS(ns, 'path');
            const y = 40 + i * 12;
            path.setAttribute('d',
                `M0 ${y} C 220 ${y - 30}, 460 ${y + 30}, 680 ${y} ` +
                `S 1020 ${y - 28}, 1200 ${y + 6}`);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', `rgba(${150 + i * 18}, ${225 - i * 6}, 255, ${0.28 - i * 0.04})`);
            path.setAttribute('stroke-width', String(1.4 + i * 0.5));
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('filter', 'drop-shadow(0 0 10px rgba(120,215,255,.35))');
            svg.appendChild(path);

            wrap.appendChild(svg);
        });

        host.appendChild(wrap);
    }

    /* ---------- Generate glowing plankton ---------- */
    function buildPlankton() {
        const wrap = document.createElement('div');
        wrap.className = 'ambient__plankton';

        const tones = [
            { c: '#c7f2ff', g: 'rgba(120,230,255,.85)', g2: 'rgba(90,200,255,.35)' },
            { c: '#dcdcff', g: 'rgba(150,160,255,.8)', g2: 'rgba(120,135,255,.3)' },
            { c: '#e8fbff', g: 'rgba(180,245,255,.9)', g2: 'rgba(140,225,255,.4)' }
        ];

        const count = window.innerWidth < 768 ? 80 : 130;
        for (let i = 0; i < count; i++) {
            const dot = document.createElement('span');
            const tone = tones[i % tones.length];
            dot.className = 'glow';
            dot.style.left = `${rand(-2, 100)}%`;
            dot.style.top = `${rand(2, 98)}%`;
            dot.style.setProperty('--s', `${rand(2.2, 5.6).toFixed(1)}px`);
            dot.style.setProperty('--c', tone.c);
            dot.style.setProperty('--g', tone.g);
            dot.style.setProperty('--g2', tone.g2);
            dot.style.setProperty('--tw', `${rand(1.8, 4.2).toFixed(1)}s`);
            dot.style.setProperty('--df', `${rand(11, 24).toFixed(1)}s`);
            dot.style.setProperty('--dl', `${rand(-6, 0).toFixed(1)}s`);
            dot.style.setProperty('--dl2', `${rand(-20, 0).toFixed(1)}s`);
            dot.style.setProperty('--dx', `${rand(-18, 22).toFixed(0)}px`);
            dot.style.setProperty('--dy', `${rand(-26, 18).toFixed(0)}px`);
            wrap.appendChild(dot);
        }

        host.appendChild(wrap);
        return wrap;
    }

    buildWaves();
    const planktonLayer = buildPlankton();

    /* ---------- Idle + pointer-driven motion ---------- */
    const orbs = Array.from(document.querySelectorAll('.orb'));
    const grid = host.querySelector('.ambient__grid');

    function applyParallax(x, y) {
        orbs.forEach(o => {
            const depth = parseFloat(o.dataset.depth || '24') / 100;
            o.style.setProperty('--px', `${(x * depth).toFixed(2)}px`);
            o.style.setProperty('--py', `${(y * depth).toFixed(2)}px`);
        });
        if (grid) {
            grid.style.setProperty('--px', `${(x * 0.3).toFixed(2)}px`);
            grid.style.setProperty('--py', `${(y * 0.3).toFixed(2)}px`);
        }
        // Plankton drifts the other way for depth
        if (planktonLayer) {
            planktonLayer.style.transform = `translate3d(${(-x * 0.05).toFixed(2)}px, ${(-y * 0.05).toFixed(2)}px, 0)`;
        }
    }

    if (reduced) {
        applyParallax(0, 0);
        return;
    }

    let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;

    function tick() {
        cx += (tx - cx) * 0.06;
        cy += (ty - cy) * 0.06;
        applyParallax(cx, cy);
        const done = Math.abs(tx - cx) < 0.05 && Math.abs(ty - cy) < 0.05;
        raf = done ? null : requestAnimationFrame(tick);
    }

    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    window.addEventListener('pointermove', (e) => {
        tx = (e.clientX / window.innerWidth - 0.5) * 30;
        ty = (e.clientY / window.innerHeight - 0.5) * 30;
        kick();
    }, { passive: true });

    // Gentle drift while idle
    let t = 0;
    setInterval(() => {
        t += 0.018;
        tx = Math.sin(t) * 16;
        ty = Math.cos(t * 0.8) * 13;
        kick();
    }, 90);
})();
