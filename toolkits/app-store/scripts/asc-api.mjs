/**
 * App Store Connect's API with no dependency: an ES256 JWT signed with node:crypto, and fetch.
 *
 * The team key comes, in order, from:
 *   ASC_KEY_PATH + ASC_KEY_ID + ASC_ISSUER_ID     (a .p8 file and its ids, e.g. from with-secrets)
 *   Infisical secrets ASC_KEY_SECRET, ASC_KEY_ID_SECRET, ASC_ISSUER_ID_SECRET
 *                                                 (the asc-api-key flow; read into memory, never written)
 * The app is ASC_APP_ID (--app-id overrides).
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadParams } from "./params.mjs";
import { getSecret, location } from "./infisical.mjs";

export const API = "https://api.appstoreconnect.apple.com/v1";

export function flag(argv, name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
}

export function appId(argv) {
  loadParams({ skill: "app-store" });
  const id = flag(argv, "app-id", process.env.ASC_APP_ID);
  if (!id || !/^[0-9]{6,12}$/.test(id)) throw new Error("No App Store app id: --app-id, or ASC_APP_ID from the asc-api-key setup.");
  return id;
}

let key;

async function teamKey() {
  if (key) return key;
  loadParams({ skill: "app-store" });
  if (process.env.ASC_KEY_PATH && process.env.ASC_KEY_ID && process.env.ASC_ISSUER_ID) {
    key = { p8: readFileSync(process.env.ASC_KEY_PATH, "utf8"), id: process.env.ASC_KEY_ID, issuer: process.env.ASC_ISSUER_ID };
    return key;
  }
  const loc = location();
  const names = {
    p8: process.env.ASC_KEY_SECRET || "APPLE_ASC_API_KEY_P8",
    id: process.env.ASC_KEY_ID_SECRET || "APPLE_ASC_KEY_ID",
    issuer: process.env.ASC_ISSUER_ID_SECRET || "APPLE_ASC_ISSUER_ID",
  };
  const values = {};
  for (const [part, name] of Object.entries(names)) {
    values[part] = (await getSecret(loc, name))?.trim();
    if (!values[part]) throw new Error(`${name} is not in Infisical. Finish the asc-api-key setup.`);
  }
  key = values;
  return key;
}

/** A fresh token per request: twenty minutes is the most Apple accepts, and longer is refused, not clamped. */
async function token() {
  const { p8, id, issuer } = await teamKey();
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "ES256", kid: id, typ: "JWT" })}.${encode({ iss: issuer, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" })}`;
  const signature = createSign("SHA256").update(body).sign({ key: p8, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${body}.${signature}`;
}

/**
 * One request, retried once on 401/429: a long run (minutes of uploads) meets the odd transient
 * one, and failing at the end makes the next person re-run and upload everything twice.
 */
export async function call(method, path, body) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.ok) {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }
    if ((response.status === 401 || response.status === 429) && attempt === 1) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    let detail = await response.text();
    try {
      detail = JSON.stringify(JSON.parse(detail), null, 2);
    } catch { /* not JSON */ }
    throw new Error(`${method} ${url.replace(API, "")} → ${response.status}\n${detail}`);
  }
}

export const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);

/**
 * The open iOS version, if any. Apple freezes name, subtitle, description and keywords outside one
 * and answers a write with a 409 that does not say why; looking first turns that into a sentence.
 */
export async function editableVersion(app) {
  const { data } = await call("GET", `/apps/${app}/appStoreVersions?limit=10&filter[platform]=IOS&fields[appStoreVersions]=versionString,appStoreState,platform`);
  return data.find((v) => EDITABLE.has(v.attributes.appStoreState)) ?? null;
}
