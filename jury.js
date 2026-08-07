import { db, storage } from './firebase.js';
import { doc, updateDoc, getDocs, collection, onSnapshot, query, where, runTransaction, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { ui, showMessage } from './ui.js';
import { state } from './script.js';

export function openEvidenceModal(squareIndex, isRare = false) {
    const playerData = state.currentPlayers.find(p => p.id === state.playerId);
    if (!playerData) return;
    
    let sq;
    if (isRare) {
        sq = state.currentGameData.rarePhrases[squareIndex];
    } else {
        sq = playerData.customBoard[squareIndex];
    }
    
    ui.evidenceSquareText.textContent = sq.text;
    if (sq.state === 'denied') {
        const attemptsLeft = 3 - (sq.appealCount || 0);
        ui.evidenceSquareText.innerHTML += `<br><span class="text-red-400 text-xs">Appeals remaining: ${attemptsLeft}</span>`;
    }
    
    ui.evidenceSquareIndex.value = squareIndex;
    ui.evidenceSquareIndex.dataset.isRare = isRare ? "true" : "false";
    ui.evidenceInput.value = '';
    ui.evidenceModal.classList.remove('hidden');
}

export async function showClaimStats(squareIndex, sq, isRare = false, forcePending = false) {
    try {
        const targetStatus = forcePending ? 'pending' : (sq.state === 'claimed' ? 'approved' : 'pending');
        const claimsRef = collection(db, `activeGames/${state.gameId}/claims`);
        let q;
        if (isRare) {
            if (targetStatus === 'pending') {
                q = query(claimsRef, where("playerId", "==", state.playerId), where("squareIndex", "==", squareIndex), where("isRare", "==", true), where("status", "==", "pending"));
            } else {
                q = query(claimsRef, where("squareIndex", "==", squareIndex), where("isRare", "==", true), where("status", "==", "approved"));
            }
        } else {
            q = query(claimsRef, where("playerId", "==", state.playerId), where("squareIndex", "==", squareIndex), where("isRare", "==", false), where("status", "==", targetStatus));
        }
        
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            showMessage("Claim Stats", "No claim record found for this square.");
            return;
        }

        const claim = snapshot.docs[0].data();
        const votes = claim.votes || {};
        
        let approvals = 0;
        let denials = 0;
        for (const voterId in votes) {
            if (votes[voterId] === true) approvals++;
            else if (votes[voterId] === false) denials++;
        }
        
        let thirdBoxHtml = '';
        let withdrawHtml = '';
        if (targetStatus === 'pending') {
            const totalVoters = state.currentPlayers.length - 1;
            const remainingVotes = totalVoters - (approvals + denials);
            thirdBoxHtml = `
                <div class="bg-gray-700 p-2 rounded text-gray-300">
                    <span class="block text-2xl font-bold">${remainingVotes < 0 ? 0 : remainingVotes}</span> Remaining
                </div>
            `;
            if (claim.playerId === state.playerId) {
                withdrawHtml = `
                    <div class="mt-4">
                        <button id="withdraw-claim-btn" class="bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-4 rounded w-full transition">Withdraw Claim (Avoid Penalty)</button>
                    </div>
                `;
            }
        } else {
            const appealCount = sq.appealCount || 0;
            thirdBoxHtml = `
                <div class="bg-blue-900/50 p-2 rounded text-blue-400">
                    <span class="block text-2xl font-bold">${appealCount}</span> Appeals
                </div>
            `;
        }
        
        const statsHtml = `
            <div class="text-center mt-4">
                <p class="text-xl font-bold text-gray-200 mb-4">${claim.evidence ? 'Evidence Submitted' : 'Image Evidence Submitted'}</p>
                <div class="grid grid-cols-3 gap-2 sm:gap-4 text-sm sm:text-lg">
                    <div class="bg-green-900/50 p-2 rounded text-green-400">
                        <span class="block text-2xl font-bold">${approvals}</span> Approvals
                    </div>
                    <div class="bg-red-900/50 p-2 rounded text-red-400">
                        <span class="block text-2xl font-bold">${denials}</span> Denials
                    </div>
                    ${thirdBoxHtml}
                </div>
                ${withdrawHtml}
            </div>
        `;
        
        const title = targetStatus === 'pending' ? "Claim Review Status" : "Approved Claim Stats";
        showMessage(title, statsHtml);
        
        if (withdrawHtml) {
            const withdrawBtn = document.getElementById('withdraw-claim-btn');
            if (withdrawBtn) {
                withdrawBtn.onclick = () => {
                    withdrawBtn.disabled = true;
                    withdrawBtn.textContent = 'Withdrawing...';
                    withdrawClaim(snapshot.docs[0].id, squareIndex, isRare);
                };
            }
        }
    } catch (e) {
        console.error("Error fetching claim stats:", e);
        showMessage("Error", "Could not load claim stats.");
    }
}

export async function submitEvidence() {
    const evidence = ui.evidenceInput.value.trim();
    const squareIndex = parseInt(ui.evidenceSquareIndex.value, 10);
    const isRare = ui.evidenceSquareIndex.dataset.isRare === "true";
    const file = ui.evidenceImageInput ? ui.evidenceImageInput.files[0] : null;
    
    if (!evidence && !file) {
        showMessage("Error", "Please provide a link, explanation, or an image.");
        return;
    }
    
    ui.submitEvidenceBtn.disabled = true;
    ui.submitEvidenceBtn.textContent = 'Submitting...';
    
    try {
        const { setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
        const claimRef = doc(collection(db, `activeGames/${state.gameId}/claims`));
        
        let evidenceImage = null;
        if (file && storage) {
            const fileExt = file.name.split('.').pop();
            const fileName = `proof_${Date.now()}.${fileExt}`;
            const fileRef = ref(storage, `activeGames/${state.gameId}/claims/${claimRef.id}/${fileName}`);
            await uploadBytes(fileRef, file);
            evidenceImage = await getDownloadURL(fileRef);
        }

        await setDoc(claimRef, {
            playerId: state.playerId,
            playerName: state.currentPlayers.find(p => p.id === state.playerId)?.playerName || 'Unknown',
            squareIndex: squareIndex,
            isRare: isRare,
            evidence: evidence,
            evidenceImage: evidenceImage,
            status: 'pending',
            votes: {},
            createdAt: serverTimestamp()
        });
        
        if (!isRare) {
            const playerRef = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
            const pDoc = state.currentPlayers.find(p => p.id === state.playerId);
            const customBoard = [...pDoc.customBoard];
            customBoard[squareIndex].state = 'pending_claim';
            customBoard[squareIndex].claimId = claimRef.id;
            await updateDoc(playerRef, { customBoard });
        } else {
            // It's rare, mark it pending if it isn't already claimed.
            // A race condition could exist here if we don't use transaction, but this is just visual state.
            // We use transaction in voteOnClaim to resolve it.
            const gameRef = doc(db, `activeGames`, state.gameId);
            const gDoc = await getDoc(gameRef);
            if (gDoc.exists()) {
                const rarePhrases = [...gDoc.data().rarePhrases];
                // Only mark as pending if it is completely unclaimed
                if (rarePhrases[squareIndex].state !== 'claimed') {
                    rarePhrases[squareIndex].state = 'pending_claim';
                    await updateDoc(gameRef, { rarePhrases });
                }
            }
        }
        
        ui.evidenceModal.classList.add('hidden');
        if (ui.evidenceImageInput) ui.evidenceImageInput.value = ''; // clear input
        showMessage("Claim Submitted", "The jury will now review your evidence.");
    } catch(e) {
        console.error(e);
        showMessage("Error", "Failed to submit claim.");
    } finally {
        ui.submitEvidenceBtn.disabled = false;
        ui.submitEvidenceBtn.textContent = 'Submit Claim for Review';
    }
}

export function listenForClaims() {
    if (state.unsubscribe.claims) return;
    const q = query(collection(db, `activeGames/${state.gameId}/claims`), where("status", "==", "pending"));
    state.unsubscribe.claims = onSnapshot(q, (snapshot) => {
        const claims = [];
        snapshot.forEach(doc => {
            claims.push({ id: doc.id, ...doc.data() });
        });
        state.activeClaims = claims;
        renderActiveClaims(claims);
        
        if (state.currentGameData && state.currentGameData.rarePhrases) {
            import('./ui.js').then(uiModule => {
                const onClaim = state.currentGameData.votingEnabled ? (idx) => openEvidenceModal(idx, true) : null;
                uiModule.renderRarePhrases(state.currentGameData.rarePhrases, state.playerId, onClaim, null, state.currentGameData.votingEnabled);
                if (state.currentPlayers) {
                    uiModule.renderPlayerProgress(state.currentPlayers, state.playerId, state.currentGameData);
                }
            });
        }
    });
}

function renderActiveClaims(claims) {
    if (!ui.activeClaimsList) return;
    ui.activeClaimsList.innerHTML = '';
    
    if (claims.length === 0) {
        ui.activeClaimsList.innerHTML = '<p class="text-gray-500 italic text-sm">No active claims to review.</p>';
        return;
    }

    claims.forEach(claim => {
        const div = document.createElement('div');
        div.className = 'bg-gray-700 p-3 rounded-lg flex flex-col gap-2 text-sm';
        
        const header = document.createElement('div');
        header.className = 'flex justify-between items-center';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'font-bold text-blue-400';
        nameSpan.textContent = claim.playerName;
        
        let isOwnerOfStolenSquare = false;
        let sqText = "Loading...";
        if (claim.isRare && state.currentGameData) {
            const rareSquare = state.currentGameData.rarePhrases[claim.squareIndex];
            if (rareSquare) {
                sqText = rareSquare.text;
                if (rareSquare.state === 'claimed' && rareSquare.claimedBy === state.playerId) {
                    isOwnerOfStolenSquare = true;
                }
            }
        } else {
            const targetPlayer = state.currentPlayers?.find(p => p.id === claim.playerId);
            if (targetPlayer && targetPlayer.customBoard) {
                sqText = targetPlayer.customBoard[claim.squareIndex].text;
            }
        }

        const myVote = claim.votes[state.playerId];
        const statusBadge = document.createElement('span');
        if (myVote !== undefined) {
            statusBadge.textContent = myVote ? 'You Approved' : 'You Denied';
            statusBadge.className = `text-xs px-2 py-1 rounded ${myVote ? 'bg-green-600' : 'bg-red-600'}`;
        } else if (claim.playerId === state.playerId) {
            statusBadge.textContent = 'Your Claim';
            statusBadge.className = 'text-xs bg-yellow-600 px-2 py-1 rounded text-white';
        } else if (isOwnerOfStolenSquare) {
            statusBadge.textContent = 'Defending Phrase';
            statusBadge.className = 'text-xs bg-blue-600 px-2 py-1 rounded text-white';
        }
        
        header.appendChild(nameSpan);
        if (statusBadge.textContent) header.appendChild(statusBadge);
        
        const claimText = document.createElement('p');
        claimText.className = 'text-gray-200 italic mb-2';
        claimText.textContent = `"${sqText}"`;
        
        div.appendChild(header);
        div.appendChild(claimText);
        
        if (claim.evidence) {
            const isLink = claim.evidence.startsWith('http');
            const evidenceLink = document.createElement(isLink ? 'a' : 'button');
            evidenceLink.className = isLink 
                ? 'text-blue-400 underline truncate block text-left' 
                : 'text-gray-300 hover:text-white truncate block text-left cursor-pointer';
            evidenceLink.textContent = claim.evidence;
            
            if (isLink) {
                evidenceLink.href = claim.evidence;
                evidenceLink.target = '_blank';
            } else {
                evidenceLink.onclick = () => showMessage("Evidence Explanation", claim.evidence);
            }
            div.appendChild(evidenceLink);
        }

        if (claim.evidenceImage) {
            const imgEl = document.createElement('img');
            imgEl.src = claim.evidenceImage;
            imgEl.className = 'w-full rounded mt-2 mb-2 object-cover max-h-48 cursor-pointer border border-gray-600 hover:opacity-90';
            imgEl.onclick = () => {
                showMessage("Image Evidence", `<img src="${claim.evidenceImage}" class="max-w-full max-h-[60vh] mx-auto rounded object-contain mt-2">`);
            };
            div.appendChild(imgEl);
        }

        // Calculate progress
        const lobbySize = state.currentPlayers ? state.currentPlayers.length : 1;
        let jurySize = Math.max(1, lobbySize - 1);
        if (claim.isRare && state.currentGameData && state.currentGameData.rarePhrases[claim.squareIndex]?.state === 'claimed') {
            jurySize = Math.max(1, lobbySize - 2);
        }
        
        let approvals = 0;
        let denials = 0;
        if (claim.votes) {
            Object.values(claim.votes).forEach(vote => {
                if (vote === true) approvals++;
                else if (vote === false) denials++;
            });
        }
        
        const approvePct = (approvals / jurySize) * 100;
        const denyPct = (denials / jurySize) * 100;
        
        const progressDiv = document.createElement('div');
        progressDiv.className = 'w-full bg-gray-900 rounded-full h-2 mt-2 flex overflow-hidden opacity-80';
        progressDiv.innerHTML = `
            <div class="bg-green-500 h-2 transition-all duration-300" style="width: ${approvePct}%"></div>
            <div class="bg-red-500 h-2 transition-all duration-300" style="width: ${denyPct}%"></div>
        `;
        div.appendChild(progressDiv);

        // Voting buttons
        if (myVote === undefined && claim.playerId !== state.playerId && !isOwnerOfStolenSquare) {
            const btnDiv = document.createElement('div');
            btnDiv.className = 'flex gap-2 mt-2';
            
            const approveBtn = document.createElement('button');
            approveBtn.textContent = 'Approve';
            approveBtn.className = 'flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-1 rounded transition';
            approveBtn.onclick = () => voteOnClaim(claim.id, true);
            
            const denyBtn = document.createElement('button');
            denyBtn.textContent = 'Deny';
            denyBtn.className = 'flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-1 rounded transition';
            denyBtn.onclick = () => voteOnClaim(claim.id, false);
            
            btnDiv.appendChild(approveBtn);
            btnDiv.appendChild(denyBtn);
            div.appendChild(btnDiv);
        }

        ui.activeClaimsList.appendChild(div);
    });
}

export async function voteOnClaim(claimId, isApprove) {
    try {
        const claimRef = doc(db, `activeGames/${state.gameId}/claims`, claimId);
        
        await runTransaction(db, async (transaction) => {
            const claimDoc = await transaction.get(claimRef);
            if (!claimDoc.exists()) throw "Claim not found";
            
            const claimData = claimDoc.data();
            
            // PRE-FETCH player doc and game doc
            const pRef = doc(db, `activeGames/${state.gameId}/players`, claimData.playerId);
            const pDoc = await transaction.get(pRef);
            const gameRef = doc(db, `activeGames`, state.gameId);
            const gDoc = await transaction.get(gameRef);
            
            const newVotes = { ...claimData.votes };
            newVotes[state.playerId] = isApprove;
            
            // Calculate total approvals/denials
            let approvals = 0;
            let denials = 0;
            for (const pid in newVotes) {
                if (newVotes[pid]) approvals++;
                else denials++;
            }

            const lobbySize = state.currentPlayers ? state.currentPlayers.length : 1;
            
            // By default, everyone except the claimant is on the jury.
            let jurySize = Math.max(1, lobbySize - 1);
            
            // If this is a rare steal attempt, exclude the current owner too.
            const isStealAttempt = claimData.isRare && gDoc.data().rarePhrases[claimData.squareIndex].state === 'claimed';
            if (isStealAttempt) {
                jurySize = Math.max(1, lobbySize - 2); 
            }
            
            const totalVoters = jurySize;
            const remainingVotes = totalVoters - (approvals + denials);
            const targetApprovals = Math.floor(totalVoters / 2) + 1;
            
            let newStatus = 'pending';

            if (approvals >= targetApprovals) {
                newStatus = 'approved';
            } else if (approvals + remainingVotes < targetApprovals) {
                // Mathematically impossible to reach target approvals
                newStatus = 'denied';
            }

            // Special logic for rare competitive phrases
            if (claimData.isRare) {
                const rarePhrases = [...gDoc.data().rarePhrases];
                const rareSquare = rarePhrases[claimData.squareIndex];
                
                if (newStatus === 'approved') {
                    const netApprovals = approvals - denials;
                    
                    if (rareSquare.state === 'claimed') {
                        // Steal SUCCESS!
                        // Deduct points from previous owner
                        const prevOwnerRef = doc(db, `activeGames/${state.gameId}/players`, rareSquare.claimedBy);
                        const prevOwnerDoc = await transaction.get(prevOwnerRef);
                        if (prevOwnerDoc.exists()) {
                            transaction.update(prevOwnerRef, { score: (prevOwnerDoc.data().score || 0) - 300 });
                        }
                    }
                    
                    // Award to new owner
                    rareSquare.state = 'claimed';
                    rareSquare.claimedBy = claimData.playerId;
                    rareSquare.claimedByName = claimData.playerName;
                    rareSquare.netApprovals = netApprovals;
                    if (pDoc.exists()) {
                        transaction.update(pRef, { score: (pDoc.data().score || 0) + 300 });
                    }
                } else if (newStatus === 'denied') {
                    // Record strike for this player
                    const pState = rareSquare.playerStates || {};
                    pState[claimData.playerId] = (pState[claimData.playerId] || 0) + 1;
                    rareSquare.playerStates = pState;
                    
                    if (rareSquare.state === 'pending_claim') {
                        rareSquare.state = 'draft'; // Revert back
                    }
                }
                
                transaction.update(gameRef, { rarePhrases });
            } else {
                // Regular board logic
                if (newStatus !== 'pending') {
                    if (pDoc.exists()) {
                        const cBoard = [...pDoc.data().customBoard];
                        cBoard[claimData.squareIndex].state = newStatus === 'approved' ? 'claimed' : 'denied';
                        
                        if (newStatus === 'denied') {
                            cBoard[claimData.squareIndex].appealCount = (cBoard[claimData.squareIndex].appealCount || 0) + 1;
                            if (cBoard[claimData.squareIndex].appealCount >= 3) {
                                cBoard[claimData.squareIndex].state = 'locked_failed';
                            }
                        }
                        
                        let updateData = { customBoard: cBoard };
                        
                        if (newStatus === 'approved') {
                            let markedCells = [...pDoc.data().markedCells];
                            const row = cBoard[claimData.squareIndex].row;
                            const col = cBoard[claimData.squareIndex].col;
                            const rowArr = markedCells[row].split('');
                            rowArr[col] = 'T';
                            markedCells[row] = rowArr.join('');
                            
                            updateData.markedCells = markedCells;
                        }
                        
                        transaction.update(pRef, updateData);
                    }
                }
            }

            transaction.update(claimRef, { votes: newVotes, status: newStatus });
        });
    } catch(e) {
        console.error("Vote failed", e);
        showMessage("Error", "Could not cast vote.");
    }
}

export async function withdrawClaim(claimId, squareIndex, isRare) {
    try {
        const claimRef = doc(db, `activeGames/${state.gameId}/claims`, claimId);
        await deleteDoc(claimRef);
        
        if (isRare) {
            const gameRef = doc(db, `activeGames`, state.gameId);
            const gDoc = await getDoc(gameRef);
            if (gDoc.exists()) {
                const rarePhrases = [...gDoc.data().rarePhrases];
                if (rarePhrases[squareIndex].state === 'pending_claim') {
                    rarePhrases[squareIndex].state = 'draft';
                    await updateDoc(gameRef, { rarePhrases });
                }
            }
        } else {
            const pRef = doc(db, `activeGames/${state.gameId}/players`, state.playerId);
            const pDoc = await getDoc(pRef);
            if (pDoc.exists()) {
                const customBoard = [...pDoc.data().customBoard];
                if (customBoard[squareIndex].state === 'pending_claim') {
                    if (customBoard[squareIndex].appealCount > 0) {
                        customBoard[squareIndex].state = 'denied';
                    } else {
                        customBoard[squareIndex].state = 'draft';
                    }
                    await updateDoc(pRef, { customBoard });
                }
            }
        }
        
        ui.messageModal.classList.add('hidden');
        showMessage("Withdrawn", "Your claim has been successfully withdrawn. No penalty was applied.");
    } catch (e) {
        console.error("Error withdrawing:", e);
        showMessage("Error", "Could not withdraw claim.");
    }
}
