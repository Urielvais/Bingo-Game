import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp, onSnapshot, updateDoc, runTransaction, query, orderBy, limit, arrayUnion, arrayRemove, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, listAll, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { db, storage } from './firebase.js';
import { ui, showMessage, showView, renderBingoCard, renderPlayerProgress, renderRarePhrases, renderActiveGamesList, renderWinnerModal, renderCallerUI } from './ui.js';
import { state } from './script.js';

export function getPhrasesFromInput() {
    if (!ui.phrasesInput) return [];
    return ui.phrasesInput.value.split('\n').map(p => p.trim()).filter(p => p.length > 0);
}

export function getRarePhrasesFromInput() {
    if (!ui.rarePhrasesInput) return [];
    return ui.rarePhrasesInput.value.split('\n').map(p => p.trim()).filter(p => p.length > 0);
}

export function updatePhraseCount() {
    if (state.gameMode === 'social') return;
    if (!ui.phrasesInput || !ui.rarePhrasesInput) return;
    const commonPhrases = getPhrasesFromInput();
    const rarePhrases = getRarePhrasesFromInput();
    ui.phraseCount.textContent = `${commonPhrases.length} phrases`;
    ui.rarePhraseCount.textContent = `${rarePhrases.length} phrases`;

    const isCommonValid = commonPhrases.length >= 25;
    const isRareValid = state.gameMode === 'classic' ? true : rarePhrases.length >= 5;
    
    ui.createGameBtn.disabled = !(isCommonValid && isRareValid);

    if (!isCommonValid && !isRareValid) {
        ui.errorMessage.textContent = 'Need at least 25 common phrases and at least 5 rare phrases.';
    } else if (!isCommonValid) {
        ui.errorMessage.textContent = 'You need at least 25 common phrases.';
    } else if (!isRareValid) {
        ui.errorMessage.textContent = 'You need at least 5 rare phrases.';
    } else {
        ui.errorMessage.textContent = '';
    }
}

export async function createNewGame() {
    const isClassic = state.gameMode === 'classic';
    const isSocial = state.gameMode === 'social';

    let commonPhrases = [];
    let rarePhrasesRaw = [];

    if (!isSocial) {
        commonPhrases = getPhrasesFromInput();
        rarePhrasesRaw = getRarePhrasesFromInput();

        if (commonPhrases.length < 25 || (!isClassic && rarePhrasesRaw.length < 5)) {
            showMessage("Invalid Phrases", "Please ensure you have at least 25 common phrases" + (isClassic ? "." : " and at least 5 rare phrases."));
            return;
        }
    }
    
    showView('loading');

    let rarePhrases = [];
    if (!isClassic && !isSocial) {
        const shuffledRare = [...rarePhrasesRaw].sort(() => 0.5 - Math.random());
        const selectedRare = shuffledRare.slice(0, 5);
        rarePhrases = selectedRare.map(phrase => ({
            text: phrase,
            claimedBy: null,
            claimedByName: null
        }));
    }

    const creatorId = state.currentUser ? state.currentUser.uid : 'guest';
    
    const gameData = {
        creatorId: creatorId,
        createdAt: serverTimestamp(),
        mode: state.gameMode,
        winner: null,
        managers: [creatorId]
    };

    if (isSocial) {
        gameData.phase = 'drafting';
    } else {
        gameData.allPhrases = commonPhrases;
        gameData.rarePhrases = rarePhrases;
        if (state.gameMode === 'phrase') {
            gameData.votingEnabled = true;
            gameData.phase = 'active'; // Skip drafting for phrase mode, go straight to active!
        }
    }

    if (isClassic) {
        gameData.remainingItems = [...commonPhrases].sort(() => 0.5 - Math.random());
        gameData.drawnItems = [];
    }

    try {
        const gameDocRef = await addDoc(collection(db, "activeGames"), gameData);

        state.gameId = gameDocRef.id;
        const newUrl = `${window.location.origin}${window.location.pathname}?game=${state.gameId}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        
        ui.gameLinkInput.value = newUrl;
        showView('link');

    } catch (error) {
        console.error("Error creating game:", error);
        showMessage("Error", "There was an error creating your game.");
        showView('create');
    }
}

export function copyGameLink() {
    ui.gameLinkInput.select();
    document.execCommand('copy');
    ui.copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => { ui.copyLinkBtn.textContent = 'Copy'; }, 2000);
}

export function copyGameId() {
    navigator.clipboard.writeText(state.gameId).then(() => {
        ui.copyGameIdBtn.textContent = 'Copied!';
        setTimeout(() => { ui.copyGameIdBtn.textContent = 'Copy'; }, 2000);
    });
}

export async function joinGame(pName, pId) {
    state.playerId = pId;
    showView('loading');
    
    try {
        const gameRef = doc(db, "activeGames", state.gameId);
        let gameDoc = await getDoc(gameRef);

        if (!gameDoc.exists()) {
            const pastGameRef = doc(db, "pastGames", state.gameId);
            gameDoc = await getDoc(pastGameRef);
            
            if (!gameDoc.exists()) {
                state.gameId = null;
                window.history.pushState({}, '', window.location.pathname);
                showView('home'); 
                showMessage("Game Not Found", "The game link is broken or doesn't exist.");
                return;
            }
        }

        const gameData = gameDoc.data();
        state.currentGameData = gameData; // Ensure we store it

        // Check if the game is already over
        if (gameData.winner) {
            showMessage("Game Over", `This game has already been won by ${gameData.winner}.`);
            
            // Clean up the active game from the user's list
            if (state.currentUser) {
                const userDocRef = doc(db, "users", state.currentUser.uid);
                await updateDoc(userDocRef, {
                    activeGames: arrayRemove(state.gameId)
                });
            }
            
            // Go back to the home screen
            state.gameId = null;
            window.history.pushState({}, '', window.location.pathname);
            showView('home');
            return; // Stop the join process
        }

        listenForGameUpdates(state.gameId);
        listenForPlayerUpdates(state.gameId);
        
        ui.playerNameDisplay.textContent = pName;
        ui.gameIdDisplay.textContent = state.gameId;

        const playerRef = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
        const playerDoc = await getDoc(playerRef);

        if (gameData.mode === 'social') {
            if (playerDoc.exists()) {
                await updateDoc(playerRef, { playerName: pName });
            } else {
                const initialMarkedCells = Array(5).fill("FFFFF");
                await setDoc(playerRef, {
                    playerName: pName,
                    customBoard: null,
                    markedCells: initialMarkedCells,
                    isReady: false,
                    score: 0
                });
            }
            ui.boardGridContainer.className = "grid grid-cols-1 lg:grid-cols-[200px_1fr_256px] gap-8 h-full";
            import('./social.js').then(s => s.initSocialGameFlow(gameData, playerDoc.exists() ? playerDoc.data() : null));
        } else {
            if (playerDoc.exists()) {
                await updateDoc(playerRef, { playerName: pName });
                if (gameData.mode === 'phrase' && gameData.votingEnabled) {
                    ui.boardGridContainer.className = "grid grid-cols-1 lg:grid-cols-[220px_200px_1fr_256px] gap-8 h-full";
                    import('./social.js').then(s => s.initSocialGameFlow(gameData, playerDoc.data()));
                } else {
                    ui.boardGridContainer.className = "grid grid-cols-1 lg:grid-cols-[200px_1fr_256px] gap-8 h-full";
                    renderBingoCard(JSON.parse(playerDoc.data().card), playerDoc.data().markedCells, toggleCell, gameData);
                    showView('board');
                }
            } else {
                const newCard = generateBingoCard(gameData.allPhrases);
                const initialMarkedCells = Array(5).fill("FFFFF");
                
                if (gameData.mode === 'phrase' && gameData.votingEnabled) {
                    let index = 0;
                    const customBoard = [];
                    for (let row = 0; row < 5; row++) {
                        for (let col = 0; col < 5; col++) {
                            customBoard.push({
                                id: `sq_${index++}`,
                                text: newCard[row][col],
                                state: 'draft',
                                row,
                                col
                            });
                        }
                    }
                    const newPlayerData = {
                        playerName: pName,
                        customBoard: customBoard,
                        markedCells: initialMarkedCells,
                        isReady: true,
                        score: 0
                    };
                    await setDoc(playerRef, newPlayerData);
                    
                    ui.boardGridContainer.className = "grid grid-cols-1 lg:grid-cols-[220px_200px_1fr_256px] gap-8 h-full";
                    import('./social.js').then(s => s.initSocialGameFlow(gameData, newPlayerData));
                } else {
                    await setDoc(playerRef, {
                        playerName: pName,
                        card: JSON.stringify(newCard),
                        markedCells: initialMarkedCells,
                        score: 0
                    });
                    ui.boardGridContainer.className = "grid grid-cols-1 lg:grid-cols-[200px_1fr_256px] gap-8 h-full";
                    renderBingoCard(newCard, initialMarkedCells, toggleCell, gameData);
                    showView('board');
                }
            }
        }

        if (state.currentUser) {
            const userDocRef = doc(db, "users", state.currentUser.uid);
            await updateDoc(userDocRef, { activeGames: arrayUnion(state.gameId) });
        }
        
    } catch (error) {
        console.error("Error joining game:", error);
        state.gameId = null;
        window.history.pushState({}, '', window.location.pathname);
        showView('home');
    }
}

export function generateBingoCard(phrases) {
    const shuffled = [...phrases].sort(() => 0.5 - Math.random());
    const cardPhrases = shuffled.slice(0, 25);
    const card = [];
    for (let i = 0; i < 5; i++) {
        card.push(cardPhrases.slice(i * 5, i * 5 + 5));
    }
    return card;
}

export function calculateScore(markedCells) {
    let markedCount = 0;
    let connectionCount = 0;
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            if (markedCells[r][c] === 'T') {
                markedCount++;
                if (c < 4 && markedCells[r][c + 1] === 'T') connectionCount++;
                if (r < 4 && markedCells[r + 1][c] === 'T') connectionCount++;
            }
        }
    }
    return (markedCount * 100) + (connectionCount * 50);
}

export async function toggleCell(row, col) {
    try {
        const playerRef = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
        const gameRef = doc(db, "activeGames", state.gameId);
        
        await runTransaction(db, async (transaction) => {
            const playerDoc = await transaction.get(playerRef);
            const gameDoc = await transaction.get(gameRef);
            if (!playerDoc.exists()) throw "Player not found";
            if (!gameDoc.exists()) throw "Game not found";

            const gameData = gameDoc.data();
            const card = JSON.parse(playerDoc.data().card);
            const phrase = card[row][col];

            const oldMarkedCells = playerDoc.data().markedCells;
            const isCurrentlyMarked = oldMarkedCells[row][col] === 'T';
            
            if (gameData.mode === 'classic' && !isCurrentlyMarked) {
                if (!gameData.drawnItems || !gameData.drawnItems.includes(phrase)) {
                    throw "Tile has not been drawn yet!";
                }
            }

            const oldBoardScore = calculateScore(oldMarkedCells);

            let markedCells = [...oldMarkedCells];
            const rowArr = markedCells[row].split('');
            rowArr[col] = isCurrentlyMarked ? 'F' : 'T';
            markedCells[row] = rowArr.join('');

            const newBoardScore = calculateScore(markedCells);
            const scoreDelta = newBoardScore - oldBoardScore;
            
            const currentTotalScore = playerDoc.data().score || 0;
            transaction.update(playerRef, { 
                markedCells, 
                score: currentTotalScore + scoreDelta 
            });
        });

    } catch (error) {
        console.error("Error updating cell:", error);
        if (typeof error === 'string') {
            showMessage("Invalid Move", error);
        } else {
            showMessage("Sync Error", "Could not save your last move.");
        }
        
        // Revert cell back from loading state by re-rendering
        if (state.playerId && state.gameId) {
            const playerRef = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
            getDoc(playerRef).then(pDoc => {
                if (pDoc.exists()) {
                    renderBingoCard(JSON.parse(pDoc.data().card), pDoc.data().markedCells, toggleCell, state.currentGameData);
                }
            });
        }
    }
}

export async function checkBingo() {
    const gameRef = doc(db, "activeGames", state.gameId);
    
    // Check if the game is already over before proceeding
    const initialGameDoc = await getDoc(gameRef);
    if (!initialGameDoc.exists() || initialGameDoc.data().winner) {
        showMessage("Game Over", "This game has already ended!");
        return;
    }

    // Disable the button to prevent double-clicks/spamming
    if (ui.bingoBtn) {
        ui.bingoBtn.disabled = true;
        ui.bingoBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    const playerRef = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
    const playerDoc = await getDoc(playerRef);
    
    if (!playerDoc.exists()) {
        if (ui.bingoBtn) {
            ui.bingoBtn.disabled = false;
            ui.bingoBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        return;
    }

    const playerData = playerDoc.data();
    const markedCells = playerData.markedCells;
    let hasBingo = false;

    for (let i = 0; i < 5; i++) {
        if (markedCells[i] === "TTTTT" || markedCells.every(row => row[i] === 'T')) {
            hasBingo = true;
            break;
        }
    }
    if (!hasBingo) {
        if (markedCells.every((r, i) => r[i] === 'T') || markedCells.every((r, i) => r[4 - i] === 'T')) {
             hasBingo = true;
        }
    }
    
        if (hasBingo) {
        const playerRefForBonus = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
        await runTransaction(db, async (transaction) => {
            const freshPlayerDoc = await transaction.get(playerRefForBonus);
            const currentScore = freshPlayerDoc.data().score || 0;
            transaction.update(playerRefForBonus, { score: currentScore + 1000 });
        });
        
        const allPlayersSnapshot = await getDocs(collection(db, `activeGames/${state.gameId}/players`));
        let highestScore = -1;
        let winner = { name: "No one", id: null };

        allPlayersSnapshot.forEach(docSnap => {
            const pData = docSnap.data();
            if ((pData.score || 0) > highestScore) {
                highestScore = pData.score;
                winner.name = pData.playerName;
                winner.id = docSnap.id;
            }
        });

        let winRecorded = false;
        await runTransaction(db, async (transaction) => {
            const gameRefForWin = doc(db, "activeGames", state.gameId);
            const gDoc = await transaction.get(gameRefForWin);
            if (!gDoc.data().winner) {
                transaction.update(gameRefForWin, { winner: winner.name });
                winRecorded = true;
            }
        });

        if (winRecorded) {
            await cleanupEndedGame(state.gameId);
        }
    } else {
        // Re-enable the button if it wasn't a valid bingo
        if (ui.bingoBtn) {
            ui.bingoBtn.disabled = false;
            ui.bingoBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        showMessage("Not a Bingo!", "You don't have a valid 5-in-a-row.");
    }
}

export async function cleanupEndedGame(endedGameId) {
    if (storage) {
        try {
            const claimsFolderRef = ref(storage, `activeGames/${endedGameId}/claims`);
            const fileList = await listAll(claimsFolderRef);
            const deletePromises = fileList.items.map(fileRef => deleteObject(fileRef));
            await Promise.all(deletePromises);
        } catch (e) {
            console.warn("Storage cleanup failed or no files to delete:", e);
        }
    }

    const gameRef = doc(db, "activeGames", endedGameId);
    const gameDoc = await getDoc(gameRef);
    let gameData = null;
    if (gameDoc.exists()) {
        gameData = gameDoc.data();
    }

    const playersSnapshot = await getDocs(collection(db, `activeGames/${endedGameId}/players`));
    const playersData = [];
    
    const playerPromises = playersSnapshot.docs.map(async (playerDoc) => {
        const pId = playerDoc.id;
        const pData = playerDoc.data();
        
        playersData.push({
            id: pId,
            playerName: pData.playerName || "Unknown",
            score: pData.score || 0
        });

        const userDocRef = doc(db, "users", pId);
        try {
            await runTransaction(db, async (transaction) => {
                const userDoc = await transaction.get(userDocRef);
                if (!userDoc.exists()) return;
                
                const userData = userDoc.data();
                const stats = userData.stats || { gamesPlayed: 0, gamesWon: 0, totalScore: 0, modesPlayed: {} };
                
                stats.gamesPlayed++;
                if (pData.playerName === gameData.winner) stats.gamesWon++;
                stats.totalScore += (pData.score || 0);
                const mode = gameData.mode || 'unknown';
                stats.modesPlayed[mode] = (stats.modesPlayed[mode] || 0) + 1;
                
                transaction.update(userDocRef, {
                    activeGames: arrayRemove(endedGameId),
                    stats: stats
                });
            });
        } catch (error) {
            // Expected for guests
        }

        try {
            await deleteDoc(doc(db, `activeGames/${endedGameId}/players`, pId));
        } catch (error) {
            console.warn("Could not delete player doc", error);
        }
    });

    await Promise.all(playerPromises);

    if (gameData) {
        try {
            const pastGameRef = doc(db, "pastGames", endedGameId);
            await setDoc(pastGameRef, {
                ...gameData,
                archivedAt: serverTimestamp(),
                participants: playersData
            });

            await deleteDoc(gameRef);
        } catch (error) {
            console.error("Error archiving game:", error);
        }
    }
}

export function listenForLeaderboardUpdates() {
    if (!ui.leaderboard) return; 
    const q = query(collection(db, "users"), orderBy("stats.gamesWon", "desc"));
    state.unsubscribe.leaderboard = onSnapshot(q, (querySnapshot) => {
        if (!ui.leaderboard) return;
        const players = [];
        querySnapshot.forEach((userDoc) => {
            const data = userDoc.data();
            if (data.stats && data.stats.gamesWon > 0) {
                players.push({ id: userDoc.id, displayName: data.displayName, wins: data.stats.gamesWon });
            }
        });
        state.leaderboardData = players;
        renderLeaderboard();
    });
}

export function renderLeaderboard() {
    if (!ui.leaderboard) return;
    ui.leaderboard.innerHTML = '';
    
    let players = state.leaderboardData;
    
    if (state.leaderboardMode === 'friends') {
        const friendsList = state.friendsList || [];
        const currentUserId = state.currentUser ? state.currentUser.uid : null;
        players = players.filter(p => friendsList.includes(p.id) || p.id === currentUserId);
    }
    
    if (players.length === 0) {
        ui.leaderboard.innerHTML = '<p class="text-gray-500 text-center py-4">No winners yet!</p>';
        return;
    }

    const fragment = document.createDocumentFragment();
    players.forEach(player => {
        const entry = document.createElement('div');
        entry.className = 'leaderboard-entry';
        const nameEl = document.createElement('span');
        nameEl.className = 'leaderboard-name';
        nameEl.textContent = player.displayName;
        const scoreEl = document.createElement('span');
        scoreEl.className = 'leaderboard-score';
        scoreEl.textContent = player.wins;
        entry.appendChild(nameEl);
        entry.appendChild(scoreEl);
        fragment.appendChild(entry);
    });
    ui.leaderboard.appendChild(fragment);
}

export function listenForRecentGames() {
    if (!ui.recentGames) return; 
    const q = query(collection(db, "activeGames"), orderBy("createdAt", "desc"), limit(5));
    onSnapshot(q, (snapshot) => {
        if (!ui.recentGames) return;
        ui.recentGames.innerHTML = '';
        if (snapshot.empty) {
            ui.recentGames.innerHTML = '<p class="text-gray-500 text-center py-4">No recent games found.</p>';
            return;
        }
        const fragment = document.createDocumentFragment();
        snapshot.forEach((gameDoc) => {
            const gameData = gameDoc.data();
            const entry = document.createElement('div');
            entry.className = 'bg-gray-700 p-3 rounded-md mb-2 flex justify-between items-center';
            const dateEl = document.createElement('span');
            dateEl.className = 'text-sm text-gray-400';
            dateEl.textContent = gameData.createdAt?.toDate().toLocaleDateString() || 'Recent Game';
            const useBtn = document.createElement('button');
            useBtn.className = 'bg-blue-600 text-white text-xs font-bold py-1 px-3 rounded hover:bg-blue-700';
            useBtn.textContent = 'Use';
            useBtn.onclick = () => {
                ui.phrasesInput.value = gameData.allPhrases.join('\n');
                if(gameData.rarePhrases) {
                    ui.rarePhrasesInput.value = gameData.rarePhrases.map(p => p.text).join('\n');
                }
                updatePhraseCount();
                window.scrollTo(0, 0); 
            };
            entry.appendChild(dateEl);
            entry.appendChild(useBtn);
            fragment.appendChild(entry);
        });
        ui.recentGames.appendChild(fragment);
    }, (error) => {
        console.error("Error fetching recent games:", error);
        if (ui.recentGames) {
            ui.recentGames.innerHTML = '<p class="text-red-500 text-center py-4">Could not load games.</p>';
        }
    });
}

export function listenForGameUpdates(id) {
    state.unsubscribe.game = onSnapshot(doc(db, "activeGames", id), (gameSnapshot) => {
        if (!gameSnapshot.exists()) return;
        const gameData = gameSnapshot.data();
        state.currentGameData = gameData;
        if (gameData.winner) {
            if (ui.winnerModal.classList.contains('hidden')) {
                renderWinnerModal(gameData.winner);
            }
            if (state.unsubscribe.players) {
                state.unsubscribe.players();
                state.unsubscribe.players = null;
            }
        }
        
        if (gameData.mode === 'social') {
            const playerRef = doc(db, `activeGames/${id}/players`, state.playerId);
            getDoc(playerRef).then(pDoc => {
                if (pDoc.exists()) {
                    import('./social.js').then(s => s.initSocialGameFlow(gameData, pDoc.data()));
                }
            });
        } else if (gameData.mode === 'classic') {
            renderCallerUI(gameData, state.playerId);
            // Re-render bingo card to reflect potentially newly drawn items
            const playerRef = doc(db, `activeGames/${id}/players`, state.playerId);
            getDoc(playerRef).then(pDoc => {
                if (pDoc.exists()) {
                    renderBingoCard(JSON.parse(pDoc.data().card), pDoc.data().markedCells, toggleCell, gameData);
                }
            });
        } else if (gameData.rarePhrases) {
            import('./jury.js').then(j => {
                const onClaim = gameData.votingEnabled ? (idx) => j.openEvidenceModal(idx, true) : claimRarePhrase;
                const onUnclaim = gameData.votingEnabled ? null : unclaimRarePhrase;
                renderRarePhrases(gameData.rarePhrases, state.playerId, onClaim, onUnclaim, gameData.votingEnabled);
            });
        }
        
        // Re-render player progress to reflect potential manager promotions
        if (state.currentPlayers && state.currentPlayers.length > 0) {
            renderPlayerProgress(state.currentPlayers, state.playerId, gameData);
        }
    });
}

export function listenForPlayerUpdates(id) {
    let lastMarkedCellsStr = null;
    state.unsubscribe.players = onSnapshot(query(collection(db, `activeGames/${id}/players`)), (snapshot) => {
        const players = [];
        snapshot.forEach((playerDoc) => {
            players.push({ id: playerDoc.id, ...playerDoc.data() });
        });

        state.currentPlayers = players;
        renderPlayerProgress(players, state.playerId, state.currentGameData);

        const currentPlayer = players.find(p => p.id === state.playerId);
        if (currentPlayer && state.currentGameData) {
            const isSocialLogic = state.currentGameData.mode === 'social' || (state.currentGameData.mode === 'phrase' && state.currentGameData.votingEnabled);
            
            if (!isSocialLogic) {
                const markedCellsData = currentPlayer.markedCells;
                if (markedCellsData) {
                    const currentMarkedCellsStr = markedCellsData.join('');
                    if (lastMarkedCellsStr !== currentMarkedCellsStr) {
                        lastMarkedCellsStr = currentMarkedCellsStr;
                        const cardData = JSON.parse(currentPlayer.card);
                        renderBingoCard(cardData, markedCellsData, toggleCell, state.currentGameData);
                    }
                }
            } else if (state.currentGameData.phase === 'active') {
                import('./social.js').then(s => s.renderSocialBoard(currentPlayer));
                // Update lobby if in drafting phase
            } else if (state.currentGameData.phase === 'drafting') {
                 import('./social.js').then(s => s.updateLobbyUI());
            }
        }
    });
}

export async function claimRarePhrase(index) {
    try {
        await runTransaction(db, async (transaction) => {
            const gameRef = doc(db, "activeGames", state.gameId);
            const playerRef = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
            const gameDoc = await transaction.get(gameRef);
            const playerDoc = await transaction.get(playerRef);
            if (!gameDoc.exists() || !playerDoc.exists()) throw "Game or player not found.";
            const gameData = gameDoc.data();
            const playerData = playerDoc.data();
            if (gameData.rarePhrases[index].claimedBy === null) {
                const updatedRarePhrases = [...gameData.rarePhrases];
                updatedRarePhrases[index] = { ...updatedRarePhrases[index], claimedBy: state.playerId, claimedByName: playerData.playerName };
                const newScore = (playerData.score || 0) + 300;
                transaction.update(gameRef, { rarePhrases: updatedRarePhrases });
                transaction.update(playerRef, { score: newScore });
            } else {
                showMessage("Too Late!", "Someone else just claimed that rare phrase.");
            }
        });
    } catch (error) {
        console.error("Failed to claim rare phrase:", error);
        showMessage("Error", "Could not claim the phrase. Please try again.");
    }
}

export async function unclaimRarePhrase(index) {
    try {
        await runTransaction(db, async (transaction) => {
            const gameRef = doc(db, "activeGames", state.gameId);
            const playerRef = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
            const gameDoc = await transaction.get(gameRef);
            const playerDoc = await transaction.get(playerRef);
            if (!gameDoc.exists() || !playerDoc.exists()) throw "Game or player not found.";
            const gameData = gameDoc.data();
            const playerData = playerDoc.data();
            if (gameData.rarePhrases[index].claimedBy === state.playerId) {
                const updatedRarePhrases = [...gameData.rarePhrases];
                updatedRarePhrases[index] = { ...updatedRarePhrases[index], claimedBy: null, claimedByName: null };
                const newScore = (playerData.score || 0) - 300;
                transaction.update(gameRef, { rarePhrases: updatedRarePhrases });
                transaction.update(playerRef, { score: newScore });
            }
        });
    } catch (error) {
        console.error("Failed to unclaim rare phrase:", error);
        showMessage("Error", "Could not unclaim the phrase. Please try again.");
    }
}

export function listenForUserUpdates(uid) {
    const userDocRef = doc(db, "users", uid);
    state.unsubscribe.gameUser = onSnapshot(userDocRef, (userDoc) => {
        if (userDoc.exists()) {
            if (state.currentUser) {
                state.currentUser.activeGames = userDoc.data().activeGames || [];
            }
            renderActiveGamesList(userDoc.data().activeGames || []);
        }
    });
}

export async function drawNextItem() {
    try {
        const gameRef = doc(db, "activeGames", state.gameId);
        await runTransaction(db, async (transaction) => {
            const gameDoc = await transaction.get(gameRef);
            if (!gameDoc.exists()) throw "Game not found";
            
            const gameData = gameDoc.data();
            if (!gameData.managers || !gameData.managers.includes(state.playerId)) throw "Not authorized";
            
            let remainingItems = gameData.remainingItems || [];
            let drawnItems = gameData.drawnItems || [];
            
            if (remainingItems.length === 0) throw "No more items to draw!";
            
            const nextItem = remainingItems.pop();
            drawnItems.push(nextItem);
            
            transaction.update(gameRef, {
                remainingItems,
                drawnItems
            });
        });
    } catch (error) {
        console.error("Error drawing item:", error);
        if (typeof error === 'string') showMessage("Error", error);
    }
}

export async function promoteManager(targetPlayerId) {
    try {
        const gameRef = doc(db, "activeGames", state.gameId);
        await runTransaction(db, async (transaction) => {
            const gameDoc = await transaction.get(gameRef);
            if (!gameDoc.exists()) throw "Game not found";
            
            const gameData = gameDoc.data();
            if (!gameData.managers || !gameData.managers.includes(state.playerId)) throw "Not authorized";
            
            let managers = gameData.managers || [];
            if (!managers.includes(targetPlayerId)) {
                managers.push(targetPlayerId);
                transaction.update(gameRef, { managers });
            }
        });
    } catch (error) {
        console.error("Error promoting manager:", error);
        if (typeof error === 'string') showMessage("Error", error);
    }
}

export async function demoteManager(targetPlayerId) {
    try {
        const gameRef = doc(db, "activeGames", state.gameId);
        await runTransaction(db, async (transaction) => {
            const gameDoc = await transaction.get(gameRef);
            if (!gameDoc.exists()) throw "Game not found";
            
            const gameData = gameDoc.data();
            if (!gameData.managers || !gameData.managers.includes(state.playerId)) throw "Not authorized";
            if (targetPlayerId === gameData.creatorId) throw "Cannot demote the game creator";
            
            let managers = gameData.managers || [];
            if (managers.includes(targetPlayerId)) {
                managers = managers.filter(id => id !== targetPlayerId);
                transaction.update(gameRef, { managers });
            }
        });
    } catch (error) {
        console.error("Error demoting manager:", error);
        if (typeof error === 'string') showMessage("Error", error);
    }
}
