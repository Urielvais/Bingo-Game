import { collection, query, where, getDocs, doc, updateDoc, arrayUnion, arrayRemove, runTransaction, onSnapshot, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from './firebase.js';
import { ui, showMessage, updateFriendRequestCount, renderFriendRequestsModal, renderFriendsList, updateGameInviteCount, renderGameInvitesModal, renderGameInvitesList } from './ui.js';
import { state } from './script.js';
import * as game from './game.js';

let friendRequestSenders = [];
let gameInvites = [];

export async function searchUsers(searchTerm) {
    ui.friendSearchResults.innerHTML = '<p class="text-gray-400">Searching...</p>';
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("displayName", "==", searchTerm));
    const querySnapshot = await getDocs(q);
    
    ui.friendSearchResults.innerHTML = '';
    if (querySnapshot.empty) {
        ui.friendSearchResults.innerHTML = '<p class="text-gray-500">No users found with that name.</p>';
        return;
    }
    
    querySnapshot.forEach(docSnap => {
        const user = { id: docSnap.id, ...docSnap.data() };
        if (user.id === state.currentUser.uid) return;

        const resultDiv = document.createElement('div');
        resultDiv.className = 'flex items-center justify-between bg-gray-700 p-2 rounded';
        
        const nameEl = document.createElement('span');
        nameEl.textContent = user.displayName;
        resultDiv.appendChild(nameEl);

        const addBtn = document.createElement('button');
        addBtn.dataset.action = 'add-friend';
        addBtn.dataset.id = user.id;
        addBtn.className = 'bg-green-600 text-white text-xs font-bold py-1 px-2 rounded hover:bg-green-700';
        addBtn.textContent = 'Add Friend';
        resultDiv.appendChild(addBtn);

        ui.friendSearchResults.appendChild(resultDiv);
    });
}

export async function sendFriendRequest(recipientId) {
    if (!state.currentUser) return;
    const senderId = state.currentUser.uid;

    const recipientRef = doc(db, "users", recipientId);

    try {
        await updateDoc(recipientRef, {
            friendRequests: arrayUnion(senderId)
        });
        showMessage("Success", "Friend request sent!");
        ui.friendSearchResults.innerHTML = '';
        ui.friendSearchInput.value = '';
    } catch (error) {
        console.error("Error sending friend request:", error);
        showMessage("Error", "Could not send friend request.");
    }
}

export function openFriendRequestsModal() {
    renderFriendRequestsModal(friendRequestSenders);
}

export async function acceptFriendRequest(senderId) {
    if (!state.currentUser) return;
    const currentUserId = state.currentUser.uid;

    const currentUserRef = doc(db, "users", currentUserId);
    const senderUserRef = doc(db, "users", senderId);

    try {
        await runTransaction(db, async (transaction) => {
            transaction.update(currentUserRef, {
                friends: arrayUnion(senderId),
                friendRequests: arrayRemove(senderId)
            });
            transaction.update(senderUserRef, {
                friends: arrayUnion(currentUserId)
            });
        });
        showMessage("Success", "Friend request accepted!");
        ui.friendRequestsModal.classList.add('hidden');
    } catch (error) {
        console.error("Error accepting friend request:", error);
        showMessage("Error", "Could not accept friend request.");
    }
}

export async function declineFriendRequest(senderId) {
    if (!state.currentUser) return;
    const currentUserId = state.currentUser.uid;
    const currentUserRef = doc(db, "users", currentUserId);

    try {
        await updateDoc(currentUserRef, {
            friendRequests: arrayRemove(senderId)
        });
        showMessage("Success", "Friend request declined.");
        ui.friendRequestsModal.classList.add('hidden');
    } catch (error) {
        console.error("Error declining friend request:", error);
        showMessage("Error", "Could not decline friend request.");
    }
}

export function listenForFriendsAndRequests(uid) {
    const userDocRef = doc(db, "users", uid);
    state.unsubscribe.friendsUser = onSnapshot(userDocRef, async (userDoc) => {
        if (userDoc.exists()) {
            const userData = userDoc.data();

            // Handle Friend Requests
            const requests = userData.friendRequests || [];
            updateFriendRequestCount(requests.length);
            if(requests.length > 0) {
                const requestPromises = requests.map(id => getDoc(doc(db, "users", id)));
                const requestDocs = await Promise.all(requestPromises);
                friendRequestSenders = requestDocs.map(d => ({id: d.id, ...d.data()}));
            } else {
                friendRequestSenders = [];
            }
            
            // Handle Friends List
            const friends = userData.friends || [];
            state.friendsList = friends;
            if(friends.length > 0) {
                const friendPromises = friends.map(id => getDoc(doc(db, "users", id)));
                const friendDocs = await Promise.all(friendPromises);
                const friendsData = friendDocs.map(d => ({id: d.id, ...d.data()}));
                renderFriendsList(friendsData);
            } else {
                renderFriendsList([]);
            }
            
            if (state.leaderboardMode === 'friends') {
                game.renderLeaderboard();
            }

            // Handle Game Invites
            gameInvites = userData.gameInvites || [];
            updateGameInviteCount(gameInvites.length);
            renderGameInvitesList(gameInvites);
        }
    });
}

export async function sendGameInvite(friendId, gameId) {
    if (!state.currentUser) return;

    const friendRef = doc(db, "users", friendId);
    try {
        await updateDoc(friendRef, {
            gameInvites: arrayUnion({
                gameId: gameId,
                from: state.currentUser.displayName,
                timestamp: new Date()
            })
        });
        showMessage("Success", "Game invite sent!");
        ui.inviteModal.classList.add('hidden');
    } catch (error) {
        console.error("Error sending game invite:", error);
        showMessage("Error", "Could not send invite.");
    }
}

export function openGameInvitesModal() {
    renderGameInvitesModal(gameInvites);
}

export async function acceptGameInvite(gameId) {
    if (!state.currentUser) return;
    const currentUserId = state.currentUser.uid;
    const currentUserRef = doc(db, "users", currentUserId);

    const inviteToRemove = gameInvites.find(inv => inv.gameId === gameId);

    try {
        await updateDoc(currentUserRef, {
            gameInvites: arrayRemove(inviteToRemove)
        });
        window.location.href = `${window.location.origin}${window.location.pathname}?game=${gameId}`;
    } catch (error) {
        console.error("Error accepting game invite:", error);
        showMessage("Error", "Could not accept invite.");
    }
}

export async function declineGameInvite(gameId) {
    if (!state.currentUser) return;
    const currentUserId = state.currentUser.uid;
    const currentUserRef = doc(db, "users", currentUserId);

    const inviteToRemove = gameInvites.find(inv => inv.gameId === gameId);

    try {
        await updateDoc(currentUserRef, {
            gameInvites: arrayRemove(inviteToRemove)
        });
        showMessage("Success", "Invite declined.");
        ui.gameInvitesModal.classList.add('hidden');
    } catch (error) {
        console.error("Error declining game invite:", error);
        showMessage("Error", "Could not decline invite.");
    }
}

