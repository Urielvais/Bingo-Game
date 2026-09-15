/* Wabba launcher v1. Account creation is hosted by Wabba, outside the game. */
(() => {
  "use strict";
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;
  const game = script.dataset.game;
  if (typeof game !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(game)) return;
  const assetURL = new URL(script.src);
  const assets = assetURL.origin;
  let origin;
  let endpoint;
  try {
    const url = new URL(script.dataset.wabbaOrigin || assets);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") return;
    origin = url.origin;
    if (script.dataset.connectEndpoint) {
      const candidate = new URL(script.dataset.connectEndpoint, window.location.origin);
      if (candidate.origin !== window.location.origin || candidate.username || candidate.password ||
          candidate.search || candidate.hash) return;
      endpoint = candidate.href;
    }
  } catch { return; }
  const snoozeDuration = 300000;
  const snoozeKey = `wabba:launcher:snooze:${game}`;
  let snoozeUntil = 0;
  try {
    const stored = Number(window.sessionStorage.getItem(snoozeKey));
    if (Number.isSafeInteger(stored) && stored > 0 && stored <= Date.now() + snoozeDuration) snoozeUntil = stored;
  } catch { /* Blocked storage must not prevent the widget or an in-memory snooze. */ }
  let reminderPending = snoozeUntil > 0;
  let restoredSnooze = reminderPending;
  let reminderTimer;
  let active = false;
  let domReadyQueued = false;
  let pendingOptions;
  const context = { playing: false, connected: false, ready: true };
  const saveSnooze = () => {
    try {
      if (snoozeUntil) window.sessionStorage.setItem(snoozeKey, String(snoozeUntil));
      else window.sessionStorage.removeItem(snoozeKey);
    } catch { /* The current page still keeps the deadline in memory. */ }
  };
  const scheduleReminder = () => {
    clearTimeout(reminderTimer);
    reminderTimer = undefined;
    if (!active || !reminderPending) return;
    const remaining = snoozeUntil - Date.now();
    if (remaining > 0) {
      reminderTimer = setTimeout(scheduleReminder, remaining);
      return;
    }
    // Host context changes presentation only, never Wabba account state.
    if (!context.ready || context.playing || context.connected) return;
    const host = document.getElementById("wabba-connect-launcher");
    if (!host) return;
    reminderPending = false;
    snoozeUntil = 0;
    saveSnooze();
    host.hidden = false;
  };
  const dismiss = ({ durationMs = snoozeDuration } = {}) => {
    if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > snoozeDuration) {
      throw new TypeError("durationMs must be between 1 and 300000.");
    }
    snoozeUntil = Date.now() + durationMs;
    reminderPending = true;
    restoredSnooze = false;
    saveSnooze();
    const host = document.getElementById("wabba-connect-launcher");
    if (host) host.hidden = true;
    scheduleReminder();
  };
  const setContext = update => {
    if (!update || typeof update !== "object" || Array.isArray(update) ||
        Object.keys(update).some(key => !["playing", "connected", "ready"].includes(key) || typeof update[key] !== "boolean")) {
      throw new TypeError("Provide playing, connected and/or ready booleans.");
    }
    Object.assign(context, update);
    // Do not hide an already-visible card; context only postpones reminders.
    scheduleReminder();
  };
  const mount = ({ connect, dismissible = false } = {}) => {
    if (connect !== undefined && typeof connect !== "function") throw new TypeError("connect must be a function.");
    if (typeof dismissible !== "boolean") throw new TypeError("dismissible must be a boolean.");
    active = true;
    if (!document.body) {
      pendingOptions = { connect, dismissible };
      if (!domReadyQueued) {
        domReadyQueued = true;
        document.addEventListener("DOMContentLoaded", () => {
          domReadyQueued = false;
          if (active) mount(pendingOptions);
        }, { once: true });
      }
      return;
    }
    if (document.getElementById("wabba-connect-launcher")) { scheduleReminder(); return; }
    // A previous release's X must not leave the default, persistent card hidden.
    // Explicit host-driven dismissal still works; restoring it is opt-in.
    if (!dismissible && restoredSnooze) {
      snoozeUntil = 0;
      reminderPending = false;
      saveSnooze();
    }
    restoredSnooze = false;
    const host = document.createElement("aside");
    host.id = "wabba-connect-launcher";
    // Retain the same host, loaded stylesheet and connector throughout a snooze.
    host.hidden = reminderPending;
    host.setAttribute("aria-label", "Wabba game connection");
    const root = host.attachShadow({ mode: "open" });
    const css = document.createElement("link");
    css.rel = "stylesheet";
    const cssURL = new URL("./wabba-connect.v1.css", assetURL);
    const releases = assetURL.searchParams.getAll("v");
    // Version the stylesheet with the script, without forwarding arbitrary
    // query parameters that might contain credentials or unrelated state.
    if (releases.length === 1 && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(releases[0])) {
      cssURL.searchParams.set("v", releases[0]);
    }
    css.href = cssURL.href;
    const card = document.createElement("div");
    card.className = "wabba-card";
    const link = document.createElement("a");
    link.href = `${origin}/account?game=${encodeURIComponent(game)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Connect to Wabba. Create an account in a new tab.");
    const logo = document.createElement("img");
    logo.src = new URL("../brand/wabba-logo-transparent.png", assetURL).href;
    logo.alt = "";
    logo.width = logo.height = 40;
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = "Connect to Wabba";
    const subtitle = document.createElement("small");
    subtitle.textContent = "Win games. Get gift cards.";
    text.append(title, subtitle);
    const arrow = document.createElement("span");
    arrow.className = "wabba-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    link.append(logo, text, arrow);
    const status = document.createElement("p");
    status.className = "wabba-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    let busy = false;
    if (endpoint || connect) {
      link.setAttribute("aria-label", "Connect to Wabba. Link your game account in a new tab.");
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        link.setAttribute("aria-busy", "true");
        status.hidden = false;
        status.textContent = "Opening your Wabba connection…";
        const tab = window.open("about:blank", "_blank");
        if (tab) {
          tab.opener = null;
          tab.document.title = "Connecting to Wabba";
          tab.document.body.textContent = "Opening your Wabba connection…";
        }
        try {
          if (!tab) throw new Error("Allow a new tab, then try connecting again.");
          let payload;
          if (connect) {
            // Authentication and game-specific transport belong to the adapter.
            payload = await connect({ signal: AbortSignal.timeout(15000) });
          } else {
          const response = await fetch(endpoint, {
            method: "POST", credentials: "same-origin", redirect: "error",
            headers: { "Content-Type": "application/json", "X-Wabba-Request": "1" },
            body: "{}", signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw new Error(response.status === 401
            ? "Sign in to your game, then connect to Wabba."
            : "Couldn’t start the connection. Please try again.");
          payload = await response.json();
          }
          const hosted = new URL(payload.hosted_url);
          if (hosted.origin !== origin || hosted.username || hosted.password ||
              hosted.pathname !== "/account" || hosted.searchParams.get("game") !== game ||
              !/^#connect=[A-Za-z0-9_-]{43}$/.test(hosted.hash)) {
            throw new Error("The game returned an invalid Wabba connection. Please try again.");
          }
          if (tab.closed) throw new Error("The Wabba tab was closed. Please try again.");
          tab.location.replace(hosted.href);
          status.textContent = "Finish connecting in the Wabba tab.";
        } catch (error) {
          if (tab && !tab.closed) tab.close();
          status.textContent = error instanceof Error && error.name !== "TimeoutError"
            && error.name !== "TypeError" ? error.message : "Couldn’t reach Wabba. Please try again.";
        } finally {
          busy = false;
          link.removeAttribute("aria-busy");
        }
      });
    }
    card.append(link);
    if (dismissible) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "wabba-close";
      close.setAttribute("aria-label", "Hide Wabba for five minutes");
      close.textContent = "×";
      close.addEventListener("click", () => dismiss());
      card.append(close);
    }
    card.append(status);
    root.append(css, card);
    document.body.append(host);
    scheduleReminder();
  };
  window.WabbaConnect = Object.freeze({
    mount,
    dismiss,
    setContext,
    open: () => {
      const host = document.getElementById("wabba-connect-launcher");
      if (!host || host.hidden) return false;
      const link = host.shadowRoot?.querySelector("a");
      if (!link) return false;
      link.click();
      return true;
    },
    destroy: () => {
      active = false;
      clearTimeout(reminderTimer);
      reminderTimer = undefined;
      document.getElementById("wabba-connect-launcher")?.remove();
    },
  });
  if (script.dataset.autoMount !== "false") mount();
})();
