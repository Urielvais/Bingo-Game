/** Game-independent account linking. Never stores game tokens or PKCE secrets. */
import { WabbaResultClient } from './wabba-results.v1.mjs';

const requestPattern = /^[A-Za-z0-9_-]{16,100}$/;
const statePattern = /^[A-Za-z0-9_-]{43}$/;
const read = (storage, key) => { try { return JSON.parse(storage.getItem(key)); } catch { return null; } };

export class WabbaGameClient {
  #options;
  constructor({ game, apiOrigin, webOrigin, returnUrl, getIdentity, onResultState,
    fetch = globalThis.fetch, localStorage = globalThis.localStorage, sessionStorage = globalThis.sessionStorage,
    now = Date.now, randomUUID = () => globalThis.crypto.randomUUID() } = {}) {
    if (typeof game !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(game)) throw new TypeError('Use the registered game slug.');
    const web = new URL(webOrigin);
    const callback = new URL(returnUrl);
    if (web.protocol !== 'https:' || web.origin !== webOrigin || callback.protocol !== 'https:' ||
        callback.username || callback.password || callback.hash || callback.search) throw new TypeError('Use registered HTTPS account and callback URLs.');
    this.#options = { game, apiOrigin, webOrigin, returnUrl, getIdentity, fetch, localStorage, sessionStorage, now, randomUUID };
    this.results = new WabbaResultClient({ game, apiOrigin, getIdentity, onState: onResultState, fetch });
  }

  #identity() {
    if (!this.#options.apiOrigin) throw new Error('The Wabba API is not configured yet. Your account has not been connected.');
    const identity = this.#options.getIdentity();
    if (!identity || typeof identity.id !== 'string' || !identity.id || identity.id.length > 200 || typeof identity.getToken !== 'function') throw new Error('Sign in to your game, then connect to Wabba.');
    return identity;
  }

  #key(kind, uid, state) { return `wabba:${this.#options.game}:${kind}:${uid}${state ? `:${state}` : ''}`; }
  #valid(pending) { return pending && Number.isFinite(pending.expiresAt) && pending.expiresAt > this.#options.now() && requestPattern.test(pending.requestKey); }
  #clearStart(uid, requestKey) {
    const key = this.#key('start', uid);
    if (read(this.#options.sessionStorage, key)?.requestKey === requestKey) this.#options.sessionStorage.removeItem(key);
  }

  async #call(identity, path, body, signal) {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Wabba request cancelled or timed out. Please try again.'));
      if (bounded.aborted) { abort(); return; }
      bounded.addEventListener('abort', abort, { once: true });
      this.#request(identity, path, body, bounded).then(resolve, reject)
        .finally(() => bounded.removeEventListener('abort', abort));
    });
  }

  async #request(identity, path, body, signal) {
    const token = await identity.getToken({ signal });
    if (signal.aborted || this.#options.getIdentity()?.id !== identity.id) throw new Error('Your game account changed. Start connecting again.');
    if (typeof token !== 'string' || !/^[A-Za-z0-9._-]{1,8000}$/.test(token)) throw new Error('Sign in to your game again.');
    const response = await this.#options.fetch(`${this.#options.apiOrigin}/v1/sdk/games/${this.#options.game}${path}`, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error('Could not connect to Wabba. Please try again.');
      error.status = response.status;
      throw error;
    }
    if (signal.aborted || this.#options.getIdentity()?.id !== identity.id) throw new Error('Your game account changed. Start connecting again.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('The connection server returned an invalid response.');
    return payload;
  }

  async start({ signal = AbortSignal.timeout(15000) } = {}) {
    const identity = this.#identity();
    const options = this.#options;
    const key = this.#key('start', identity.id);
    let pending = read(options.sessionStorage, key);
    if (!this.#valid(pending)) {
      pending = { requestKey: options.randomUUID(), expiresAt: options.now() + 15 * 60 * 1000 };
      options.sessionStorage.setItem(key, JSON.stringify(pending));
    }
    let result;
    try {
      result = await this.#call(identity, '/link/start', { request_key: pending.requestKey, return_url: options.returnUrl }, signal);
    } catch (error) {
      if ([400, 409, 410, 422].includes(error.status)) this.#clearStart(identity.id, pending.requestKey);
      throw error;
    }
    const hosted = new URL(result.hosted_url);
    if (!statePattern.test(result.state) || hosted.origin !== options.webOrigin || hosted.username || hosted.password ||
        hosted.pathname !== '/account' || hosted.searchParams.get('game') !== options.game ||
        !statePattern.test(new URLSearchParams(hosted.hash.slice(1)).get('connect'))) throw new Error('Invalid Wabba approval URL or state.');
    const binding = this.#key('callback', identity.id, result.state);
    const existing = read(options.localStorage, binding);
    if (existing && existing.requestKey !== pending.requestKey) throw new Error('This connection conflicts with another request. Start again from your game.');
    options.localStorage.setItem(binding, JSON.stringify(pending));
    this.#clearStart(identity.id, pending.requestKey);
    return result;
  }

  async finish(callback) {
    const identity = this.#identity();
    if (typeof callback?.state !== 'string' || !statePattern.test(callback.state)) throw new Error('This callback is invalid. Start a new connection from your game.');
    const key = this.#key('callback', identity.id, callback.state);
    const pending = read(this.#options.localStorage, key);
    if (!this.#valid(pending)) throw new Error('Start a new Wabba connection from your game account.');
    const result = await this.#call(identity, '/link/finish', { state: callback.state, code: callback.code,
      link_session_id: callback.link_session_id, request_key: pending.requestKey }, AbortSignal.timeout(15000));
    if (result.connected !== true || result.gameUserId !== identity.id || typeof result.gameId !== 'string' ||
        typeof result.wabbaPlayerId !== 'string' || !result.wabbaPlayerId) throw new Error('Connection was not confirmed. Try again.');
    this.#options.localStorage.removeItem(key);
    return result;
  }
}
