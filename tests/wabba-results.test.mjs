import assert from 'node:assert/strict';
import test from 'node:test';
import { WabbaResultClient } from '../wabba-sdk/sdk/wabba-results.v1.mjs';

const record = (overrides = {}) => ({
  gameId: 'gam_bingo', externalMatchId: 'match-42', gameUserId: 'alice', wabbaPlayerId: 'plr_alice',
  connected: true, email: 'alice@example.test', emailVerified: true, status: 'recorded', evidence: 'game_record',
  outcome: 'win', won: true, participantIds: ['alice', 'bob', 'carol'], winnerId: 'alice',
  completedAt: '2026-01-01T00:00:00.000Z', ...overrides,
});
function setup(options = {}) {
  const states = [], requests = [];
  let user = { id: 'alice', getToken: async () => 'game.token' };
  const client = new WabbaResultClient({ apiOrigin: 'https://game-server.test',
    getIdentity: () => user, onState: value => states.push(value), retryDelayMs: 1, timeoutMs: 100,
    fetch: async (url, request) => { requests.push({ url, ...request }); return Response.json(record()); }, ...options });
  return { client, states, requests, changeUser: value => { user = value; } };
}

test('retrieves a bound rich result using a bearer GET, never a submitted winner or email', async () => {
  const f = setup();
  assert.equal(f.requests.length, 0);
  const state = await f.client.watch('match-42');
  assert.equal(state.status, 'win');
  assert.deepEqual(state.result, record());
  assert.ok(Object.isFrozen(state.result));
  assert.ok(Object.isFrozen(state.result.participantIds));
  assert.deepEqual(f.states.map(s => s.status), ['checking', 'win']);
  const req = f.requests[0];
  assert.equal(req.url, 'https://game-server.test/wabba/matches/match-42/result');
  assert.equal(req.method, 'GET'); assert.equal(req.body, undefined);
  assert.equal(req.headers.Authorization, 'Bearer game.token');
  assert.equal(req.credentials, 'omit'); assert.equal(req.redirect, 'error');
  assert.doesNotMatch(state.message, /alice@|plr_|game\.token/);
  await f.client.watch('match-42'); assert.equal(f.requests.length, 1);
});

test('supports multiple games, multiplayer losses and draws without rewarding anyone', async () => {
  for (const [winnerId, outcome] of [['bob', 'loss'], [null, 'draw']]) {
    const f = setup({ fetch: async () => Response.json(record({ gameId: 'gam_racing', winnerId, won: false, outcome })) });
    const state = await f.client.watch('match-42');
    assert.equal(state.status, outcome); assert.equal(state.result.gameId, 'gam_racing');
    assert.equal(state.result.won, false); assert.equal('award' in state.result, false);
  }
});

test('waits for saved records with bounded retries and a manual retry after exhaustion', async () => {
  let calls = 0;
  const f = setup({ maxAttempts: 2, fetch: async () => {
    calls++; return Response.json(record(calls < 3 ? { status: 'not_final', winnerId: 'alice', won: true } : {}));
  } });
  assert.equal((await f.client.watch('match-42')).status, 'pending');
  assert.equal(calls, 2); assert.equal(f.client.state.result, undefined);
  assert.equal((await f.client.retry()).status, 'win'); assert.equal(calls, 3);
});

test('rejects mismatched identity, match, connection and inconsistent recorded outcomes', async () => {
  for (const bad of [{ externalMatchId: 'other' }, { gameUserId: 'bob' }, { connected: false },
    { wabbaPlayerId: '' }, { gameId: '' }, { evidence: 'browser_claim' }, { status: 'verified' },
    { participantIds: ['bob'] }, { participantIds: ['alice', 'alice'] }, { winnerId: 'outsider' },
    { won: false }, { outcome: 'loss' }, { completedAt: 'invalid' }]) {
    const f = setup({ fetch: async () => Response.json(record(bad)) });
    const state = await f.client.watch('match-42');
    assert.equal(state.status, 'unavailable'); assert.equal(state.result, undefined);
  }
});

test('errors expose no private response and unlinked or signed-out users get specific states', async () => {
  for (const [code, expected] of [[401, 'sign_in'], [409, 'not_connected'], [403, 'unavailable'], [503, 'unavailable']]) {
    const f = setup({ fetch: async () => Response.json({ message: 'private-token-and-email' }, { status: code }) });
    const state = await f.client.watch('match-42');
    assert.equal(state.status, expected); assert.doesNotMatch(JSON.stringify(state), /private-token/);
  }
});

test('missing configuration or sign-in does not read a token or make requests', async () => {
  const f = setup({ apiOrigin: null, getIdentity: () => ({ id: 'alice', getToken: () => assert.fail() }) });
  assert.equal((await f.client.watch('match-42')).status, 'unavailable');
  const signedOut = setup({ getIdentity: () => null });
  assert.equal((await signedOut.client.watch('match-42')).status, 'sign_in');
  assert.equal(f.requests.length + signedOut.requests.length, 0);
});

test('account switches cannot fetch with stale credentials or publish another account result', async () => {
  let release;
  const f = setup();
  f.changeUser({ id: 'alice', getToken: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.client.watch('match-42');
  f.changeUser({ id: 'bob', getToken: async () => 'bob.token' });
  release('alice.token'); await pending;
  assert.equal(f.requests.length, 0); assert.equal(f.client.state.status, 'idle');
  let resolveRead;
  const g = setup({ fetch: () => new Promise(resolve => { resolveRead = resolve; }) });
  const read = g.client.watch('match-42');
  await new Promise(resolve => setImmediate(resolve));
  g.changeUser(null); resolveRead(Response.json(record())); await read;
  assert.equal(g.client.state.status, 'idle'); assert.equal(g.client.state.result, undefined);
});

test('reset cancels a stalled provider and cannot be overwritten by a late response', async () => {
  let release;
  const f = setup({ fetch: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.client.watch('match-42');
  await new Promise(resolve => setImmediate(resolve));
  f.client.reset(); await pending;
  release(Response.json(record())); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.client.state.status, 'idle'); assert.equal(f.client.state.result, undefined);
});

test('timeouts cover both token acquisition and stalled HTTP calls even if cancellation is ignored', async () => {
  for (const options of [{ getIdentity: () => ({ id: 'alice', getToken: () => new Promise(() => {}) }) },
    { fetch: () => new Promise(() => {}) }]) {
    const f = setup({ timeoutMs: 5, ...options });
    assert.equal((await f.client.watch('match-42')).status, 'unavailable');
  }
});

test('invalid inputs cannot create requests and presentation failures do not break data retrieval', async () => {
  const f = setup({ onState: () => { throw new Error('UI failed'); } });
  for (const id of ['', '../id', 'a/b', 'x\n', null, 'x'.repeat(201)]) await assert.rejects(f.client.watch(id), TypeError);
  assert.equal(f.requests.length, 0);
  assert.equal((await f.client.watch('match-42')).status, 'win');
  for (const apiOrigin of ['http://remote.test', 'https://user@server.test', 'https://server.test/path', 'https://server.test?x=y']) {
    assert.throws(() => setup({ apiOrigin }), TypeError);
  }
});
