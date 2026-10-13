const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authMiddleware, requireRole } = require('../middleware/auth');

// @route   GET /api/settings
// @desc    Get all settings (public)
router.get('/', (req, res) => {
  try {
    const settings = db.getSettings();
    res.json({ settings });
  } catch (error) {
    console.error('Error in GET /api/settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PUT /api/settings/:key
// @desc    Update setting (superadmin only)
router.put('/:key', authMiddleware, requireRole('superadmin'), (req, res) => {
  try {
    const { value } = req.body;
    const key = req.params.key;
    db.updateSetting(key, value);
    res.json({ message: 'Setting updated' });
  } catch (error) {
    console.error('Error in PUT /api/settings/:key:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/settings/dashboard/data
// @desc    Get dashboard data (admin/superadmin)
router.get('/dashboard/data', authMiddleware, requireRole('admin', 'superadmin'), (req, res) => {
  try {
    const stats = db.getStats();

    const recentArticles = db.getArticles().slice(0, 5).map(article => {
      const author = db.getUserById(article.author_id);
      return { ...article, author_name: author ? author.name : 'Unknown' };
    });

    const recentUsers = db.getAllUsers().slice(0, 5);

    res.json({
      stats,
      recentArticles,
      recentUsers
    });
  } catch (error) {
    console.error('Error in GET /api/settings/dashboard/data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
