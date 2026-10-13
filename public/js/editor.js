/* ============================================
   IMAGE CROPPER — pan / zoom, fixed aspect,
   client-side crop + JPEG re-encode.
   ============================================ */
(function () {
    const OUT_W = 1600;
    const OUT_H = 900;

    let overlay = null;
    let state = null;

    function buildOverlay() {
        overlay = document.createElement('div');
        overlay.className = 'cropper';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="cropper__scrim" data-crop="cancel"></div>
            <div class="cropper__panel">
                <div class="cropper__head">
                    <span class="kicker">Cover image</span>
                    <button class="modal__close" data-crop="cancel" aria-label="Cancel crop">&times;</button>
                </div>
                <p class="cropper__hint">Drag to reposition · scroll or use the slider to zoom</p>
                <div class="cropper__stage">
                    <canvas class="cropper__canvas" data-crop="canvas"></canvas>
                    <div class="cropper__grid" aria-hidden="true"></div>
                </div>
                <div class="cropper__controls">
                    <input type="range" class="cropper__zoom" min="0.2" max="3" step="0.01" value="1"
                           data-crop="zoom" aria-label="Zoom">
                    <span class="cropper__pct" data-crop="pct">100%</span>
                    <button class="btn btn--sm btn--ghost" data-crop="reset">Reset</button>
                </div>
                <div class="modal__foot">
                    <button class="btn" data-crop="cancel">Cancel</button>
                    <button class="btn btn--solid" data-crop="apply">Crop &amp; use</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        return overlay;
    }

    function close() {
        if (!overlay) return;
        overlay.classList.remove('is-open');
        const el = overlay;
        setTimeout(() => el.remove(), 300);
        overlay = null;
        state = null;
        document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }

    /* Draw the cropped region to the canvas */
    function draw() {
        if (!state) return;
        const { img, scale, ox, oy, canvas, ctx } = state;

        const cw = canvas.clientWidth || 640;
        const ch = canvas.clientHeight || 360;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
            canvas.width = Math.round(cw * dpr);
            canvas.height = Math.round(ch * dpr);
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#060f1f';
        ctx.fillRect(0, 0, cw, ch);

        // "cover" fit at the current scale, then user offset
        const base = Math.max(cw / img.width, ch / img.height);
        const s = base * scale;
        const w = img.width * s;
        const h = img.height * s;
        const x = (cw - w) / 2 + ox;
        const y = (ch - h) / 2 + oy;

        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, x, y, w, h);
    }

    /* Keep the crop inside the frame at all times */
    function clampOffset() {
        if (!state) return;
        const { img, scale, canvas } = state;
        const cw = canvas.clientWidth || 640;
        const ch = canvas.clientHeight || 360;
        const base = Math.max(cw / img.width, ch / img.height);
        const s = base * scale;
        const w = img.width * s;
        const h = img.height * s;

        const maxX = Math.max(0, (w - cw) / 2);
        const maxY = Math.max(0, (h - ch) / 2);
        state.ox = Math.max(-maxX, Math.min(maxX, state.ox));
        state.oy = Math.max(-maxY, Math.min(maxY, state.oy));
    }

    function setScale(next) {
        if (!state) return;
        const { img, canvas } = state;
        // Minimum scale must cover the frame
        const cw = canvas.clientWidth || 640;
        const ch = canvas.clientHeight || 360;
        const base = Math.max(cw / img.width, ch / img.height);
        const minScale = Math.max(0.2, 1 / base);

        state.scale = Math.max(minScale, Math.min(3, next));
        clampOffset();
        draw();

        const pct = overlay.querySelector('[data-crop="pct"]');
        const slider = overlay.querySelector('[data-crop="zoom"]');
        if (pct) pct.textContent = `${Math.round(state.scale * 100)}%`;
        if (slider) slider.value = String(state.scale);
    }

    function bindDrag() {
        const { canvas } = state;
        let dragging = false;
        let lastX = 0;
        let lastY = 0;

        canvas.addEventListener('pointerdown', (e) => {
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            canvas.setPointerCapture(e.pointerId);
            canvas.classList.add('is-dragging');
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            state.ox += e.clientX - lastX;
            state.oy += e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            clampOffset();
            draw();
        });

        const stop = (e) => {
            dragging = false;
            canvas.classList.remove('is-dragging');
            if (e && e.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) {
                canvas.releasePointerCapture(e.pointerId);
            }
        };
        canvas.addEventListener('pointerup', stop);
        canvas.addEventListener('pointercancel', stop);

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            setScale(state.scale * (e.deltaY < 0 ? 1.06 : 0.94));
        }, { passive: false });

        canvas.addEventListener('dblclick', () => setScale(1));
    }

    function produceBlob(aspect) {
        const { img, scale, ox, oy } = state;
        const A = aspect || 16 / 9;

        // Longest edge capped at 1600px so uploads stay small
        const outW = A >= 1 ? 1600 : Math.round(1600 * A);
        const outH = A >= 1 ? Math.round(1600 / A) : 1600;

        const out = document.createElement('canvas');
        out.width = outW;
        out.height = outH;
        const octx = out.getContext('2d');

        octx.fillStyle = '#060f1f';
        octx.fillRect(0, 0, outW, outH);

        const base = Math.max(outW / img.width, outH / img.height);
        const s = base * scale;
        const w = img.width * s;
        const h = img.height * s;
        const k = outW / (state.canvas.clientWidth || 640);
        const x = (outW - w) / 2 + ox * k;
        const y = (outH - h) / 2 + oy * k;

        octx.imageSmoothingQuality = 'high';
        octx.drawImage(img, x, y, w, h);

        return new Promise((resolve) => {
            out.toBlob((blob) => {
                resolve(blob);
            }, 'image/jpeg', 0.9);
        });
    }

    /**
     * Open the cropper.
     * @param {File} file       source image
     * @param {(blob: Blob, url: string) => void} onApply
     * @param {number} [aspect] output width/height, e.g. 16/9 or 4/3
     */
    async function open(file, onApply, aspect) {
        const A = aspect || 16 / 9;
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            alert('Please choose an image file.');
            return;
        }

        const el = overlay || buildOverlay();
        overlay = el;
        el.classList.add('is-open');

        const canvas = el.querySelector('[data-crop="canvas"]');
        const stage = el.querySelector('.cropper__stage');
        if (stage) stage.style.aspectRatio = String(A);

        const slider = el.querySelector('[data-crop="zoom"]');
        const resetBtn = el.querySelector('[data-crop="reset"]');
        const applyBtn = el.querySelector('[data-crop="apply"]');
        const pct = el.querySelector('[data-crop="pct"]');

        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            state = { img, scale: 1, ox: 0, oy: 0, canvas, ctx: canvas.getContext('2d') };
            setScale(1);
            bindDrag();
        };
        img.onerror = () => {
            alert('That image could not be read.');
            close();
        };
        img.src = objectUrl;

        el.querySelectorAll('[data-crop="cancel"]').forEach(b => {
            b.onclick = () => close();
        });
        resetBtn.onclick = () => setScale(1);
        slider.oninput = () => setScale(parseFloat(slider.value));

        applyBtn.onclick = async () => {
            if (!state) return;
            applyBtn.disabled = true;
            applyBtn.textContent = 'Processing…';
            try {
                const blob = await produceBlob(A);
                const url = URL.createObjectURL(blob);
                const cropped = new File([blob], 'upload.jpg', { type: 'image/jpeg' });
                onApply(cropped, url);
                close();
            } catch (error) {
                console.error('Crop failed:', error);
                alert('Could not process that image.');
                applyBtn.disabled = false;
                applyBtn.textContent = 'Crop & use';
            }
        };

        document.addEventListener('keydown', onKey);

        // Redraw on resize so the crop stays framed correctly
        window.addEventListener('resize', () => {
            if (state) { clampOffset(); draw(); }
        });
    }

    window.ImageCropper = { open };
})();
