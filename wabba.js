import { wabbaConfig } from './wabba-config.js';
import { mountWabbaEntry } from './wabba-age-gate.js';

const startKeyFor = uid => `wabba:bingo:start:${uid}`;
const callbackKeyFor = (uid, state) => `wabba:bingo:callback:${uid}:${state}`;
const requestKeyPattern = /^[A-Za-z0-9_-]{16,100}$/;
const statePattern = /^[A-Za-z0-9_-]{43}$/;
let entryMounted = false;

function configuredOrigin(value) {
  try {
    if (typeof value !== 'string') return null;
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value ? url.origin : null;
  } catch { return null; }
}

function configuration() {
  if (wabbaConfig?.enabled !== true) return null;
  const webOrigin = configuredOrigin(wabbaConfig.webOrigin);
  const adapterOrigin = configuredOrigin(wabbaConfig.adapterOrigin);
  return webOrigin && adapterOrigin ? { webOrigin, adapterOrigin } : null;
}

function readStored(storage, key) {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
}

function clearStart(uid, requestKey) {
  const key = startKeyFor(uid);
  // An older asynchronous operation must not clear a newer attempt.
  if (readStored(sessionStorage, key)?.requestKey === requestKey) sessionStorage.removeItem(key);
}

class ConnectionRequestError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function call(auth, path, body, signal) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to Bingo, then connect to Wabba.');
  const config = configuration();
  if (!config) throw new Error('The Bingo connection server is not configured yet.');
  const token = await user.getIdToken();
  const response = await fetch(`${config.adapterOrigin}${path}`, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ConnectionRequestError(payload?.message || 'Could not connect to Wabba. Please try again.', response.status);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('The connection server returned an invalid response. Please try again.');
  if (auth.currentUser?.uid !== user.uid) throw new Error('Your Bingo account changed. Start connecting again.');
  return payload;
}

async function startWabba(auth, signal) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to Bingo, then connect to Wabba.');
  // Only an ambiguous (e.g. lost network response) start is reused, and only
  // within its initiating tab. Successful starts must never reopen a consumed
  // approval URL. These IDs contain no credentials or PKCE verifier.
  const key = startKeyFor(user.uid);
  let pending = readStored(sessionStorage, key);
  if (!pending || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= Date.now() ||
      typeof pending.requestKey !== 'string' || !requestKeyPattern.test(pending.requestKey)) {
    pending = { requestKey: crypto.randomUUID(), expiresAt: Date.now() + 15 * 60 * 1000 };
    sessionStorage.setItem(key, JSON.stringify(pending));
  }
  let result;
  try {
    result = await call(auth, '/wabba/link/start', { request_key: pending.requestKey }, signal);
  } catch (error) {
    // A definite rejection cannot be recovered by repeating the same request.
    // Network/server failures remain retryable with their original request ID.
    if (error instanceof ConnectionRequestError && [400, 409, 410, 422].includes(error.status)) clearStart(user.uid, pending.requestKey);
    throw error;
  }
  if (typeof result.state !== 'string' || !statePattern.test(result.state)) throw new Error('The connection server returned an invalid state. Please try again.');
  const bindingKey = callbackKeyFor(user.uid, result.state);
  const existing = readStored(localStorage, bindingKey);
  if (existing && existing.requestKey !== pending.requestKey) throw new Error('This connection conflicts with another request. Start again from Bingo.');
  // Each state gets its own atomic storage entry: simultaneous tabs cannot
  // overwrite another flow or attach its callback to the newest request.
  localStorage.setItem(bindingKey, JSON.stringify(pending));
  clearStart(user.uid, pending.requestKey);
  return result;
}

export function setupWabba(auth) {
  // Optional integration: unconfigured/disabled setup must not interrupt Bingo
  // or display an action that cannot work. Repeated game initialization is safe.
  if (entryMounted || !configuration()) return false;
  try {
    mountWabbaEntry(() => loadLauncher(auth));
    entryMounted = true;
    return true;
  } catch {
    return false;
  }
}

function loadLauncher(auth) {
  return new Promise((resolve, reject) => {
    const config = configuration();
    if (!config) { reject(new Error('The Bingo connection server is not configured yet.')); return; }
    const script = document.createElement('script');
    script.src = `${config.webOrigin}/sdk/wabba-connect.v1.js`;
    script.dataset.game = 'bingo';
    script.dataset.autoMount = 'false';
    script.onerror = () => { script.remove(); reject(new Error('Wabba could not load.')); };
    script.onload = () => {
      try {
        if (!window.WabbaConnect) throw new Error('Wabba could not initialize.');
        window.WabbaConnect.mount({ connect: ({ signal }) => startWabba(auth, signal) });
        resolve();
      } catch {
        script.remove(); reject(new Error('Wabba could not initialize. Please try again.'));
      }
    };
    document.head.append(script);
  });
}

export async function finishWabba(auth, callback) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to Bingo in the original tab, then try again here.');
  if (typeof callback?.state !== 'string' || !statePattern.test(callback.state)) throw new Error('This callback is invalid. Start a new Wabba connection from Bingo.');
  const key = callbackKeyFor(user.uid, callback.state);
  const pending = readStored(localStorage, key);
  if (!pending || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= Date.now() ||
      typeof pending.requestKey !== 'string' || !requestKeyPattern.test(pending.requestKey)) {
    throw new Error('Start a new Wabba connection from your Bingo account.');
  }
  const result = await call(auth, '/wabba/link/finish', { ...callback, request_key: pending.requestKey }, AbortSignal.timeout(15000));
  if (result.connected !== true) throw new Error('Connection was not confirmed. Try again.');
  localStorage.removeItem(key);
  return result;
}
