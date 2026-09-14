// Public deployment settings only. Wabba partner secrets NEVER belong in this file.
export const wabbaConfig = Object.freeze({
  // Opt in only after the adapter and player-accessible Wabba host are ready.
  enabled: false,
  webOrigin: "https://wabba-games.urielvaisfish.chatgpt.site",
  // Set to the HTTPS origin of integrations/bingo/server after provisioning it.
  adapterOrigin: null,
});
