# Wabba SDK integration

The styled bottom-right “Connect to Wabba” card stays visible during play and
sign-out. There is no X or “Offers coming soon” line. Initial HTML/local CSS
remain usable if optional SDK loading fails; the compact styling is unchanged.

## Game developer checklist

1. Provide the actual Bingo URL and exact `wabba-callback.html` URL, including
   any hosting project path.
2. Keep this PR's small hooks: the existing Firebase identity, match-ended ID,
   and stable winner/participant IDs in the saved archive.
3. Confirm existing Firestore Rules allow a signed-in participant to read
   `pastGames/<id>`. Pending checks also read `activeGames/<id>` and that
   user's `players/<uid>` document.
4. Once Wabba deploys its central API, set `apiOrigin` in `wabba-config.js`
   to its HTTPS origin and `webOrigin` to the player-accessible account site.
   Deploy these game assets normally.

No new game backend, Firebase Admin key, Cloud Function, separate linking
database, partner secret or replacement login is required. This PR does not
change Rules. If Rules deny these reads, the game owner must approve minimal
access or provide an authorized API; Wabba cannot bypass that restriction.

## Responsibilities

The **Wabba Python API** verifies the configured Firebase project's token,
handles Wabba consent/PKCE, reads saved game records with the player's token,
and stores links/results in Wabba's existing database. Every binding is scoped
by game ID and verified UID. Optional game email is never the matching key.
Signed Firebase tokens are verified for signature/project/issuer/expiry/tenant,
not immediate Admin revocation. Wabba link revocation is checked on each read.

The **shared SDK** owns linking, callback correlation, retry/account-change
checks, result validation and the launcher. `wabba.js` supplies Bingo's user
and game events. Other games reuse these assets, supply their identity adapter
and a Wabba-side result provider; Firebase is not mandatory. Games with servers
can push the same contract through Wabba's signed partner API instead.

## Live setup still required

`enabled: true` displays the widget. `apiOrigin: null` remains because no live
central API URL has been verified. The card then opens the account page without
requesting a token or falsely claiming a game connection. The current Wabba
website is owner-private; player access is a separate release decision.

Wabba must deploy the API and migration, configure accounts, register Bingo's
callback, and configure `firebase` / `bingo-firestore-v1` for `phrasebingo`.
[Wabba operator setup and API contract](https://github.com/eliyad26/wabba/blob/codex/game-result-identity-sdk/docs/game-integrations.md).
The old separate Bingo server/Admin setup is no longer required.

## Result flow and limits

After consent, a saved winner/end/cleanup/rejoin event passes **only the match
ID** to the SDK. It calls
`GET /v1/sdk/games/bingo/matches/<id>/result` with the current game bearer token.
Wabba derives identity, checks the approved account link and match membership,
reads the archive, then persists the normalized evidence. Browser-supplied
winner/email/score assertions are not accepted by this endpoint.

The response includes game ID, match ID, game UID, Wabba player ID, optional game
email, outcome, completion time, winner IDs and participants with optional
scores/ranks/teams. Generic outcomes: win, loss, draw, completed, void. Team wins
are supported; Bingo maps its saved single winner to win/loss. Legacy
display-name-only archives cannot prove which user won.

Results are unique by game and match; repeats are safe and conflicting results
are rejected. This records game evidence, **not an anti-cheat verdict or a
gift-card award**. Bingo still computes outcomes client-side. Eligibility,
budgets and fulfillment remain separate.

The card shows checking, pending, recorded outcomes and retry feedback using
a polite atomic status without moving focus. A new match or changed account
clears old results. A recorded win explicitly says no gift card was awarded yet.

## Reuse

From Wabba's repository, install the five unchanged shared assets:

```sh
node sdk/browser/install.mjs --destination /absolute/path/to/Bingo-Game/wabba-sdk --update
```

The installed directory deploys with the game; no Wabba checkout is required
at runtime. New games instantiate `WabbaGameClient` with `game`, `apiOrigin`,
`webOrigin`, `returnUrl`, and `getIdentity` returning
`{ id: user.uid, getToken: () => user.getIdToken() }` (or their own login adapter).

- Launcher connector: `options => wabba.start(options)`.
- Callback: `await wabba.finish({ state, code, link_session_id })`.
- After consent and match end: `await wabba.results.watch(matchId)`.
- New match/sign-out: `wabba.results.reset()`.
- Retry button: `wabba.results.retry()`.
- Result presentation: `onResultState: state => WabbaConnect.setResultState(state)`.

Only non-secret request IDs/expiry/state bindings are stored for callback
retries. Tokens, PKCE verifiers and Wabba link tokens are not persisted by the
SDK. The callback clears its URL first; approval codes remain in memory.
Reloading that page requires a fresh connection attempt.

## Checks

```sh
node --test tests/*.test.mjs
```

Node 22+, no credentials/dependencies. GitHub Actions also checks syntax.
Tests cover actual integration/SDK code with identity/network/DOM doubles:
multi-tab retries, account switches, result parsing and archive-before-cleanup.
They do not prove rendered/mobile behavior or live Firebase permissions.

Before release, verify real login → Wabba consent → callback → win/loss read,
Rules denial, revoked Wabba link, expired game token, popup blocking, lost
responses, keyboard/mobile layout and ordinary-player account-site access.
No live rewards are enabled or claimed by this PR.
