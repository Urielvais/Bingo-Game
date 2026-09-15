import { wabbaConfig } from './wabba-config.js?v=widget-20260915-4';
import { mountWabbaEntry } from './wabba-entry-view.js?v=widget-20260915-4';
import { WabbaResultClient } from './wabba-sdk/sdk/wabba-results.v1.mjs?v=widget-20260915-4';

const startKeyFor = uid => `wabba:bingo:start:${uid}`;
const callbackKeyFor = (uid, state) => `wabba:bingo:callback:${uid}:${state}`;
const requestKeyPattern = /^[A-Za-z0-9_-]{16,100}$/;
const statePattern = /^[A-Za-z0-9_-]{43}$/;
let entryMounted = false;
let gameAuth = null;
let entryController = null;
let storageListening = false;
const connectedPreferenceKey = uid => `wabba:bingo:connected:${uid}`;
const connectedInMemory = new Set();
const launcherContext = { playing: false, connected: false, ready: false };
let resultClient;
let endedMatchId = null;
let resultIdentity = null;

function results() {
  if (!resultClient) resultClient = new WabbaResultClient({
    apiOrigin: configuration()?.adapterOrigin,
    getIdentity: () => {
      const user = gameAuth?.currentUser;
      return user ? { id: user.uid, getToken: () => user.getIdToken() } : null;
    },
    onState: state => entryController?.setResultState?.(state),
  });
  return resultClient;
}

export function prepareWabbaMatch() {
  endedMatchId = null;
  if (resultClient) resultClient.reset();
  else entryController?.setResultState?.({ status: 'idle', message: '' });
}

export function checkWabbaResult(matchId) {
  if (typeof matchId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(matchId) || /\s/.test(matchId)) return Promise.resolve(null);
  endedMatchId = matchId;
  // A remembered link only gates automatic collection; the server rechecks the
  // actual Wabba binding on every result request, including revocation.
  if (!launcherContext.connected) {
    entryController?.setResultState?.({ status: 'not_connected', message: 'Connect your game account to Wabba to check this match.' });
    return Promise.resolve(null);
  }
  return results().watch(matchId).catch(() => null);
}

function syncConnectedContext() {
  const uid = gameAuth?.currentUser?.uid;
  if (uid !== resultIdentity) { resultClient?.reset(); resultIdentity = uid; }
  let remembered = false;
  try { remembered = !!uid && localStorage.getItem(connectedPreferenceKey(uid)) === 'true'; } catch { /* UI preference only. */ }
  launcherContext.connected = !!uid && (connectedInMemory.has(uid) || remembered);
  entryController?.setContext(launcherContext);
  if (endedMatchId && launcherContext.connected) void checkWabbaResult(endedMatchId);
}

export function updateWabbaContext({ playing } = {}) {
  if (typeof playing === 'boolean') launcherContext.playing = playing;
  entryController?.setContext(launcherContext);
}

function rememberConfirmedConnection(uid) {
  // This local preference provides display context only. It never authorizes an
  // API operation, identifies a Wabba account, or qualifies a player for value.
  connectedInMemory.add(uid);
  try { localStorage.setItem(connectedPreferenceKey(uid), 'true'); } catch { /* Keep in memory. */ }
  syncConnectedContext();
}

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
  return webOrigin ? { webOrigin, adapterOrigin } : null;
}

function connectionConfiguration() {
  const config = configuration();
  if (!config?.adapterOrigin) {
    throw new Error('Bingo account linking is not available yet. Your account has not been connected.');
  }
  return config;
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
  const config = connectionConfiguration();
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in to Bingo, then connect to Wabba.');
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
  // Missing infrastructure must not collect a Firebase token or create a
  // pending request. SDK visibility is independent from server readiness.
  connectionConfiguration();
  const user = auth?.currentUser;
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

export function setupWabba(auth, { contextReady = false } = {}) {
  // The local entry starts independently of Firebase. Bingo injects its auth
  // instance when available, even if the widget was already mounted.
  if (auth) gameAuth = auth;
  // Identity readiness is presentation context, never a fabricated connection.
  if (contextReady || auth?.currentUser) launcherContext.ready = true;
  syncConnectedContext();
  if (!storageListening) {
    window.addEventListener('storage', event => {
      const uid = gameAuth?.currentUser?.uid;
      if (uid && (event.key === null || event.key === connectedPreferenceKey(uid))) syncConnectedContext();
    });
    storageListening = true;
  }
  // Display the installed SDK independently of the adapter's deployment.
  // Explicit opt-out and invalid account origins still stay inert.
  if (entryMounted || !configuration()) return false;
  try {
    // Eligibility belongs to Wabba's account flow, not a second Bingo dialog.
    // This non-secret link also works while the local SDK is loading/offline.
    entryController = mountWabbaEntry(() => loadLauncher(), `${configuration().webOrigin}/account?game=bingo`, {
      onResultRetry: () => resultClient ? resultClient.retry() : endedMatchId && checkWabbaResult(endedMatchId),
    });
    entryController?.setContext(launcherContext);
    entryMounted = true;
    return true;
  } catch {
    return false;
  }
}

function loadLauncher() {
  return new Promise((resolve, reject) => {
    const config = configuration();
    if (!config) { reject(new Error('The Bingo connection server is not configured yet.')); return; }
    const script = document.createElement('script');
    // Self-host the unchanged shared SDK with Bingo, including path-based hosts.
    // Showing the launcher must not depend on access to Wabba's private website.
    script.src = new URL('./wabba-sdk/sdk/wabba-connect.v1.js?v=widget-20260915-4', import.meta.url).href;
    script.dataset.game = 'bingo';
    script.dataset.wabbaOrigin = config.webOrigin;
    script.dataset.autoMount = 'false';
    let settled = false;
    let timer;
    let host;
    let stylesheet;
    const settle = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (stylesheet) { stylesheet.onload = null; stylesheet.onerror = null; }
      if (error) { if (host) window.WabbaConnect?.destroy?.(); host?.remove(); script.remove(); reject(error); }
      else { host.style.removeProperty('display'); resolve(window.WabbaConnect); }
    };
    script.onerror = () => settle(new Error('Wabba could not load. Please try again.'));
    script.onload = () => {
      // An old request may finish after timeout/removal and a new attempt.
      if (settled) return;
      try {
        if (!window.WabbaConnect || !['mount', 'setContext', 'destroy'].every(
          name => typeof window.WabbaConnect[name] === 'function')) throw new Error('Wabba could not initialize.');
        // Seed presentation context without hiding the persistent launcher.
        window.WabbaConnect.setContext(launcherContext);
        // Missing infrastructure must not trap the player at a setup error.
        // Ordinary navigation opens Wabba, but is never proof of an account link.
        window.WabbaConnect.mount({
          ...(config.adapterOrigin ? { connect: ({ signal }) => startWabba(gameAuth, signal) } : {}),
          dismissible: false,
          onResultRetry: () => resultClient ? resultClient.retry() : endedMatchId && checkWabbaResult(endedMatchId),
        });
        host = document.getElementById('wabba-connect-launcher');
        if (!host) throw new Error('Wabba launcher did not mount.');
        // A mounted host alone is not ready: its shadow stylesheet loads
        // separately. Keep the styled native card until that CSS is available,
        // so slow/failed CSS cannot turn the launcher into plain page text.
        host.style.setProperty('display', 'none', 'important');
        stylesheet = host.shadowRoot?.querySelector('link[rel="stylesheet"]');
        if (!stylesheet) throw new Error('Wabba launcher styles are missing.');
        stylesheet.onload = () => settle();
        stylesheet.onerror = () => settle(new Error('Wabba styles could not load. Please try again.'));
        if (stylesheet.sheet) settle();
      } catch {
        settle(new Error('Wabba could not initialize. Please try again.'));
      }
    };
    timer = setTimeout(() => settle(new Error('Wabba took too long to load. Please try again.')), 15000);
    try { document.head.append(script); }
    catch { settle(new Error('Wabba could not load. Please try again.')); }
  });
}

export async function finishWabba(auth, callback) {
  connectionConfiguration();
  const user = auth?.currentUser;
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
  rememberConfirmedConnection(user.uid);
  localStorage.removeItem(key);
  return result;
}
