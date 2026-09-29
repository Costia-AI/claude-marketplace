#!/usr/bin/env node
/**
 * Sets the release notes of the release carrying a versionCode on a track.
 *
 *   node play-release-notes.mjs                                     measures and prints the paste block
 *   node play-release-notes.mjs --commit --version-code 42 [--track production]
 *
 * Notes: <copy>/<locale>/release_notes.txt (≤ 500 characters), copy = --copy, PLAY_COPY_DIR or
 * store/play, relative to --app (default: the working directory). Every locale folder that has
 * the file is sent.
 *
 * Play accepts notes on a release that is already live. When they cannot go through the API
 * (another account, a permission missing), the dry run prints one block in the format Play
 * Console's "Release notes" field takes pasted — every language at once.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { accessToken, call, flag, packageName, serviceAccount, withEdit } from "./play-api.mjs";

const argv = process.argv.slice(2);
const LIMIT = 500;

try {
  const app = resolve(flag(argv, "app", "."));
  const copyDir = resolve(app, flag(argv, "copy", process.env.PLAY_COPY_DIR || "store/play"));
  const notes = (existsSync(copyDir) ? readdirSync(copyDir) : [])
    .filter((locale) => existsSync(join(copyDir, locale, "release_notes.txt")))
    .sort()
    .map((language) => ({ language, text: readFileSync(join(copyDir, language, "release_notes.txt"), "utf8").trim() }));
  const problems = [];
  if (!notes.length) problems.push(`no <locale>/release_notes.txt under ${copyDir}`);
  for (const { language, text } of notes) {
    console.log(`${language.padEnd(8)} ${String(text.length).padStart(3)}/${LIMIT}`);
    if (!text) problems.push(`${language}: empty`);
    if (text.length > LIMIT) problems.push(`${language}: ${text.length}/${LIMIT} characters`);
  }
  if (problems.length) {
    console.error(`\n${problems.join("\n")}`);
    process.exit(1);
  }
  if (!argv.includes("--commit")) {
    console.log(`\nTo paste into Play Console → Release notes:\n\n${notes.map(({ language, text }) => `<${language}>\n${text}\n</${language}>`).join("\n")}`);
    process.exit(0);
  }
  const versionCode = flag(argv, "version-code", null);
  const track = flag(argv, "track", "production");
  if (!versionCode) throw new Error("--commit needs --version-code.");
  const pkg = packageName(argv);
  const token = await accessToken(await serviceAccount(argv));
  await withEdit(token, pkg, async ({ base }) => {
    const current = await call(token, "GET", `${base}/tracks/${track}`);
    const release = (current.releases ?? []).find((r) => (r.versionCodes ?? []).includes(String(versionCode)));
    if (!release) {
      const found = (current.releases ?? []).map((r) => `${r.name} ${JSON.stringify(r.versionCodes)} ${r.status}`);
      throw new Error(`No release with versionCode ${versionCode} on ${track}: ${found.join("; ") || "empty"}`);
    }
    release.releaseNotes = notes;
    await call(token, "PUT", `${base}/tracks/${track}`, { contentType: "application/json", body: JSON.stringify(current) });
    console.log(`Notes set on ${track}: ${release.name} (${release.versionCodes.join(", ")}), ${release.status}.`);
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
