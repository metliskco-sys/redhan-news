// Load .env first so JWT_SECRET is stable across restarts
require('./config/env')();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const security = require('./config/security');
const db = require('./config/db');
const authRoutes = require('./routes/auth');
const articleRoutes = require('./routes/articles');
const categoryRoutes = require('./routes/categories');
const commentRoutes = require('./routes/comments');
const adRoutes = require('./routes/ads');
const statsRoutes = require('./routes/stats');
const pagesRoutes = require('./routes/pages');
const embedRoutes = require('./routes/embed');
const commercialRoutes = require('./routes/commercial');
const settingsRoutes = require('./routes/settings');
const uploadRoutes = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the proxy chain if deployed behind one, so rate limiting sees real IPs
app.set('trust proxy', 1);

// Security headers + hardened CORS
app.use(security.securityHeaders);
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || true,  // same-origin by default
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body limits — prevents oversized-payload DoS
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Never let the browser serve a stale build while the site is being iterated
// on: HTML, CSS and JS must always be revalidated.
app.use((req, res, next) => {
    if (/\.(html?|css|js)(\?.*)?$/.test(req.path)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    fallthrough: true,
    setHeaders: (res) => {
        // Never let an uploaded file be interpreted as anything but a file
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=86400');
    }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/pages', pagesRoutes);
app.use('/api/embed', embedRoutes);
app.use('/api/commercial', commercialRoutes);

// Broad API rate limit (per IP)
app.use('/api/', security.rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: 'Too many requests. Try again shortly.'
}));

// Liveness probe. Must answer immediately and must NOT touch the database:
// hosts use this path to decide whether a deploy succeeded, so an unreachable
// third-party service here hangs the whole deploy.
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        storage: process.env.DATABASE_URL ? 'postgres' : 'json-file',
        timestamp: new Date().toISOString()
    });
});

// Readiness probe. Reports whether storage actually answers. Never used by the
// host for deploy decisions, so it is safe to wait on the network here.
app.get('/api/health/db', async (req, res) => {
    try {
        // getStats exists on both backends and touches real storage
        await db.getStats();
        res.json({ status: 'ok', database: 'reachable' });
    } catch (error) {
        // Only the driver code is exposed, never the connection string
        res.status(503).json({
            status: 'degraded',
            database: 'unreachable',
            databaseError: {
                code: error.code || null,
                message: error.message || String(error)
            }
        });
    }
});

// Page helper: res.sendFile() resets Cache-Control, so read + send instead
function sendPage(res, file) {
    const full = path.join(__dirname, 'public', file);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.type('html').send(fs.readFileSync(full));
}

// Serve frontend for all non-API routes
app.get('/', (req, res) => {
    sendPage(res, 'index.html');
});

app.get('/login', (req, res) => {
    sendPage(res, 'login.html');
});

app.get('/register', (req, res) => {
    sendPage(res, 'register.html');
});

app.get('/article', (req, res) => {
    sendPage(res, 'article.html');
});

// Staff desk entry point (client decides whether to open the panel or bounce to login)
app.get('/desk', (req, res) => {
    sendPage(res, 'index.html');
});

app.get('/forgot-password', (req, res) => {
    sendPage(res, 'forgot-password.html');
});

app.get('/reset-password', (req, res) => {
    sendPage(res, 'reset-password.html');
});

// Static content pages
const CONTENT_PAGES = [
    'about', 'contact', 'advertise', 'careers',
    'privacy', 'terms', 'cookies', 'gallery'
];
CONTENT_PAGES.forEach((name) => {
    app.get(`/${name}`, (req, res) => {
        sendPage(res, `${name}.html`);
    });
});

// Unknown routes get a real 404 instead of silently serving the homepage
app.use((req, res) => {
    res.status(404);
    sendPage(res, '404.html');
});

// Central error handler — never leak stack traces or internals
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err && err.message ? err.message : err);
    if (res.headersSent) return;
    res.status(err && err.status ? err.status : 500).json({
        error: 'Something went wrong. Please try again.'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Redhan News Server running on http://localhost:${PORT}`);
    console.log(`📰 Frontend: http://localhost:${PORT}`);
    console.log(`🔌 API: http://localhost:${PORT}/api`);
    console.log(`\nDefault accounts:`);
    console.log(`  Super Admin: super@redhan.mv / admin123`);
    console.log(`  Admin: admin@redhan.mv / admin123`);
    console.log(`  Writer: writer@redhan.mv / admin123`);
});

module.exports = app;
