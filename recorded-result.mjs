// Recorded gameplay outcomes, not an independent anti-cheat attestation.
const stableId = value => typeof value === 'string' && value.length > 0 &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);

export function createWinnerRecord(winner, completedAt) {
    if (!winner || !stableId(winner.id) || typeof winner.name !== 'string' || !completedAt) {
        throw new Error('A recorded winner needs a stable player ID and completion timestamp.');
    }
    return {
        winner: winner.name,
        winnerId: winner.id,
        resultVersion: 1,
        completedAt,
    };
}

export function buildArchivedGame(gameData, participants, archivedAt) {
    if (!gameData || !gameData.winner || !Array.isArray(participants) || !participants.length ||
        !participants.every(player => player && stableId(player.id)) ||
        new Set(participants.map(player => player.id)).size !== participants.length) {
        throw new Error('Capture the ended game and its full participant snapshot before cleanup.');
    }
    if (gameData.resultVersion === 1 && (!stableId(gameData.winnerId) || !gameData.completedAt ||
        !participants.some(player => player.id === gameData.winnerId))) {
        throw new Error('The recorded winner must belong to the captured participants.');
    }
    // Copy the recorded identity/time as-is. Legacy display names never become
    // stable winner IDs, and archiving time never becomes completion time.
    return {
        ...gameData,
        archivedAt,
        participants: participants.map(player => ({
            id: player.id,
            playerName: player.playerName || 'Unknown',
            score: player.score || 0,
        })),
    };
}

export async function archiveRecordedGame(transaction, { gameRef, archiveRef, participants, archivedAt }) {
    // Firestore retries this callback if another cleanup creates the archive.
    // Check it first: a later empty/partial snapshot may never replace it.
    const previous = await transaction.get(archiveRef);
    if (previous.exists()) return { created: false, record: previous.data() };
    const game = await transaction.get(gameRef);
    if (!game.exists()) throw new Error('The ended game is unavailable; keep participant data.');
    const record = buildArchivedGame(game.data(), participants, archivedAt);
    transaction.set(archiveRef, record);
    return { created: true, record };
}

export async function retryGameArchive(archive, { wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
    // Retry only archive work. Statistics and deletions must never be replayed
    // because a later cleanup step failed. Permission/validation failures stop.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await archive();
        } catch (error) {
            const code = typeof error?.code === 'string' ? error.code.replace(/^firestore\//, '') : '';
            if (attempt === 2 || !['aborted', 'deadline-exceeded', 'unavailable'].includes(code)) throw error;
            await wait(250 * (2 ** attempt));
        }
    }
}
