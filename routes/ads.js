const express = require('express');
const router = express.Router();
const db = require('../config/database');
const security = require('../config/security');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

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

// @route   GET /api/ads/manage
// @desc    Every placement with full detail (admin/superadmin)
router.get('/manage', authMiddleware, requireRole('admin', 'superadmin'), (req, res) => {
    try {
        const byPosition = {};
        db.getAds().forEach(a => { byPosition[a.position] = a; });

        // Always return the full set, in a stable order
        const ads = POSITIONS.map(p => byPosition[p]).filter(Boolean);
        res.json({ ads });
    } catch (error) {
        console.error('Ad manage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   GET /api/ads/stats
// @desc    Impressions, clicks and CTR per placement (admin/superadmin)
router.get('/stats', authMiddleware, requireRole('admin', 'superadmin'), (req, res) => {
    try {
        const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));

        const placements = {};
        db.getAds().forEach(slot => {
            const series = db.getEventSeries('ad:' + slot.position, days);
            const impressions = series.reduce((s, r) => s + r.impressions, 0);
            const clicks = series.reduce((s, r) => s + r.clicks, 0);

            placements[slot.position] = {
                position: slot.position,
                name: slot.name,
                impressions,
                clicks,
                ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                series
            };
        });

        // Totals across every placement
        let impressions = 0;
        let clicks = 0;
        Object.values(placements).forEach(p => {
            impressions += p.impressions;
            clicks += p.clicks;
        });

        res.json({
            windowDays: days,
            totals: {
                impressions,
                clicks,
                ctr: impressions > 0 ? (clicks / impressions) * 100 : 0
            },
            placements
        });
    } catch (error) {
        console.error('Ad stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   PUT /api/ads/:position
// @desc    Set the image and destination link for a placement
router.put('/:position', authMiddleware, requireRole('admin', 'superadmin'), [
    body('image_url').optional({ nullable: true }).isLength({ max: 500 }),
    body('link_url').optional({ nullable: true }).isLength({ max: 500 }),
    body('is_active').optional().isBoolean()
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
        const existing = db.getAdByPosition(position);
        if (!existing) {
            return res.status(404).json({ error: 'Unknown placement' });
        }

        const updates = {};
        if ('image_url' in req.body) updates.image_url = req.body.image_url || null;
        if ('link_url' in req.body) {
            // A scheme-less link would resolve as a relative path and go nowhere
            let link = String(req.body.link_url || '').trim();
            if (link && !/^https?:\/\//i.test(link) && !link.startsWith('/')) {
                link = 'https://' + link;
            }
            updates.link_url = link || null;
        }
        if ('is_active' in req.body) updates.is_active = !!req.body.is_active;

        const ad = db.upsertAd(position, updates);
        res.json({ ad });
    } catch (error) {
        console.error('Ad update error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
