const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authMiddleware, requireRole } = require('../middleware/auth');

/* ============================================================
   SITE ANALYTICS — admin only
   ============================================================ */
// @route   GET /api/stats/site
// @desc    Page views, top pages and the per-article funnel
router.get('/site', authMiddleware, requireRole('admin', 'superadmin'), (req, res) => {
    try {
        const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));
        res.json(db.getSiteStats(days));
    } catch (error) {
        console.error('Site stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
