import { db } from './firebase.js';
import { doc, updateDoc, getDocs, collection, onSnapshot, query, where, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ui, showMessage, showView } from './ui.js';
import { state } from './script.js';

let viewingBoardIndex = 0;
let readyPlayersForReview = [];

export function initSocialGameFlow(gameData, playerData) {
    if (gameData.phase === 'drafting') {
        const hasDrafted = playerData && playerData.customBoard;
        
        if (hasDrafted) {
            const hasVetoes = playerData.customBoard.some(sq => sq.state === 'vetoed');
            if (hasVetoes || !playerData.isReady) {
                renderDraftBoard(playerData.customBoard);
            } else {
                updateLobbyUI();
            }
        } else {
            renderDraftBoard();
        }
    } else if (gameData.phase === 'active') {
        showView('board');
        
        if (ui.boardColClaims) {
            ui.boardColClaims.classList.remove('hidden');
            ui.boardColClaims.classList.add('flex');
        }
        ui.activeClaimsSection.classList.remove('hidden');
        
        if (gameData.mode === 'phrase' && gameData.votingEnabled) {
            if (ui.boardColRare) ui.boardColRare.classList.remove('hidden');
            if (ui.rarePhrasesSection) {
                ui.rarePhrasesSection.classList.remove('hidden');
                ui.rarePhrasesSection.classList.add('flex');
            }
        } else {
            if (ui.boardColRare) ui.boardColRare.classList.add('hidden');
            if (ui.rarePhrasesSection) {
                ui.rarePhrasesSection.classList.add('hidden');
                ui.rarePhrasesSection.classList.remove('flex');
            }
        }
        
        renderSocialBoard(playerData);
        import('./jury.js').then(j => j.listenForClaims());
    }
}

export function updateLobbyUI() {
    if (state.currentGameData && state.currentGameData.phase === 'drafting') {
        showView('lobby');
        
        const players = state.currentPlayers || [];
        readyPlayersForReview = players.filter(p => p.isReady && p.id !== state.playerId);
        
        renderLobbyPlayersList(players, state.currentGameData);
        renderAnonymousBoardReview();
    }
}

function renderLobbyPlayersList(players, gameData) {
    if (!ui.lobbyPlayersList) return;
    ui.lobbyPlayersList.innerHTML = '';
    
    const isManager = gameData.managers && gameData.managers.includes(state.playerId);
    if (isManager) {
        ui.managerControls.classList.remove('hidden');
    } else {
        ui.managerControls.classList.add('hidden');
    }

    players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center bg-gray-700 p-2 rounded';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.playerName;
        
        const statusSpan = document.createElement('span');
        if (p.isReady) {
            statusSpan.textContent = 'Ready';
            statusSpan.className = 'text-green-400 text-sm font-bold';
        } else {
            const hasVetoes = p.customBoard && p.customBoard.some(sq => sq.state === 'vetoed');
            statusSpan.textContent = hasVetoes ? 'Revising Vetoes' : 'Drafting...';
            statusSpan.className = 'text-yellow-400 text-sm';
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'flex gap-2 items-center';
        infoDiv.appendChild(statusSpan);

        if (isManager && p.id !== state.playerId) {
            const kickBtn = document.createElement('button');
            kickBtn.textContent = 'Kick';
            kickBtn.className = 'text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700';
            kickBtn.onclick = () => kickPlayer(p.id);
            infoDiv.appendChild(kickBtn);
        }

        div.appendChild(nameSpan);
        div.appendChild(infoDiv);
        ui.lobbyPlayersList.appendChild(div);
    });

    const allReady = players.every(p => p.isReady);
    if (ui.forceStartBtn) {
        if (allReady && players.length > 0) {
            ui.forceStartBtn.textContent = "Start Game";
            ui.forceStartBtn.classList.remove('bg-yellow-600');
            ui.forceStartBtn.classList.add('bg-green-600');
        } else {
            ui.forceStartBtn.textContent = "Force Start Game";
            ui.forceStartBtn.classList.remove('bg-green-600');
            ui.forceStartBtn.classList.add('bg-yellow-600');
        }
    }
}

function renderAnonymousBoardReview() {
    if (!ui.vetoBoardContainer) return;
    
    if (readyPlayersForReview.length === 0) {
        ui.vetoBoardContainer.innerHTML = '<p class="col-span-5 text-center text-gray-400">No other players are ready yet.</p>';
        ui.currentBoardLabel.textContent = 'Board 0 of 0';
        ui.prevBoardBtn.disabled = true;
        ui.nextBoardBtn.disabled = true;
        return;
    }

    if (viewingBoardIndex >= readyPlayersForReview.length) viewingBoardIndex = 0;
    if (viewingBoardIndex < 0) viewingBoardIndex = readyPlayersForReview.length - 1;

    const targetPlayer = readyPlayersForReview[viewingBoardIndex];
    ui.currentBoardLabel.textContent = `Board ${viewingBoardIndex + 1} of ${readyPlayersForReview.length}`;
    ui.prevBoardBtn.disabled = readyPlayersForReview.length <= 1;
    ui.nextBoardBtn.disabled = readyPlayersForReview.length <= 1;

    ui.vetoBoardContainer.innerHTML = '';
    
    targetPlayer.customBoard.forEach((sq, idx) => {
        const sqDiv = document.createElement('div');
        sqDiv.className = 'bg-gray-700 p-3 rounded flex flex-col justify-between min-h-[6rem] h-auto text-sm';
        
        const pEl = document.createElement('p');
        pEl.textContent = sq.text;
        pEl.className = 'text-gray-200 mb-2';
        sqDiv.appendChild(pEl);

        const btnContainer = document.createElement('div');
        btnContainer.className = 'mt-2 text-right';

        if (sq.state === 'vetoed') {
            const vSpan = document.createElement('span');
            vSpan.textContent = 'VETOED';
            vSpan.className = 'text-xs font-bold text-red-500';
            btnContainer.appendChild(vSpan);
            sqDiv.classList.add('border-2', 'border-red-500');
        } else {
            const vetoBtn = document.createElement('button');
            vetoBtn.textContent = 'Veto';
            vetoBtn.className = 'text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded';
            vetoBtn.onclick = () => submitVeto(targetPlayer.id, idx);
            btnContainer.appendChild(vetoBtn);
        }

        sqDiv.appendChild(btnContainer);
        ui.vetoBoardContainer.appendChild(sqDiv);
    });
}

export function handlePrevBoard() {
    viewingBoardIndex--;
    renderAnonymousBoardReview();
}

export function handleNextBoard() {
    viewingBoardIndex++;
    renderAnonymousBoardReview();
}

export async function submitVeto(targetPlayerId, squareIndex) {
    try {
        const pRef = doc(db, `activeGames/${state.gameId}/players`, targetPlayerId);
        const pDoc = await getDocs(collection(db, `activeGames/${state.gameId}/players`)); 
        // need target doc
        let targetDocData;
        pDoc.forEach(d => { if(d.id === targetPlayerId) targetDocData = d.data(); });

        if (!targetDocData) return;

        const updatedBoard = [...targetDocData.customBoard];
        updatedBoard[squareIndex].vetoCount = (updatedBoard[squareIndex].vetoCount || 0) + 1;
        
        // Simple threshold: 1 veto is enough to flag it. (Can be adjusted)
        updatedBoard[squareIndex].state = 'vetoed';

        await updateDoc(pRef, {
            customBoard: updatedBoard,
            isReady: false // Force them to rewrite
        });

        showMessage("Veto Cast", "Square has been flagged for revision.");
    } catch (e) {
        console.error("Veto failed", e);
    }
}

export async function forceStartGame() {
    try {
        const gameRef = doc(db, "activeGames", state.gameId);
        await updateDoc(gameRef, { phase: 'active' });
    } catch(e) {
        console.error(e);
    }
}

async function kickPlayer(playerId) {
    // Basic kick logic (in reality might need cloud function to fully clean up)
    // Here we could set a kicked flag
    showMessage("Not Implemented", "Kick player logic placeholder.");
}

export function renderDraftBoard(existingBoard = null) {
    ui.draftBoardContainer.innerHTML = '';
    
    let hasVetoes = false;

    for (let i = 0; i < 25; i++) {
        const existingSquare = existingBoard ? existingBoard[i] : null;
        const isVetoed = existingSquare && existingSquare.state === 'vetoed';
        if (isVetoed) hasVetoes = true;

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'relative w-full h-32';

        const input = document.createElement('textarea');
        input.className = `w-full h-full p-2 border ${isVetoed ? 'border-red-500 bg-red-900/30' : 'border-gray-600 bg-gray-700'} rounded-md text-sm draft-input`;
        input.placeholder = `Square ${i + 1} prediction...`;
        input.dataset.index = i;
        if (existingSquare) input.value = existingSquare.text;
        
        input.addEventListener('input', validateDrafting);
        
        inputWrapper.appendChild(input);

        if (isVetoed) {
            const vetoBadge = document.createElement('span');
            vetoBadge.textContent = 'Vetoed - Please Rewrite';
            vetoBadge.className = 'absolute -top-2 right-2 bg-red-600 text-white text-[10px] font-bold px-1 rounded';
            inputWrapper.appendChild(vetoBadge);
            
            // Allow them to clear veto state by typing
            input.addEventListener('input', () => {
                input.classList.remove('border-red-500', 'bg-red-900/30');
                input.classList.add('border-gray-600', 'bg-gray-700');
                if (vetoBadge.parentNode) vetoBadge.parentNode.removeChild(vetoBadge);
            }, { once: true });
        }

        ui.draftBoardContainer.appendChild(inputWrapper);
    }
    
    ui.submitDraftBtn.classList.remove('hidden');
    ui.submitDraftBtn.textContent = hasVetoes ? 'Resubmit Board' : 'Submit Board & Ready Up';
    
    validateDrafting();
    showView('draft');
}

export function validateDrafting() {
    const inputs = document.querySelectorAll('.draft-input');
    let filledCount = 0;
    let multiConditionCount = 0;
    
    const multiConditionRegex = /\band\b|(?:^|\s)ו/i;

    inputs.forEach(input => {
        const val = input.value.trim();
        if (val.length > 0) {
            filledCount++;
            if (multiConditionRegex.test(val)) {
                multiConditionCount++;
            }
        }
    });

    ui.multiConditionCount.textContent = `${multiConditionCount} / 5`;
    if (multiConditionCount >= 5) {
        ui.multiConditionCount.classList.remove('text-red-500');
        ui.multiConditionCount.classList.add('text-green-500');
    } else {
        ui.multiConditionCount.classList.add('text-red-500');
        ui.multiConditionCount.classList.remove('text-green-500');
    }

    if (filledCount === 25 && multiConditionCount >= 5) {
        ui.submitDraftBtn.disabled = false;
        ui.submitDraftBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        ui.draftErrorMsg.textContent = '';
    } else {
        ui.submitDraftBtn.disabled = true;
        ui.submitDraftBtn.classList.add('opacity-50', 'cursor-not-allowed');
        if (filledCount < 25) {
            ui.draftErrorMsg.textContent = 'Please fill all 25 squares.';
        } else {
            ui.draftErrorMsg.textContent = 'Need at least 5 multi-condition squares (using "and" or "ו").';
        }
    }
}
export async function submitDraftBoard() {
    const inputs = document.querySelectorAll('.draft-input');
    const customBoard = [];
    
    const multiConditionRegex = /\band\b|(?:^|\s)ו/i;

    inputs.forEach((input, index) => {
        const val = input.value.trim();
        const row = Math.floor(index / 5);
        const col = index % 5;
        customBoard.push({
            id: `sq_${index}`,
            row: row,
            col: col,
            text: val,
            state: 'draft',
            vetoCount: 0,
            appealCount: 0,
            isMultiCondition: multiConditionRegex.test(val)
        });
    });

    ui.submitDraftBtn.disabled = true;
    ui.submitDraftBtn.innerHTML = `<div class="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mx-auto"></div>`;

    try {
        const playerRef = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
        await updateDoc(playerRef, {
            customBoard: customBoard,
            isReady: true
        });
        
    } catch (e) {
        console.error("Error submitting draft:", e);
        showMessage("Error", "Could not submit your draft. Try again.");
        ui.submitDraftBtn.disabled = false;
        ui.submitDraftBtn.textContent = "Submit Board & Ready Up";
    }
}

export function renderSocialBoard(playerData) {
    if (!playerData.customBoard) return;
    
    ui.bingoCardContainer.innerHTML = "";
    
    playerData.customBoard.forEach((sq, idx) => {
        const cell = document.createElement("div");
        cell.className = "bingo-cell bg-gray-700 text-gray-200 text-xs sm:text-sm p-1";
        
        let bgColor = "bg-gray-700";
        if (sq.state === 'claimed') bgColor = "bg-green-600 text-white";
        if (sq.state === 'pending_claim') bgColor = "bg-yellow-600 text-white";
        if (sq.state === 'denied') bgColor = "bg-red-900 text-white opacity-80";
        if (sq.state === 'locked_failed') bgColor = "bg-black text-gray-500 line-through opacity-50 cursor-not-allowed";

        cell.className = `bingo-cell social-cell ${bgColor} hover:opacity-80 transition`;
        cell.textContent = sq.text;
        
        cell.onclick = () => {
            if (sq.state === 'draft' || sq.state === 'denied') {
                import('./jury.js').then(j => j.openEvidenceModal(idx));
            } else if (sq.state === 'locked_failed') {
                showMessage("Locked", "You have exhausted your 3 appeals for this square.");
            } else if (sq.state === 'pending_claim' || sq.state === 'claimed') {
                import('./jury.js').then(j => j.showClaimStats(idx, sq));
            }
        };

        ui.bingoCardContainer.appendChild(cell);
    });
}
