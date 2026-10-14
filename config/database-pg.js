/**
 * PostgreSQL storage layer.
 *
 * Replaces the JSON file, which had two real problems: it was rewritten whole
 * on every write (so concurrent writes clobbered each other), and it lived on
 * disk, so any restart lost everything.
 *
 * Every method here mirrors config/database.js but is async, because there is
 * no synchronous Postgres client in Node. Callers await it.
 */
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    max: 10
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'writer'
        CHECK (role IN ('superadmin', 'admin', 'writer', 'reader')),
    bio TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS articles (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    excerpt TEXT DEFAULT '',
    content TEXT NOT NULL,
    featured_image TEXT,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),
    views INTEGER NOT NULL DEFAULT 0,
    tags TEXT DEFAULT '',
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'spam')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_slots (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    position TEXT UNIQUE NOT NULL,
    label TEXT DEFAULT '',
    image_url TEXT,
    link_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_settings (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    subject TEXT NOT NULL,
    bucket_date DATE NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    UNIQUE (subject, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);
CREATE INDEX IF NOT EXISTS idx_comments_article ON comments(article_id);
CREATE INDEX IF NOT EXISTS idx_events_subject ON events(subject, bucket_date);
`;

const CANONICAL_AD_SLOTS = [
    ['Header banner', 'header', 'Wide banner below the navigation'],
    ['Reading rail', 'rail', 'Sidebar slot on the home page and articles'],
    ['In-feed', 'inline', 'Between the story grid on the home page'],
    ['In article', 'article', 'Inside every story, below the body'],
    ['Footer banner', 'footer', 'Wide banner above the footer, site-wide']
];

const NO_HASH = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';

async function init() {
    await pool.query(SCHEMA);
    // The five advert placements are structural, not user-created rows.
    for (const [name, position, label] of CANONICAL_AD_SLOTS) {
        await pool.query(
            `INSERT INTO ad_slots (name, position, label) VALUES ($1, $2, $3)
             ON CONFLICT (position) DO NOTHING`,
            [name, position, label]
        );
    }
}

/** Number of days of event history to keep. */
const EVENT_RETENTION_DAYS = 90;

const pg = {
    pool,

    // ---------------- users ----------------
    async getUser(email) {
        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        return rows[0] || null;
    },

    async getUserById(id) {
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [Number(id)]);
        return rows[0] || null;
    },

    async getAllUsers() {
        const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
        return rows;
    },

    async createUser({ email, password, name, role = 'writer', bio = '' }) {
        const { rows } = await pool.query(
            `INSERT INTO users (email, password, name, role, bio)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [email, password, name, role, bio]
        );
        return rows[0];
    },

    async updateUser(id, updates) {
        const allowed = ['name', 'bio', 'role'];
        const fields = Object.keys(updates).filter(k => allowed.includes(k));
        if (fields.length === 0) return this.getUserById(id);

        const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
        const values = fields.map(f => updates[f]);
        values.push(Number(id));

        const { rows } = await pool.query(
            `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async deleteUser(id) {
        await pool.query('DELETE FROM users WHERE id = $1', [Number(id)]);
    },

    // ---------------- categories ----------------
    async getCategories() {
        const { rows } = await pool.query('SELECT * FROM categories ORDER BY id');
        return rows;
    },

    async getCategory(id) {
        const { rows } = await pool.query('SELECT * FROM categories WHERE id = $1', [Number(id)]);
        return rows[0] || null;
    },

    async getCategoryBySlug(slug) {
        const { rows } = await pool.query('SELECT * FROM categories WHERE slug = $1', [slug]);
        return rows[0] || null;
    },

    async createCategory({ name, slug, description = '' }) {
        const { rows } = await pool.query(
            'INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3) RETURNING *',
            [name, slug, description]
        );
        return rows[0];
    },

    async updateCategory(id, updates) {
        const { rows } = await pool.query(
            'UPDATE categories SET name = $1, slug = $2, description = $3 WHERE id = $4 RETURNING *',
            [updates.name, updates.slug, updates.description, Number(id)]
        );
        return rows[0] || null;
    },

    async deleteCategory(id) {
        await pool.query('DELETE FROM categories WHERE id = $1', [Number(id)]);
    },

    // ---------------- articles ----------------
    async getArticles(filters = {}) {
        const where = [];
        const values = [];

        if (filters.status) {
            where.push('a.status = $' + (values.length + 1));
            values.push(filters.status);
        }
        if (filters.category_id) {
            where.push('a.category_id = $' + (values.length + 1));
            values.push(Number(filters.category_id));
        }
        if (filters.author_id) {
            where.push('a.author_id = $' + (values.length + 1));
            values.push(Number(filters.author_id));
        }
        if (filters.search) {
            where.push('(a.title ILIKE $' + (values.length + 1) + ' OR a.excerpt ILIKE $' + (values.length + 2) + ')');
            values.push(`%${filters.search}%`, `%${filters.search}%`);
        }

        const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT a.*, u.name AS author_name, c.name AS category_name, c.slug AS category_slug
            FROM articles a
            JOIN users u ON a.author_id = u.id
            LEFT JOIN categories c ON a.category_id = c.id
            ${clause}
            ORDER BY COALESCE(a.published_at, a.created_at) DESC
        `, values);
        return rows;
    },

    async getArticle(id) {
        const { rows } = await pool.query('SELECT * FROM articles WHERE id = $1', [Number(id)]);
        return rows[0] || null;
    },

    async getArticleBySlug(slug) {
        const { rows } = await pool.query('SELECT * FROM articles WHERE slug = $1', [slug]);
        return rows[0] || null;
    },

    async createArticle(article) {
        const { rows } = await pool.query(`
            INSERT INTO articles
                (title, slug, excerpt, content, featured_image, author_id, category_id, status, tags)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            article.title,
            article.slug,
            article.excerpt || '',
            article.content,
            article.featured_image || null,
            Number(article.author_id),
            article.category_id ? Number(article.category_id) : null,
            article.status || 'draft',
            article.tags || ''
        ]);
        return rows[0];
    },

    async updateArticle(id, updates) {
        const allowed = ['title', 'slug', 'excerpt', 'content', 'featured_image',
            'category_id', 'status', 'tags', 'views'];
        const fields = Object.keys(updates).filter(k => allowed.includes(k));
        if (fields.length === 0) return this.getArticle(id);

        const params = fields.map(f => updates[f]);
        params.push(Number(id));
        const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

        const { rows } = await pool.query(
            `UPDATE articles SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
            params
        );
        return rows[0] || null;
    },

    async deleteArticle(id) {
        // Cascades to comments via the foreign key
        await pool.query('DELETE FROM articles WHERE id = $1', [Number(id)]);
    },

    // ---------------- comments ----------------
    async getComment(id) {
        const { rows } = await pool.query('SELECT * FROM comments WHERE id = $1', [Number(id)]);
        return rows[0] || null;
    },

    async getCommentsByArticle(articleId) {
        const { rows } = await pool.query(
            'SELECT * FROM comments WHERE article_id = $1 ORDER BY created_at DESC',
            [Number(articleId)]
        );
        return rows;
    },

    async createComment({ article_id, author_name, author_email, content, status = 'pending' }) {
        const { rows } = await pool.query(`
            INSERT INTO comments (article_id, author_name, author_email, content, status)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
        `, [Number(article_id), author_name, author_email, content, status]);
        return rows[0];
    },

    async updateComment(id, updates) {
        const allowed = ['status'];
        const fields = Object.keys(updates).filter(k => allowed.includes(k));
        if (fields.length === 0) return this.getComment(id);

        const params = fields.map(f => updates[f]);
        params.push(Number(id));
        const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

        const { rows } = await pool.query(
            `UPDATE comments SET ${setClause} WHERE id = $1 RETURNING *`,
            params
        );
        return rows[0] || null;
    },

    async deleteComment(id) {
        await pool.query('DELETE FROM comments WHERE id = $1', [Number(id)]);
    },

    // ---------------- adverts ----------------
    async getAds() {
        const { rows } = await pool.query('SELECT * FROM ad_slots ORDER BY id');
        return rows;
    },

    async getAd(id) {
        const { rows } = await pool.query('SELECT * FROM ad_slots WHERE id = $1', [Number(id)]);
        return rows[0] || null;
    },

    async getAdByPosition(position) {
        const { rows } = await pool.query('SELECT * FROM ad_slots WHERE position = $1', [position]);
        return rows[0] || null;
    },

    async upsertAd(position, updates) {
        const current = await this.getAdByPosition(position);
        if (!current) return null;
        const merged = { ...current, ...updates };

        const { rows } = await pool.query(`
            UPDATE ad_slots SET name = $1, label = $2, image_url = $3, link_url = $4, is_active = $5
            WHERE position = $6 RETURNING *
        `, [
            merged.name ?? null,
            merged.label ?? '',
            merged.image_url ?? null,
            merged.link_url ?? null,
            !!merged.is_active,
            position
        ]);
        return rows[0];
    },

    // ---------------- settings ----------------
    async getSettings() {
        const { rows } = await pool.query('SELECT key, value FROM site_settings');
        const out = {};
        rows.forEach(r => { out[r.key] = r.value; });
        return out;
    },

    async updateSetting(key, value) {
        await pool.query(`
            INSERT INTO site_settings (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        `, [key, value]);
    },

    // ---------------- events / analytics ----------------
    async recordEvent(subject, type) {
        await pool.query(`
            INSERT INTO events (subject, bucket_date, impressions, clicks)
            VALUES ($1, CURRENT_DATE,
                    $2::int, $3::int)
            ON CONFLICT (subject, bucket_date) DO UPDATE SET
                impressions = events.impressions + EXCLUDED.impressions,
                clicks = events.clicks + EXCLUDED.clicks
        `, [subject, type === 'click' ? 0 : 1, type === 'click' ? 1 : 0]);
    },

    async getEventSeries(subject, days = 14) {
        await pool.query(
            'DELETE FROM events WHERE bucket_date < CURRENT_DATE - $1::int',
            [EVENT_RETENTION_DAYS]
        );

        const { rows } = await pool.query(`
            WITH days AS (
                SELECT generate_series(
                    CURRENT_DATE - ($1::int - 1),
                    CURRENT_DATE,
                    '1 day'::interval
                )::date AS d
            )
            SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
                   COALESCE(e.impressions, 0)::int AS impressions,
                   COALESCE(e.clicks, 0)::int AS clicks
            FROM days
            LEFT JOIN events e ON e.subject = $2 AND e.bucket_date = days.d
            ORDER BY days.d
        `, [days, subject]);
        return rows;
    },

    async getEventTotals(prefix, days = 14) {
        const { rows } = await pool.query(`
            SELECT COALESCE(SUM(impressions), 0)::int AS impressions,
                   COALESCE(SUM(clicks), 0)::int AS clicks
            FROM events
            WHERE subject LIKE $1 AND bucket_date >= CURRENT_DATE - ($2::int - 1)
        `, [prefix + '%', days]);
        return rows[0];
    },

    async getSiteStats(days = 14) {
        const [{ rows: pageRows }, { rows: articleRows }] = await Promise.all([
            pool.query(`
                SELECT subject, bucket_date, impressions, clicks
                FROM events WHERE subject LIKE 'page:%'
            `),
            pool.query(`
                SELECT id, title, slug, status, views FROM articles ORDER BY id
            `)
        ]);

        const pages = { views: 0, clicks: 0, series: [], top: [] };
        const pageTotals = {};
        pageRows.forEach(r => {
            pages.views += r.impressions;
            pages.clicks += r.clicks;
            const p = r.subject.slice(5);
            pageTotals[p] = (pageTotals[p] || 0) + r.impressions;
        });
        pages.top = Object.entries(pageTotals)
            .map(([path, views]) => ({ path, views }))
            .sort((a, b) => b.views - a.views)
            .slice(0, 8);

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - (days - 1));
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        const seriesMap = {};
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            seriesMap[d.toISOString().slice(0, 10)] = { date: d.toISOString().slice(0, 10), views: 0, clicks: 0 };
        }
        pageRows.forEach(r => {
            const key = r.bucket_date.toISOString ? r.bucket_date.toISOString().slice(0, 10) : String(r.bucket_date).slice(0, 10);
            if (seriesMap[key]) {
                seriesMap[key].views += r.impressions;
                seriesMap[key].clicks += r.clicks;
            }
        });
        pages.series = Object.values(seriesMap);

        const articles = articleRows.map(a => ({ ...a, impressions: 0, clicks: 0, ctr: 0 }));

        return { pages, articles };
    },

    getStats() {
        // Placeholder; the dashboard uses getSiteStats for the funnel and
        // separate count queries where needed.
        return Promise.all([
            pool.query('SELECT COUNT(*)::int AS c FROM articles'),
            pool.query("SELECT COUNT(*)::int AS c FROM articles WHERE status = 'published'"),
            pool.query("SELECT COUNT(*)::int AS c FROM articles WHERE status = 'draft'"),
            pool.query('SELECT COUNT(*)::int AS c FROM users'),
            pool.query('SELECT COUNT(*)::int AS c FROM comments')
        ]).then(results => ({
            totalArticles: results[0].rows[0].c,
            publishedArticles: results[1].rows[0].c,
            draftArticles: results[2].rows[0].c,
            totalUsers: results[3].rows[0].c,
            totalComments: results[4].rows[0].c
        }));
    }
};

module.exports = { pool, pg, init, NO_HASH };
