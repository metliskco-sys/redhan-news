/**
 * The site must degrade clearly when api.js fails to load.
 *
 * A real user hit a 502 on api.js and got "ReferenceError: api is not defined"
 * plus a stack of failed requests. The app caught it, but reported a generic
 * error. These tests pin the intended behaviour: name the actual cause.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');

function makeContext() {
    const els = {};
    const mk = () => ({
        innerHTML: '', value: '', textContent: '', style: { setProperty() {} },
        dataset: {},
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); },
            remove(c) { this._s.delete(c); },
            toggle() {},
            contains() { return false; }
        },
        addEventListener() {}, focus() {}, appendChild() {}, remove() {},
        scrollIntoView() {}, setAttribute() {}, getAttribute() { return null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        click() {}, tagName: 'DIV'
    });

    const sandbox = {
        console: { error() {}, log() {}, warn() {} },
        setTimeout: (cb) => { if (cb) cb(); return 0; },
        setInterval: () => 0,
        setImmediate: (cb) => cb(),
        requestAnimationFrame: () => 0,
        performance: { now: () => 0 },
        localStorage: {
            _d: {},
            getItem(k) { return this._d[k] == null ? null : this._d[k]; },
            setItem(k, v) { this._d[k] = v; },
            removeItem(k) { delete this._d[k]; }
        },
        document: {
            getElementById: (id) => els[id] || (els[id] = mk()),
            createElement: () => mk(),
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener() {},
            body: { appendChild() {}, style: {} },
            documentElement: { scrollHeight: 3000 }
        },
        window: {
            location: { search: '' },
            addEventListener() {},
            matchMedia: () => ({ matches: false }),
            history: { pushState() {} },
            innerWidth: 1400,
            innerHeight: 900,
            pageYOffset: 0
        },
        FormData: class { append() {} }
    };
    sandbox.window.document = sandbox.document;

    return { sandbox, els };
}

test('loads and constructs without api.js present', () => {
    const { sandbox } = makeContext();
    // `api` is intentionally undefined in this sandbox
    vm.createContext(sandbox);
    vm.runInContext(js, sandbox);

    assert.ok(sandbox.app, 'app must still be created');
    assert.equal(sandbox.app.apiMissing(), true);
});

test('reports the real cause rather than a generic failure', () => {
    const { sandbox } = makeContext();
    vm.createContext(sandbox);
    vm.runInContext(js, sandbox);

    const message = sandbox.app.apiUnavailableMessage();
    assert.match(message, /JavaScript API client did not/i);
    assert.match(message, /reload/i, 'it should tell the user what to do');
});

test('a missing api client never crashes the app', async () => {
    const { sandbox, els } = makeContext();
    vm.createContext(sandbox);
    vm.runInContext(js, sandbox);

    await sandbox.app.loadInitialData();
    const html = els.cardGrid.innerHTML;
    assert.match(html, /site backend did not load/i);
    assert.match(html, /reload/i, 'a retry affordance must be offered');
});
