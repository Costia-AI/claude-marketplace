#!/usr/bin/env node
/**
 * `eas submit -p ios` with the team key from Infisical, restored afterwards.
 *
 *   node eas-submit-ios.mjs [--profile production] [--app <dir>] [-- extra eas args]
 *
 * EAS reads an App Store Connect key from `submit.<profile>.ios.ascApiKeyPath/ascApiKeyId/
 * ascApiKeyIssuerId` in eas.json. This writes the key to a private temp file, points the profile at
 * it for the length of one `eas submit --latest --non-interactive`, and restores eas.json and
 * shreds the file afterwards — including on Ctrl-C. Nothing is committed with the key's path in it.
 *
 * `ascAppId` in the profile must be the app's Apple ID (ASC_APP_ID); it is set if missing.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appId, flag } from "./asc-api.mjs";
import { getSecret, location } from "./infisical.mjs";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const own = split === -1 ? argv : argv.slice(0, split);
const extra = split === -1 ? [] : argv.slice(split + 1);
const app = resolve(flag(own, "app", "."));
const profile = flag(own, "profile", "production");
const easJson = join(app, "eas.json");

const id = appId(own);
const loc = location();
const secret = async (env, fallback) => {
  const name = process.env[env] || fallback;
  const value = (await getSecret(loc, name))?.trim();
  if (!value) throw new Error(`${name} is not in Infisical. Finish the asc-api-key setup.`);
  return value;
};
const p8 = await secret("ASC_KEY_SECRET", "APPLE_ASC_API_KEY_P8");
const keyId = await secret("ASC_KEY_ID_SECRET", "APPLE_ASC_KEY_ID");
const issuer = await secret("ASC_ISSUER_ID_SECRET", "APPLE_ASC_ISSUER_ID");

process.umask(0o077);
const dir = mkdtempSync(join(tmpdir(), "eas-submit-"));
const keyPath = join(dir, `AuthKey_${keyId}.p8`);
writeFileSync(keyPath, p8, { mode: 0o600 });
const backup = join(dir, "eas.json.orig");
copyFileSync(easJson, backup);

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  try {
    copyFileSync(backup, easJson);
  } finally {
    try {
      const fd = openSync(keyPath, "r+");
      writeSync(fd, randomBytes(Math.max(statSync(keyPath).size, 1)));
      closeSync(fd);
    } catch { /* removed below */ }
    rmSync(dir, { recursive: true, force: true });
  }
}
process.on("exit", restore);

const config = JSON.parse(readFileSync(easJson, "utf8"));
config.submit ??= {};
config.submit[profile] ??= {};
config.submit[profile].ios = { ...(config.submit[profile].ios ?? {}), ascAppId: config.submit[profile].ios?.ascAppId ?? id, ascApiKeyPath: keyPath, ascApiKeyId: keyId, ascApiKeyIssuerId: issuer };
writeFileSync(easJson, `${JSON.stringify(config, null, 2)}\n`);

const child = spawn("npx", ["eas", "submit", "-p", "ios", "--profile", profile, "--latest", "--non-interactive", ...extra], { cwd: app, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  restore();
  process.exit(code ?? 1);
});
