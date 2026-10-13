const express = require('express');
const router = express.Router();
const db = require('../config/database');
const security = require('../config/security');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// NOTE: staff endpoints live in ./commercial.js (mounted at /api/commercial).
// They used to sit under /api/ads/*, and ad-blocking extensions filter URLs
// containing "ads" — which broke the desk for anyone with one enabled.

// The only placements that exist. A placement is created by the seed, so
// there is no "create" endpoint — admins fill them in.
const POSITIONS = ['header', 'rail', 'inline', 'article', 'footer'];

/* Impressions/clicks arrive on every page view, so they get their own
   generous-but-capped limit to stop one client inflating the numbers. */
const eventLimiter = security.rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: 'Too many events.'
});

/* What the public site is allowed to see */
const publicAd = (ad) => ({
    id: ad.id,
    position: ad.position,
    image_url: ad.image_url,
    link_url: ad.link_url
});

// @route   GET /api/ads
// @desc    Live ads for every placement (public)
//          Only placements that are switched on AND have an image.
router.get('/', (req, res) => {
    try {
        const ads = db.getAds()
            .filter(a => a.is_active && a.image_url)
            .map(publicAd);
        res.json({ ads });
    } catch (error) {
        console.error('Public ad list error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   POST /api/ads/:position/event
// @desc    Record an advert impression or click (public, fire-and-forget)
router.post('/:position/event', eventLimiter, [
    body('type').isIn(['impression', 'click']).withMessage('Invalid event type')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const position = req.params.position;
    if (!POSITIONS.includes(position)) {
        return res.status(404).json({ error: 'Unknown placement' });
    }

    try {
        db.recordEvent('ad:' + position, req.body.type);
        // Always ack with 204 — a tracking pixel must never break a page
        res.status(204).end();
    } catch (error) {
        console.error('Ad event error:', error);
        res.status(204).end();
    }
});

module.exports = router;
