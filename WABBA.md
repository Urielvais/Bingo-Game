# Wabba SDK and account connection

The Wabba widget is enabled throughout Bingo, including when signed out or the
connection backend is not configured. It has no X or snooze control; the native
card and shared SDK stay visible during gameplay and after account connection.
The compact card is 280px wide (viewport-limited), at least 72px high, with a 40px logo.
The coming-soon line is removed. Account linking and rewards are separate server capabilities: missing
adapter configuration keeps ordinary account navigation, never a false connected state. Normal
Bingo authentication and gameplay are unchanged. No browser-calculated winner
is submitted to Wabba.

The full bottom-right card and its stylesheet are in the initial HTML, not
created only after JavaScript starts. Its native anchor opens the Wabba account
page even if JavaScript fails. Keep the HTML href synchronized with the shipped
`wabba-config.js` account origin; a test checks that destination. JavaScript adopts the existing card
once and replaces it only after the shared SDK host and stylesheet are ready.
The replacement stays hidden while its CSS loads. A CSS failure or timeout
removes the incomplete replacement and leaves the original account link usable.
There is no duplicate header button. Wabba module URLs share a release version
so stale deployment settings cannot silently hide connection controls.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| `wabba-config.js` | Widget visibility and deployment origins |
| `wabba-entry-view.js`, `wabba-entry.css` | Local anchor and progressive SDK enhancement |
| `wabba.js` | Bingo Firebase identity, request bindings, SDK loading, callback completion and game-result events |
| `wabba-callback.*` | Standalone return page and recoverable confirmation status |
| `wabba-sdk/` (installed shared browser SDK) | Persistent branded launcher, approval navigation and reusable authenticated result client |
| Bingo server adapter (separate Wabba deployment) | Verify Firebase tokens; own PKCE, partner signing, and durable link state |
| Wabba API (separate deployment) | Account consent, eligibility, ledger, and rewards |

The browser assets are installed unchanged from Wabba's `sdk/browser`; they are
not a game-specific SDK fork. From the Wabba repository, run:

```sh
node sdk/browser/install.mjs --destination /absolute/path/to/Bingo-Game/wabba-sdk
```

Use `--update` when deliberately refreshing an existing SDK version. Deploy the
whole generated `wabba-sdk/` directory with the game. CSS and logo resolve next
to the script, including on GitHub Pages project paths. The launcher loads from
Bingo itself, not from Wabba's private website. The server SDK stays server-only.

This repository contains no partner secret, service-account credential, or
browser winner-reporting endpoint. An account link alone does not qualify a
player or a match for a reward.

## Before real account linking

1. Deploy the Wabba API and the Bingo server adapter from the Wabba workspace
   (`integrations/bingo/server` using `sdk/node`). They are not included here.
   The adapter must verify Firebase ID tokens, including revocation, and use
   server-only durable storage. Do not replace Bingo's existing Firestore rules
   with the adapter's dedicated-database rules.
2. Make the approved Wabba account flow available to the intended players.
   Wabba's website is currently owner-private. Local SDK installation removes
   that dependency for displaying the widget, not for signing in to Wabba.
3. Register the actual Bingo origin and its exact
   `https://<bingo-host>/wabba-callback.html` callback in the server-side partner
   configuration. If Bingo is served under a path (for example a GitHub Pages
   project), include that path in the callback. Configure exact-origin CORS at
   the adapter; use HTTPS and do not redirect authenticated API requests.
4. Set `webOrigin` and `adapterOrigin` in `wabba-config.js` to those deployed
   HTTPS origins, without paths, trailing slashes, queries, or fragments.
   `enabled: true` is the shipped widget setting. Missing/invalid adapter origins
   keep the widget visible as an ordinary Wabba account link, without requesting
   Firebase tokens or saving pending requests. This does not connect accounts.
   Explicit `enabled: false` or an invalid Wabba
   account origin still prevents initialization; these are configuration errors
   or a deliberate host opt-out, not backend-readiness checks.
5. Verify the manual checks below on the real hosting domains. Do not enable
   rewards until authoritative results and funding are independently ready.

Only Bingo-hosted entry and SDK assets load before the player clicks. The click
opens Wabba, which owns account age/country eligibility; Bingo no longer asks
for age separately. With a configured adapter, the click sends the Firebase
token to that adapter to initiate linking before reaching Wabba's eligibility
screen. SDK loading has a 15-second deadline; a failure leaves the original
account link usable. Late completion of an abandoned load cannot mount the UI.

## Browser/server contract

All adapter endpoints use HTTPS with
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
- `GET /wabba/matches/<match-id>/result`: no body or query parameters. The only
  caller input is the match ID; the server must derive the game user from the
  Firebase token and verify its current Wabba account link before returning data.
  A local connection preference is not authorization.

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

- Disabled configuration: no SDK initialization or background remote requests;
  the static account link remains visible. A deployment that deliberately opts
  out of Wabba must also remove the static entry from its HTML.
- Default configuration: the widget remains visible across all views and
  signed-out states, with no X or timed dismissal. Confirm previous snooze
  preferences do not hide the card and keyboard focus remains visible.
  The shared SDK loads locally
  without asking for age or making remote requests. With no adapter configured,
  clicking opens Wabba's account page without requesting a Firebase token,
  storing a flow or claiming the Bingo account is connected.
- Enabled configuration: real Firebase sign-in and revoked-token rejection;
  SDK availability for an ordinary player; popup, consent, and exact callback
  routing on the actual domains; returning-user and Google SSO paths in Wabba.
- Confirm Wabba still enforces eligibility in its own account flow. Confirm
  keyboard operation, focus, status announcements, mobile layout, and no
  interference with Bingo. SDK load failure must leave account navigation usable.
- Retry after a lost start/finish response; simultaneous tabs; account switch;
  expired or replayed callback; disabled storage; refreshed callback recovery.
- Confirm the server mapping belongs to the correct Firebase UID and Wabba
  account, without exposing credentials or one-time codes in logs.

No in-app browser was available in the review environment, so these rendered
and live-provider checks have not been performed. No live rewards or gift-card
delivery has been tested or enabled.

## Recorded results and rewards

The game-side SDK is wired to winner, archived-game deletion, and ended-game
rejoin events. It requests the saved result from the configured adapter using
the current Firebase user's token. It does **not** send the browser's winner,
email, UID, score, or a `won: true` assertion. Checks begin after a confirmed
connection; the server must recheck that binding on every request.

The shipped `adapterOrigin` remains `null` because no live result server has
been configured. The widget is enabled, but real account linking and result
reads need that deployment. This PR does not connect the Wabba website/API or
enable payouts; those are the next integration stage.

The result contract is richer than a boolean:

| Field | Meaning and source |
| --- | --- |
| `gameId` | The server-configured Wabba game registration |
| `externalMatchId` | Bingo's match/document ID |
| `gameUserId` | Firebase UID verified by the adapter, never a display name |
| `wabbaPlayerId`, `connected` | The current server-verified Wabba account link |
| `email`, `emailVerified` | Optional game sign-in email and verification claim; not the Wabba email and not a matching key |
| `status`, `evidence` | `recorded` / `game_record`, or `not_final` while saving |
| `outcome`, `won` | `win`, `loss`, or `draw`, and whether this participant won |
| `participantIds`, `winnerId`, `completedAt` | Saved match evidence; a draw has a null winner |

The reusable SDK supports draws; Bingo's existing archive reader currently
requires a winner and does not invent a draw for an incomplete/legacy archive.
Emails may be absent, especially for anonymous or phone-only game accounts.
Account matching always uses `(gameId, verified gameUserId)` and the approved
server-held link to `wabbaPlayerId`, never equal emails or user-entered IDs.

The card displays checking, pending, recorded win/loss/draw, sign-in/connection,
and unavailable states. A recorded win explicitly says it is not yet a gift-card
award. Pending results retry up to five times; pending/unavailable states offer
"Check result again". Each token/HTTP attempt has a deadline, account changes
cancel stale reads, and a new game clears the previous result. There is still
no X/close button. Result status is an atomic polite live region and does not
move keyboard focus or print email/account IDs.

### Reuse in the next game

Install the same four SDK assets (launcher JS, CSS, result module and logo),
then supply that game's identity adapter and call `watch()` when a match ends:

```js
import { WabbaResultClient } from './wabba-sdk/sdk/wabba-results.v1.mjs';

const results = new WabbaResultClient({
  apiOrigin: 'https://your-deployed-game-adapter.example',
  getIdentity: () => {
    const user = gameAuth.currentUser;
    return user ? { id: user.uid, getToken: () => user.getIdToken() } : null;
  },
  onState: state => window.WabbaConnect.setResultState(state),
});
// Pass onResultRetry: () => results.retry() when mounting WabbaConnect.
// After account connection and the game's match-ended event:
const state = await results.watch(matchId);
if (state.result) console.log(state.result.outcome); // Not a reward instruction.
// On the next match or auth change: results.reset().
```

The shared result client has no Firebase dependency. Other games replace
`getIdentity` and their server's source-record reader, not the widget or result
validation. `tests/wabba-results.test.mjs` exercises the installed module inside
this repository; no checkout of Wabba is required for CI.

### Evidence limits

Bingo currently lets browsers calculate results and write winners. Its phrase
and social modes also rely on observations/votes, and it supports more than two
players. Wabba's current match contract supports exactly two participants.
For the small-payout MVP, new results retain a stable `winnerId`,
`resultVersion: 1`, completion timestamp and participant IDs. Cleanup archives
first and does not replace that archive during a concurrent cleanup. The
Bingo server's authenticated read-only result endpoint compares the signed-in
player with this saved winner. It labels its evidence `game_record`, not
anti-cheat proof; legacy name-only records are not inferred. Existing scoring
rules are unchanged. The endpoint performs no gift-card purchase or reward
settlement. A real payout still requires the configured provider/budget and
Wabba's confirmed account/match/eligibility/idempotency checks.
