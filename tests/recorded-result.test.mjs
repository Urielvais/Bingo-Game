import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { archiveRecordedGame, buildArchivedGame, createWinnerRecord, retryGameArchive } from '../recorded-result.mjs';

const completedAt = Object.freeze({ seconds: 1789387140, nanoseconds: 0 });
const archivedAt = Object.freeze({ seconds: 1789387145, nanoseconds: 0 });
const game = () => ({
    mode: 'classic', ...createWinnerRecord({ id: 'firebase-alice', name: 'Same name' }, completedAt),
});
const participants = () => [
    { id: 'firebase-alice', playerName: 'Same name', score: 1500 },
    { id: 'firebase-bob', playerName: 'Same name', score: 900 },
];
const refs = { gameRef: 'activeGames/game-42', archiveRef: 'pastGames/game-42' };

function transactionWith(records) {
    return {
        async get(ref) {
            const value = records.get(ref);
            return { exists: () => value !== undefined, data: () => value };
        },
        set(ref, value) { records.set(ref, value); },
    };
}

test('winner record preserves its display name and stable identity with server timestamp marker', () => {
    const marker = Object.freeze({ type: 'serverTimestamp' });
    assert.deepEqual(createWinnerRecord({ name: 'Same name', id: 'firebase-alice' }, marker), {
        winner: 'Same name', winnerId: 'firebase-alice', resultVersion: 1, completedAt: marker,
    });
    for (const winner of [null, { name: 'Only a name' }, { name: 'A', id: '' }, { name: 'A', id: ' x ' }]) {
        assert.throws(() => createWinnerRecord(winner, marker), /stable player ID/);
    }
});

test('archive retains stable winner, version, actual completion and all participant identities', () => {
    const players = participants();
    const result = buildArchivedGame(game(), players, archivedAt);
    assert.equal(result.resultVersion, 1);
    assert.equal(result.winnerId, 'firebase-alice');
    assert.equal(result.completedAt, completedAt);
    assert.equal(result.archivedAt, archivedAt);
    assert.deepEqual(result.participants, players);
    players[0].id = 'changed';
    assert.equal(result.participants[0].id, 'firebase-alice');
});

test('legacy display names never infer a stable winner or fabricated completion/version', () => {
    const result = buildArchivedGame({ winner: 'Same name', mode: 'classic' }, participants(), archivedAt);
    assert.equal(result.winner, 'Same name');
    for (const field of ['winnerId', 'completedAt', 'resultVersion']) assert.equal(field in result, false);
    assert.equal(result.archivedAt, archivedAt);
});

test('new archives reject empty, duplicate, winner-missing and unfinished snapshots', () => {
    for (const players of [[], participants().slice(1), [participants()[0], participants()[0]], [{ id: null }]]) {
        assert.throws(() => buildArchivedGame(game(), players, archivedAt));
    }
    assert.throws(() => buildArchivedGame({ ...game(), winner: null }, participants(), archivedAt));
    assert.throws(() => buildArchivedGame({ ...game(), completedAt: null }, participants(), archivedAt));
});

test('first archive is saved before later empty or partial cleanup snapshots and never overwritten', async () => {
    const records = new Map([[refs.gameRef, game()]]);
    const full = await archiveRecordedGame(transactionWith(records), {
        ...refs, participants: participants(), archivedAt,
    });
    assert.equal(full.created, true);
    for (const captured of [participants().slice(1), []]) {
        const later = await archiveRecordedGame(transactionWith(records), {
            ...refs, participants: captured, archivedAt: { seconds: 9999999999 },
        });
        assert.equal(later.created, false);
        assert.equal(later.record, full.record);
        assert.equal(records.get(refs.archiveRef), full.record);
    }
});

test('a transaction retry after a competing full archive ignores its stale partial snapshot', async () => {
    const records = new Map([[refs.gameRef, game()]]);
    const full = buildArchivedGame(game(), participants(), archivedAt);
    let competingArchive = false;
    const retryingTransaction = {
        async get(ref) {
            if (ref === refs.archiveRef) {
                // Represents Firestore retrying after a conflicting create.
                competingArchive = true;
                records.set(ref, full);
            }
            return transactionWith(records).get(ref);
        },
        set() { assert.fail('A winning concurrent archive must never be overwritten'); },
    };
    const result = await archiveRecordedGame(retryingTransaction, {
        ...refs, participants: [], archivedAt: { seconds: 9999999999 },
    });
    assert.equal(competingArchive, true);
    assert.equal(result.record, full);
});

test('missing active record cannot create a partial archive, but existing archives survive cleanup', async () => {
    const records = new Map();
    await assert.rejects(archiveRecordedGame(transactionWith(records), {
        ...refs, participants: participants(), archivedAt,
    }), /keep participant data/);
    assert.equal(records.has(refs.archiveRef), false);
    const full = buildArchivedGame(game(), participants(), archivedAt);
    records.set(refs.archiveRef, full);
    assert.equal((await archiveRecordedGame(transactionWith(records), {
        ...refs, participants: [], archivedAt,
    })).record, full);
});

async function loadCleanup(overrides = {}) {
    // Execute the shipped function with local Firestore stubs, not a copy of its
    // algorithm. The browser's remote SDK imports are deliberately not loaded.
    const source = await readFile(new URL('../game.js', import.meta.url), 'utf8');
    const beginning = source.indexOf('export async function cleanupEndedGame(');
    const end = source.indexOf('export function listenForLeaderboardUpdates(', beginning);
    assert.ok(beginning >= 0 && end > beginning);
    const events = [];
    const records = new Map([[refs.gameRef, game()]]);
    const fixtures = {
        db: {}, storage: null, archiveRecordedGame,
        retryGameArchive: archive => retryGameArchive(archive, { wait: async () => events.push('retry') }),
        doc: (_db, ...parts) => parts.join('/'),
        collection: (_db, path) => path,
        serverTimestamp: () => archivedAt,
        getDocs: async () => ({ docs: participants().map(player => ({ id: player.id, data: () => player })) }),
        runTransaction: async (_db, callback) => callback({
            ...transactionWith(records),
            set(ref, record) { events.push('archive'); records.set(ref, record); },
        }),
        deleteDoc: async ref => {
            assert.ok(records.get(refs.archiveRef), 'No deletion before archive commit');
            events.push(`delete:${ref}`);
        },
        arrayRemove: () => ({}),
        console: { error: () => events.push('error'), warn: () => {} },
        ...(typeof overrides === 'function' ? overrides({ records, events }) : overrides),
    };
    const cleanup = new Function(...Object.keys(fixtures),
        `${source.slice(beginning, end).replace('export async function', 'async function')}; return cleanupEndedGame;`
    )(...Object.values(fixtures));
    return { cleanup, events, records };
}

test('shipped cleanup commits the complete archive before deleting any game or participant data', async () => {
    const fixture = await loadCleanup();
    await fixture.cleanup('game-42');
    assert.equal(fixture.events[0], 'archive');
    assert.equal(fixture.events.filter(event => event.startsWith('delete:')).length, 3);
    assert.deepEqual(fixture.records.get(refs.archiveRef).participants, participants());
});

test('shipped cleanup deletes nothing if the archive transaction fails', async () => {
    let deletions = 0;
    const fixture = await loadCleanup({
        runTransaction: async () => { throw new Error('simulated unavailable database'); },
        deleteDoc: async () => { deletions++; },
    });
    await fixture.cleanup('game-42');
    assert.equal(deletions, 0);
    assert.deepEqual(fixture.events, ['error']);
    assert.equal(fixture.records.has(refs.archiveRef), false);
});

test('archive-only retry is bounded, backs off and never retries permission or validation errors', async () => {
    const waits = [];
    let attempts = 0;
    const result = await retryGameArchive(async () => {
        attempts++;
        if (attempts < 3) throw Object.assign(new Error('temporary'), { code: 'firestore/unavailable' });
        return { created: true };
    }, { wait: async delay => waits.push(delay) });
    assert.deepEqual(result, { created: true });
    assert.equal(attempts, 3);
    assert.deepEqual(waits, [250, 500]);
    for (const code of ['permission-denied', 'invalid-argument', undefined, 'deadline-exceeded']) {
        let calls = 0;
        const error = Object.assign(new Error('failure'), { code });
        await assert.rejects(retryGameArchive(async () => { calls++; throw error; }, { wait: async () => {} }), thrown => thrown === error);
        assert.equal(calls, code === 'deadline-exceeded' ? 3 : 1);
    }
});

test('shipped cleanup recovers a transient archive failure before any deletion', async () => {
    let first = true;
    const fixture = await loadCleanup(({ records, events }) => ({
        runTransaction: async (_db, callback) => {
            if (first) {
                first = false;
                throw Object.assign(new Error('temporary archive failure'), { code: 'unavailable' });
            }
            return callback({
                ...transactionWith(records),
                set(ref, record) { events.push('archive'); records.set(ref, record); },
            });
        },
    }));
    assert.equal(await fixture.cleanup('game-42'), true);
    assert.deepEqual(fixture.events.slice(0, 2), ['retry', 'archive']);
    assert.equal(fixture.events.filter(event => event.startsWith('delete:')).length, 3);
    assert.deepEqual(fixture.records.get(refs.archiveRef).participants, participants());
});

test('repeated cleanup never reruns statistics or deletions after an archive already committed', async () => {
    const fixture = await loadCleanup(({ records, events }) => {
        for (const player of participants()) records.set(`users/${player.id}`, {});
        return {
            runTransaction: async (_db, callback) => callback({
                ...transactionWith(records),
                set(ref, record) { events.push('archive'); records.set(ref, record); },
                update(ref, changes) { events.push('stats'); records.set(ref, { ...records.get(ref), ...changes }); },
            }),
        };
    });
    assert.equal(await fixture.cleanup('game-42'), true);
    assert.equal(fixture.events.filter(event => event === 'stats').length, 2);
    const events = [...fixture.events];
    assert.equal(await fixture.cleanup('game-42'), true);
    assert.deepEqual(fixture.events, events);
    for (const player of participants()) assert.equal(fixture.records.get(`users/${player.id}`).stats.gamesPlayed, 1);
});

test('an ambiguous archive commit is discovered on retry without replaying post-archive work', async () => {
    let ambiguous = true;
    const fixture = await loadCleanup(({ records, events }) => ({
        runTransaction: async (_db, callback) => {
            const result = await callback({
                ...transactionWith(records),
                set(ref, record) { events.push('archive'); records.set(ref, record); },
                update() { assert.fail('Do not retry statistics after an ambiguous commit.'); },
            });
            if (ambiguous) {
                ambiguous = false;
                throw Object.assign(new Error('response lost after commit'), { code: 'unavailable' });
            }
            return result;
        },
    }));
    assert.equal(await fixture.cleanup('game-42'), true);
    assert.deepEqual(fixture.events, ['archive', 'retry']);
});

test('the live game listener checks only the match ID on winner and cleanup events', async () => {
    const source = await readFile(new URL('../game.js', import.meta.url), 'utf8');
    const beginning = source.indexOf('export function listenForGameUpdates(');
    const end = source.indexOf('export function listenForPlayerUpdates(', beginning);
    assert.ok(beginning >= 0 && end > beginning);
    const checks = [];
    const displayed = [];
    let listener;
    let resets = 0;
    let unsubscribed = 0;
    const fixtures = {
        state: { unsubscribe: { players: () => { unsubscribed++; } } }, db: {},
        prepareWabbaMatch: () => { resets++; },
        checkWabbaResult: (...args) => { checks.push(args); return Promise.resolve(); },
        doc: (_db, ...parts) => parts.join('/'),
        onSnapshot: (ref, callback) => { assert.equal(ref, 'activeGames/game-42'); listener = callback; return () => {}; },
        ui: { winnerModal: { classList: { contains: () => true } } },
        renderWinnerModal: name => displayed.push(name),
    };
    const listen = new Function(...Object.keys(fixtures),
        `${source.slice(beginning, end).replace('export function', 'function')}; return listenForGameUpdates;`
    )(...Object.values(fixtures));
    listen('game-42');
    assert.equal(resets, 1);
    listener({ exists: () => true, data: () => ({}) });
    assert.deepEqual(checks, []);
    listener({ exists: () => true, data: () => ({ winner: 'Same name', winnerId: 'firebase-alice' }) });
    listener({ exists: () => false });
    assert.deepEqual(checks, [['game-42'], ['game-42']], 'no browser winner, email or account ID is submitted');
    assert.deepEqual(displayed, ['Same name']);
    assert.equal(unsubscribed, 1);
});

async function loadEndedJoin({ active = true, recovery = true, cleanup } = {}) {
    const source = await readFile(new URL('../game.js', import.meta.url), 'utf8');
    const beginning = source.indexOf('export async function joinGame(');
    const end = source.indexOf('export function generateBingoCard(', beginning);
    assert.ok(beginning >= 0 && end > beginning);
    const events = [];
    const state = { gameId: 'game-42', currentUser: { uid: 'firebase-alice' } };
    const fixtures = {
        state, db: {},
        doc: (_db, ...parts) => parts.join('/'),
        getDoc: async ref => ({ id: 'game-42', exists: () => ref.startsWith('pastGames/') || active, data: game }),
        cleanupEndedGame: async id => { events.push(`recover:${id}`); return cleanup ? cleanup(id) : recovery; },
        checkWabbaResult: id => { events.push(`result:${id}`); return Promise.resolve(); },
        updateDoc: async () => events.push('remove-from-active-list'),
        arrayRemove: value => value,
        showView: view => events.push(`view:${view}`),
        showMessage: title => events.push(`message:${title}`),
        window: { history: { pushState() {} }, location: { pathname: '/' } },
        console: { error: assert.fail },
    };
    const join = new Function(...Object.keys(fixtures),
        `${source.slice(beginning, end).replace('export async function', 'async function')}; return joinGame;`
    )(...Object.values(fixtures));
    return { join, events, state };
}

test('rejoining an ended active game retries archiving, while archive-only games skip cleanup', async () => {
    for (const active of [true, false]) {
        const fixture = await loadEndedJoin({ active });
        await fixture.join('Same name', 'firebase-alice');
        assert.equal(fixture.events.includes('recover:game-42'), active);
        assert.ok(fixture.events.includes('result:game-42'));
        assert.ok(fixture.events.includes('remove-from-active-list'));
        assert.equal(fixture.events.at(-1), 'view:home');
    }
});

test('failed ended-game recovery keeps the rejoin entry and a later rejoin can complete the archive', async () => {
    let unavailable = true;
    const cleanupFixture = await loadCleanup(({ records, events }) => ({
        runTransaction: async (_db, callback) => {
            if (unavailable) throw Object.assign(new Error('temporarily offline'), { code: 'unavailable' });
            return callback({
                ...transactionWith(records),
                set(ref, record) { events.push('archive'); records.set(ref, record); },
            });
        },
    }));
    const failedJoin = await loadEndedJoin({ cleanup: cleanupFixture.cleanup });
    await failedJoin.join('Same name', 'firebase-alice');
    assert.equal(failedJoin.events.includes('remove-from-active-list'), false);
    assert.equal(cleanupFixture.records.has(refs.archiveRef), false);
    assert.deepEqual(cleanupFixture.events, ['retry', 'retry', 'error']);
    unavailable = false;
    const recoveredJoin = await loadEndedJoin({ cleanup: cleanupFixture.cleanup });
    await recoveredJoin.join('Same name', 'firebase-alice');
    assert.ok(recoveredJoin.events.includes('remove-from-active-list'));
    assert.deepEqual(cleanupFixture.records.get(refs.archiveRef).participants, participants());
});
