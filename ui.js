import { state } from './script.js';
import { updateWabbaContext } from './wabba.js?v=widget-20260915-4';
import { db, storage } from './firebase.js';
import { doc, getDoc, updateDoc, arrayRemove, deleteDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, listAll, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

export const ui = {};

export function assignUIElements() {
    const ids = [
        'app', 'auth-container', 'user-info', 'user-display-name', 'logout-btn', 'login-register-buttons', 
        'login-btn-nav', 'register-btn-nav', 'auth-modal', 'friend-requests-btn', 'friend-requests-count', 
        'friend-requests-modal', 'phrases-input', 'phrase-count', 'error-message', 
        'create-game-btn', 'game-link-input', 'copy-link-btn', 'go-to-my-card-btn', 
        'bingo-card-container', 'player-name-display', 'player-score-display', 'bingo-btn', 
        'winner-modal', 'message-modal', 'leaderboard', 'recent-games', 'live-players-container', 
        'rare-phrases-input', 'rare-phrase-count', 'rare-phrases-container', 
        'active-games-container', 'active-games-list', 'join-by-id-input', 'join-by-id-btn', 'friends-list',
        'go-to-create-btn', 'go-to-join-btn', 'home-game-view', 'mode-game-view', 'select-phrase-bingo-btn', 'create-game-view', 'join-game-view', 
        'link-game-view', 'board-game-view', 'loading-spinner', 'game-id-display', 'copy-game-id-btn',
        'friend-search-input', 'friend-search-btn', 'friend-search-results', 'leaderboard-panel', 'friends-panel',
        'leaderboard-tab-btn', 'friends-tab-btn', 'invite-modal', 'game-invites-btn', 'game-invites-count',
        'game-invites-modal', 'profile-modal', 'page-title', 'back-to-home-btn', 'game-invites-container', 'game-invites-list',
        'global-leaderboard-btn', 'friends-leaderboard-btn', 'select-classic-bingo-btn', 'select-social-bingo-btn', 'rare-phrases-input-container',
        'rare-phrases-section', 'caller-ui-section', 'current-draw-display', 'draw-next-btn', 'previous-draws-container',
        'score-display-wrapper', 'common-phrases-input-container', 'draft-game-view', 'draft-board-container',
        'submit-draft-btn', 'multi-condition-count', 'draft-error-msg', 'lobby-game-view', 'manager-controls',
        'force-start-btn', 'lobby-players-list', 'prev-board-btn', 'current-board-label', 'next-board-btn', 'veto-board-container',
        'evidence-modal', 'evidence-square-text', 'evidence-input', 'submit-evidence-btn', 'evidence-square-index', 'evidence-image-input',
        'active-claims-section', 'active-claims-list', 'social-mode-explanation', 'board-grid-container', 'board-col-claims', 'board-col-rare'
    ];

    ids.forEach(id => {
        const key = id.replace(/-(\w)/g, (_, c) => c.toUpperCase());
        ui[key] = document.getElementById(id);
    });
}

export function showMessage(title, text) {
    ui.messageModal.innerHTML = `
        <div class="modal-content bg-gray-800 text-center">
            <h2 class="text-2xl font-bold text-gray-100 mb-4">${title}</h2>
            <p class="text-lg text-gray-300">${text}</p>
            <button data-action="close" class="mt-6 bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">OK</button>
        </div>`;
    ui.messageModal.classList.remove('hidden');
}

export function showConfirm(title, text) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop bg-black bg-opacity-70';
        modal.innerHTML = `
            <div class="modal-content bg-gray-800 text-center w-11/12 max-w-md">
                <h2 class="text-2xl font-bold text-gray-100 mb-4">${title}</h2>
                <p class="text-lg text-gray-300 mb-6">${text}</p>
                <div class="flex justify-center space-x-4 mt-2">
                    <button id="confirm-yes" class="bg-red-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-red-700">Yes, Abandon</button>
                    <button id="confirm-no" class="bg-gray-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-gray-700">Cancel</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        modal.querySelector('#confirm-yes').onclick = () => {
            modal.remove();
            resolve(true);
        };
        modal.querySelector('#confirm-no').onclick = () => {
            modal.remove();
            resolve(false);
        };
    });
}

export function updateAuthUI(isLoggedIn, currentUser) {
    if (isLoggedIn) {
        ui.userDisplayName.textContent = `${currentUser.displayName}`;
        ui.userInfo.classList.remove('hidden');
        ui.friendRequestsBtn.classList.remove('hidden');
        ui.gameInvitesBtn.classList.remove('hidden');
        ui.loginRegisterButtons.classList.add('hidden');
    } else {
        ui.userInfo.classList.add('hidden');
        ui.friendRequestsBtn.classList.add('hidden');
        ui.gameInvitesBtn.classList.add('hidden');
        ui.loginRegisterButtons.classList.remove('hidden');
    }
}

export function openAuthModal(isRegister) {
    ui.authModal.innerHTML = `
        <div class="modal-content bg-gray-800 text-left w-full max-w-sm relative">
            <h2 id="auth-modal-title" class="text-2xl font-bold text-gray-100 mb-4">Login</h2>
            <div class="space-y-4">
                <input id="auth-display-name" type="text" class="w-full p-3 border border-gray-600 rounded-md bg-gray-700" placeholder="Display Name">
                <input id="auth-email" type="email" class="w-full p-3 border border-gray-600 rounded-md bg-gray-700" placeholder="Email">
                <input id="auth-password" type="password" class="w-full p-3 border border-gray-600 rounded-md bg-gray-700" placeholder="Password">
            </div>
            <p id="auth-error" class="text-red-500 text-sm mt-2 h-5"></p>
            <button data-action="submit-auth" class="mt-4 w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Login</button>
            <p class="text-xs text-gray-400 mt-4 text-center">
                <span id="auth-toggle-text">Don't have an account?</span>
                <button data-action="toggle-auth-mode" class="text-blue-400 hover:underline">Register</button>
            </p>
            <button data-action="close" class="absolute top-2 right-2 text-gray-400 hover:text-white text-2xl font-bold">&times;</button>
        </div>`;
    ui.authModal.classList.remove('hidden');
    setupAuthModal(isRegister);
}


export function setupAuthModal(isRegister) {
    const authDisplayName = document.getElementById('auth-display-name');
    const authModalTitle = document.getElementById('auth-modal-title');
    const authSubmitBtn = document.querySelector('[data-action="submit-auth"]');
    const authToggleText = document.getElementById('auth-toggle-text');
    const authToggleBtn = document.querySelector('[data-action="toggle-auth-mode"]');
    
    authDisplayName.style.display = isRegister ? 'block' : 'none';
    authModalTitle.textContent = isRegister ? 'Register' : 'Login';
    authSubmitBtn.textContent = isRegister ? 'Register' : 'Login';
    authToggleText.textContent = isRegister ? 'Already have an account?' : "Don't have an account?";
    authToggleBtn.textContent = isRegister ? 'Login' : 'Register';
}


export function showView(view) {
    updateWabbaContext({ playing: ['board', 'link', 'draft', 'lobby'].includes(view) ||
        (view === 'loading' && Boolean(state.gameId)) });
    const viewIds = ['home-game-view', 'mode-game-view', 'create-game-view', 'link-game-view', 'join-game-view', 'board-game-view', 'draft-game-view', 'lobby-game-view', 'loading-spinner'];
    viewIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    ui.backToHomeBtn.classList.toggle('hidden', view === 'home');
    
    switch(view) {
        case 'home':
            ui.pageTitle.textContent = "Bingo Game";
            break;
        case 'mode':
            ui.pageTitle.textContent = "Select Game Mode";
            break;
        case 'create':
             ui.pageTitle.textContent = "Create a Game";
             if (state.gameMode === 'social') {
                 if(ui.commonPhrasesInputContainer) {
                     ui.commonPhrasesInputContainer.classList.add('hidden');
                     ui.commonPhrasesInputContainer.classList.remove('flex');
                 }
                 if(ui.rarePhrasesInputContainer) {
                     ui.rarePhrasesInputContainer.classList.add('hidden');
                     ui.rarePhrasesInputContainer.classList.remove('flex');
                 }
                 if(ui.socialModeExplanation) {
                     ui.socialModeExplanation.classList.remove('hidden');
                     ui.socialModeExplanation.classList.add('flex');
                 }
                 if(ui.createGameBtn) ui.createGameBtn.disabled = false;
                 if(ui.errorMessage) ui.errorMessage.textContent = '';
             } else if (state.gameMode === 'classic') {
                 if(ui.socialModeExplanation) {
                     ui.socialModeExplanation.classList.add('hidden');
                     ui.socialModeExplanation.classList.remove('flex');
                 }
                 if(ui.commonPhrasesInputContainer) {
                     ui.commonPhrasesInputContainer.classList.remove('hidden');
                     ui.commonPhrasesInputContainer.classList.add('flex');
                 }
                 if(ui.rarePhrasesInputContainer) {
                     ui.rarePhrasesInputContainer.classList.add('hidden');
                     ui.rarePhrasesInputContainer.classList.remove('flex');
                 }
                 import('./game.js').then(g => g.updatePhraseCount());
             } else {
                 if(ui.socialModeExplanation) {
                     ui.socialModeExplanation.classList.add('hidden');
                     ui.socialModeExplanation.classList.remove('flex');
                 }
                 if(ui.commonPhrasesInputContainer) {
                     ui.commonPhrasesInputContainer.classList.remove('hidden');
                     ui.commonPhrasesInputContainer.classList.add('flex');
                 }
                 if(ui.rarePhrasesInputContainer) {
                     ui.rarePhrasesInputContainer.classList.remove('hidden');
                     ui.rarePhrasesInputContainer.classList.add('flex');
                 }
                 import('./game.js').then(g => g.updatePhraseCount());
             }
             break;
        case 'join':
            ui.pageTitle.textContent = "Join a Game";
            if (state.currentUser) {
                if(ui.activeGamesContainer) ui.activeGamesContainer.classList.remove('hidden');
                if(ui.gameInvitesContainer) ui.gameInvitesContainer.classList.remove('hidden');
            }
            break;
        case 'board':
             ui.pageTitle.textContent = "Your Bingo Card";
            break;
        case 'draft':
            ui.pageTitle.textContent = "Draft Your Board";
            break;
        case 'lobby':
            ui.pageTitle.textContent = "Game Lobby";
            break;
    }

    if (view === 'loading') {
        ui.loadingSpinner.classList.remove('hidden');
    } else {
        const viewElement = document.getElementById(`${view}-game-view`);
        if (viewElement) {
            viewElement.classList.remove('hidden');
        }
    }
}

export function switchTab(activeTab) {
    if (activeTab === 'friends') {
        ui.friendsPanel.classList.remove('hidden');
        ui.leaderboardPanel.classList.add('hidden');
        
        ui.friendsTabBtn.classList.add('bg-gray-800', 'border-b-2', 'border-blue-500');
        ui.friendsTabBtn.classList.remove('text-gray-400');
        
        ui.leaderboardTabBtn.classList.add('text-gray-400');
        ui.leaderboardTabBtn.classList.remove('bg-gray-800', 'border-b-2', 'border-blue-500');
    } else { // Default to leaderboard
        ui.leaderboardPanel.classList.remove('hidden');
        ui.friendsPanel.classList.add('hidden');

        ui.leaderboardTabBtn.classList.add('bg-gray-800', 'border-b-2', 'border-blue-500');
        ui.leaderboardTabBtn.classList.remove('text-gray-400');

        ui.friendsTabBtn.classList.add('text-gray-400');
        ui.friendsTabBtn.classList.remove('bg-gray-800', 'border-b-2', 'border-blue-500');
    }
}

export function switchLeaderboardMode(mode) {
    if (mode === 'global') {
        ui.globalLeaderboardBtn.classList.add('border-b-2', 'border-blue-500', 'text-blue-500');
        ui.globalLeaderboardBtn.classList.remove('text-gray-400');
        
        ui.friendsLeaderboardBtn.classList.remove('border-b-2', 'border-blue-500', 'text-blue-500');
        ui.friendsLeaderboardBtn.classList.add('text-gray-400');
    } else {
        ui.friendsLeaderboardBtn.classList.add('border-b-2', 'border-blue-500', 'text-blue-500');
        ui.friendsLeaderboardBtn.classList.remove('text-gray-400');
        
        ui.globalLeaderboardBtn.classList.remove('border-b-2', 'border-blue-500', 'text-blue-500');
        ui.globalLeaderboardBtn.classList.add('text-gray-400');
    }
}

export function renderWinnerModal(winnerName) {
    ui.winnerModal.innerHTML = `
        <div class="modal-content bg-gray-800 text-center">
            <h2 class="text-4xl font-bold text-amber-500 mb-4">BINGO CALLED!</h2>
            <p class="text-lg text-gray-300">The player with the highest score wins...</p>
            <p class="mt-4 text-2xl">The winner is <strong class="text-blue-400">${winnerName}</strong>!</p>
            <button data-action="play-again" class="mt-6 bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Play Again</button>
        </div>`;
    ui.winnerModal.classList.remove('hidden');
}


export function renderBingoCard(card, markedCells, onCellClick, gameData = null) {
    ui.bingoCardContainer.innerHTML = "";
    card.forEach((row, r) => {
        row.forEach((phrase, c) => {
            const cell = document.createElement("div");
            cell.className = "bingo-cell bg-gray-700 text-gray-200";
            
            const isMarked = markedCells[r][c] === 'T';
            let isDisabled = false;

            if (gameData && gameData.mode === 'classic' && !isMarked) {
                if (!gameData.drawnItems || !gameData.drawnItems.includes(phrase)) {
                    isDisabled = true;
                    cell.classList.add('opacity-50', 'cursor-not-allowed');
                }
            }

            if (isMarked) {
                cell.classList.add('marked', 'bg-blue-500', 'text-white');
            }

            cell.textContent = phrase;
            cell.dataset.row = r;
            cell.dataset.col = c;
            
            cell.addEventListener("click", () => {
                if (isDisabled) return;
                cell.innerHTML = `<div class="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white mx-auto"></div>`;
                onCellClick(r, c);
            }, { once: !isDisabled });
            ui.bingoCardContainer.appendChild(cell);
        });
    });
}


export function renderPlayerProgress(players, currentPlayerId, gameData = null) {
    if(!ui.livePlayersContainer) return;
    ui.livePlayersContainer.innerHTML = '';
    if (players.length === 0) {
        ui.livePlayersContainer.innerHTML = '<p class="text-gray-500 text-center py-4">Waiting for players...</p>';
        return;
    }
    players.sort((a, b) => (b.score || 0) - (a.score || 0));
    
    const isManager = gameData && gameData.managers && gameData.managers.includes(currentPlayerId);

    const fragment = document.createDocumentFragment();
    players.forEach(player => {
        if (player.id === currentPlayerId) {
            ui.playerScoreDisplay.textContent = player.score || 0;
        }
        const playerCard = document.createElement('div');
        playerCard.className = 'bg-gray-700 p-3 rounded-md';
        const header = document.createElement('div');
        header.className = 'flex justify-between items-center text-sm mb-2';
        
        const nameContainer = document.createElement('div');
        nameContainer.className = 'flex items-center space-x-2 truncate';
        const nameEl = document.createElement('p');
        nameEl.className = 'font-bold truncate';
        nameEl.textContent = player.playerName;
        nameContainer.appendChild(nameEl);

        if (gameData && gameData.managers && gameData.managers.includes(player.id)) {
            const badgeContainer = document.createElement('div');
            badgeContainer.className = 'flex items-center space-x-1';

            const badge = document.createElement('span');
            badge.className = 'bg-blue-600 text-white text-[10px] px-1 rounded';
            badge.textContent = 'MGR';
            badgeContainer.appendChild(badge);

            if (isManager && player.id !== gameData.creatorId && player.id !== currentPlayerId) {
                const demoteBtn = document.createElement('button');
                demoteBtn.className = 'text-[10px] bg-red-600 hover:bg-red-700 text-white px-2 py-0.5 rounded transition';
                demoteBtn.textContent = 'Demote';
                demoteBtn.onclick = () => {
                    import('./game.js').then(module => module.demoteManager(player.id));
                };
                badgeContainer.appendChild(demoteBtn);
            }
            nameContainer.appendChild(badgeContainer);
        } else if (isManager && player.id !== currentPlayerId) {
            const promoteBtn = document.createElement('button');
            promoteBtn.className = 'text-[10px] bg-purple-600 hover:bg-purple-700 text-white px-2 py-0.5 rounded transition';
            promoteBtn.textContent = 'Promote';
            promoteBtn.onclick = () => {
                import('./game.js').then(module => module.promoteManager(player.id));
            };
            nameContainer.appendChild(promoteBtn);
        }

        const scoreEl = document.createElement('p');
        scoreEl.className = 'text-blue-400 font-mono flex-shrink-0';
        scoreEl.textContent = player.score || 0;
        
        header.appendChild(nameContainer);
        if (!gameData || gameData.mode !== 'classic') {
            header.appendChild(scoreEl);
        }
        playerCard.appendChild(header);
        const gridsContainer = document.createElement('div');
        gridsContainer.className = 'flex flex-row items-start gap-2';

        if (gameData && gameData.rarePhrases && gameData.rarePhrases.length > 0) {
            const rareCol = document.createElement('div');
            rareCol.className = 'flex flex-col gap-[2px] w-4 shrink-0';
            
            gameData.rarePhrases.forEach((phrase, idx) => {
                const rareCell = document.createElement('div');
                rareCell.className = 'w-full aspect-square rounded-[2px]';
                
                let bgColor = 'bg-purple-600';
                const isClaimedByPlayer = phrase.state === 'claimed' && phrase.claimedBy === player.id;
                
                const hasPendingInitial = state.activeClaims && state.activeClaims.some(c => 
                    c.playerId === player.id && c.squareIndex === idx && c.isRare && phrase.state !== 'claimed'
                );
                
                const hasPendingSteal = state.activeClaims && state.activeClaims.some(c => 
                    c.squareIndex === idx && c.isRare && phrase.state === 'claimed' && 
                    (c.playerId === player.id || phrase.claimedBy === player.id)
                );
                
                if (hasPendingSteal) {
                    bgColor = 'bg-blue-600';
                } else if (hasPendingInitial) {
                    bgColor = 'bg-orange-500';
                } else if (isClaimedByPlayer) {
                    bgColor = 'bg-green-500';
                }
                
                rareCell.classList.add(bgColor);
                rareCol.appendChild(rareCell);
            });
            gridsContainer.appendChild(rareCol);
        }

        const miniGrid = document.createElement('div');
        miniGrid.className = 'mini-card-grid flex-grow';
        const markedCells = player.markedCells;
        const customBoard = player.customBoard;
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                const miniCell = document.createElement('div');
                const idx = r * 5 + c;
                let bgColor = 'bg-gray-600';
                
                if (gameData && gameData.votingEnabled && customBoard && customBoard[idx]) {
                    const cState = customBoard[idx].state || 'draft';
                    if (cState === 'claimed') bgColor = 'bg-green-500';
                    else if (cState === 'pending_claim') bgColor = 'bg-yellow-500';
                    else if (cState === 'locked_failed') bgColor = 'bg-black';
                    else if (cState === 'denied') bgColor = 'bg-red-900';
                } else {
                    const isMarked = markedCells && markedCells[r] && markedCells[r][c] === 'T';
                    if (isMarked) bgColor = 'bg-blue-500';
                }
                
                miniCell.className = `mini-cell ${bgColor}`;
                miniGrid.appendChild(miniCell);
            }
        }
        gridsContainer.appendChild(miniGrid);
        playerCard.appendChild(gridsContainer);
        fragment.appendChild(playerCard);
    });
    ui.livePlayersContainer.appendChild(fragment);
}

export function renderRarePhrases(phrases, currentPlayerId, onClaim, onUnclaim, votingEnabled = false) {
    if(!ui.rarePhrasesContainer) return;
    ui.rarePhrasesContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();
    phrases.forEach((phrase, index) => {
        const cell = document.createElement('div');
        cell.className = 'rare-phrase-cell';
        
        const phraseState = phrase.state || 'draft';
        const strikes = (phrase.playerStates && phrase.playerStates[currentPlayerId]) || 0;
        const isLockedOut = votingEnabled && strikes >= 3;

        if (votingEnabled) {
            if (isLockedOut) {
                cell.classList.add('bg-red-900', 'cursor-not-allowed', 'opacity-75');
                cell.innerHTML = `
                    <p class="text-gray-300 line-through">${phrase.text}</p>
                    <p class="text-xs text-red-400 mt-1">Locked (3 Failed Attempts)</p>
                `;
            } else if (phraseState === 'pending_claim') {
                cell.classList.add('bg-yellow-600', 'hover:bg-yellow-700', 'cursor-pointer');
                cell.innerHTML = `
                    <p class="text-white">${phrase.text}</p>
                    <p class="text-xs text-yellow-200 mt-1 animate-pulse">Pending Review...</p>
                `;
                cell.addEventListener('click', () => {
                    import('./jury.js').then(j => j.showClaimStats(index, phrase, true));
                });
            } else if (phraseState === 'claimed') {
                const myPendingSteal = state.activeClaims && state.activeClaims.some(c => 
                    c.playerId === currentPlayerId && 
                    c.squareIndex === index && 
                    c.isRare
                );
                
                const isContested = state.activeClaims && state.activeClaims.some(c =>
                    c.squareIndex === index && c.isRare && phrase.claimedBy === currentPlayerId
                );

                if (isContested) {
                    cell.classList.add('bg-blue-800', 'hover:bg-blue-700', 'cursor-pointer');
                    cell.innerHTML = `
                        <p class="text-white">${phrase.text}</p>
                        <p class="text-xs text-blue-200 mt-1 animate-pulse">Defending against steal!</p>
                    `;
                    cell.addEventListener('click', () => {
                        import('./jury.js').then(j => j.showClaimStats(index, phrase, true));
                    });
                } else if (phrase.claimedBy === currentPlayerId) {
                    cell.classList.add('bg-green-600', 'hover:bg-green-700', 'cursor-pointer');
                    cell.innerHTML = `
                        <p class="text-white">${phrase.text}</p>
                        <p class="text-xs text-green-200 mt-1">(Claimed by you)</p>
                    `;
                    cell.addEventListener('click', () => {
                        import('./jury.js').then(j => j.showClaimStats(index, phrase, true));
                    });
                } else if (myPendingSteal) {
                    cell.classList.add('bg-yellow-600', 'hover:bg-yellow-700', 'cursor-pointer');
                    cell.innerHTML = `
                        <p class="text-white">${phrase.text}</p>
                        <p class="text-xs text-yellow-200 mt-1 animate-pulse">Steal Pending Review...</p>
                    `;
                    cell.addEventListener('click', () => {
                        import('./jury.js').then(j => j.showClaimStats(index, phrase, true, true));
                    });
                } else {
                    // Someone else claimed it, but we can steal it!
                    cell.classList.add('bg-blue-800', 'hover:bg-blue-700', 'cursor-pointer');
                    cell.innerHTML = `
                        <p class="text-white">${phrase.text}</p>
                        <p class="text-xs text-blue-300 mt-1">Claimed by ${phrase.claimedByName} - Click to Steal!</p>
                        ${strikes > 0 ? `<p class="text-xs text-red-400">Strikes: ${strikes}/3</p>` : ''}
                    `;
                    cell.addEventListener('click', () => onClaim(index));
                }
            } else {
                // Draft state
                cell.classList.add('bg-purple-600', 'hover:bg-purple-700', 'cursor-pointer');
                cell.innerHTML = `
                    <p class="text-white">${phrase.text}</p>
                    ${strikes > 0 ? `<p class="text-xs text-red-400 mt-1">Strikes: ${strikes}/3</p>` : ''}
                `;
                cell.addEventListener('click', () => onClaim(index));
            }
        } else {
            // Classic Non-Voting Mode
            if (phrase.claimedBy) {
                if (phrase.claimedBy === currentPlayerId) {
                    cell.classList.add('bg-green-600', 'hover:bg-green-700', 'cursor-pointer');
                    const textEl = document.createElement('p');
                    textEl.textContent = phrase.text;
                    const claimerEl = document.createElement('p');
                    claimerEl.className = 'text-xs text-green-200 mt-1';
                    claimerEl.textContent = `(Claimed by you)`;
                    cell.appendChild(textEl);
                    cell.appendChild(claimerEl);
                    cell.addEventListener('click', () => {
                        cell.innerHTML = `<div class="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white mx-auto"></div>`;
                        onUnclaim(index);
                    }, { once: true });
                } else {
                    cell.classList.add('bg-gray-700', 'cursor-not-allowed');
                    const textEl = document.createElement('p');
                    textEl.className = 'text-gray-400 line-through';
                    textEl.textContent = phrase.text;
                    const claimerEl = document.createElement('p');
                    claimerEl.className = 'text-xs text-blue-400 mt-1';
                    claimerEl.textContent = `Claimed by ${phrase.claimedByName}`;
                    cell.appendChild(textEl);
                    cell.appendChild(claimerEl);
                }
            } else {
                cell.classList.add('bg-purple-600', 'hover:bg-purple-700', 'cursor-pointer');
                cell.textContent = phrase.text;
                cell.addEventListener('click', () => {
                    cell.innerHTML = `<div class="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white mx-auto"></div>`;
                    onClaim(index);
                }, { once: true });
            }
        }
        fragment.appendChild(cell);
    });
    ui.rarePhrasesContainer.appendChild(fragment);
}


export async function renderActiveGamesList(gameIds) {
    if (!ui.activeGamesList) return;
    ui.activeGamesList.innerHTML = '';
    if (!gameIds || gameIds.length === 0) {
        ui.activeGamesList.innerHTML = '<p class="text-gray-500 text-center py-4">No active games found.</p>';
        return;
    }
    const gamePromises = gameIds.map(id => getDoc(doc(db, "activeGames", id)));
    const gameDocs = await Promise.all(gamePromises);
    
    ui.activeGamesList.innerHTML = '';

    const fragment = document.createDocumentFragment();

    gameDocs.forEach(gameDoc => {
        if (gameDoc.exists()) {
            const gameData = gameDoc.data();
            const currentGameId = gameDoc.id;
            const entry = document.createElement('div');
            entry.className = 'bg-gray-700 p-3 rounded-md mb-2 flex justify-between items-center';
            const dateEl = document.createElement('span');
            dateEl.className = 'text-sm text-gray-400';
            dateEl.textContent = `Game from ${gameData.createdAt?.toDate().toLocaleDateString() || 'Recent'}`;
            const rejoinBtn = document.createElement('button');
            rejoinBtn.className = 'bg-green-600 text-white text-xs font-bold py-1 px-3 rounded hover:bg-green-700';
            rejoinBtn.textContent = 'Rejoin';
            
            rejoinBtn.onclick = () => {
                window.location.href = `${window.location.origin}${window.location.pathname}?game=${currentGameId}`;
            };
            
            const abandonBtn = document.createElement('button');
            abandonBtn.className = 'bg-red-600 text-white text-xs font-bold py-1 px-3 rounded hover:bg-red-700 ml-2';
            abandonBtn.textContent = 'Abandon';
            abandonBtn.onclick = async () => {
                const isConfirmed = await showConfirm(
                    'Abandon Game', 
                    'Are you sure you want to abandon this game? Any progress you made in this game will be permanently deleted.'
                );
                if (isConfirmed) {
                    abandonBtn.disabled = true;
                    abandonBtn.textContent = '...';
                    try {
                        const playerDocRef = doc(db, `activeGames/${currentGameId}/players`, state.currentUser.uid);
                        await deleteDoc(playerDocRef);

                        // Check if the game is completely abandoned
                        const playersCollectionRef = collection(db, `activeGames/${currentGameId}/players`);
                        const playersSnapshot = await getDocs(playersCollectionRef);
                        
                        if (playersSnapshot.empty) {
                            const gameDocRef = doc(db, "activeGames", currentGameId);
                            await deleteDoc(gameDocRef);
                            
                            if (typeof storage !== 'undefined' && storage) {
                                try {
                                    const claimsFolderRef = ref(storage, `activeGames/${currentGameId}/claims`);
                                    const fileList = await listAll(claimsFolderRef);
                                    const deletePromises = fileList.items.map(fileRef => deleteObject(fileRef));
                                    await Promise.all(deletePromises);
                                } catch (e) {
                                    console.warn("Storage cleanup failed or no files to delete:", e);
                                }
                            }
                        }

                        const userDocRef = doc(db, "users", state.currentUser.uid);
                        await updateDoc(userDocRef, {
                            activeGames: arrayRemove(currentGameId)
                        });

                        entry.remove();
                        if (ui.activeGamesList.children.length === 0) {
                             ui.activeGamesList.innerHTML = '<p class="text-gray-500 text-center py-4">No active games found.</p>';
                        }
                    } catch (err) {
                        console.error('Failed to abandon game', err);
                        showMessage('Error', 'Could not abandon game. Please try again.');
                        abandonBtn.disabled = false;
                        abandonBtn.textContent = 'Abandon';
                    }
                }
            };

            const actionsDiv = document.createElement('div');
            actionsDiv.appendChild(rejoinBtn);
            actionsDiv.appendChild(abandonBtn);

            entry.appendChild(dateEl);
            entry.appendChild(actionsDiv);
            fragment.appendChild(entry);
        }
    });
    ui.activeGamesList.appendChild(fragment);
}

export function updateFriendRequestCount(count) {
    if(!ui.friendRequestsCount) return;
    ui.friendRequestsCount.textContent = count;
    ui.friendRequestsCount.classList.toggle('hidden', count === 0);
}

export function renderFriendRequestsModal(requests) {
    let requestsHtml = requests.map(req => `
        <div class="flex items-center justify-between bg-gray-700 p-2 rounded mb-2">
            <span>${req.displayName}</span>
            <div>
                <button data-action="accept-friend" data-id="${req.id}" class="bg-green-600 text-white text-xs font-bold py-1 px-2 rounded hover:bg-green-700">Accept</button>
                <button data-action="decline-friend" data-id="${req.id}" class="bg-red-600 text-white text-xs font-bold py-1 px-2 rounded hover:bg-red-700 ml-2">Decline</button>
            </div>
        </div>
    `).join('');

    if (requests.length === 0) {
        requestsHtml = '<p class="text-gray-500 text-center">No new friend requests.</p>';
    }

    ui.friendRequestsModal.innerHTML = `
        <div class="modal-content bg-gray-800 w-full max-w-md text-left relative">
            <h2 class="text-2xl font-bold text-gray-100 mb-4">Friend Requests</h2>
            <div class="space-y-2">${requestsHtml}</div>
            <button data-action="close" class="absolute top-2 right-2 text-gray-400 hover:text-white text-2xl font-bold">&times;</button>
        </div>`;
    ui.friendRequestsModal.classList.remove('hidden');
}

export function renderFriendsList(friends) {
    if(!ui.friendsList) return;
    ui.friendsList.innerHTML = '';
    if (friends.length === 0) {
        ui.friendsList.innerHTML = '<p class="text-gray-500 text-center py-4">Your friends will appear here.</p>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    friends.forEach(friend => {
        const friendDiv = document.createElement('div');
        friendDiv.className = 'flex items-center justify-between bg-gray-700 p-2 rounded mb-2';
        friendDiv.textContent = friend.displayName;
        const inviteBtn = document.createElement('button');
        inviteBtn.className = 'bg-blue-600 text-white text-xs font-bold py-1 px-2 rounded hover:bg-blue-700';
        inviteBtn.textContent = 'Invite';
        inviteBtn.dataset.action = 'invite-friend';
        inviteBtn.dataset.id = friend.id;
        inviteBtn.dataset.name = friend.displayName;
        friendDiv.appendChild(inviteBtn);
        fragment.appendChild(friendDiv);
    });
    ui.friendsList.appendChild(fragment);
}

export async function renderInviteModal(friendId, friendName, gameIds) {
    let gamesHtml = '<p class="text-gray-500 text-center">You have no active games to invite them to.</p>';
    
    if (gameIds && gameIds.length > 0) {
        const gamePromises = gameIds.map(id => getDoc(doc(db, "activeGames", id)));
        const gameDocs = await Promise.all(gamePromises);

        const trulyActiveGames = gameDocs.filter(doc => doc.exists() && !doc.data().winner);

        if (trulyActiveGames.length > 0) {
            gamesHtml = trulyActiveGames.map(gameDoc => {
                const gameId = gameDoc.id;
                return `
                <div class="flex items-center justify-between bg-gray-700 p-2 rounded mb-2">
                    <span class="truncate">Game: ${gameId}</span>
                    <button data-action="send-game-invite" data-game-id="${gameId}" data-friend-id="${friendId}" class="bg-green-600 text-white text-xs font-bold py-1 px-2 rounded hover:bg-green-700">Send Invite</button>
                </div>
            `}).join('');
        }
    }

    ui.inviteModal.innerHTML = `
        <div class="modal-content bg-gray-800 w-full max-w-md text-left relative">
            <h2 class="text-2xl font-bold text-gray-100 mb-4">Invite ${friendName}</h2>
            <p class="text-gray-400 mb-4">Choose an active game to invite them to:</p>
            <div class="space-y-2">${gamesHtml}</div>
            <button data-action="close" class="absolute top-2 right-2 text-gray-400 hover:text-white text-2xl font-bold">&times;</button>
        </div>`;
    ui.inviteModal.classList.remove('hidden');
}

export function updateGameInviteCount(count) {
    if (!ui.gameInvitesCount) return;
    ui.gameInvitesCount.textContent = count;
    ui.gameInvitesCount.classList.toggle('hidden', count === 0);
}

export function renderGameInvitesModal(invites) {
    let invitesHtml = invites.map(inv => `
        <div class="flex items-center justify-between bg-gray-700 p-2 rounded mb-2">
            <div>
                <p>From: <span class="font-bold">${inv.from}</span></p>
                <p class="text-xs text-gray-400 truncate">Game ID: ${inv.gameId}</p>
            </div>
            <div>
                <button data-action="accept-game-invite" data-game-id="${inv.gameId}" class="bg-green-600 text-white text-xs font-bold py-1 px-2 rounded hover:bg-green-700">Accept</button>
                <button data-action="decline-game-invite" data-game-id="${inv.gameId}" class="bg-red-600 text-white text-xs font-bold py-1 px-2 rounded hover:bg-red-700 ml-2">Decline</button>
            </div>
        </div>
    `).join('');

    if (invites.length === 0) {
        invitesHtml = '<p class="text-gray-500 text-center">No new game invites.</p>';
    }

    ui.gameInvitesModal.innerHTML = `
        <div class="modal-content bg-gray-800 w-full max-w-md text-left relative">
            <h2 class="text-2xl font-bold text-gray-100 mb-4">Game Invites</h2>
            <div class="space-y-2">${invitesHtml}</div>
            <button data-action="close" class="absolute top-2 right-2 text-gray-400 hover:text-white text-2xl font-bold">&times;</button>
        </div>`;
    ui.gameInvitesModal.classList.remove('hidden');
}

export function renderGameInvitesList(invites) {
    if (!ui.gameInvitesList) return;
    ui.gameInvitesList.innerHTML = '';
    if (invites.length === 0) {
        ui.gameInvitesList.innerHTML = '<p class="text-gray-500 text-center py-4">No new game invites.</p>';
        return;
    }

    let invitesHtml = invites.map(inv => `
        <div class="flex items-center justify-between bg-gray-700 p-2 rounded mb-2">
            <div>
                <p>From: <span class="font-bold">${inv.from}</span></p>
                <p class="text-xs text-gray-400 truncate">Game ID: ${inv.gameId}</p>
            </div>
            <div>
                <button data-action="accept-game-invite" data-game-id="${inv.gameId}" class="bg-green-600 text-white text-xs font-bold py-1 px-2 rounded hover:bg-green-700">Accept</button>
                <button data-action="decline-game-invite" data-game-id="${inv.gameId}" class="bg-red-600 text-white text-xs font-bold py-1 px-2 rounded hover:bg-red-700 ml-2">Decline</button>
            </div>
        </div>
    `).join('');
    ui.gameInvitesList.innerHTML = invitesHtml;
}


export function renderCallerUI(gameData, currentPlayerId) {
    if (!ui.callerUiSection || !ui.rarePhrasesSection) return;
    
    if (ui.boardColRare) ui.boardColRare.classList.remove('hidden');
    ui.rarePhrasesSection.classList.add('hidden');
    ui.rarePhrasesSection.classList.remove('flex');
    ui.callerUiSection.classList.remove('hidden');
    ui.callerUiSection.classList.add('flex');
    if (ui.scoreDisplayWrapper) ui.scoreDisplayWrapper.classList.add('hidden');

    const drawnItems = gameData.drawnItems || [];
    const currentDraw = drawnItems.length > 0 ? drawnItems[drawnItems.length - 1] : "--";
    ui.currentDrawDisplay.textContent = currentDraw;

    ui.previousDrawsContainer.innerHTML = '';
    const prevItems = drawnItems.slice(0, -1).reverse();
    if (prevItems.length === 0) {
        ui.previousDrawsContainer.innerHTML = '<p class="text-gray-500 py-4">No previous draws.</p>';
    } else {
        prevItems.forEach(item => {
            const el = document.createElement('div');
            el.className = 'bg-gray-700 p-2 rounded truncate';
            el.textContent = item;
            ui.previousDrawsContainer.appendChild(el);
        });
    }

    if (gameData.managers && gameData.managers.includes(currentPlayerId)) {
        ui.drawNextBtn.classList.remove('hidden');
        ui.drawNextBtn.disabled = gameData.remainingItems && gameData.remainingItems.length === 0;
        if (ui.drawNextBtn.disabled) {
            ui.drawNextBtn.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            ui.drawNextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    } else {
        ui.drawNextBtn.classList.add('hidden');
    }
}
