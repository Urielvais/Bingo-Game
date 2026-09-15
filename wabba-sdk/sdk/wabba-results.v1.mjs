/** Framework-independent result reads. Identity adapters and game events belong to the host. */
const matchPattern = /^[A-Za-z0-9_-]{1,200}$/;
const identityId = value => typeof value?.id === "string" && value.id.length > 0 && value.id.length <= 200 ? value.id : null;
const messages = Object.freeze({
  idle: "", checking: "Checking your game result…", pending: "The game is still saving its result. Check again shortly.",
  win: "Win recorded. This is not yet a gift-card award.", loss: "Match recorded — you did not win this match.",
  draw: "Match recorded as a draw.", completed: "Game completion recorded.", void: "This match was voided. No win recorded.",
  not_connected: "Connect your game account to Wabba to check this match.",
  sign_in: "Sign in to your game to check this match.", unavailable: "Could not check the result. Please try again.",
});

function accountResult(data, matchId, userId) {
  if (!data || data.externalMatchId !== matchId || data.gameUserId !== userId ||
      data.connected !== true || typeof data.gameId !== "string" || !data.gameId ||
      typeof data.wabbaPlayerId !== "string" || !data.wabbaPlayerId || !["game_record", "partner_report"].includes(data.evidence)) {
    throw new Error("Invalid result binding");
  }
  if (data.status === "not_final") return { status: "pending" };
  if (data.schemaVersion === 2) {
    const people = data.participants;
    const outcomes = ["win", "loss", "draw", "completed", "void"];
    if (data.status !== "recorded" || !Array.isArray(people) || people.length < 1 || people.length > 1000 ||
        !people.every(p => identityId({ id: p?.gameUserId }) && outcomes.includes(p.outcome) &&
          (p.score == null || (Number.isFinite(p.score) && Math.abs(p.score) <= Number.MAX_SAFE_INTEGER)) &&
          (p.rank == null || (Number.isSafeInteger(p.rank) && p.rank >= 1 && p.rank <= 1000000)) &&
          (p.teamId == null || identityId({ id: p.teamId }))) ||
        new Set(people.map(p => p.gameUserId)).size !== people.length ||
        typeof data.completedAt !== "string" || !Number.isFinite(Date.parse(data.completedAt))) throw new Error("Invalid result contract");
    const participant = people.find(p => p.gameUserId === userId);
    const winners = people.filter(p => p.outcome === "win").map(p => p.gameUserId);
    if (!participant || data.outcome !== participant.outcome || data.won !== (participant.outcome === "win") ||
        !Array.isArray(data.winnerIds) || JSON.stringify([...data.winnerIds].sort()) !== JSON.stringify([...winners].sort())) throw new Error("Inconsistent player outcome");
    return { status: participant.outcome, result: Object.freeze({
      schemaVersion: 2, gameId: data.gameId, externalMatchId: matchId, gameUserId: userId, wabbaPlayerId: data.wabbaPlayerId,
      connected: true, email: typeof data.email === "string" ? data.email : null,
      emailVerified: typeof data.email === "string" && data.emailVerified === true,
      status: "recorded", evidence: data.evidence, outcome: participant.outcome, won: data.won,
      participants: Object.freeze(people.map(p => Object.freeze({ gameUserId: p.gameUserId, outcome: p.outcome,
        score: p.score ?? null, rank: p.rank ?? null, teamId: p.teamId ?? null }))),
      participantIds: Object.freeze(people.map(p => p.gameUserId)), winnerIds: Object.freeze(winners),
      winnerId: winners.length === 1 ? winners[0] : null, completedAt: data.completedAt,
    }) };
  }
  if (data.status !== "recorded" || !Array.isArray(data.participantIds) ||
      data.participantIds.length < 1 || data.participantIds.length > 1000 ||
      !data.participantIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 200) ||
      new Set(data.participantIds).size !== data.participantIds.length || !data.participantIds.includes(userId) ||
      (data.winnerId !== null && !data.participantIds.includes(data.winnerId)) ||
      typeof data.won !== "boolean" || data.won !== (data.winnerId === userId) ||
      typeof data.completedAt !== "string" || !Number.isFinite(Date.parse(data.completedAt))) {
    throw new Error("Invalid recorded result");
  }
  const outcome = data.winnerId === null ? "draw" : data.won ? "win" : "loss";
  if (data.outcome !== outcome) throw new Error("Inconsistent outcome");
  // Return only the documented fields, never arbitrary provider records.
  return { status: outcome, result: Object.freeze({
    gameId: data.gameId, externalMatchId: matchId, gameUserId: userId, wabbaPlayerId: data.wabbaPlayerId,
    connected: true, email: typeof data.email === "string" ? data.email : null,
    emailVerified: typeof data.email === "string" && data.emailVerified === true,
    status: "recorded", evidence: "game_record", outcome, won: data.won,
    participantIds: Object.freeze([...data.participantIds]), winnerId: data.winnerId, completedAt: data.completedAt,
  }) };
}

export class WabbaResultClient {
  #origin;
  #path;
  #identity;
  #fetch;
  #onState;
  #attempts;
  #delay;
  #timeout;
  #active;
  #last;
  #state = Object.freeze({ status: "idle", message: "", externalMatchId: null });

  constructor({ apiOrigin, game, getIdentity, onState = () => {}, fetch: transport = globalThis.fetch,
    maxAttempts = 5, retryDelayMs = 1500, timeoutMs = 10000 } = {}) {
    if (typeof getIdentity !== "function" || typeof onState !== "function" || typeof transport !== "function") throw new TypeError("Provide identity, state and HTTP adapters.");
    if (![maxAttempts, retryDelayMs, timeoutMs].every(Number.isSafeInteger) || maxAttempts < 1 || maxAttempts > 10 ||
        retryDelayMs < 1 || retryDelayMs > 10000 || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError("Use bounded result retry settings.");
    if (apiOrigin != null) {
      const url = new URL(apiOrigin);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.origin !== apiOrigin || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new TypeError("Use the game server's exact HTTPS origin.");
      this.#origin = url.origin;
    }
    if (game != null && (typeof game !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(game))) throw new TypeError("Use the registered game slug.");
    this.#path = game == null ? "/wabba" : `/v1/sdk/games/${game}`;
    this.#identity = getIdentity; this.#fetch = transport; this.#onState = onState;
    this.#attempts = maxAttempts; this.#delay = retryDelayMs; this.#timeout = timeoutMs;
  }

  get state() { return this.#state; }

  #emit(status, matchId, result) {
    this.#state = Object.freeze({ status, message: messages[status], externalMatchId: matchId, ...(result ? { result } : {}) });
    try { this.#onState(this.#state); } catch { /* Presentation cannot break the result lifecycle. */ }
    return this.#state;
  }

  reset() {
    this.#active?.controller.abort(); this.#active = undefined; this.#last = undefined;
    this.#emit("idle", null);
  }

  retry() { return this.#last ? this.watch(this.#last.matchId, { force: true }) : Promise.resolve(this.#state); }

  watch(matchId, { force = false } = {}) {
    if (typeof matchId !== "string" || !matchPattern.test(matchId) || matchPattern.exec(matchId)?.[0] !== matchId) return Promise.reject(new TypeError("Provide only a safe match ID."));
    const identity = this.#identity();
    const userId = identityId(identity);
    if (!force && this.#last?.matchId === matchId && this.#last.userId === userId) {
      if (this.#active) return this.#active.promise;
      if (["win", "loss", "draw", "completed", "void"].includes(this.#state.status)) return Promise.resolve(this.#state);
    }
    this.#active?.controller.abort();
    this.#active = undefined;
    this.#last = { matchId, userId };
    if (!this.#origin) return Promise.resolve(this.#emit("unavailable", matchId));
    if (!userId || typeof identity.getToken !== "function") return Promise.resolve(this.#emit("sign_in", matchId));
    const operation = { controller: new AbortController() };
    this.#active = operation;
    this.#emit("checking", matchId);
    operation.promise = this.#run(operation, identity, matchId);
    return operation.promise;
  }

  async #run(operation, identity, matchId) {
    const current = () => this.#active === operation && identityId(this.#identity()) === identity.id;
    const outerSignal = operation.controller.signal;
    try {
      for (let attempt = 0; attempt < this.#attempts; attempt++) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        outerSignal.addEventListener("abort", abort, { once: true });
        let timer;
        let response;
        try {
          response = await Promise.race([
            (async () => {
              const token = await identity.getToken({ signal: controller.signal });
              if (!current() || controller.signal.aborted) throw new Error("Stale identity");
              if (typeof token !== "string" || !/^[A-Za-z0-9._-]{1,8000}$/.test(token)) throw new Error("Invalid game token");
              const res = await this.#fetch(`${this.#origin}${this.#path}/matches/${encodeURIComponent(matchId)}/result`, {
                method: "GET", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
                headers: { Authorization: `Bearer ${token}` },
              });
              const body = await res.json().catch(() => null);
              return { status: res.status, ok: res.ok, body };
            })(),
            new Promise((_, reject) => {
              timer = setTimeout(() => { controller.abort(); reject(new Error("Result timed out")); }, this.#timeout);
              controller.signal.addEventListener("abort", () => reject(new Error("Result cancelled")), { once: true });
            }),
          ]);
        } finally { clearTimeout(timer); outerSignal.removeEventListener("abort", abort); }
        if (!current()) return this.#state;
        if (response.status === 401) return this.#emit("sign_in", matchId);
        if (response.status === 409) return this.#emit(response.body?.code === "game_result_conflict" ? "unavailable" : "not_connected", matchId);
        if (!response.ok) throw new Error("Result unavailable");
        const validated = accountResult(response.body, matchId, identity.id);
        if (validated.status !== "pending") return this.#emit(validated.status, matchId, validated.result);
        this.#emit("pending", matchId);
        if (attempt + 1 < this.#attempts) await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(delay); reject(new Error("Result cancelled")); };
          const delay = setTimeout(() => { outerSignal.removeEventListener("abort", abort); resolve(); }, this.#delay);
          outerSignal.addEventListener("abort", abort, { once: true });
        });
        if (!current()) return this.#state;
      }
      return this.#state;
    } catch {
      if (current()) return this.#emit("unavailable", matchId);
      return this.#state;
    } finally {
      if (this.#active === operation) {
        this.#active = undefined;
        if (identityId(this.#identity()) !== identity.id) { this.#last = undefined; this.#emit("idle", null); }
      }
    }
  }
}
