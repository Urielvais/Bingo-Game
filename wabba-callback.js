import { initializeFirebase, auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { finishWabba } from './wabba.js';

const params = new URLSearchParams(location.search);
const callback = Object.fromEntries(['state', 'code', 'link_session_id'].map(key => [key, params.get(key)]));
// Clear the one-time code before any subsequent navigation; never log it.
history.replaceState({}, '', location.pathname);
const status = document.getElementById('status');
const retry = document.getElementById('retry');
let busy = false;
let completed = false;
async function connect() {
  if (busy || completed) return;
  busy = true; retry.hidden = true;
  status.textContent = 'Confirming your connection…';
  try {
    await finishWabba(auth, callback);
    completed = true;
    status.textContent = 'Your Bingo account is connected to Wabba. Reward eligibility is checked separately for each supported match.';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not connect. Please try again.';
    retry.hidden = false;
  } finally { busy = false; }
}
retry.addEventListener('click', connect);
initializeFirebase();
onAuthStateChanged(auth, () => void connect());
