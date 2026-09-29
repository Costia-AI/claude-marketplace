/**
 * The Google Play Developer API with no dependency: a service-account JWT signed with node:crypto,
 * exchanged for a bearer token, and plain fetch.
 *
 * The service account's JSON key comes, in order, from:
 *   --key <path>                          a file (for example one exported by with-secrets --file)
 *   GOOGLE_PLAY_KEY_PATH                  the same, from the environment
 *   Infisical, secret PLAY_SERVICE_ACCOUNT_SECRET (default GOOGLE_PLAY_SERVICE_ACCOUNT_JSON),
 *                                         read into memory and never written anywhere
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadParams } from "./params.mjs";
import { getSecret, location } from "./infisical.mjs";

export const API = "https://androidpublisher.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

export function flag(argv, name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
}

/** The package name from --package or ANDROID_PACKAGE (the play-service-account flow). */
export function packageName(argv) {
  loadParams({ skill: "play-store" });
  const name = flag(argv, "package", process.env.ANDROID_PACKAGE);
  if (!name) throw new Error("No package name: --package, or ANDROID_PACKAGE from the play-service-account setup.");
  return name;
}

export async function serviceAccount(argv) {
  loadParams({ skill: "play-store" });
  const path = flag(argv, "key", process.env.GOOGLE_PLAY_KEY_PATH);
  let text;
  if (path) text = readFileSync(path, "utf8");
  else {
    const name = process.env.PLAY_SERVICE_ACCOUNT_SECRET || "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON";
    text = await getSecret(location(), name);
    if (!text) throw new Error(`${name} is not in Infisical. Finish the play-service-account setup, or pass --key.`);
  }
  const key = JSON.parse(text);
  if (!key.client_email || !key.private_key) throw new Error("That is not a service-account JSON key (no client_email / private_key).");
  return key;
}

export async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: key.client_email,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(body).sign(key.private_key).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${body}.${signature}` }),
  });
  if (!response.ok) {
    // Deliberately not the body: it echoes the assertion back.
    throw new Error(`The service account got no token (HTTP ${response.status}). Check the key is current and the Play Developer API is enabled in its Google Cloud project.`);
  }
  return (await response.json()).access_token;
}

export async function call(token, method, url, { body, contentType } = {}) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(contentType ? { "Content-Type": contentType } : {}) },
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    const hint = response.status === 403
      ? "\n(403: the service account is not invited into Play Console for this app, lacks the permission for this call, or the invitation has not propagated yet — retry in a few minutes.)"
      : response.status === 404 && /applications\/[^/]+\/edits$/.test(url)
        ? "\n(404: Play knows no app with this package, or its first bundle was never uploaded by hand.)"
        : "";
    throw new Error(`${method} ${url.replace(API, "")} → ${response.status}\n${detail}${hint}`);
  }
  return response.status === 204 ? null : response.json();
}

/**
 * Runs `work` inside one transactional edit and commits it; deletes the edit on failure.
 * An abandoned edit is not harmless: Play keeps one open draft per app and the next run fails on
 * `insert` until somebody discards it in the console.
 */
export async function withEdit(token, pkg, work, { commit = true } = {}) {
  const base = `${API}/androidpublisher/v3/applications/${pkg}/edits`;
  const edit = await call(token, "POST", base);
  try {
    const result = await work({ base: `${base}/${edit.id}`, upload: `${API}/upload/androidpublisher/v3/applications/${pkg}/edits/${edit.id}`, id: edit.id });
    if (commit) await call(token, "POST", `${base}/${edit.id}:commit`);
    else await call(token, "DELETE", `${base}/${edit.id}`);
    return result;
  } catch (error) {
    await call(token, "DELETE", `${base}/${edit.id}`).catch(() => {});
    throw error;
  }
}
