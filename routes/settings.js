const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// @route   GET /api/settings
// @desc    Get all settings (public)
router.get('/', async (req, res) => {
  try {
    const settings = await db.getSettings();
    res.json({ settings });
  } catch (error) {
    console.error('Error in GET /api/settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PUT /api/settings/:key
// @desc    Update setting (superadmin only)
router.put('/:key', authMiddleware, requireRole('superadmin'), async (req, res) => {
  try {
    const { value } = req.body;
    const key = req.params.key;
    await db.updateSetting(key, value);
    res.json({ message: 'Setting updated' });
  } catch (error) {
    console.error('Error in PUT /api/settings/:key:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/settings/dashboard/data
// @desc    Get dashboard data (admin/superadmin)
router.get('/dashboard/data', authMiddleware, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const stats = await db.getStats();

    const allArticles = await db.getArticles();
    const recentArticles = await Promise.all(allArticles.slice(0, 5).map(async article => {
      const author = await db.getUserById(article.author_id);
      return { ...article, author_name: author ? author.name : 'Unknown' };
    }));

    const allUsers = await db.getAllUsers();
    const recentUsers = allUsers.slice(0, 5);

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
