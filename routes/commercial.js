const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

/* Staff-only advert management.

   Mounted at /api/commercial on purpose: these paths deliberately avoid the
   word "ads". Ad-blocking extensions filter URLs containing "ads", and when
   these endpoints lived under /api/ads/* the editorial desk broke for anyone
   with an ad blocker enabled. */
const POSITIONS = ['header', 'rail', 'inline', 'article', 'footer'];

// @route   GET /api/commercial/slots
// @desc    Every placement with full detail (admin/superadmin)
router.get('/slots', authMiddleware, requireRole('admin', 'superadmin'), async (req, res) => {
    try {
        const byPosition = {};
        await db.getAds().forEach(a => { byPosition[a.position] = a; });

        // Always return the full set, in a stable order
        const ads = POSITIONS.map(p => byPosition[p]).filter(Boolean);
        res.json({ ads });
    } catch (error) {
        console.error('Ad manage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   GET /api/commercial/metrics
// @desc    Impressions, clicks and CTR per placement (admin/superadmin)
router.get('/metrics', authMiddleware, requireRole('admin', 'superadmin'), async (req, res) => {
    try {
        const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));

        const placements = {};
        const slots = await db.getAds();
        for (const slot of slots) {
            const series = await db.getEventSeries('ad:' + slot.position, days);
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
        }

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

// @route   PUT /api/commercial/slots/:position
// @desc    Set the image and destination link for a placement
router.put('/slots/:position', authMiddleware, requireRole('admin', 'superadmin'), [
    body('image_url').optional({ nullable: true }).isLength({ max: 500 }),
    body('link_url').optional({ nullable: true }).isLength({ max: 500 }),
    body('is_active').optional().isBoolean()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const position = req.params.position;
    if (!POSITIONS.includes(position)) {
        return res.status(404).json({ error: 'Unknown placement' });
    }

    try {
        const existing = await db.getAdByPosition(position);
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

        const ad = await db.upsertAd(position, updates);
        res.json({ ad });
    } catch (error) {
        console.error('Ad update error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
