# Optional Wabba account connection

This draft adds a browser-side connection to Wabba. **It is disabled by default
and is not a live rewards integration.** Normal Bingo authentication and gameplay
are unchanged. No browser-calculated winner is submitted to Wabba.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| `wabba-config.js` | Explicit activation and deployment origins |
| `wabba-age-gate.js`, `wabba-entry.css` | Local entry button and neutral adult-only pilot screen |
| `wabba.js` | Bingo Firebase identity, request bindings, SDK loading, callback completion |
| `wabba-callback.*` | Standalone return page and recoverable confirmation status |
| Shared Wabba browser SDK (separately hosted) | Branded connection launcher and approval navigation |
| Bingo server adapter (separate Wabba deployment) | Verify Firebase tokens; own PKCE, partner signing, and durable link state |
| Wabba API (separate deployment) | Account consent, eligibility, ledger, and rewards |

The shared SDK and server services are not copied into each game's repository.
This repository contains no partner secret, service-account credential, or
browser winner-reporting endpoint. An account link alone does not qualify a
player or a match for a reward.

## Before enabling

1. Deploy the Wabba API and the Bingo server adapter from the Wabba workspace
   (`integrations/bingo/server` using `sdk/node`). They are not included here.
   The adapter must verify Firebase ID tokens, including revocation, and use
   server-only durable storage. Do not replace Bingo's existing Firestore rules
   with the adapter's dedicated-database rules.
2. Make the approved Wabba account flow and `/sdk/wabba-connect.v1.js` available
   to the intended players. The currently configured Wabba site is owner-private:
   an unauthenticated SDK request returned HTTP 401 during review. Changing
   `enabled` does not make that hosting public.
3. Register the actual Bingo origin and its exact
   `https://<bingo-host>/wabba-callback.html` callback in the server-side partner
   configuration. If Bingo is served under a path (for example a GitHub Pages
   project), include that path in the callback. Configure exact-origin CORS at
   the adapter; use HTTPS and do not redirect authenticated API requests.
4. Set `webOrigin` and `adapterOrigin` in `wabba-config.js` to those deployed
   HTTPS origins, without paths, trailing slashes, queries, or fragments. Set
   `enabled: true` only after deployment checks pass. Missing/invalid origins
   or disabled configuration do not mount a Wabba entry button.
5. Verify the manual checks below on the real hosting domains. Do not enable
   rewards until authoritative results and funding are independently ready.

No Wabba assets or API calls are made by this integration before the player
selects the adult age group. The local age screen is not identity or age
verification; the Wabba backend must enforce eligibility separately.
SDK loading has a 15-second deadline so a stalled download releases the age
screen for retry; late completion of an abandoned load cannot mount the UI.

## Browser/server contract

Both adapter endpoints accept JSON over HTTPS with
`Authorization: Bearer <Bingo Firebase ID token>`. Tokens are obtained from the
current Firebase user and are not persisted by these integration files. API
requests omit cookies and reject redirects.

- `POST /wabba/link/start`: `{ "request_key": "<random per-attempt ID>" }`.
  The response includes a 43-character base64url `state` and `hosted_url`
  handled by the shared SDK. State, PKCE, and one-time approval codes must be
  generated and validated by the server services, not trusted from the browser.
- `POST /wabba/link/finish`: JSON fields `state`, `code`, `link_session_id`, and
  the initiating `request_key`.
  Success must explicitly return `{ "connected": true }`.

Ambiguous start retries reuse a per-tab request ID for up to 15 minutes. A
successful start clears that retry slot, so a later click starts a fresh flow.
Pending callbacks use separate UID-and-state storage keys to isolate accounts
and simultaneous tabs. These entries contain only a request ID and expiry, not
credentials or a PKCE verifier. Completion clears its own pending entry only.
The browser storage expiry is a convenience check; the server must also expire
sessions, enforce one-time use, and handle retries idempotently.

The callback removes its query string before initializing Firebase. Its
one-time code remains only in memory; refreshing the callback page loses that
code. Return to Bingo and begin a fresh connection if this happens. Storage
blocking, account changes, expired sessions, and network failures must produce
an error rather than a false success.

## Automated checks

With Node.js 22 or later, from this repository:

```sh
node --test tests/*.test.mjs
```

GitHub Actions also syntax-checks all root JavaScript modules. Tests execute the
actual integration source with identity, storage, network, and DOM doubles.
They require no installed dependencies, credentials, Firebase writes, or Wabba
deployment. They check protocol/controller behavior, not visual rendering or
real-provider compatibility. The separate Wabba workspace has additional
server SDK and adapter tests; those are not this repository's CI suite.

## Manual release checks still required

- Disabled configuration: normal Bingo sign-in, creating/joining games, and
  existing game modes still work with no Wabba UI or Wabba network requests.
- Enabled configuration: real Firebase sign-in and revoked-token rejection;
  SDK availability for an ordinary player; popup, consent, and exact callback
  routing on the actual domains; returning-user and Google SSO paths in Wabba.
- Cancel/underage choices make no Wabba request. Confirm keyboard operation,
  focus, status announcements, mobile layout, and no interference with Bingo.
- Retry after a lost start/finish response; simultaneous tabs; account switch;
  expired or replayed callback; disabled storage; refreshed callback recovery.
- Confirm the server mapping belongs to the correct Firebase UID and Wabba
  account, without exposing credentials or one-time codes in logs.

No in-app browser was available in the review environment, so these rendered
and live-provider checks have not been performed. No live rewards or gift-card
delivery has been tested or enabled.

## Separate work before rewards

Bingo currently lets browsers calculate results and write winners. Its phrase
and social modes also rely on observations/votes, and it supports more than two
players. Wabba's current match contract supports exactly two participants.
Agree on supported modes, implement server-owned state and result validation,
and persist immutable results with retry-safe delivery before any reward
integration. Signing an existing browser-supplied winner does not make it
authoritative.
