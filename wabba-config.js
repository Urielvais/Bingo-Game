// Public deployment settings only. Wabba partner secrets NEVER belong in this file.
export const wabbaConfig = Object.freeze({
  // Show the installed SDK. Backend readiness is checked separately on connect.
  enabled: true,
  webOrigin: "https://wabba-games.urielvaisfish.chatgpt.site",
  // Set to the real HTTPS origin of the central Wabba Python API. A missing API
  // shows setup feedback; it must never hide the SDK or pretend to link a player.
  apiOrigin: null,
});
