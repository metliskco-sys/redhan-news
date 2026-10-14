const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// @route   GET /api/categories
// @desc    Get all categories (public)
router.get('/', async (req, res) => {
  try {
    const categories = await db.getCategories();
    res.json({ categories });
  } catch (error) {
    console.error('Error in GET /api/categories:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/categories
// @desc    Create category (admin/superadmin)
router.post('/', authMiddleware, requireRole('admin', 'superadmin'), [
  body('name').notEmpty(),
  body('slug').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { name, slug, description } = req.body;
    const category = await db.createCategory({ name, slug, description });
    res.status(201).json({ category });
  } catch (error) {
    console.error('Error in POST /api/categories:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PUT /api/categories/:id
// @desc    Update category (admin/superadmin)
router.put('/:id', authMiddleware, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const { name, slug, description } = req.body;
    const category = await db.updateCategory(req.params.id, { name, slug, description });
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ message: 'Category updated', category });
  } catch (error) {
    console.error('Error in PUT /api/categories/:id:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   DELETE /api/categories/:id
// @desc    Delete category (admin/superadmin)
router.delete('/:id', authMiddleware, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    await db.deleteCategory(req.params.id);
    res.json({ message: 'Category deleted' });
  } catch (error) {
    console.error('Error in DELETE /api/categories/:id:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
