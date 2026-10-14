#!/usr/bin/env node
/**
 * Copy the JSON store into Postgres.
 *
 *   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/migrate-json-to-pg.js
 *
 * Safe to re-run: every table is truncated first. Run it once per fresh
 * database.
 */
const path = require('path');
const fs = require('fs');

(async () => {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is required.');
        process.exit(1);
    }

    const jsonPath = path.join(__dirname, '..', 'db.json');
    if (!fs.existsSync(jsonPath)) {
        console.error('db.json not found — nothing to migrate.');
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const { pool, init } = require('../config/database-pg');

    await init();
    console.log('Schema ready. Copying data…');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Order matters: parents before children
        await client.query('TRUNCATE users, categories, articles, comments, ad_slots, site_settings, events RESTART IDENTITY CASCADE');

        const users = data.users || [];
        for (const u of users) {
            await client.query(
                `INSERT INTO users (id, email, password, name, role, bio, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
                [u.id, u.email, u.password, u.name, u.role, u.bio || '',
                 u.created_at || new Date().toISOString()]
            );
        }
        console.log(`  users: ${users.length}`);

        const categories = data.categories || [];
        for (const c of categories) {
            await client.query(
                'INSERT INTO categories (id, name, slug, description) VALUES ($1, $2, $3, $4)',
                [c.id, c.name, c.slug, c.description || '']
            );
        }
        console.log(`  categories: ${categories.length}`);

        const articles = data.articles || [];
        for (const a of articles) {
            await client.query(`
                INSERT INTO articles (id, title, slug, excerpt, content, featured_image,
                    author_id, category_id, status, views, tags, published_at, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
            `, [
                a.id, a.title, a.slug, a.excerpt || '', a.content, a.featured_image || null,
                a.author_id, a.category_id || null, a.status || 'draft', a.views || 0,
                a.tags || '', a.published_at, a.created_at || new Date().toISOString()
            ]);
        }
        console.log(`  articles: ${articles.length}`);

        const comments = (data.comments || []).filter(c => {
            const articleExists = articles.some(a => a.id === c.article_id);
            if (!articleExists) console.log(`  skipping orphaned comment #${c.id}`);
            return articleExists;
        });
        for (const c of comments) {
            await client.query(`
                INSERT INTO comments (id, article_id, author_name, author_email, content, status, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [c.id, c.article_id, c.author_name, c.author_email, c.content,
                c.status || 'pending', c.created_at]);
        }
        console.log(`  comments: ${comments.length}`);

        // The five advert placements must match the canonical set
        const slots = (data.ad_slots || []).filter(s =>
            ['header', 'rail', 'inline', 'article', 'footer'].includes(s.position));
        for (const s of slots) {
            await client.query(
                `INSERT INTO ad_slots (name, position, label, image_url, link_url, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (position) DO UPDATE SET
                    name = EXCLUDED.name, label = EXCLUDED.label,
                    image_url = EXCLUDED.image_url, link_url = EXCLUDED.link_url,
                    is_active = EXCLUDED.is_active`,
                [s.name, s.position, s.label || '', s.image_url || null,
                 s.link_url || null, !!s.is_active]
            );
        }
        console.log(`  advert slots: ${slots.length}`);

        const settings = data.site_settings || [];
        for (const s of settings) {
            await client.query(
                'INSERT INTO site_settings (key, value) VALUES ($1, $2)',
                [s.key, s.value]
            );
        }
        console.log(`  settings: ${settings.length}`);

        const stats = data.stats || {};
        let eventCount = 0;
        for (const [subject, days] of Object.entries(stats)) {
            for (const [date, b] of Object.entries(days)) {
                await client.query(`
                    INSERT INTO events (subject, bucket_date, impressions, clicks)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (subject, bucket_date) DO UPDATE SET
                        impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks
                `, [subject, date, b.impressions || 0, b.clicks || 0]);
                eventCount++;
            }
        }
        console.log(`  analytics days: ${eventCount}`);

        await client.query('COMMIT');

        // Reset sequences so new rows do not collide with copied ids
        for (const table of ['users', 'categories', 'articles', 'comments', 'site_settings', 'events']) {
            await client.query(
                `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`,
                [table]
            );
        }

        console.log('\nMigration complete.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed, rolled back:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
})();
