import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../wabba-sdk/sdk/wabba-connect.v1.js", import.meta.url), "utf8");

// A minimal DOM double checks SDK behavior, not browser rendering or layout.
function load({ dataset = {}, response, popupBlocked = false, scriptSrc = "https://assets.example.test/sdk/wabba-connect.v1.js",
  storage = new Map(), storageBlocked = false, timeMs = 1000000, bodyReady = true } = {}) {
  const nodes = [];
  const timers = new Map();
  let now = timeMs;
  let timerId = 0;
  const clock = {
    advance(milliseconds) {
      const destination = now + milliseconds;
      let iterations = 0;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= destination)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        assert.ok(iterations++ < 100, "reminders must not busy-loop");
        const [id, timer] = next;
        timers.delete(id); now = timer.at; timer.callback();
      }
      now = destination;
    },
  };
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; nodes.push(this); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    attachShadow() { this.shadowRoot = new Element("shadow"); return this.shadowRoot; }
    addEventListener(name, handler) { this.events[name] = handler; }
    click() { this.events.click?.({ preventDefault() {} }); }
    querySelector(tag) {
      for (const child of this.children) {
        if (child.tag === tag || (tag.startsWith(".") && child.className === tag.slice(1))) return child;
        const match = child.querySelector(tag);
        if (match) return match;
      }
      return null;
    }
    remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  }
  class Script extends Element {}
  const script = new Script("script");
  script.dataset = { game: "bingo", ...dataset };
  script.src = scriptSrc;
  const documentEvents = {};
  const document = { currentScript: script, body: bodyReady ? new Element("body") : null,
    createElement: tag => new Element(tag),
    getElementById: id => nodes.find(node => node.id === id && node.parent),
    addEventListener: (name, handler) => { documentEvents[name] = handler; },
  };
  const requests = [];
  const tab = { opener: {}, document: { body: {} }, closed: false,
    location: { replace(url) { tab.destination = url; } }, close() { tab.closed = true; } };
  const window = { location: { origin: "https://game.example.test" }, open: () => popupBlocked ? null : tab,
    sessionStorage: {
      getItem(key) { if (storageBlocked) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw new Error("Storage blocked"); storage.set(key, value); },
      removeItem(key) { if (storageBlocked) throw new Error("Storage blocked"); storage.delete(key); },
    },
  };
  vm.runInNewContext(source, { document, window, HTMLScriptElement: Script, URL, AbortSignal, Date: { now: () => now },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return response ?? Response.json({ hosted_url: `https://wabba.example.test/account?game=bingo#connect=${"t".repeat(43)}` });
    },
  });
  const host = () => document.getElementById("wabba-connect-launcher");
  return { window, document, requests, tab, clock, timers, storage, host,
    ready: () => { document.body = new Element("body"); documentEvents.DOMContentLoaded?.(); },
    link: () => host()?.shadowRoot?.querySelector("a"),
    status: () => host()?.shadowRoot?.querySelector(".wabba-status"),
    close: () => host()?.shadowRoot?.querySelector(".wabba-close") ?? undefined,
    stylesheet: () => nodes.find(node => node.tag === "link"),
    logo: () => nodes.find(node => node.tag === "img"),
    title: () => nodes.find(node => node.tag === "strong"),
  };
}

test("installed SDK retains result status and retry during deferred mounting", () => {
  for (const bodyReady of [true, false]) {
    const sdk = load({ bodyReady, dataset: { autoMount: "false", wabbaOrigin: "https://wabba.example.test" } });
    let retries = 0;
    sdk.window.WabbaConnect.setResultState({ status: "pending", message: "The match is saving." });
    sdk.window.WabbaConnect.mount({ onResultRetry: () => { retries++; } });
    if (!bodyReady) sdk.ready();
    const root = sdk.host().shadowRoot;
    const message = root.querySelector(".wabba-result");
    const retry = root.querySelector(".wabba-result-retry");
    assert.equal(message.textContent, "The match is saving.");
    assert.equal(message.attributes["role"], "status");
    assert.equal(message.attributes["aria-live"], "polite");
    assert.equal(message.attributes["aria-atomic"], "true");
    assert.equal(message.hidden, false);
    assert.equal(retry.hidden, false);
    retry.click();
    assert.equal(retries, 1);
    sdk.window.WabbaConnect.setResultState({ status: "win", message: "Win recorded. This is not yet a gift-card award." });
    assert.equal(retry.hidden, true);
    assert.match(message.textContent, /not yet/);
    sdk.window.WabbaConnect.setResultState({ status: "idle", message: "" });
    assert.equal(message.hidden, true);
    assert.equal(retry.hidden, true);
    assert.equal(sdk.close(), undefined);
    assert.equal(sdk.requests.length, 0, "presentation itself never fetches or submits results");
    assert.equal(sdk.host().hidden, false);
  }
});

test("installed result presentation uses plain text and rejects invalid states", () => {
  const sdk = load();
  const message = sdk.host().shadowRoot.querySelector(".wabba-result");
  const markup = '<img src=x onerror="stealToken()">';
  sdk.window.WabbaConnect.setResultState({ status: "unavailable", message: markup });
  assert.equal(message.textContent, markup);
  assert.equal(message.children.length, 0);
  assert.equal(message.innerHTML, undefined);
  for (const update of [null, { status: "rewarded", message: "paid" }, { status: "win", message: "x".repeat(321) }]) {
    assert.throws(() => sdk.window.WabbaConnect.setResultState(update), /result presentation/);
  }
  assert.equal(sdk.host().shadowRoot.querySelector(".wabba-result-retry"), null, "no inert retry without a host callback");
  assert.equal(sdk.close(), undefined);
});
