/**
 * Where the plugin talks to. Production values are the defaults; the environment
 * overrides them for local development against a backend on localhost.
 */
export const VERSION = "0.2.0";

export const config = {
  issuer: (process.env.COSTIA_ISSUER ?? "https://id.costia.app").replace(/\/$/, ""),
  api: (process.env.COSTIA_API ?? "https://claude-api.costia.app").replace(/\/$/, ""),
  web: (process.env.COSTIA_WEB ?? "https://claude.costia.app").replace(/\/$/, ""),
  clientId: process.env.COSTIA_CLIENT_ID ?? "costia-claude-tools-cli",
  // No "openid": the device grant does not issue ID tokens; identity comes from the access token.
  scope: "profile email offline_access",
  /** A CI or a test can skip the device flow entirely. */
  staticToken: process.env.COSTIA_TOKEN || undefined,
};
