const express = require('express');
const router = express.Router();
const db = require('../config/db');
const security = require('../config/security');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

/* Page views arrive on every page load: capped but comfortable. */
const viewLimiter = security.rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    message: 'Too many events.'
});

/* Only countable, sensible paths — never a token, id or query string.
   Anything outside the known shape is recorded as a generic "other". */
const KNOWN_PAGES = [
    '/', '/article', '/gallery', '/about', '/contact', '/advertise',
    '/careers', '/privacy', '/terms', '/cookies'
];

function safePath(raw) {
    if (typeof raw !== 'string') return '/';

    // Drop query string and fragment, cap length
    let p = raw.split('?')[0].split('#')[0].slice(0, 80);

    // No traversal, no control characters, no backslashes
    if (p.includes('..') || p.includes('\\') || /[\u0000-\u001f]/.test(p)) {
        return '/other';
    }

    // Normalise: leading slash, no duplicate slashes, no trailing slash
    if (!p.startsWith('/')) p = '/' + p;
    p = p.replace(/\/{2,}/g, '/');
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);

    if (!/^\/[a-z0-9/_-]*$/.test(p)) return '/other';

    return p;
}

/* True when a path is one of the public reader pages. Keeps admin and auth
   routes out of the traffic numbers. */
function isCountable(path) {
    return KNOWN_PAGES.indexOf(path) !== -1;
}

// @route   POST /api/pages/event
// @desc    Record a page view (public, fire-and-forget)
router.post('/event', viewLimiter, [
    body('path').optional().isString().isLength({ max: 80 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const path = safePath(req.body.path);
        // Only reader pages count; /desk, /login and unknown routes do not
        if (isCountable(path)) {
            await db.recordEvent('page:' + path, 'impression');
        }
        res.status(204).end();
    } catch (error) {
        console.error('Page view error:', error);
        res.status(204).end();
    }
});

module.exports = router;
