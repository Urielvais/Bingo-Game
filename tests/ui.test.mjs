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

function ageGate(onAdult) {
  const document = {
    head: new Element('head'), body: new Element('body'),
    createElement: tag => new Element(tag),
  };
  const source = readFileSync(new URL('../wabba-age-gate.js', import.meta.url), 'utf8')
    .replace('export function mountWabbaEntry', 'function mountWabbaEntry')
    .replaceAll('import.meta.url', JSON.stringify('https://bingo.example/Bingo-Game/wabba-age-gate.js'));
  const context = vm.createContext({ document, URL });
  vm.runInContext(`${source}\nglobalThis.mount = mountWabbaEntry;`, context);
  context.mount(onAdult);
  const [entry, dialog] = document.body.children;
  const [heading, label, status, next, cancel] = dialog.children;
  return { document, entry, dialog, heading, label, status, next, cancel, select: label.children[0] };
}

test('age gate uses local assets, a neutral selection, and labelled native controls', () => {
  let calls = 0;
  const ui = ageGate(() => { calls++; });
  assert.equal(calls, 0);
  assert.equal(ui.document.head.children[0].href, 'https://bingo.example/Bingo-Game/wabba-entry.css');
  assert.equal(ui.entry.children[0].src, 'https://bingo.example/Bingo-Game/wabba-logo.png');
  assert.equal(ui.entry.tag, 'button');
  assert.equal(ui.dialog.tag, 'dialog');
  assert.equal(ui.dialog.attributes.get('aria-labelledby'), ui.heading.id);
  assert.equal(ui.label.tag, 'label');
  assert.equal(ui.select.tag, 'select');
  assert.equal(ui.select.value, '');
  assert.deepEqual(ui.select.children.map(option => option.value), ['', 'under13', 'teen', 'adult']);
  assert.equal(ui.status.attributes.get('role'), 'status');
});

test('empty, underage, and cancel selections never load Wabba', async () => {
  let calls = 0;
  const ui = ageGate(() => { calls++; });
  await ui.entry.click();
  assert.equal(ui.dialog.open, true);
  await ui.next.click();
  assert.match(ui.status.textContent, /select an age group/i);
  for (const value of ['under13', 'teen']) {
    ui.select.value = value;
    await ui.next.click();
    assert.match(ui.status.textContent, /adults only/i);
    assert.equal(ui.dialog.open, true);
  }
  await ui.cancel.click();
  assert.equal(ui.dialog.open, false);
  assert.equal(calls, 0);
});

test('a failed SDK load remains recoverable; success removes the local gate', async () => {
  let attempts = 0;
  let complete;
  const ui = ageGate(() => {
    attempts++;
    if (attempts === 1) return Promise.reject(new Error('offline'));
    return new Promise(resolve => { complete = resolve; });
  });
  await ui.entry.click();
  ui.select.value = 'adult';
  await ui.next.click();
  assert.equal(attempts, 1);
  assert.equal(ui.next.disabled, false);
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.entry.removed, false);
  assert.match(ui.status.textContent, /try again/i);
  const pending = ui.next.click();
  assert.equal(ui.next.disabled, true);
  await ui.next.click();
  assert.equal(attempts, 2);
  complete();
  await pending;
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.dialog.removed, true);
  assert.equal(ui.entry.removed, true);
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
