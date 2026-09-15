import { wabbaConfig } from './wabba-config.js?v=widget-20260915-5';
import { mountWabbaEntry } from './wabba-entry-view.js?v=widget-20260915-5';
import { WabbaGameClient } from './wabba-sdk/sdk/wabba-client.v1.mjs?v=widget-20260915-5';

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

let gameClient;
function client() {
  if (!gameClient) gameClient = new WabbaGameClient({
    game: 'bingo', apiOrigin: configuration()?.apiOrigin, webOrigin: configuration()?.webOrigin,
    returnUrl: new URL('./wabba-callback.html', import.meta.url).href,
    getIdentity: () => {
      const user = gameAuth?.currentUser;
      return user ? { id: user.uid, getToken: () => user.getIdToken() } : null;
    },
    onResultState: state => entryController?.setResultState?.(state),
  });
  return gameClient;
}
function results() {
  resultClient = client().results;
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
  const apiOrigin = configuredOrigin(wabbaConfig.apiOrigin);
  return webOrigin ? { webOrigin, apiOrigin } : null;
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
    script.src = new URL('./wabba-sdk/sdk/wabba-connect.v1.js?v=widget-20260915-5', import.meta.url).href;
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
          ...(config.apiOrigin ? { connect: ({ signal }) => client().start({ signal }) } : {}),
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
  if (auth) gameAuth = auth;
  const result = await client().finish(callback);
  rememberConfirmedConnection(result.gameUserId);
  return result;
}
