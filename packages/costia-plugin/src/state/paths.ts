import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Two directories, following XDG: configuration the user would carry to a new
 * machine by hand (device identity, credentials, trusted hashes) and state that
 * can be thrown away (checkout index, caches, backups, pending login).
 */
function xdg(variable: string, fallback: string): string {
  const value = process.env[variable];
  return value && value.startsWith("/") ? value : join(homedir(), fallback);
}

export function configDir(): string {
  return process.env.COSTIA_CONFIG_DIR ?? join(xdg("XDG_CONFIG_HOME", ".config"), "costia");
}

export function stateDir(): string {
  return process.env.COSTIA_STATE_DIR ?? join(xdg("XDG_STATE_HOME", ".local/state"), "costia");
}

export const files = {
  device: () => join(configDir(), "device.json"),
  credentials: () => join(configDir(), "credentials.json"),
  trust: () => join(configDir(), "trust.json"),
  pendingLogin: () => join(stateDir(), "login-pending.json"),
  checkouts: () => join(stateDir(), "checkouts.json"),
  repos: () => join(stateDir(), "repos.json"),
  conflicts: () => join(stateDir(), "conflicts"),
  backups: () => join(stateDir(), "backups"),
  cache: () => join(stateDir(), "cache"),
};
