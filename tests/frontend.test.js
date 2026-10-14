/**
 * Static analysis of the frontend.
 *
 * The comment moderation panel broke because loadComments() called a method
 * that had been deleted during a refactor. Nothing caught it. These tests
 * parse the frontend and assert every referenced method actually exists, so
 * that whole class of regression becomes a build failure.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'public', 'js');

function read(file) {
    return fs.readFileSync(path.join(JS_DIR, file), 'utf8');
}

/**
 * Strip whole-line comments only. Inline stripping would corrupt lines that
 * legitimately contain "//" inside strings, such as URLs.
 */
function code(file) {
    return read(file)
        .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')   // whole-line block comments
        .replace(/^\s*\/\/.*$/gm, '');                    // whole-line line comments
}

/** Every method defined directly on the RedhanApp class. */
function appMethods(source) {
    const methods = new Set();
    const re = /^\s{4}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm;
    let m;
    while ((m = re.exec(source))) methods.add(m[1]);
    return methods;
}

/** `this.foo(` calls that are not also locals/params. */
function thisCalls(source) {
    const calls = new Set();
    const re = /this\.([a-zA-Z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(source))) calls.add(m[1]);
    return calls;
}

const APP = code('app.js');

test('every method called with this. is defined on the class', () => {
    const defined = appMethods(APP);
    const called = thisCalls(APP);

    // Locals and constructor parameters to ignore
    const ignore = new Set(['constructor']);
    const missing = [...called].filter(name => !defined.has(name) && !ignore.has(name));

    assert.deepEqual(missing, [], `undefined methods referenced via this.: ${missing.join(', ')}`);
});

test('every onclick="app.foo(" in generated markup points at a real method', () => {
    const defined = appMethods(APP);
    const called = new Set();
    // Handlers built inside template strings in app.js and article.js
    for (const file of ['app.js', 'article.js']) {
        const src = code(file);
        const re = /onclick="app\.([a-zA-Z_$][\w$]*)\s*\(/g;
        let m;
        while ((m = re.exec(src))) called.add(m[1]);
    }

    const missing = [...called].filter(name => !defined.has(name));
    assert.deepEqual(missing, [], `missing app methods used by inline handlers: ${missing.join(', ')}`);
});

test('every getElementById target exists somewhere in the served HTML', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const ids = new Set();
    const re = /getElementById\('([^']+)'\)/g;
    let m;
    while ((m = re.exec(APP))) ids.add(m[1]);

    // ids that are generated at runtime by an article/details template
    const RUNTIME = new Set([
        'commentList', 'commentCount', 'commentForm', 'commentName',
        'commentEmail', 'commentBody', 'comments', 'relatedList'
    ]);

    const missing = [...ids].filter(id => !html.includes(`id="${id}"`) && !RUNTIME.has(id));
    assert.deepEqual(missing, [], `ids referenced in app.js but absent from index.html: ${missing.join(', ')}`);
});

test('every api method the frontend calls exists on the client', () => {
    const api = code('api.js');
    const defined = new Set();
    const re = /^\s{4}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm;
    let m;
    while ((m = re.exec(api))) defined.add(m[1]);

    const used = new Set();
    const reUse = /api\.([a-zA-Z_$][\w$]*)\s*\(/g;
    while ((m = reUse.exec(APP))) used.add(m[1]);

    const missing = [...used].filter(name => !defined.has(name));
    assert.deepEqual(missing, [], `api methods called but not defined: ${missing.join(', ')}`);
});

test('the password reset client methods exist', () => {
    const api = code('api.js');
    ['forgotPassword', 'resetPassword', 'getManagedAds', 'getManagedComments',
        'getAdStats', 'recordPageView', 'recordArticleEvent', 'uploadImage']
        .forEach(name => assert.match(api, new RegExp(`async ${name}\\s*\\(`), `api.${name} must exist`));
});

test('no advert staff endpoint lives under an "ads" path', () => {
    // Regression guard: ad blockers broke the desk when these were under
    // /api/ads/*. Only the two public reader endpoints may use that prefix.
    const api = code('api.js');
    const paths = (api.match(/this\.request\('(\/[^']+)'/g) || [])
        .map(s => s.match(/'([^']+)'/)[1]);

    const PUBLIC_ADS = ['/ads', '/ads/'];           // reader banner fetch
    const EVENT_RE = /^\/ads\/[^/]+\/event$/;     // impression/click beacons

    const offenders = paths.filter(p =>
        p.startsWith('/ads') &&
        !PUBLIC_ADS.includes(p) &&
        !EVENT_RE.test(p)
    );

    assert.deepEqual(offenders, [], `staff endpoints still under /ads/: ${offenders.join(', ')}`);
});

test('every page loads the core scripts', () => {
    const pages = fs.readdirSync(path.join(ROOT, 'public'))
        .filter(f => f.endsWith('.html'));

    for (const page of pages) {
        const html = fs.readFileSync(path.join(ROOT, 'public', page), 'utf8');
        assert.ok(html.includes('/js/ambient.js'), `${page} must load ambient.js`);

        // Pages with no navigation, advert slots or sections
        const SKIP = ['404.html', 'login.html', 'register.html',
            'forgot-password.html', 'reset-password.html'];
        if (SKIP.includes(page)) continue;

        assert.ok(html.includes('/js/ads.js'), `${page} must load ads.js`);
        assert.ok(html.includes('/js/sections.js'), `${page} must load sections.js`);
    }
});

test('syntax check every frontend file', () => {
    const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const source = read(file);
        // A parse is enough; new Function throws on invalid syntax.
        assert.doesNotThrow(() => new Function(source), `${file} has a syntax error`);
    }
});
