const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const security = require('../config/security');
const { body, validationResult } = require('express-validator');

// @route   GET /api/articles
// @desc    Get all published articles (public)
router.get('/', async (req, res) => {
  try {
    const { category, search, limit = 10, page = 1 } = req.query;
    let articles = await db.getArticles({ status: 'published' });

    if (category) {
      const cat = await db.getCategoryBySlug(category);
      if (cat) {
        articles = articles.filter(a => a.category_id === cat.id);
      }
    }

    if (search) {
      const searchLower = search.toLowerCase();
      articles = articles.filter(a =>
        a.title.toLowerCase().includes(searchLower) ||
        a.excerpt.toLowerCase().includes(searchLower)
      );
    }

    // Enrich with author and category data
    articles = await Promise.all(articles.map(async article => {
      const author = await db.getUserById(article.author_id);
      const category = await db.getCategory(article.category_id);
      return {
        ...article,
        author_name: author ? author.name : 'Unknown',
        category_name: category ? category.name : null,
        category_slug: category ? category.slug : null
      };
    }));

    res.json({ articles });
  } catch (error) {
    console.error('Error in GET /api/articles:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/articles/:slug
// @desc    Get single article by slug (public)
router.get('/:slug', async (req, res) => {
  try {
    const article = await db.getArticleBySlug(req.params.slug);
    if (!article || article.status !== 'published') {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Increment views
    await db.updateArticle(article.id, { views: (article.views || 0) + 1 });

    const author = await db.getUserById(article.author_id);
    const category = await db.getCategory(article.category_id);

    res.json({
      article: {
        ...article,
        author_name: author ? author.name : 'Unknown',
        category_name: category ? category.name : null,
        category_slug: category ? category.slug : null
      }
    });
  } catch (error) {
    console.error('Error in GET /api/articles/:slug:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/articles
// @desc    Create new article (any editorial role, incl. superadmin)
router.post('/', authMiddleware, requireRole('superadmin', 'admin', 'writer'), [
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('content').isString().notEmpty().isLength({ max: 200000 }),
  body('excerpt').trim().notEmpty().isLength({ max: 1000 }),
  body('featured_image').optional().isLength({ max: 500 }),
  body('tags').optional().isString().isLength({ max: 300 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { title, category_id, status, featured_image, tags } = req.body;

    // Author-authored HTML is sanitised on write: a compromised writer
    // account must not be able to run scripts in readers' browsers.
    const excerpt = security.sanitizeHtml(req.body.excerpt);
    const content = security.sanitizeHtml(req.body.content);
    // Hashtags are plain text: any markup is stripped outright
    const cleanTags = String(tags || '').replace(/<[^>]*>/g, '').slice(0, 300);

    let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Check if slug exists
    const existing = await db.getArticleBySlug(slug);
    if (existing) {
      return res.status(400).json({ error: 'Article with this title already exists' });
    }

    const article = await db.createArticle({
      title,
      slug,
      excerpt,
      content,
      featured_image: featured_image || null,
      author_id: req.user.id,
      category_id: category_id || null,
      status: status || 'draft',
      tags: cleanTags
    });

    res.status(201).json({ article });
  } catch (error) {
    console.error('Error in POST /api/articles:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PUT /api/articles/:id
// @desc    Update article (author/admin/superadmin)
router.put('/:id', authMiddleware, requireRole('admin', 'writer', 'superadmin'), [
  body('title').optional().notEmpty(),
  body('content').optional().notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const article = await db.getArticle(req.params.id);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Check permissions
    if (article.author_id !== req.user.id && !['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized to edit this article' });
    }

    const updates = {};
    if (req.body.title) updates.title = req.body.title;
    if (req.body.excerpt) updates.excerpt = security.sanitizeHtml(req.body.excerpt);
    if (req.body.content) updates.content = security.sanitizeHtml(req.body.content);
    if (req.body.category_id) updates.category_id = req.body.category_id;
    if (req.body.status) updates.status = req.body.status;
    if (req.body.featured_image) updates.featured_image = req.body.featured_image;
    // Hashtags are plain text — strip any markup
    if ('tags' in req.body) {
        updates.tags = String(req.body.tags || '').replace(/<[^>]*>/g, '').slice(0, 300);
    }

    if (req.body.title) {
      updates.slug = req.body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    const updatedArticle = await db.updateArticle(req.params.id, updates);
    res.json({ article: updatedArticle });
  } catch (error) {
    console.error('Error in PUT /api/articles/:id:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   DELETE /api/articles/:id
// @desc    Delete article (author/admin/superadmin)
router.delete('/:id', authMiddleware, requireRole('admin', 'writer', 'superadmin'), async (req, res) => {
  try {
    const article = await db.getArticle(req.params.id);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    if (article.author_id !== req.user.id && !['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized to delete this article' });
    }

    await db.deleteArticle(req.params.id);
    res.json({ message: 'Article deleted' });
  } catch (error) {
    console.error('Error in DELETE /api/articles/:id:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/articles/dashboard/stats
// @desc    Get dashboard stats (admin/writer)
router.get('/dashboard/stats', authMiddleware, requireRole('admin', 'writer', 'superadmin'), async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({ stats });
  } catch (error) {
    console.error('Error in GET /api/articles/dashboard/stats:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/articles/dashboard/recent
// @desc    Get recent articles (admin/writer)
router.get('/dashboard/recent', authMiddleware, requireRole('admin', 'writer', 'superadmin'), async (req, res) => {
  try {
    const allArticles = await db.getArticles();
    const articles = await Promise.all(allArticles.slice(0, 10).map(async article => {
      const author = await db.getUserById(article.author_id);
      return {
        ...article,
        author_name: author ? author.name : 'Unknown'
      };
    }));
    res.json({ articles });
  } catch (error) {
    console.error('Error in GET /api/articles/dashboard/recent:', error);
    res.status(500).json({ error: 'Server error' });
  }
});


// @route   POST /api/articles/:id/event
// @desc    Record a feed impression or a teaser click (public, fire-and-forget)
router.post('/:id/event', security.rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    message: 'Too many events.'
}), [
    body('type').isIn(['impression', 'click']).withMessage('Invalid event type')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid article' });
    }

    try {
        await db.recordEvent('article:' + id, req.body.type);
        res.status(204).end();
    } catch (error) {
        console.error('Article event error:', error);
        res.status(204).end();
    }
});


// @route   GET /api/articles/manage/:id
// @desc    Fetch a single article regardless of status (admin/editorial).
//          The public /:slug route only serves published stories, so this is
//          what lets the desk open a draft for editing.
router.get('/manage/:id', authMiddleware, requireRole('superadmin', 'admin', 'writer'), async (req, res) => {
    try {
        const article = await db.getArticle(req.params.id);
        if (!article) {
            return res.status(404).json({ error: 'Article not found' });
        }
        res.json({ article });
    } catch (error) {
        console.error('Error in GET /api/articles/manage/:id:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
