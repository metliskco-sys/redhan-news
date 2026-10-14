const express = require('express');
const router = express.Router();
const db = require('../config/db');
const security = require('../config/security');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

/* Rate limit comment submissions to stop spam flooding */
const commentLimiter = security.rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: 'You are posting comments too quickly. Try again shortly.'
});

/* Public-safe projection: never expose an email address or a hidden status */
function publicComment(c) {
    return {
        id: c.id,
        article_id: c.article_id,
        author_name: c.author_name,
        content: c.content,
        created_at: c.created_at
    };
}

// @route   GET /api/comments/manage
// @desc    Every comment, every status, for moderation (admin/superadmin).
//          The public endpoint only returns approved comments, so the queue
//          needs its own source.
router.get('/manage', authMiddleware, requireRole('admin', 'superadmin'), async (req, res) => {
    try {
        // All articles, including drafts — a comment on an unpublished story
        // still needs moderating.
        const articles = await db.getArticles();
        const out = [];

        for (const article of articles) {
            const comments = await db.getCommentsByArticle(article.id);
            comments.forEach(c => {
                out.push({
                    id: c.id,
                    article_id: c.article_id,
                    article_title: article.title,
                    author_name: c.author_name,
                    author_email: c.author_email,
                    content: c.content,
                    status: c.status,
                    created_at: c.created_at
                });
            });
        }

        out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        res.json({ comments: out });
    } catch (error) {
        console.error('Comment manage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   GET /api/comments/article/:articleId
// @desc    Approved comments only — public
router.get('/article/:articleId', async (req, res) => {
    try {
        const all = await db.getCommentsByArticle(req.params.articleId);
        // Only 'approved' comments are visible to the world; pending and spam are not
        const visible = all.filter(c => c.status === 'approved').map(publicComment);
        res.json({ comments: visible });
    } catch (error) {
        console.error('Comment list error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   POST /api/comments
// @desc    Add comment to article (public, moderated)
router.post('/article/:articleId', commentLimiter, [
    body('author_name').trim().notEmpty().isLength({ max: 80 }),
    body('author_email').isEmail().normalizeEmail(),
    body('content').trim().notEmpty().isLength({ max: 2000 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const article = await db.getArticle(req.params.articleId);
        // Only commented on published articles
        if (!article || article.status !== 'published') {
            return res.status(404).json({ error: 'Article not found' });
        }

        const { author_name, author_email, content } = req.body;

        const comment = await db.createComment({
            article_id: Number(req.params.articleId),
            author_name,
            author_email,      // stored (needed to moderate) but never returned publicly
            content,
            status: 'pending'  // always starts unapproved
        });

        res.status(201).json({ message: 'Comment submitted for moderation', id: comment.id });
    } catch (error) {
        console.error('Comment create error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   PUT /api/comments/:id/status
// @desc    Update comment status (admin/superadmin)
router.put('/:id/status', authMiddleware, requireRole('admin', 'superadmin'), [
    body('status').isIn(['approved', 'spam', 'pending']).withMessage('Invalid status')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const comment = await db.updateComment(req.params.id, { status: req.body.status });
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        res.json({ message: 'Comment status updated' });
    } catch (error) {
        console.error('Comment status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   DELETE /api/comments/:id
// @desc    Delete comment (admin/superadmin)
router.delete('/:id', authMiddleware, requireRole('admin', 'superadmin'), async (req, res) => {
    try {
        const comment = await db.getComment(req.params.id);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        await db.deleteComment(req.params.id);
        res.json({ message: 'Comment deleted' });
    } catch (error) {
        console.error('Comment delete error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
