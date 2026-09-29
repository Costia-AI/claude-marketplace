import { config } from "../config.ts";
import { files } from "../state/paths.ts";
import { readJson, removeFile, writeJson } from "../state/json-file.ts";
import { withLock } from "../state/lock.ts";
import { decodeClaims, endpoints, OAuthError, postForm, type TokenResponse } from "./oidc.ts";

export interface Credentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  account: { sub: string; email?: string };
}

export class NotSignedInError extends Error {
  constructor(reason = "not signed in") {
    super(reason);
  }
}

export function readCredentials(): Credentials | null {
  return readJson<Credentials | null>(files.credentials(), null);
}

export function saveTokens(tokens: TokenResponse, previous?: Credentials): Credentials {
  const claims = decodeClaims(tokens.id_token ?? tokens.access_token);
  const credentials: Credentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    account: {
      sub: String(claims.sub ?? previous?.account.sub ?? ""),
      email: (claims.email as string | undefined) ?? previous?.account.email,
    },
  };
  writeJson(files.credentials(), credentials);
  return credentials;
}

export function forgetCredentials(): void {
  removeFile(files.credentials());
}

const SKEW_MS = 60_000;

/**
 * A valid access token, refreshed when it is about to expire. Refreshing runs
 * under a file lock and re-reads the file inside it, so when two processes race
 * only one spends the rotating refresh token and the other reuses its result.
 */
export async function accessToken(): Promise<string> {
  if (config.staticToken) return config.staticToken;
  const current = readCredentials();
  if (!current) throw new NotSignedInError();
  if (current.expiresAt - SKEW_MS > Date.now()) return current.accessToken;
  if (!current.refreshToken) throw new NotSignedInError("session expired");

  return withLock(files.credentials(), async () => {
    const fresh = readCredentials();
    if (!fresh) throw new NotSignedInError();
    if (fresh.expiresAt - SKEW_MS > Date.now()) return fresh.accessToken;
    try {
      const { token } = await endpoints();
      const tokens = await postForm<TokenResponse>(token, {
        grant_type: "refresh_token",
        refresh_token: fresh.refreshToken ?? "",
        client_id: config.clientId,
      });
      return saveTokens(tokens, fresh).accessToken;
    } catch (error) {
      if (error instanceof OAuthError && error.code === "invalid_grant") {
        forgetCredentials();
        throw new NotSignedInError("session expired or revoked");
      }
      throw error;
    }
  });
}
