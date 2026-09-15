import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Controller doubles, not a substitute for rendered browser/accessibility QA.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.removed = false;
    this.open = false;
  }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.removed = true; }
  async click() {
    if (!this.disabled) await this.listeners.get('click')?.();
  }
}

function accountEntry(loadLauncher, { staticMarkup = false, onResultRetry } = {}) {
  const initialEntry = staticMarkup ? new Element('a') : null;
  const initialShell = staticMarkup ? new Element('aside') : null;
  const stylesheet = staticMarkup ? new Element('link') : null;
  if (staticMarkup) {
    initialEntry.id = 'wabba-local-entry';
    initialShell.id = 'wabba-entry-shell';
    stylesheet.id = 'wabba-entry-styles';
    initialShell.append(initialEntry);
  }
  const find = (element, id) => element.id === id ? element
    : element.children.map(child => find(child, id)).find(Boolean);
  const created = [];
  const document = {
    head: new Element('head'), body: new Element('body'),
    createElement: tag => { const element = new Element(tag); created.push(element); return element; },
    getElementById: id => find(document.head, id) || find(document.body, id),
  };
  if (staticMarkup) { document.head.append(stylesheet); document.body.append(initialShell); }
  const source = readFileSync(new URL('../wabba-entry-view.js', import.meta.url), 'utf8')
    .replace('export function mountWabbaEntry', 'function mountWabbaEntry')
    .replaceAll('import.meta.url', JSON.stringify('https://bingo.example/Bingo-Game/wabba-entry-view.js'));
  const accountURL = 'https://wabba.example/account?game=bingo';
  const context = vm.createContext({ document, URL,
    setTimeout: () => assert.fail('The persistent fallback needs no reminder timers.'),
    clearTimeout: () => assert.fail('The persistent fallback needs no reminder timers.'),
  });
  vm.runInContext(`${source}\nglobalThis.mount = mountWabbaEntry;`, context);
  const controller = context.mount(loadLauncher, accountURL, { onResultRetry });
  const entry = document.getElementById('wabba-local-entry');
  const shell = document.getElementById('wabba-entry-shell');
  return { document, entry, shell, created, accountURL, controller,
    close: document.getElementById('wabba-entry-close'),
    mountAgain: () => context.mount(loadLauncher, accountURL),
  };
}

function sdkDouble() {
  const calls = [];
  return { calls, setContext: value => calls.push(['context', { ...value }]),
    destroy: () => calls.push(['destroy']) };
}

test('the native account link is usable immediately without an age dialog or click interception', () => {
  let calls = 0;
  const ui = accountEntry(() => { calls++; return new Promise(() => {}); });
  assert.equal(calls, 1, 'the local SDK starts loading without an age selection or click');
  assert.equal(ui.document.head.children[0].href, 'https://bingo.example/Bingo-Game/wabba-entry.css?v=widget-20260915-4');
  assert.equal(ui.entry.children[0].src, 'https://bingo.example/Bingo-Game/wabba-logo.png');
  assert.equal(ui.shell.tag, 'aside');
  assert.equal(ui.entry.tag, 'a');
  assert.equal(ui.entry.href, ui.accountURL);
  assert.equal(ui.entry.target, '_blank');
  assert.equal(ui.entry.rel, 'noopener noreferrer');
  assert.match(ui.entry.attributes.get('aria-label'), /Opens in a new tab/);
  assert.equal(ui.entry.listeners.size, 0, 'native navigation is never intercepted');
  assert.equal(ui.shell.removed, false, 'a pending SDK load must not remove the usable fallback');
  assert.equal(ui.entry.children[1].children[0].textContent, 'Connect to Wabba');
  assert.equal(ui.entry.children[1].children[1].textContent, 'Win games. Get gift cards.');
  assert.equal(ui.entry.children[1].children.length, 2);
  assert.equal(ui.entry.children[2].attributes.get('aria-hidden'), 'true');
  assert.equal(ui.created.some(element => ['dialog', 'select'].includes(element.tag)), false);
  assert.equal(ui.created.filter(element => element.tag === 'button').length, 1);
  assert.equal(ui.created.find(element => element.tag === 'button').hidden, true);
  assert.equal(ui.close, undefined);
  assert.equal(ui.controller.dismiss, undefined);
  assert.equal(ui.entry.children[0].width, 40);
  assert.equal(ui.entry.children[0].height, 40);
  const assets = ui.created.flatMap(element => element.tag === 'link' ? [element.href]
    : element.tag === 'img' ? [element.src] : []);
  assert.equal(assets.length, 2);
  assert.ok(assets.every(url => new URL(url).origin === 'https://bingo.example'));
});

test('adopts the initial native anchor and stylesheet once while loading in the background', () => {
  let attempts = 0;
  const ui = accountEntry(() => { attempts++; return new Promise(() => {}); }, { staticMarkup: true });
  assert.equal(ui.document.body.children[0], ui.shell);
  assert.equal(ui.shell.children[0], ui.entry);
  assert.equal(ui.document.head.children.length, 1);
  assert.equal(ui.entry.href, ui.accountURL);
  assert.equal(ui.entry.target, '_blank');
  assert.equal(ui.entry.rel, 'noopener noreferrer');
  assert.equal(ui.entry.dataset.wabbaReady, 'true');
  assert.equal(ui.entry.listeners.size, 0);
  ui.mountAgain();
  assert.equal(ui.document.body.children.length, 1);
  assert.equal(ui.created.length, 2, 'adoption adds only hidden result and retry controls, once');
  assert.equal(attempts, 1);
  assert.equal(ui.shell.removed, false);
});

test('synchronous and asynchronous SDK failures keep a usable account link without retry loops', async () => {
  for (const staticMarkup of [false, true]) {
    for (const fail of [() => { throw new Error('SDK failed'); }, () => Promise.reject(new Error('offline'))]) {
      let attempts = 0;
      const ui = accountEntry(() => { attempts++; return fail(); }, { staticMarkup });
      await flush();
      assert.equal(ui.shell.removed, false);
      assert.equal(ui.entry.removed, false);
      assert.equal(ui.entry.href, ui.accountURL);
      assert.equal(ui.entry.listeners.size, 0);
      assert.equal(ui.entry.disabled, false);
      await ui.entry.click();
      ui.mountAgain();
      assert.equal(attempts, 1, 'the persistent fallback must not retry or intercept clicks');
      assert.equal(ui.document.body.children.length, 1);
    }
  }
});

test('only successful shared-SDK completion removes the fallback card', async () => {
  for (const staticMarkup of [false, true]) {
    let complete;
    const ui = accountEntry(() => new Promise(resolve => { complete = resolve; }), { staticMarkup });
    await flush();
    assert.equal(ui.shell.removed, false);
    assert.equal(ui.entry.href, ui.accountURL);
    complete(sdkDouble());
    await flush();
    assert.equal(ui.shell.removed, true);
  }
});

test('fallback styling preserves a visible keyboard focus and mobile-safe native link', () => {
  const css = readFileSync(new URL('../wabba-entry.css', import.meta.url), 'utf8');
  assert.match(css, /\.wabba-local-entry \{[^}]*text-decoration: none/);
  assert.match(css, /\.wabba-local-entry:focus-visible \{[^}]*outline: 3px/);
  assert.match(css, /width: min\(280px,/);
  assert.match(css, /min-height: 72px/);
  assert.match(css, /gap: 10px/);
  assert.match(css, /border-radius: 14px/);
  assert.match(css, /\.wabba-entry-arrow \{[^}]*flex: 0 0 30px; height: 30px/);
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /env\(safe-area-inset-right\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(css, /wabba-entry-close|age-dialog|details-marker|wabba-entry-fallback/);
});

test('the fallback stays visible through game, connection and readiness changes without snooze controls', async () => {
  for (const staticMarkup of [false, true]) {
    const ui = accountEntry(() => Promise.reject(new Error('offline')), { staticMarkup });
    await flush();
    for (const update of [
      { playing: true }, { connected: true }, { ready: false },
      { playing: false, connected: false, ready: true },
    ]) {
      ui.controller.setContext(update);
      assert.equal(ui.shell.hidden, false);
      assert.equal(ui.shell.removed, false);
      assert.equal(ui.entry.href, ui.accountURL);
    }
    assert.equal(ui.close, undefined);
    assert.equal(ui.controller.dismiss, undefined);
    assert.equal(ui.entry.listeners.size, 0);
  }
  const source = readFileSync(new URL('../wabba-entry-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /dismiss|setTimeout|clearTimeout|Date\.now/);
});

test('result status is accessible, retryable and survives the SDK handoff without a close button', async () => {
  let complete;
  let retries = 0;
  const states = [];
  const sdk = { ...sdkDouble(), setResultState: value => states.push({ ...value }) };
  const ui = accountEntry(() => new Promise(resolve => { complete = resolve; }), { onResultRetry: () => { retries++; } });
  const message = ui.created.find(node => node.className === 'wabba-entry-result');
  const retry = ui.created.find(node => node.className === 'wabba-entry-retry');
  assert.equal(message.attributes.get('role'), 'status');
  assert.equal(message.attributes.get('aria-live'), 'polite');
  assert.equal(message.attributes.get('aria-atomic'), 'true');
  ui.controller.setResultState({ status: 'pending', message: 'Saving the match.' });
  assert.equal(message.hidden, false);
  assert.equal(message.textContent, 'Saving the match.');
  assert.equal(retry.hidden, false);
  await retry.click();
  assert.equal(retries, 1);
  complete(sdk);
  await flush();
  assert.deepEqual(states, [{ status: 'pending', message: 'Saving the match.' }]);
  ui.controller.setResultState({ status: 'win', message: 'Win recorded.' });
  assert.equal(states.at(-1).status, 'win');
  assert.equal(ui.close, undefined);
});

test('SDK handoff preserves context and never requires a dismissal API', async () => {
  let complete;
  const sdk = sdkDouble();
  const ui = accountEntry(() => new Promise(resolve => { complete = resolve; }));
  ui.controller.setContext({ playing: true, connected: true, ready: false });
  complete(sdk);
  await flush();
  assert.deepEqual(sdk.calls, [['context', { playing: true, connected: true, ready: false }]]);
  assert.equal(ui.shell.removed, true);
  ui.controller.setContext({ playing: false, ready: true });
  assert.deepEqual(sdk.calls.at(-1), ['context', { playing: false, connected: true, ready: true }]);
});

test('failed SDK context handoff destroys the replacement and preserves the visible native link', async () => {
  let complete;
  let destroyed = false;
  const ui = accountEntry(() => new Promise(resolve => { complete = resolve; }));
  complete({ setContext() { throw new Error('handoff failed'); }, destroy() { destroyed = true; } });
  await flush();
  assert.equal(destroyed, true);
  assert.equal(ui.shell.removed, false);
  assert.equal(ui.shell.hidden, false);
  assert.equal(ui.entry.href, ui.accountURL);
});

test('destroyed fallback destroys a late SDK without restoring UI', async () => {
  let complete;
  const sdk = sdkDouble();
  const ui = accountEntry(() => new Promise(resolve => { complete = resolve; }));
  ui.controller.destroy();
  complete(sdk);
  await flush();
  assert.equal(ui.shell.removed, true);
  assert.deepEqual(sdk.calls, [['destroy']]);
});

test('game views update SDK context from navigation without polling or changing visible UI', () => {
  const source = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  const beginning = source.indexOf('export function showView(');
  const ending = source.indexOf('export function switchTab(', beginning);
  const updates = [];
  const classList = { add() {}, remove() {}, toggle() {} };
  const state = { gameId: null, gameMode: 'social' };
  const context = vm.createContext({
    state,
    updateWabbaContext: value => updates.push({ ...value }),
    document: { getElementById: () => ({ classList }) },
    ui: { backToHomeBtn: { classList }, pageTitle: {}, loadingSpinner: { classList } },
  });
  vm.runInContext(source.slice(beginning, ending).replace('export function', 'function'), context);
  for (const view of ['board', 'link', 'draft', 'lobby']) {
    context.showView(view);
    assert.equal(updates.at(-1).playing, true, view);
  }
  for (const view of ['home', 'mode', 'join', 'create', 'loading']) {
    context.showView(view);
    assert.equal(updates.at(-1).playing, false, view);
  }
  state.gameId = 'ongoing-game';
  context.showView('loading');
  assert.equal(updates.at(-1).playing, true);
  state.gameId = null;
  context.showView('home');
  assert.equal(updates.at(-1).playing, false);
});

const flush = () => new Promise(resolve => setImmediate(resolve));

function callbackPage(finish) {
  const status = new Element('p');
  const retry = new Element('button');
  retry.hidden = true;
  const events = [];
  const calls = [];
  const auth = { currentUser: { uid: 'test-player' } };
  let observer;
  const source = readFileSync(new URL('../wabba-callback.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  const context = vm.createContext({
    URLSearchParams, Error,
    location: { pathname: '/Bingo-Game/wabba-callback.html', search: '?state=test-state&code=test-one-time-code&link_session_id=test-session' },
    history: { replaceState: (_state, _title, path) => events.push(['clear-url', path]) },
    document: { getElementById: id => ({ status, retry })[id] },
    initializeFirebase: () => events.push(['firebase']),
    auth,
    onAuthStateChanged: (received, handler) => {
      assert.equal(received, auth);
      observer = handler;
    },
    finishWabba: (received, callback) => {
      assert.equal(received, auth);
      const data = JSON.parse(JSON.stringify(callback));
      calls.push(data);
      return finish(data);
    },
  });
  vm.runInContext(source, context);
  return { status, retry, calls, events, notifyAuth: () => observer() };
}

test('callback clears its URL first and confirms once despite repeated auth notifications', async () => {
  let complete;
  const page = callbackPage(() => new Promise(resolve => { complete = resolve; }));
  assert.deepEqual(page.events, [['clear-url', '/Bingo-Game/wabba-callback.html'], ['firebase']]);
  assert.equal(page.calls.length, 0);
  page.notifyAuth();
  page.notifyAuth();
  assert.deepEqual(page.calls, [{ state: 'test-state', code: 'test-one-time-code', link_session_id: 'test-session' }]);
  assert.equal(page.retry.hidden, true);
  assert.match(page.status.textContent, /confirming/i);
  complete({ connected: true });
  await flush();
  assert.match(page.status.textContent, /connected to Wabba/);
  assert.match(page.status.textContent, /eligibility is checked separately/);
  page.notifyAuth();
  await flush();
  assert.equal(page.calls.length, 1);
});

test('callback failure exposes a retry using the same in-memory one-time code', async () => {
  let attempts = 0;
  const page = callbackPage(async () => {
    if (++attempts === 1) throw new Error('Connection interrupted. Please try again.');
    return { connected: true };
  });
  page.notifyAuth();
  await flush();
  assert.equal(page.retry.hidden, false);
  assert.match(page.status.textContent, /interrupted/);
  await page.retry.click();
  assert.equal(page.calls.length, 2);
  assert.deepEqual(page.calls[1], page.calls[0]);
  assert.equal(page.retry.hidden, true);
  assert.match(page.status.textContent, /connected to Wabba/);
});
