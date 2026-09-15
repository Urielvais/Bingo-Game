import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { Script } from 'node:vm';
import { WabbaResultClient } from '../wabba-sdk/sdk/wabba-results.v1.mjs';

// Exercise actual Bingo sources with separate per-tab sessionStorage and shared
// origin localStorage. These protocol tests need only Node, not the Wabba repo,
// Firebase credentials, a running server, or a browser/layout test runner.
const source = readFileSync(new URL('../wabba.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify('https://bingo.example/Bingo-Game/wabba.js'))
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

function setup(configOverrides = {}, { failMount = false, failSdk = false, stallSdk = false, authDelayed = false, missingSdkHost = false, stallCss = false, missingCss = false } = {}) {
  const local = storage();
  const storageListeners = [];
  const setLocal = local.setItem;
  local.setItem = (key, value) => {
    setLocal(key, value);
    for (const listener of storageListeners) listener({ key });
  };
  const requests = [];
  const tokenRequests = [];
  const flows = new Map();
  let now = 1000;
  let failStart = false;
  let failFinish = false;
  let rejectStart = false;
  let confirmFinish = true;
  const transport = async (url, options) => {
    if (options.method === 'GET') {
      const uid = options.headers.Authorization.slice('Bearer token-'.length);
      requests.push({ url, uid, body: options.body });
      assert.equal(options.body, undefined);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.equal(url, 'https://adapter.test/wabba/matches/match-42/result');
      return { ok: true, status: 200, json: async () => ({
        gameId: 'gam_bingo', externalMatchId: 'match-42', gameUserId: uid, wabbaPlayerId: `plr_${uid}`,
        connected: true, email: `${uid}@example.test`, emailVerified: true,
        status: 'recorded', evidence: 'game_record', outcome: uid === 'alice' ? 'win' : 'loss',
        won: uid === 'alice', winnerId: 'alice', participantIds: ['alice', 'bob'], completedAt: '2026-09-14T12:00:00Z',
      }) };
    }
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit', 'game cookies must never accompany adapter calls');
    assert.equal(options.redirect, 'error', 'a redirect must not forward Firebase authentication');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.match(options.headers.Authorization, /^Bearer token-[a-z]+$/);
    assert.ok(options.signal instanceof AbortSignal, 'every request must have cancellation/timeout');
    assert.equal(options.signal.aborted, false);
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
    return { ok: true, json: async () => ({ connected: confirmFinish }) };
  };
  function tab(uid = 'alice', session = storage()) {
    const auth = { currentUser: { uid, getIdToken: async () => { tokenRequests.push(uid); return `token-${uid}`; } } };
    let enhance;
    let accountURL;
    let connect;
    let mounts = 0;
    let sdkMounts = 0;
    let dismissible;
    const sdkContexts = [];
    const entryContexts = [];
    const resultStates = [];
    const sdkEvents = [];
    let destroys = 0;
    let timerId = 0;
    const assets = [];
    const scripts = [];
    const timers = new Map();
    const stylesheet = { sheet: stallCss ? null : {} };
    const styles = new Map();
    const host = {
      removed: false,
      remove() { this.removed = true; },
      style: {
        setProperty: (name, value, priority) => styles.set(name, { value, priority }),
        removeProperty: name => styles.delete(name),
      },
      shadowRoot: { querySelector: selector => {
        assert.equal(selector, 'link[rel="stylesheet"]');
        return missingCss ? null : stylesheet;
      } },
    };
    const context = {
      WabbaResultClient: class extends WabbaResultClient {
        constructor(options) { super({ ...options, fetch: transport }); }
      },
      wabbaConfig: configOverrides === null ? null : { enabled: true, webOrigin: 'https://wabba.test', adapterOrigin: 'https://adapter.test', ...configOverrides },
      mountWabbaEntry: (callback, destination) => {
        if (failMount) { failMount = false; throw new Error('Optional UI unavailable'); }
        enhance = callback; accountURL = destination; mounts += 1;
        return { setContext: value => entryContexts.push({ ...value }), setResultState: value => resultStates.push(value) };
      },
      localStorage: local, sessionStorage: session,
      crypto: { randomUUID }, Date: { now: () => now },
      URL, AbortSignal, fetch: transport,
      setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
      clearTimeout: id => timers.delete(id),
      window: { addEventListener: (name, listener) => {
        assert.equal(name, 'storage'); storageListeners.push(listener);
      }, WabbaConnect: { mount: options => {
        sdkEvents.push('mount');
        if (failSdk) { failSdk = false; throw new Error('SDK initialization failed'); }
        host.removed = false;
        sdkMounts += 1;
        connect = options.connect;
        dismissible = options.dismissible;
      }, setContext: value => { sdkEvents.push('context'); sdkContexts.push({ ...value }); },
      destroy: () => { destroys++; host.remove(); } } },
      document: {
        getElementById: id => id === 'wabba-connect-launcher' && sdkMounts > 0 && !missingSdkHost ? host : null,
        createElement: () => ({ dataset: {}, removed: false, remove() { this.removed = true; } }),
        head: { append: script => { assets.push(script.src); scripts.push(script); if (!stallSdk) script.onload(); } },
      },
    };
    runInNewContext(`${source}\nglobalThis.testAPI = { setupWabba, finishWabba, updateWabbaContext, checkWabbaResult, prepareWabbaMatch };`, context);
    context.testAPI.setupWabba(authDelayed ? undefined : auth);
    return {
      session, auth, assets, scripts, timers, stylesheet, styles, host, sdkContexts, entryContexts, sdkEvents, resultStates,
      checkResult: id => context.testAPI.checkWabbaResult(id),
      prepareResult: () => context.testAPI.prepareWabbaMatch(),
      destroyCount: () => destroys,
      updateContext: value => context.testAPI.updateWabbaContext(value),
      mountCount: () => mounts,
      sdkMountCount: () => sdkMounts,
      isDismissible: () => dismissible,
      destination: () => accountURL,
      hasConnectionHandler: () => typeof connect === 'function',
      loadSdk: () => enhance(),
      setupAgain: options => context.testAPI.setupWabba(auth, options),
      async start() { if (!connect) await enhance(); return connect({ signal: AbortSignal.timeout(15000) }); },
      finish: callback => context.testAPI.finishWabba(auth, callback),
    };
  }
  function callback(state) {
    const row = [...flows.values()].find(flow => flow.state === state);
    return { state, code: row.code, link_session_id: row.sessionId };
  }
  return {
    local, requests, tokenRequests, flows, tab, callback,
    pendingCount: () => [...local.values.keys()].filter(key => key.startsWith('wabba:bingo:callback:')).length,
    unconfirmFinish: () => { confirmFinish = false; },
    loseStartResponse: () => { failStart = true; },
    loseFinishResponse: () => { failFinish = true; },
    rejectNextStart: () => { rejectStart = true; },
    allowSdkLoad: () => { stallSdk = false; },
    expire: () => { now += 16 * 60 * 1000; },
  };
}

test('result checks wait for connection, read with the signed-in token and clear for the next match', async () => {
  const f = setup();
  const game = f.tab();
  await game.checkResult('match-42');
  assert.equal(f.requests.length, 0);
  assert.equal(f.tokenRequests.length, 0);
  assert.equal(game.resultStates.at(-1).status, 'not_connected');
  game.prepareResult();
  assert.equal(game.resultStates.at(-1).status, 'idle', 'a new game also clears the pre-connection message');
  await game.checkResult('match-42');
  const started = await game.start();
  await game.finish(f.callback(started.state));
  const result = await game.checkResult('match-42');
  assert.equal(result.status, 'win');
  assert.equal(result.result.gameUserId, 'alice');
  assert.equal(result.result.wabbaPlayerId, 'plr_alice');
  assert.equal(result.result.email, 'alice@example.test');
  assert.equal(f.requests.filter(request => request.body === undefined).length, 1, 'automatic and repeated checks share one request');
  game.prepareResult();
  assert.equal(game.resultStates.at(-1).status, 'idle');
  assert.equal(game.resultStates.at(-1).result, undefined);
  game.auth.currentUser = null;
  game.setupAgain();
  await game.checkResult('match-42');
  assert.equal(f.requests.filter(request => request.body === undefined).length, 1, 'signed-out accounts never send result requests');
});

test('missing result backend does not invent wins or block the connection card', async () => {
  const f = setup({ adapterOrigin: null });
  f.local.setItem('wabba:bingo:connected:alice', 'true');
  const game = f.tab();
  await game.checkResult('match-42');
  assert.equal(f.requests.length, 0);
  assert.equal(game.mountCount(), 1);
  assert.notEqual(game.resultStates.at(-1).status, 'win');
  assert.equal(game.resultStates.at(-1).status, 'unavailable');
});

test('simultaneous tabs bind callbacks independently and clear only their own completed flow', async () => {
  const f = setup();
  const [first, second] = await Promise.all([f.tab().start(), f.tab().start()]);
  assert.notEqual(first.state, second.state);
  assert.equal(f.pendingCount(), 2);
  await f.tab().finish(f.callback(first.state));
  assert.equal(f.pendingCount(), 1);
  assert.equal([...f.local.values.keys()][0].endsWith(second.state), true);
  await f.tab().finish(f.callback(second.state));
  assert.equal(f.pendingCount(), 0);
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
  assert.equal(f.pendingCount(), 1);
  for (const value of f.local.values.values()) {
    assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ['expiresAt', 'requestKey']);
    assert.doesNotMatch(value, new RegExp(body.code));
    assert.doesNotMatch(value, /verifier|linkToken|token-/);
  }
  await callbackTab.finish(body);
  assert.deepEqual(f.requests[1], f.requests[2]);
  assert.equal(f.pendingCount(), 0);
});

test('another Firebase account or unrecognized state cannot borrow a pending callback', async () => {
  const f = setup();
  const started = await f.tab().start();
  const body = f.callback(started.state);
  await assert.rejects(f.tab('bob').finish(body), /Start a new Wabba connection/);
  await assert.rejects(f.tab().finish({ ...body, state: 'x'.repeat(43) }), /Start a new Wabba connection/);
  await assert.rejects(f.tab().finish({ ...body, state: '../invalid' }), /callback is invalid/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.pendingCount(), 1);
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

test('explicit opt-out or invalid Wabba account origin stays inert', () => {
  for (const config of [
    null,
    { enabled: false }, { enabled: undefined }, { enabled: 'true' },
    { webOrigin: null }, { webOrigin: 'http://wabba.test' },
    { webOrigin: 'https://wabba.test/path' }, { webOrigin: 'https://name@wabba.test' },
    { webOrigin: 'not a URL' },
  ]) {
    const f = setup(config);
    const game = f.tab();
    assert.equal(game.mountCount(), 0, JSON.stringify(config));
    assert.equal(game.setupAgain(), false);
    assert.equal(game.assets.length, 0);
    assert.equal(f.requests.length, 0);
    assert.equal(game.session.values.size, 0);
    assert.equal(f.pendingCount(), 0);
  }
});

test('the widget mounts before Firebase is ready and accepts authentication later without remounting', async () => {
  const f = setup({}, { authDelayed: true });
  const game = f.tab();
  assert.equal(game.mountCount(), 1);
  await game.loadSdk();
  assert.equal(game.sdkMountCount(), 1);
  await assert.rejects(game.start(), /Sign in to Bingo/);
  assert.equal(f.tokenRequests.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(game.setupAgain(), false);
  const started = await game.start();
  assert.ok(started.state);
  assert.equal(game.mountCount(), 1);
  assert.equal(game.sdkMountCount(), 1);
});

test('Bingo boots the local widget separately from its Firebase module graph', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../wabba-entry.js', import.meta.url), 'utf8');
  assert.match(html, /<script type="module" src="wabba-entry\.js\?v=widget-20260915-4" async><\/script>/);
  assert.match(entry, /import \{ setupWabba \} from '\.\/wabba\.js\?v=widget-20260915-4'/);
  assert.match(entry, /setupWabba\(\)/);
  assert.doesNotMatch(entry, /firebase\.js|gstatic|fetch\(/);
  assert.doesNotMatch(html, /wabba-connect-header/);
});

test('the complete styled card exists in initial HTML even with every script removed', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  assert.match(html, /<link id="wabba-entry-styles" rel="stylesheet" href="\.\/wabba-entry\.css\?v=widget-20260915-4">/);
  const card = html.match(/<aside id="wabba-entry-shell"[\s\S]*?<\/aside>/)?.[0];
  assert.ok(card);
  assert.match(card, /<a id="wabba-local-entry" class="wabba-local-entry"/);
  assert.match(card, /Connect to Wabba/);
  assert.match(card, /Win games\. Get gift cards\./);
  assert.doesNotMatch(card, /Offers coming soon/);
  assert.match(card, /wabba-logo\.png/);
  assert.match(card, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(card, /<script|<dialog/);
  assert.doesNotMatch(card, /<button|wabba-entry-close|Hide Wabba|×/);
  assert.match(card, /width="40" height="40"/);
  const config = {};
  runInNewContext(readFileSync(new URL('../wabba-config.js', import.meta.url), 'utf8')
    .replace('export const wabbaConfig', 'globalThis.wabbaConfig'), config);
  const destination = new URL(card.match(/href="([^"]+)"/)[1]);
  assert.equal(destination.href, `${config.wabbaConfig.webOrigin}/account?game=bingo`,
    'the no-JS destination must match shipped account configuration');
  const css = readFileSync(new URL('../wabba-entry.css', import.meta.url), 'utf8');
  assert.match(css, /\.wabba-entry-shell \{[^}]*position: fixed;[^}]*right:[^}]*bottom:/);
});

test('all Wabba bootstrap imports use one fresh release URL, including auth injection', () => {
  for (const name of ['wabba-entry.js', 'script.js', 'wabba-callback.js', 'ui.js']) {
    const code = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    assert.match(code, /from '\.\/wabba\.js\?v=widget-20260915-4'/);
  }
  const code = readFileSync(new URL('../wabba.js', import.meta.url), 'utf8');
  assert.match(code, /from '\.\/wabba-config\.js\?v=widget-20260915-4'/);
  assert.match(code, /from '\.\/wabba-entry-view\.js\?v=widget-20260915-4'/);
  assert.doesNotMatch(code, /wabba-age-gate/);
});

test('HTML and every app-state importer use the same unversioned script.js module instance', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = html.match(/<script\s+type="module"\s+src="(script\.js[^\"]*)"/)?.[1];
  assert.equal(source, 'script.js');
  const base = 'https://bingo.example/Bingo-Game/';
  const mainURL = new URL(source, base).href;
  let stateImporters = 0;
  for (const name of readdirSync(new URL('../', import.meta.url)).filter(name => name.endsWith('.js'))) {
    const contents = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    for (const match of contents.matchAll(/import\s+\{[^}]*\bstate\b[^}]*\}\s+from\s+['"]([^'"]+)['"]/g)) {
      stateImporters++;
      assert.equal(new URL(match[1], base).href, mainURL, `${name} must not instantiate a second app-state module`);
    }
  }
  assert.ok(stateImporters >= 3);
});

test('SDK receives playing and confirmed-link context before mounting the persistent card', async () => {
  const f = setup();
  const game = f.tab();
  game.updateContext({ playing: true });
  await game.loadSdk();
  assert.deepEqual(game.sdkEvents.slice(0, 2), ['context', 'mount']);
  assert.deepEqual(game.sdkContexts[0], { playing: true, connected: false, ready: true });
  assert.equal(f.requests.length, 0);
});

test('confirmed finish alone persists per-user display context and notifies the original tab', async () => {
  const f = setup();
  const original = f.tab();
  const started = await original.start();
  assert.equal(f.local.getItem('wabba:bingo:connected:alice'), null);
  assert.equal(original.entryContexts.at(-1).connected, false);
  await f.tab().finish(f.callback(started.state));
  assert.equal(f.local.getItem('wabba:bingo:connected:alice'), 'true');
  assert.equal(original.entryContexts.at(-1).connected, true);
  assert.equal(f.pendingCount(), 0);
  const restored = f.tab();
  assert.equal(restored.entryContexts.at(-1).connected, true);
  await restored.loadSdk();
  assert.equal(restored.sdkContexts[0].connected, true);
  assert.equal(f.requests.length, 2, 'remembering the display preference never performs verification requests');
});

test('standalone bootstrap tracks readiness until Firebase resolves a signed-in or signed-out identity', async () => {
  for (const signedIn of [true, false]) {
    const f = setup({}, { authDelayed: true });
    const game = f.tab();
    assert.deepEqual(game.entryContexts.at(-1), { playing: false, connected: false, ready: false });
    await game.loadSdk();
    assert.deepEqual(game.sdkContexts[0], { playing: false, connected: false, ready: false });
    assert.deepEqual(game.sdkEvents.slice(0, 2), ['context', 'mount']);
    if (!signedIn) {
      game.auth.currentUser = null;
      game.setupAgain();
      assert.equal(game.entryContexts.at(-1).ready, false, 'a null currentUser alone does not prove auth has resolved');
    }
    game.setupAgain(signedIn ? undefined : { contextReady: true });
    assert.deepEqual(game.entryContexts.at(-1), { playing: false, connected: false, ready: true });
    assert.equal(game.mountCount(), 1);
    assert.equal(game.sdkMountCount(), 1);
    assert.equal(f.tokenRequests.length, 0);
    assert.equal(f.requests.length, 0);
  }
  const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(script, /onAuthStateChanged\(auth, async user => \{\s*setupWabba\(auth, \{ contextReady: true \}\)/);
});

test('an unconfirmed or lost finish response cannot set confirmed connection context', async () => {
  for (const failure of ['unconfirmed', 'lost']) {
    const f = setup();
    const game = f.tab();
    const started = await game.start();
    if (failure === 'unconfirmed') f.unconfirmFinish();
    else f.loseFinishResponse();
    await assert.rejects(game.finish(f.callback(started.state)), /not confirmed|Response lost/);
    assert.equal(f.local.getItem('wabba:bingo:connected:alice'), null);
    assert.equal(game.entryContexts.at(-1).connected, false);
  }
});

test('account switching clears active connection context without borrowing another user preference', async () => {
  const f = setup();
  const game = f.tab();
  const started = await game.start();
  await game.finish(f.callback(started.state));
  assert.equal(game.entryContexts.at(-1).connected, true);
  game.auth.currentUser = { uid: 'bob', getIdToken: async () => 'token-bob' };
  game.setupAgain();
  assert.equal(game.entryContexts.at(-1).connected, false);
  f.local.setItem('wabba:bingo:connected:alice', 'true');
  assert.equal(game.entryContexts.at(-1).connected, false);
  game.auth.currentUser = null;
  game.setupAgain();
  assert.equal(game.entryContexts.at(-1).connected, false);
  game.auth.currentUser = { uid: 'alice', getIdToken: async () => 'token-alice' };
  game.setupAgain();
  assert.equal(game.entryContexts.at(-1).connected, true);
  assert.equal(game.mountCount(), 1);
});

test('blocked preference storage retains confirmed UI state in memory without failing the callback', async () => {
  const f = setup();
  const game = f.tab();
  const started = await game.start();
  const write = f.local.setItem;
  f.local.setItem = (key, value) => {
    if (key.startsWith('wabba:bingo:connected:')) throw new Error('storage unavailable');
    write(key, value);
  };
  assert.equal((await game.finish(f.callback(started.state))).connected, true);
  assert.equal(game.entryContexts.at(-1).connected, true);
  assert.equal(f.local.getItem('wabba:bingo:connected:alice'), null);
  assert.equal(f.pendingCount(), 0);
});

test('the per-user connection preference never authorizes a start or replaces Firebase authentication', async () => {
  const f = setup();
  f.local.setItem('wabba:bingo:connected:alice', 'true');
  const game = f.tab();
  game.auth.currentUser = null;
  game.setupAgain();
  assert.equal(game.entryContexts.at(-1).connected, false);
  await assert.rejects(game.start(), /Sign in to Bingo/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.tokenRequests.length, 0);
  game.updateContext({ connected: true });
  assert.equal(game.entryContexts.at(-1).connected, false, 'game views can change only playing context');
});

test('the game ships its local SDK script, stylesheet and logo', () => {
  const sdk = readFileSync(new URL('../wabba-sdk/sdk/wabba-connect.v1.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Script(sdk));
  assert.match(sdk, /Connect to Wabba/);
  const css = readFileSync(new URL('../wabba-sdk/sdk/wabba-connect.v1.css', import.meta.url), 'utf8');
  assert.match(css, /:host/);
  const logo = readFileSync(new URL('../wabba-sdk/brand/wabba-logo-transparent.png', import.meta.url));
  assert.equal(logo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('SDK mounts once with local assets and never requests a token before connecting', async () => {
  const f = setup();
  const game = f.tab();
  assert.equal(game.mountCount(), 1);
  assert.equal(game.setupAgain(), false);
  assert.equal(game.mountCount(), 1);
  assert.equal(game.assets.length, 0);
  assert.equal(f.requests.length, 0);
  await game.loadSdk();
  assert.deepEqual(game.assets, ['https://bingo.example/Bingo-Game/wabba-sdk/sdk/wabba-connect.v1.js?v=widget-20260915-4']);
  assert.equal(game.scripts[0].dataset.wabbaOrigin, 'https://wabba.test');
  assert.equal(game.destination(), 'https://wabba.test/account?game=bingo');
  assert.equal(game.isDismissible(), false, 'Bingo keeps the shared card visible without an X');
  assert.equal(f.tokenRequests.length, 0);
  assert.equal(f.requests.length, 0);
  await game.start();
  assert.equal(f.requests.length, 1);
});

test('shipped configuration displays the SDK without a pretend live adapter', () => {
  const configSource = readFileSync(new URL('../wabba-config.js', import.meta.url), 'utf8')
    .replace('export const wabbaConfig', 'globalThis.wabbaConfig');
  const context = {};
  runInNewContext(configSource, context);
  assert.equal(context.wabbaConfig.enabled, true);
  assert.equal(context.wabbaConfig.adapterOrigin, null);
});

test('missing or unsafe adapter opens the account page without an intercepted connect action', async () => {
  for (const adapterOrigin of [null, undefined, 'http://localhost:8080', 'https://adapter.test/path',
    'https://adapter.test#fragment', 'https://adapter.test?secret=no', 'https://user@adapter.test']) {
    const f = setup({ adapterOrigin });
    const game = f.tab();
    assert.equal(game.mountCount(), 1);
    await game.loadSdk();
    assert.equal(game.sdkMountCount(), 1);
    assert.equal(game.hasConnectionHandler(), false, 'the SDK must use ordinary account navigation');
    assert.equal(game.destination(), 'https://wabba.test/account?game=bingo');
    f.local.getItem = () => { throw new Error('Must not read callback storage without a configured adapter'); };
    await assert.rejects(game.finish({ state: 'x'.repeat(43) }), /linking is not available.*not been connected/);
    assert.equal(f.tokenRequests.length, 0);
    assert.equal(f.requests.length, 0);
    assert.equal(game.session.values.size, 0);
    assert.equal(f.pendingCount(), 0);
  }
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

test('SDK initialization failure rejects instead of hanging enhancement and permits retry', async () => {
  const f = setup({}, { failSdk: true });
  const game = f.tab();
  await assert.rejects(game.start(), /Wabba could not initialize/);
  assert.equal(f.requests.length, 0);
  await game.start();
  assert.equal(game.assets.length, 2);
  assert.equal(f.requests.length, 1);
  assert.equal(game.timers.size, 0);
});

test('an SDK script that does not mount a host cannot replace the static card', async () => {
  const f = setup({}, { missingSdkHost: true });
  const game = f.tab();
  await assert.rejects(game.loadSdk(), /Wabba could not initialize/);
  assert.equal(f.requests.length, 0);
  assert.equal(game.scripts[0].removed, true);
  assert.equal(game.timers.size, 0);
});

test('SDK enhancement waits for CSS before revealing the replacement card', async () => {
  const f = setup({}, { stallCss: true });
  const game = f.tab();
  let ready = false;
  const attempt = game.loadSdk().then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  assert.deepEqual(game.styles.get('display'), { value: 'none', priority: 'important' });
  assert.equal(game.timers.size, 1, 'deadline must include stylesheet loading');
  const lateError = game.stylesheet.onerror;
  game.stylesheet.onload();
  await attempt;
  assert.equal(ready, true);
  assert.equal(game.styles.has('display'), false);
  assert.equal(game.host.removed, false);
  assert.equal(game.stylesheet.onload, null);
  assert.equal(game.stylesheet.onerror, null);
  assert.equal(game.timers.size, 0);
  lateError();
  assert.equal(game.host.removed, false);
  assert.equal(f.tokenRequests.length, 0);
});

test('failed, missing or stalled CSS removes the unstyled SDK and preserves fallback eligibility', async () => {
  for (const failure of ['error', 'missing', 'timeout']) {
    const f = setup({}, { stallCss: true, missingCss: failure === 'missing' });
    const game = f.tab();
    const attempt = game.loadSdk();
    const rejected = assert.rejects(attempt, /styles could not load|could not initialize|took too long/);
    const lateLoad = game.stylesheet.onload;
    if (failure === 'error') game.stylesheet.onerror();
    if (failure === 'timeout') [...game.timers.values()][0].callback();
    await rejected;
    assert.equal(game.host.removed, true);
    assert.equal(game.destroyCount(), 1, 'the incomplete SDK host must be destroyed');
    assert.equal(game.scripts[0].removed, true);
    assert.equal(game.styles.get('display').value, 'none');
    assert.equal(game.timers.size, 0);
    lateLoad?.();
    assert.equal(game.host.removed, true);
    assert.equal(game.styles.get('display').value, 'none', 'late CSS must not reveal an abandoned card');
    assert.equal(f.requests.length, 0);
  }
});

test('stalled SDK load times out once, ignores late callbacks and permits a fresh retry', async () => {
  const f = setup({}, { stallSdk: true });
  const game = f.tab();
  const attempt = game.start();
  const rejected = assert.rejects(attempt, /took too long to load/);
  assert.equal(game.timers.size, 1);
  const deadline = [...game.timers.values()][0];
  assert.equal(deadline.delay, 15000);
  const script = game.scripts[0];
  const lateLoad = script.onload;
  const lateError = script.onerror;
  deadline.callback();
  await rejected;
  assert.equal(game.timers.size, 0);
  assert.equal(script.removed, true);
  assert.equal(script.onload, null);
  assert.equal(script.onerror, null);
  assert.equal(game.sdkMountCount(), 0);
  assert.equal(f.requests.length, 0);
  lateLoad(); lateError(); deadline.callback();
  assert.equal(game.sdkMountCount(), 0);
  f.allowSdkLoad();
  await game.start();
  assert.equal(game.scripts.length, 2);
  assert.equal(game.sdkMountCount(), 1);
  assert.equal(game.timers.size, 0);
  assert.equal(f.requests.length, 1);
  lateLoad(); lateError();
  assert.equal(game.sdkMountCount(), 1);
  assert.equal(f.requests.length, 1);
});

test('start and finish both use cookie-free bearer transport with redirect protection and a signal', async () => {
  const f = setup();
  const started = await f.tab().start();
  await f.tab().finish(f.callback(started.state));
  // The transport above asserts the real adapter options on both requests.
  assert.deepEqual(f.requests.map(request => new URL(request.url).pathname), ['/wabba/link/start', '/wabba/link/finish']);
});
