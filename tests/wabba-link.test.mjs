import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Exercise actual Bingo sources with separate per-tab sessionStorage and shared
// origin localStorage. These protocol tests need only Node, not the Wabba repo,
// Firebase credentials, a running server, or a browser/layout test runner.
const source = readFileSync(new URL('../wabba.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '');

function storage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function setup(configOverrides = {}, { failMount = false, failSdk = false } = {}) {
  const local = storage();
  const requests = [];
  const flows = new Map();
  let now = 1000;
  let failStart = false;
  let failFinish = false;
  let rejectStart = false;
  const transport = async (url, options) => {
    const body = JSON.parse(options.body);
    const uid = options.headers.Authorization.slice('Bearer token-'.length);
    requests.push({ url, uid, body });
    if (url.endsWith('/start')) {
      if (rejectStart) { rejectStart = false; return { ok: false, status: 409, json: async () => ({ message: 'Start a new connection.' }) }; }
      const key = `${uid}:${body.request_key}`;
      if (!flows.has(key)) flows.set(key, {
        uid, requestKey: body.request_key, state: randomBytes(32).toString('base64url'),
        code: randomBytes(32).toString('base64url'), sessionId: `lks_${flows.size}`, completed: false,
      });
      const row = flows.get(key);
      // The remote operation succeeds even though this response is lost.
      if (failStart) { failStart = false; throw new TypeError('Network unavailable'); }
      return { ok: true, json: async () => ({ state: row.state, hosted_url: `https://wabba.test/account?game=bingo#connect=${row.state}` }) };
    }
    const row = flows.get(`${uid}:${body.request_key}`);
    assert.ok(row, 'callback must identify its initiating request');
    assert.equal(body.state, row.state, 'a newer tab must not replace the callback binding');
    assert.equal(body.code, row.code);
    assert.equal(body.link_session_id, row.sessionId);
    row.completed = true;
    if (failFinish) { failFinish = false; throw new TypeError('Response lost after server completion'); }
    return { ok: true, json: async () => ({ connected: true }) };
  };
  function tab(uid = 'alice', session = storage()) {
    const auth = { currentUser: { uid, getIdToken: async () => `token-${uid}` } };
    let adult;
    let connect;
    let mounts = 0;
    const assets = [];
    const context = {
      wabbaConfig: configOverrides === null ? null : { enabled: true, webOrigin: 'https://wabba.test', adapterOrigin: 'https://adapter.test', ...configOverrides },
      mountWabbaEntry: callback => {
        if (failMount) { failMount = false; throw new Error('Optional UI unavailable'); }
        adult = callback; mounts += 1;
      },
      localStorage: local, sessionStorage: session,
      crypto: { randomUUID }, Date: { now: () => now },
      URL, AbortSignal, fetch: transport,
      window: { WabbaConnect: { mount: options => {
        if (failSdk) { failSdk = false; throw new Error('SDK initialization failed'); }
        connect = options.connect;
      } } },
      document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append: script => { assets.push(script.src); script.onload(); } } },
    };
    runInNewContext(`${source}\nglobalThis.testAPI = { setupWabba, finishWabba };`, context);
    context.testAPI.setupWabba(auth);
    return {
      session, auth, assets,
      mountCount: () => mounts,
      setupAgain: () => context.testAPI.setupWabba(auth),
      async start() { if (!connect) await adult(); return connect({ signal: AbortSignal.timeout(15000) }); },
      finish: callback => context.testAPI.finishWabba(auth, callback),
    };
  }
  function callback(state) {
    const row = [...flows.values()].find(flow => flow.state === state);
    return { state, code: row.code, link_session_id: row.sessionId };
  }
  return {
    local, requests, flows, tab, callback,
    loseStartResponse: () => { failStart = true; },
    loseFinishResponse: () => { failFinish = true; },
    rejectNextStart: () => { rejectStart = true; },
    expire: () => { now += 16 * 60 * 1000; },
  };
}

test('simultaneous tabs bind callbacks independently and clear only their own completed flow', async () => {
  const f = setup();
  const [first, second] = await Promise.all([f.tab().start(), f.tab().start()]);
  assert.notEqual(first.state, second.state);
  assert.equal(f.local.values.size, 2);
  await f.tab().finish(f.callback(first.state));
  assert.equal(f.local.values.size, 1);
  assert.equal([...f.local.values.keys()][0].endsWith(second.state), true);
  await f.tab().finish(f.callback(second.state));
  assert.equal(f.local.values.size, 0);
  assert.equal([...f.flows.values()].every(flow => flow.completed), true);
});

test('a successful start is never reused, and an older callback survives a newer same-tab start', async () => {
  const f = setup();
  const game = f.tab();
  const first = await game.start();
  const second = await game.start();
  assert.notEqual(first.state, second.state);
  assert.equal(game.session.values.size, 0);
  await f.tab().finish(f.callback(second.state));
  await f.tab().finish(f.callback(first.state));
  assert.notEqual(f.requests[0].body.request_key, f.requests[1].body.request_key);
});

test('lost start responses reuse a tab-local key across reload without consuming another tab retry', async () => {
  const f = setup();
  const firstTab = f.tab();
  f.loseStartResponse();
  await assert.rejects(firstTab.start(), /Network unavailable/);
  assert.equal(firstTab.session.values.size, 1);
  const other = await f.tab().start();
  const retried = await f.tab('alice', firstTab.session).start();
  assert.notEqual(other.state, retried.state);
  assert.equal(f.requests[0].body.request_key, f.requests[2].body.request_key);
  assert.equal(f.flows.size, 2);
  assert.equal(firstTab.session.values.size, 0);
  await f.tab().finish(f.callback(retried.state));
  await f.tab().finish(f.callback(other.state));
});

test('a lost finish response retains only non-secret callback correlation for an identical retry', async () => {
  const f = setup();
  const started = await f.tab().start();
  const body = f.callback(started.state);
  const callbackTab = f.tab();
  f.loseFinishResponse();
  await assert.rejects(callbackTab.finish(body), /Response lost/);
  assert.equal(f.local.values.size, 1);
  for (const value of f.local.values.values()) {
    assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ['expiresAt', 'requestKey']);
    assert.doesNotMatch(value, new RegExp(body.code));
    assert.doesNotMatch(value, /verifier|linkToken|token-/);
  }
  await callbackTab.finish(body);
  assert.deepEqual(f.requests[1], f.requests[2]);
  assert.equal(f.local.values.size, 0);
});

test('another Firebase account or unrecognized state cannot borrow a pending callback', async () => {
  const f = setup();
  const started = await f.tab().start();
  const body = f.callback(started.state);
  await assert.rejects(f.tab('bob').finish(body), /Start a new Wabba connection/);
  await assert.rejects(f.tab().finish({ ...body, state: 'x'.repeat(43) }), /Start a new Wabba connection/);
  await assert.rejects(f.tab().finish({ ...body, state: '../invalid' }), /callback is invalid/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.local.values.size, 1);
});

test('definite start rejection permits a fresh next attempt; expired callbacks fail locally', async () => {
  const f = setup();
  const game = f.tab();
  f.rejectNextStart();
  await assert.rejects(game.start(), /Start a new connection/);
  assert.equal(game.session.values.size, 0);
  const started = await game.start();
  assert.notEqual(f.requests[0].body.request_key, f.requests[1].body.request_key);
  f.expire();
  await assert.rejects(f.tab().finish(f.callback(started.state)), /Start a new Wabba connection/);
  assert.equal(f.requests.length, 2);
});

test('disabled, missing or invalid deployment configuration stays inert', () => {
  for (const config of [
    null,
    { enabled: false }, { enabled: undefined }, { enabled: 'true' },
    { webOrigin: null }, { adapterOrigin: null }, { adapterOrigin: undefined },
    { webOrigin: 'http://wabba.test' }, { adapterOrigin: 'http://localhost:8080' },
    { webOrigin: 'https://wabba.test/path' }, { adapterOrigin: 'https://adapter.test/path' },
    { webOrigin: 'https://name@wabba.test' }, { adapterOrigin: 'https://adapter.test#fragment' },
    { webOrigin: 'not a URL' }, { adapterOrigin: 'https://adapter.test?secret=no' },
  ]) {
    const f = setup(config);
    const game = f.tab();
    assert.equal(game.mountCount(), 0, JSON.stringify(config));
    assert.equal(game.setupAgain(), false);
    assert.equal(game.assets.length, 0);
    assert.equal(f.requests.length, 0);
    assert.equal(game.session.values.size, 0);
    assert.equal(f.local.values.size, 0);
  }
});

test('valid opt-in mounts once and loads no remote SDK until the local age gate permits it', async () => {
  const f = setup();
  const game = f.tab();
  assert.equal(game.mountCount(), 1);
  assert.equal(game.setupAgain(), false);
  assert.equal(game.mountCount(), 1);
  assert.equal(game.assets.length, 0);
  assert.equal(f.requests.length, 0);
  await game.start();
  assert.deepEqual(game.assets, ['https://wabba.test/sdk/wabba-connect.v1.js']);
  assert.equal(f.requests.length, 1);
});

test('shipped configuration is disabled and contains no pretend live adapter', () => {
  const configSource = readFileSync(new URL('../wabba-config.js', import.meta.url), 'utf8')
    .replace('export const wabbaConfig', 'globalThis.wabbaConfig');
  const context = {};
  runInNewContext(configSource, context);
  assert.equal(context.wabbaConfig.enabled, false);
  assert.equal(context.wabbaConfig.adapterOrigin, null);
});

test('optional UI failure does not throw into Bingo initialization and can be retried', () => {
  const f = setup({}, { failMount: true });
  const game = f.tab();
  assert.equal(game.mountCount(), 0);
  assert.equal(f.requests.length, 0);
  assert.equal(game.setupAgain(), true);
  assert.equal(game.mountCount(), 1);
  assert.equal(game.setupAgain(), false);
});

test('SDK initialization failure rejects instead of hanging the age gate and permits retry', async () => {
  const f = setup({}, { failSdk: true });
  const game = f.tab();
  await assert.rejects(game.start(), /Wabba could not initialize/);
  assert.equal(f.requests.length, 0);
  await game.start();
  assert.equal(game.assets.length, 2);
  assert.equal(f.requests.length, 1);
});
