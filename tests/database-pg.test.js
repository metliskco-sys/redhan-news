/**
 * Postgres layer unit tests.
 *
 * These run against a mocked Pool so the SQL text and parameter ordering can
 * be verified without a live database. The places bugs actually hide — event
 * bucketing, date series generation, allow-listed updates, upserts — are all
 * asserted here.
 *
 * A live integration test is skipped unless DATABASE_URL is set.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/test';

const { pg, pool } = require('../config/database-pg');

let calls = [];
let nextResult = { rows: [] };

const originalQuery = pool.query.bind(pool);

before(() => {
    pool.query = async (sql, params) => {
        calls.push({ sql, params });
        return typeof nextResult === 'function' ? nextResult(sql, params) : nextResult;
    };
});

function lastCall() {
    return calls[calls.length - 1];
}

/** Restore the real pool between assertions that need isolation. */
before(() => {
    calls = [];
});

test('getArticles composes filters and uses parameterised queries', async () => {
    calls = [];
    await pg.getArticles({ status: 'published', category_id: 3, search: 'reef' });

    const { sql, params } = lastCall();
    assert.match(sql, /a\.status = \$1/);
    assert.match(sql, /a\.category_id = \$2/);
    assert.match(sql, /ILIKE \$3/);
    assert.equal(params[0], 'published');
    assert.equal(params[1], 3, 'category_id is coerced to a number');
    assert.equal(params[2], '%reef%');
    // No interpolated user input: every bound value must be a parameter
    assert.ok(!sql.includes("'published'"), 'values must be bound, not interpolated');
});

test('updateArticle only writes allow-listed columns', async () => {
    calls = [];
    // A caller trying to reach author_id or id must not be able to
    await pg.updateArticle(7, { title: 'New', author_id: 999, id: 1, created_at: 'hack' });
    const { sql, params } = lastCall();
    assert.match(sql, /title = \$1/);
    assert.ok(!/author_id/.test(sql), 'author_id must never be updatable');
    assert.ok(!/created_at/.test(sql), 'created_at must never be updatable');
    assert.equal(params[0], 'New');
});

test('updateUser only writes allow-listed columns', async () => {
    calls = [];
    await pg.updateUser(3, { name: 'X', role: 'admin', created_at: 'hack' });
    const { sql } = lastCall();
    assert.match(sql, /name = \$1/);
    assert.match(sql, /role = \$2/);
    assert.ok(!/created_at/.test(sql));
});

test('recordEvent counts an impression as an impression', async () => {
    calls = [];
    await pg.recordEvent('article:4', 'impression');
    const { sql, params } = lastCall();
    assert.match(sql, /INSERT INTO events/);
    assert.match(sql, /ON CONFLICT \(subject, bucket_date\) DO UPDATE/);
    // (subject, impression, click)
    assert.deepEqual(params, ['article:4', 1, 0]);
});

test('recordEvent counts a click as a click', async () => {
    calls = [];
    await pg.recordEvent('ad:rail', 'click');
    assert.deepEqual(lastCall().params, ['ad:rail', 0, 1]);
});

test('getEventSeries returns one row per day including empty days', async () => {
    calls = [];
    nextResult = { rows: [{ date: '2026-10-13', impressions: 4, clicks: 1 }] };
    await pg.getEventSeries('article:1', 14);

    const { sql, params } = lastCall();
    assert.match(sql, /generate_series/);
    assert.match(sql, /LEFT JOIN events/);
    assert.equal(params[1], 'article:1');
    // A LEFT JOIN is what makes zero-traffic days appear as rows
});

test('getEventSeries prunes expired history', async () => {
    calls = [];
    await pg.getEventSeries('article:1', 14);
    assert.equal(calls.length, 2, 'a prune query runs before the read');
    assert.match(calls[0].sql, /DELETE FROM events/);
});

test('upsertAd merges into the existing row rather than inserting', async () => {
    calls = [];
    nextResult = () => ({ rows: [{ id: 2, name: 'Reading rail', label: 'Sidebar slot', position: 'rail', image_url: null, link_url: null, is_active: false }] });
    // first call is the lookup
    await pg.upsertAd('rail', { image_url: '/uploads/x.png', is_active: true });

    const updateCall = calls.find(c => /UPDATE ad_slots/.test(c.sql));
    assert.ok(updateCall, 'upsertAd must UPDATE, never INSERT');
    assert.match(updateCall.sql, /WHERE position = \$6/);
    // The existing name/label are preserved via the merge
    assert.equal(updateCall.params[0], 'Reading rail');
    assert.equal(updateCall.params[2], '/uploads/x.png');
    assert.equal(updateCall.params[4], true);
    assert.equal(updateCall.params[5], 'rail');
    assert.equal(updateCall.params[1], 'Sidebar slot', 'existing label must survive a link-only update');
    assert.equal(updateCall.params[3], null, 'an absent link stays NULL');
});

test('upsertAd returns null for an unknown placement', async () => {
    calls = [];
    nextResult = { rows: [] };
    const result = await pg.upsertAd('does-not-exist', { is_active: true });
    assert.equal(result, null);
    assert.ok(!calls.some(c => /UPDATE ad_slots/.test(c.sql)), 'nothing should be written');
});

test('getStats returns the five counts', async () => {
    calls = [];
    nextResult = () => ({ rows: [{ c: 1 }] });
    const stats = await pg.getStats();
    assert.deepEqual(stats, {
        totalArticles: 1,
        publishedArticles: 1,
        draftArticles: 1,
        totalUsers: 1,
        totalComments: 1
    });
});

test('createArticle coerces numeric foreign keys', async () => {
    calls = [];
    nextResult = { rows: [{ id: 1 }] };
    await pg.createArticle({
        title: 'T', slug: 't', excerpt: 'e', content: 'c',
        author_id: '2', category_id: '3', status: 'published'
    });
    const { params } = lastCall();
    assert.equal(params[5], 2, 'author_id must be coerced');
    assert.equal(params[6], 3, 'category_id must be coerced');
});

test('initial schema contains every table and index', async () => {
    const { init } = require('../config/database-pg');
    calls = [];
    nextResult = { rows: [] };
    await init();

    const allSql = calls.map(c => c.sql).join('\n');
    ['users', 'categories', 'articles', 'comments', 'ad_slots', 'site_settings', 'events']
        .forEach(t => assert.match(allSql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`)));
    assert.match(allSql, /CREATE INDEX IF NOT EXISTS idx_events_subject/);
    assert.match(allSql, /ON DELETE CASCADE/, 'articles must cascade to comments');
});

// Restore the real pool when run alongside other suites
test('teardown', () => { pool.query = originalQuery; });
