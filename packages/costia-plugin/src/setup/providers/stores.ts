import { createPrivateKey, createSign, sign } from "node:crypto";

/**
 * Proves that store credentials work, with one harmless call each. The
 * credentials are held in memory for the duration of the call and dropped.
 */

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

async function ok(response: Response): Promise<boolean> {
  await response.body?.cancel().catch(() => {});
  return response.ok;
}

/**
 * Google Play: exchanges a JWT signed with the service account's key for an
 * access token, opens an edit for the package and deletes it again.
 */
export async function googlePlayAccess(serviceAccountJson: string, packageName: string): Promise<{ ok: boolean; reason: string }> {
  let account: { client_email?: string; private_key?: string; token_uri?: string };
  try {
    account = JSON.parse(serviceAccountJson);
  } catch {
    return { ok: false, reason: "the stored service account is not JSON" };
  }
  if (!account.client_email || !account.private_key) return { ok: false, reason: "the stored service account has no client_email or private_key" };
  const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: tokenUri, iat: now, exp: now + 600 }),
  )}`;
  let assertion: string;
  try {
    assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(account.private_key).toString("base64url")}`;
  } catch {
    return { ok: false, reason: "the service account's private key cannot sign" };
  }
  const exchanged = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!exchanged.ok) return { ok: false, reason: `Google refused the service account (${exchanged.status})` };
  const { access_token: accessToken } = (await exchanged.json()) as { access_token?: string };
  const api = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits`;
  const headers = { authorization: `Bearer ${accessToken}` };
  const edit = await fetch(api, { method: "POST", headers, signal: AbortSignal.timeout(15_000) });
  if (!edit.ok) {
    await edit.body?.cancel().catch(() => {});
    const hint = edit.status === 403 || edit.status === 401 ? " — invite the service account in Play Console → Users and permissions" : edit.status === 404 ? " — no app with that package, or no access to it" : "";
    return { ok: false, reason: `Play Console answered ${edit.status} for ${packageName}${hint}` };
  }
  const { id } = (await edit.json()) as { id?: string };
  if (id) await ok(await fetch(`${api}/${encodeURIComponent(id)}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15_000) }));
  return { ok: true, reason: `the service account can edit ${packageName}` };
}

/** App Store Connect: a locally signed ES256 JWT and GET /v1/apps/{id}. */
export async function appStoreConnectAccess(p8: string, keyId: string, issuerId: string, appId: string): Promise<{ ok: boolean; reason: string }> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "ES256", kid: keyId.trim(), typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: issuerId.trim(), iat: now, exp: now + 600, aud: "appstoreconnect-v1" }),
  )}`;
  let jwt: string;
  try {
    const key = createPrivateKey(p8);
    jwt = `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  } catch {
    return { ok: false, reason: "the stored .p8 key cannot sign" };
  }
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(appId)}`, {
    headers: { authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (await ok(response)) return { ok: true, reason: `the API key can read app ${appId}` };
  const hint = response.status === 401 ? " — the key id, issuer id and .p8 do not match, or the key was revoked" : response.status === 403 || response.status === 404 ? " — the key's role cannot see that app" : "";
  return { ok: false, reason: `App Store Connect answered ${response.status}${hint}` };
}
