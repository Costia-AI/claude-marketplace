import { config } from "../config.ts";

export interface Endpoints {
  deviceAuthorization: string;
  token: string;
  revocation?: string;
}

let cached: Endpoints | undefined;

/** Endpoints from the issuer's discovery document, with the standard paths as a fallback. */
export async function endpoints(timeoutMs = 3_000): Promise<Endpoints> {
  if (cached) return cached;
  try {
    const response = await fetch(`${config.issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      const doc = (await response.json()) as Record<string, string>;
      if (doc.device_authorization_endpoint && doc.token_endpoint) {
        cached = {
          deviceAuthorization: doc.device_authorization_endpoint,
          token: doc.token_endpoint,
          revocation: doc.revocation_endpoint,
        };
        return cached;
      }
    }
  } catch { /* fall through to the defaults */ }
  return {
    deviceAuthorization: `${config.issuer}/oauth2/device_authorization`,
    token: `${config.issuer}/oauth2/token`,
    revocation: `${config.issuer}/oauth2/revoke`,
  };
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

export class OAuthError extends Error {
  constructor(readonly code: string, description?: string) {
    super(description ? `${code}: ${description}` : code);
  }
}

export async function postForm<T>(url: string, body: Record<string, string>, timeoutMs = 10_000): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new OAuthError(String(payload.error ?? `http_${response.status}`), payload.error_description as string | undefined);
  }
  return payload as T;
}

/** Reads the claims of a JWT without verifying it — only to show who is signed in. */
export function decodeClaims(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
