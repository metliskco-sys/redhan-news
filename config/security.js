/* ============================================
   SECURITY — headers, rate limiting, sanitising,
   upload signature verification, errors.
   No external dependencies (keeps the stack lean
   and auditable).
   ============================================ */
const crypto = require('crypto');

/* --------------------------------------------------
   1. HTTP security headers
   -------------------------------------------------- */
function securityHeaders(req, res, next) {
    // Stop MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Legacy XSS filter (for old browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Do not leak URLs in referrers
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Explicitly disable powerful features we never use
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    // HSTS — safe to always set; ignored over plain HTTP
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // Content Security Policy. Google Fonts is the only external origin we need.
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",          // inline handlers used across pages
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        "connect-src 'self'",
        "frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'"
    ].join('; '));

    next();
}

/* --------------------------------------------------
   2. Rate limiting / brute-force protection
   In-memory, per key, sliding window. Fine for a
   single-process deployment.
   -------------------------------------------------- */
const buckets = new Map();
const IS_TEST = process.env.NODE_ENV === 'test';

// Periodically drop expired entries so the map cannot grow without bound
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(key);
    }
}, 60 * 1000).unref();

function clientKey(req) {
    return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * @param {object}  opts
 * @param {number}  opts.windowMs   window length
 * @param {number}  opts.max        max requests per window per key
 * @param {string}  opts.keyFn      'ip' | 'ip+email' | custom
 * @param {string}  opts.message    error text returned when limited
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 100, keyFn = 'ip', message = 'Too many requests. Please slow down.' }) {
    return (req, res, next) => {
        if (IS_TEST) return next();

        let key = clientKey(req);
        if (keyFn === 'ip+email') {
            key += ':' + String(req.body?.email || '').toLowerCase();
        }

        const now = Date.now();
        let entry = buckets.get(key);

        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            buckets.set(key, entry);
        }

        entry.count += 1;

        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

        if (entry.count > max) {
            res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
            return res.status(429).json({ error: message });
        }

        next();
    };
}

/* --------------------------------------------------
   3. Progressive login lockout
   Tracks failures per (email|ip) and locks the pair
   after `threshold` failures for `lockMs`.
   -------------------------------------------------- */
const loginFailures = new Map();

function registerLoginFailure(email, ip) {
    const key = `${String(email).toLowerCase()}|${ip}`;
    const now = Date.now();
    let entry = loginFailures.get(key);
    if (!entry) {
        entry = { failures: 0, lockedUntil: 0 };
        loginFailures.set(key, entry);
    }
    entry.failures += 1;
    if (entry.failures >= 5) {
        entry.lockedUntil = now + 15 * 60 * 1000;  // 15 min lock
    }
}

function clearLoginFailures(email, ip) {
    loginFailures.delete(`${String(email).toLowerCase()}|${ip}`);
}

function isLoginLocked(email, ip) {
    if (IS_TEST) return false;
    const entry = loginFailures.get(`${String(email).toLowerCase()}|${ip}`);
    if (!entry) return false;
    if (entry.lockedUntil > Date.now()) return true;
    if (entry.lockedUntil !== 0 && entry.lockedUntil <= Date.now()) {
        loginFailures.delete(`${String(email).toLowerCase()}|${ip}`);
    }
    return false;
}

/* --------------------------------------------------
   4. HTML sanitising for author-authored content
   Editorial bodies are HTML by design, but a
   compromised writer account must not be able to
   run scripts in readers' browsers.
   -------------------------------------------------- */
function sanitizeHtml(input) {
    if (typeof input !== 'string') return '';

    let html = input;

    // Remove dangerous elements outright (content included)
    html = html.replace(/<\s*(script|iframe|object|embed|style|link|meta|base|form)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    // Remove any unclosed dangerous opening tags
    html = html.replace(/<\s*\/?\s*(script|iframe|object|embed|style|link|meta|base|form)\b[^>]*>/gi, '');
    // Strip inline event handlers: onclick=, onerror=, onload= ...
    html = html.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // Neutralise javascript: / data: URLs in href and src
    html = html.replace(/(href|src|action|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript|data)\s*:[^"]*"|'\s*(?:javascript|vbscript|data)\s*:[^']*'|(?:javascript|vbscript|data)\s*:[^\s>]*)/gi, '$1="#"');
    // Remove javascript: appearing in plain text forms
    html = html.replace(/(javascript|vbscript)\s*:/gi, '$1_:');
    // Strip style attributes that could carry expressions or url()
    html = html.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    return html;
}

/* --------------------------------------------------
   5. Upload verification — magic bytes, not the
   client-supplied MIME type or filename.
   -------------------------------------------------- */
const SIGNATURES = [
    { ext: 'png', mime: 'image/png', test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
    { ext: 'jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { ext: 'gif', mime: 'image/gif', test: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
    { ext: 'webp', mime: 'image/webp', test: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
    { ext: 'avif', mime: 'image/avif', test: b => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66 }
];

function detectImageType(buffer) {
    if (!buffer || buffer.length < 12) return null;
    return SIGNATURES.find(sig => sig.test(buffer)) || null;
}

/* --------------------------------------------------
   6. JWT secret — never hardcode a weak one
   -------------------------------------------------- */
function resolveJwtSecret() {
    const fromEnv = process.env.JWT_SECRET;
    if (fromEnv && fromEnv.length >= 32) return fromEnv;

    if (process.env.NODE_ENV === 'production' && !fromEnv) {
        console.error('FATAL: JWT_SECRET must be set in production.');
        process.exit(1);
    }

    if (fromEnv) {
        console.warn('WARNING: JWT_SECRET is shorter than 32 chars — use a longer one.');
        return fromEnv;
    }

    // Development fallback: random per boot so tokens do not survive a restart
    const generated = crypto.randomBytes(48).toString('hex');
    console.warn('WARNING: JWT_SECRET not set — generated an ephemeral secret for this run.');
    console.warn('         Set JWT_SECRET in the environment for stable sessions.');
    return generated;
}

/* --------------------------------------------------
   7. Safe error responses — never leak internals
   -------------------------------------------------- */
function publicError(res, status, message) {
    return res.status(status).json({ error: message });
}

module.exports = {
    securityHeaders,
    rateLimit,
    registerLoginFailure,
    clearLoginFailures,
    isLoginLocked,
    sanitizeHtml,
    detectImageType,
    resolveJwtSecret,
    publicError
};
