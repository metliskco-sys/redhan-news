/**
 * API smoke + regression tests.
 *
 * These exist because a method got deleted mid-refactor and nothing caught it:
 * the comment moderation panel silently broke. Every critical endpoint is
 * asserted here so that class of regression cannot ship silently again.
 *
 * Run: npm test   (starts an isolated server on a random port)
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const PORT = 3791 + (process.pid % 50);
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let token = '';
let readerToken = '';

function waitForServer(timeoutMs = 20000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            http.get(`${BASE}/api/health`, (res) => {
                if (res.statusCode === 200) return resolve();
                retry();
            }).on('error', retry);

            function retry() {
                if (Date.now() - start > timeoutMs) {
                    return reject(new Error('server did not start'));
                }
                setTimeout(tick, 200);
            }
        };
        tick();
    });
}

function request(method, endpoint, body, authToken) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request(
            `${BASE}${endpoint}`,
            {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                    ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
                }
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => (raw += chunk));
                res.on('end', () => {
                    let json = null;
                    try { json = raw ? JSON.parse(raw) : null; } catch (_) { /* 204s etc */ }
                    resolve({ status: res.statusCode, body: json });
                });
            }
        );
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

before(async () => {
    // An isolated database file so the real one is never touched
    fs.copyFileSync(path.join(ROOT, 'db.json'), path.join(ROOT, 'db.test.json'));
    process.env.DB_OVERRIDE = path.join(ROOT, 'db.test.json');

    server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        env: { ...process.env, PORT: String(PORT), DB_OVERRIDE: process.env.DB_OVERRIDE, NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    server.stderr.on('data', (d) => {
        const msg = d.toString();
        if (/Unhandled|TypeError|Cannot find/.test(msg)) {
            process.stderr.write(`[server] ${msg}`);
        }
    });

    await waitForServer();

    const login = await request('POST', '/api/auth/login', {
        email: 'super@redhan.mv', password: 'admin123'
    });
    assert.equal(login.status, 200, 'super admin login must work');
    token = login.body.token;

    const reader = await request('POST', '/api/auth/login', {
        email: 'writer@redhan.mv', password: 'admin123'
    });
    readerToken = reader.body.token;
});

after(() => {
    if (server) server.kill();
    try { fs.unlinkSync(path.join(ROOT, 'db.test.json')); } catch (_) {}
});

describe('public site', () => {
    test('pages return 200', async () => {
        for (const p of ['/', '/gallery', '/about', '/contact', '/privacy', '/article', '/login', '/register']) {
            const r = await request('GET', p);
            assert.equal(r.status, 200, `${p} should be 200`);
        }
    });

    test('unknown routes return 404, not the homepage', async () => {
        const r = await request('GET', '/this-does-not-exist');
        assert.equal(r.status, 404);
    });

    test('articles are served publicly', async () => {
        const r = await request('GET', '/api/articles');
        assert.equal(r.status, 200);
        assert.ok(Array.isArray(r.body.articles));
        assert.ok(r.body.articles.length > 0, 'seeded articles must be visible');
    });

    test('drafts are never public', async () => {
        const created = await request('POST', '/api/articles', {
            title: 'Test Draft Should Stay Hidden',
            excerpt: 'excerpt',
            content: '<p>body</p>',
            status: 'draft'
        }, token);
        assert.equal(created.status, 201);

        const list = await request('GET', '/api/articles');
        assert.ok(
            !list.body.articles.some(a => a.id === created.body.article.id),
            'draft must not appear in the public list'
        );

        await request('DELETE', `/api/articles/${created.body.article.id}`, null, token);
    });

    test('advert slots are public and well-formed', async () => {
        const r = await request('GET', '/api/ads');
        assert.equal(r.status, 200);
        r.body.ads.forEach(ad => {
            assert.ok(ad.image_url, 'every live ad needs an image');
            assert.ok(ad.link_url, 'every live ad needs a destination');
        });
    });

    test('security headers are set', async () => {
        const raw = await new Promise((resolve) => {
            http.get(`${BASE}/`, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => resolve({ headers: res.headers }));
            });
        });
        assert.ok(raw.headers['content-security-policy'], 'CSP must be set');
        assert.ok(raw.headers['x-frame-options'], 'X-Frame-Options must be set');
        assert.ok(raw.headers['x-content-type-options'], 'nosniff must be set');
    });
});

describe('authentication and authorisation', () => {
    test('login rejects a wrong password', async () => {
        const r = await request('POST', '/api/auth/login', {
            email: 'super@redhan.mv', password: 'wrong'
        });
        assert.equal(r.status, 401);
        assert.equal(r.body.error, 'Invalid credentials');
    });

    test('login does not leak the password hash', async () => {
        const r = await request('POST', '/api/auth/login', {
            email: 'super@redhan.mv', password: 'admin123'
        });
        assert.ok(r.body.user);
        assert.equal(r.body.user.password, undefined, 'password must never be returned');
    });

    test('public signup always gets the reader role', async () => {
        const stamp = Date.now();
        const r = await request('POST', '/api/auth/signup', {
            email: `signup-${stamp}@example.com`,
            name: 'Signup Test',
            password: 'password123',
            role: 'superadmin' // must be ignored
        });
        assert.equal(r.status, 201);
        assert.equal(r.body.user.role, 'reader', 'client cannot choose its own role');
    });

    test('password policy is enforced', async () => {
        const r = await request('POST', '/api/auth/signup', {
            email: 'weak@example.com', name: 'Weak', password: 'abc'
        });
        assert.equal(r.status, 400);
    });

    test('protected endpoints reject anonymous callers', async () => {
        for (const [method, endpoint] of [
            ['GET', '/api/auth/users'],
            ['GET', '/api/auth/profile'],
            ['GET', '/api/commercial/slots'],
            ['GET', '/api/commercial/metrics'],
            ['GET', '/api/comments/manage'],
            ['GET', '/api/articles/dashboard/stats'],
            ['GET', '/api/stats/site']
        ]) {
            const r = await request(method, endpoint);
            assert.equal(r.status, 401, `${endpoint} must require auth`);
        }

        // the old ad-blocker-blocked paths are gone entirely, not merely guarded
        for (const endpoint of ['/api/ads/manage', '/api/ads/metrics']) {
            assert.equal((await request('GET', endpoint)).status, 404, `${endpoint} should no longer exist`);
        }
    });

    test('a writer cannot moderate or manage users', async () => {
        assert.equal((await request('GET', '/api/comments/manage', null, readerToken)).status, 403);
        assert.equal((await request('GET', '/api/auth/users', null, readerToken)).status, 403);
        assert.equal((await request('GET', '/api/commercial/slots', null, readerToken)).status, 403);
    });

    test('JWT forgery is rejected', async () => {
        const r = await request('GET', '/api/auth/profile', null, 'forged.token.here');
        assert.equal(r.status, 401);
    });
});

describe('article lifecycle', () => {
    let articleId;

    test('a superadmin can create an article', async () => {
        const r = await request('POST', '/api/articles', {
            title: 'Test Article Lifecycle',
            excerpt: 'excerpt',
            content: '<p>body</p>',
            status: 'published'
        }, token);
        assert.equal(r.status, 201);
        articleId = r.body.article.id;
    });

    test('a writer cannot edit someone else\'s article', async () => {
        const r = await request('PUT', `/api/articles/${articleId}`, { title: 'Hijacked' }, readerToken);
        assert.equal(r.status, 403);
    });

    test('the owner can edit it', async () => {
        const r = await request('PUT', `/api/articles/${articleId}`, { title: 'Test Article Lifecycle Edited' }, token);
        assert.equal(r.status, 200);
        assert.equal(r.body.article.title, 'Test Article Lifecycle Edited');
    });

    test('a draft can be reopened for editing', async () => {
        await request('PUT', `/api/articles/${articleId}`, { status: 'draft' }, token);
        const r = await request('GET', `/api/articles/manage/${articleId}`, null, token);
        assert.equal(r.status, 200, 'drafts must be loadable by the editor');
    });

    test('hashtags persist and strip markup', async () => {
        await request('PUT', `/api/articles/${articleId}`, {
            tags: 'Maldives, <script>alert(1)</script>Tourism'
        }, token);
        const r = await request('GET', `/api/articles/manage/${articleId}`, null, token);
        assert.ok(r.body.article.tags.includes('Maldives'));
        assert.ok(!r.body.article.tags.includes('<script'), 'markup must be stripped from tags');
    });

    test('author HTML is sanitised on write', async () => {
        await request('PUT', `/api/articles/${articleId}`, {
            content: '<p onclick="steal()">ok</p><script>alert(1)</script>'
        }, token);
        const r = await request('GET', `/api/articles/manage/${articleId}`, null, token);
        assert.ok(!r.body.article.content.includes('<script'));
        assert.ok(!r.body.article.content.includes('onclick'));
        assert.ok(r.body.article.content.includes('<p>ok</p>'));
    });

    test('deleting works', async () => {
        const r = await request('DELETE', `/api/articles/${articleId}`, null, token);
        assert.equal(r.status, 200);
        const after = await request('GET', '/api/articles?search=Lifecycle');
        assert.ok(!after.body.articles.some(a => a.id === articleId));
    });
});

describe('comment moderation', () => {
    let commentId;

    test('a reader can submit a comment', async () => {
        const articles = await request('GET', '/api/articles');
        const article = articles.body.articles[0];
        const r = await request('POST', `/api/comments/article/${article.id}`, {
            author_name: 'Test Reader',
            author_email: 'reader@example.com',
            content: 'A genuine comment body.'
        });
        assert.equal(r.status, 201);
        commentId = r.body.id;
    });

    test('a pending comment is hidden from the public', async () => {
        const articles = await request('GET', '/api/articles');
        const article = articles.body.articles[0];
        const r = await request('GET', `/api/comments/article/${article.id}`);
        assert.ok(!r.body.comments.some(c => c.id === commentId), 'unmoderated comments must not be public');
    });

    test('the moderation queue shows every status', async () => {
        const r = await request('GET', '/api/comments/manage', null, token);
        assert.equal(r.status, 200);
        assert.ok(
            r.body.comments.some(c => c.id === commentId && c.author_name === 'Test Reader'),
            'the moderation endpoint must return submitted comments'
        );
    });

    test('approving publishes it and does not leak the email', async () => {
        const articles = await request('GET', '/api/articles');
        const article = articles.body.articles[0];

        await request('PUT', `/api/comments/${commentId}/status`, { status: 'approved' }, token);
        const pub = await request('GET', `/api/comments/article/${article.id}`);
        const shown = pub.body.comments.find(c => c.id === commentId);
        assert.ok(shown, 'approved comment must be public');
        assert.equal(shown.author_email, undefined, 'email must never be exposed');

        // and it can still be reversed
        await request('PUT', `/api/comments/${commentId}/status`, { status: 'pending' }, token);
        const hiddenAgain = await request('GET', `/api/comments/article/${article.id}`);
        assert.ok(!hiddenAgain.body.comments.some(c => c.id === commentId), 'un-approving must hide it again');
    });

    test('an approved comment can still be deleted', async () => {
        await request('PUT', `/api/comments/${commentId}/status`, { status: 'approved' }, token);
        const r = await request('DELETE', `/api/comments/${commentId}`, null, token);
        assert.equal(r.status, 200);
    });
});

describe('advert management', () => {
    test('slots load for the desk on the new blocker-safe path', async () => {
        const r = await request('GET', '/api/commercial/slots', null, token);
        assert.equal(r.status, 200);
        assert.ok(r.body.ads.length >= 5, 'all five placements must be returned');
    });

    test('metrics load with a series', async () => {
        const r = await request('GET', '/api/commercial/metrics', null, token);
        assert.equal(r.status, 200);
        assert.ok(r.body.placements, 'metrics must include placements');
        assert.ok(r.body.totals, 'metrics must include totals');
    });

    test('impressions and clicks are counted', async () => {
        await request('POST', '/api/ads/rail/event', { type: 'impression' });
        await request('POST', '/api/ads/rail/event', { type: 'click' });
        const r = await request('GET', '/api/commercial/metrics', null, token);
        const rail = r.body.placements.rail;
        assert.ok(rail.impressions >= 1, 'impression must be recorded');
        assert.ok(rail.clicks >= 1, 'click must be recorded');
    });

    test('a scheme-less link is corrected', async () => {
        const r = await request('PUT', '/api/commercial/slots/footer', {
            image_url: null, link_url: 'bbc.com', is_active: false
        }, token);
        assert.equal(r.body.ad.link_url, 'https://bbc.com');
    });

    test('the desk endpoints contain no "ads" path segment', async () => {
        // regression guard: these used to live under /api/ads/* and were
        // blocked by ad-blocking extensions, breaking the desk.
        for (const p of ['/api/ads/manage', '/api/ads/metrics']) {
            assert.equal((await request('GET', p, null, token)).status, 404);
        }
    });
});

describe('sections', () => {
    test('a new section is listable and usable', async () => {
        const stamp = Date.now();
        const created = await request('POST', '/api/categories', {
            name: 'Test Section', slug: `test-section-${stamp}`
        }, token);
        assert.equal(created.status, 201);

        const list = await request('GET', '/api/categories');
        assert.ok(list.body.categories.some(c => c.id === created.body.category.id));
        assert.equal((await request('GET', `/api/articles?category=test-section-${stamp}`)).status, 200);

        await request('DELETE', `/api/categories/${created.body.category.id}`, null, token);
    });
});

describe('embedding', () => {
    test('video URLs resolve to a player iframe', async () => {
        const r = await request('GET', '/api/embed/resolve?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ');
        assert.equal(r.status, 200);
        assert.equal(r.body.provider, 'youtube');
        assert.ok(r.body.html.includes('iframe'));
    });

    test('unsupported and unsafe URLs are rejected', async () => {
        assert.equal((await request('GET', '/api/embed/resolve?url=https://example.com')).status, 422);
        assert.equal((await request('GET', '/api/embed/resolve?url=javascript:alert(1)')).status, 400);
    });
});

describe('site analytics', () => {
    test('page views and story metrics are tracked', async () => {
        await request('POST', '/api/pages/event', { path: '/' });
        await request('GET', '/api/articles'); // touch something
        const r = await request('GET', '/api/stats/site', null, token);
        assert.equal(r.status, 200);
        assert.ok(r.body.pages, 'must include page stats');
        assert.ok(Array.isArray(r.body.articles), 'must include article funnel');
    });

    test('non-reader pages are not counted', async () => {
        await request('POST', '/api/pages/event', { path: '/desk' });
        const r = await request('GET', '/api/stats/site', null, token);
        assert.ok(!r.body.pages.top.some(p => p.path === '/desk'), 'staff pages are not reader traffic');
    });
});
