#!/usr/bin/env node
/**
 * Writes the App Store listing from the repository, and submits nothing for review.
 *
 *   node asc-listing.mjs show                 what the files say and which version is editable
 *   node asc-listing.mjs push [--dry-run]     writes appInfo and version localizations
 *   node asc-listing.mjs push --promo-only    promotionalText only: the one field that changes live
 *
 * Copy: <ASC_COPY_DIR or store/appstore>/<locale>/<field>.txt, relative to --app (default: the
 * working directory). Fields: name, subtitle, privacy_policy_url (appInfo); description, keywords,
 * promotional_text, support_url, marketing_url (version). marketing_url may be empty; the rest are
 * required. whatsNew is left out: it belongs to a binary, not to the listing.
 *
 * Refuses to send, before the first request:
 *   - anything over Apple's limits (a 400 halfway leaves the listing half-written);
 *   - any word in ASC_FORBIDDEN_WORDS (Guideline 2.3.10: no other platform in an iOS listing);
 *   - a missing support URL (Guideline 1.5).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { appId, call, editableVersion, flag } from "./asc-api.mjs";

const argv = process.argv.slice(2);
const LIMITS = { name: 30, subtitle: 30, promotional_text: 170, keywords: 100, description: 4000, support_url: 255, privacy_policy_url: 255, marketing_url: 255 };
const OPTIONAL = new Set(["marketing_url"]);
const APP_INFO = { name: "name", subtitle: "subtitle", privacy_policy_url: "privacyPolicyUrl" };
const VERSION = { description: "description", keywords: "keywords", promotional_text: "promotionalText", support_url: "supportUrl", marketing_url: "marketingUrl" };

function copyDir() {
  return resolve(resolve(flag(argv, "app", ".")), flag(argv, "copy", process.env.ASC_COPY_DIR || "store/appstore"));
}

function forbiddenWords() {
  return (process.env.ASC_FORBIDDEN_WORDS ?? "Android,Google Play,Play Store").split(",").map((w) => w.trim()).filter(Boolean);
}

function readCopy() {
  const dir = copyDir();
  if (!existsSync(dir)) throw new Error(`No copy folder ${dir}.`);
  const locales = readdirSync(dir).filter((n) => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(n) && statSync(join(dir, n)).isDirectory()).sort();
  const problems = [];
  const words = forbiddenWords();
  const copy = {};
  for (const locale of locales) {
    const text = {};
    for (const [field, limit] of Object.entries(LIMITS)) {
      const file = join(dir, locale, `${field}.txt`);
      if (!existsSync(file)) {
        if (!OPTIONAL.has(field)) problems.push(`${locale}: ${field}.txt is missing`);
        continue;
      }
      const value = readFileSync(file, "utf8").replace(/\s+$/, "");
      if (!value && !OPTIONAL.has(field)) problems.push(`${locale}/${field}: empty`);
      if (value.length > limit) problems.push(`${locale}/${field}: ${value.length} characters, the maximum is ${limit}`);
      for (const word of words) {
        if (value.toLowerCase().includes(word.toLowerCase())) problems.push(`${locale}/${field}: mentions "${word}" (Guideline 2.3.10)`);
      }
      text[field] = value;
    }
    copy[locale] = text;
  }
  if (!locales.length) problems.push(`no locale folders in ${dir}`);
  return { copy, problems };
}

function report(copy) {
  for (const [locale, text] of Object.entries(copy)) {
    console.log(`\n${locale}`);
    for (const [field, limit] of Object.entries(LIMITS)) {
      const value = text[field] ?? "";
      console.log(`  ${field.padEnd(19)}${String(value.length).padStart(5)}/${limit}  ${value.split("\n")[0].slice(0, 60)}${value.length > 60 ? "…" : ""}`);
    }
  }
}

async function write(kind, parentPath, relationship, fields, copy, dryRun) {
  const { data } = await call("GET", `/${parentPath}/${kind}?limit=50`);
  const existing = Object.fromEntries(data.map((item) => [item.attributes.locale, item]));
  const parentType = { appInfo: "appInfos", appStoreVersion: "appStoreVersions" }[relationship];
  for (const [locale, text] of Object.entries(copy)) {
    const attributes = Object.fromEntries(Object.entries(fields).filter(([field]) => text[field]).map(([field, api]) => [api, text[field]]));
    if (!Object.keys(attributes).length) continue;
    console.log(`  ${locale}: ${existing[locale] ? "updates" : "creates"} ${kind} — ${Object.keys(attributes).sort().join(", ")}`);
    if (dryRun) continue;
    if (existing[locale]) {
      await call("PATCH", `/${kind}/${existing[locale].id}`, { data: { type: kind, id: existing[locale].id, attributes } });
    } else {
      // A locale that does not exist has to be created; Apple does not add one on write.
      await call("POST", `/${kind}`, {
        data: { type: kind, attributes: { ...attributes, locale }, relationships: { [relationship]: { data: { type: parentType, id: parentPath.split("/").pop() } } } },
      });
    }
  }
}

async function main() {
  const command = argv[0];
  if (!["show", "push"].includes(command)) throw new Error("usage: asc-listing.mjs show | push [--dry-run] [--promo-only]");
  const { copy, problems } = readCopy();
  report(copy);
  if (problems.length) {
    console.error(`\nNothing is sent:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  const app = appId(argv);
  const version = await editableVersion(app);
  if (command === "show") {
    console.log(`\nEditable version: ${version ? `${version.attributes.versionString} (${version.attributes.appStoreState})` : "none — only promotionalText can change"}`);
    return;
  }
  const dryRun = argv.includes("--dry-run");
  if (argv.includes("--promo-only")) {
    if (!version) throw new Error("There is no editable version, so not even promotionalText has anywhere to go.");
    console.log(`\npromotionalText only, on ${version.attributes.versionString}:`);
    await write("appStoreVersionLocalizations", `appStoreVersions/${version.id}`, "appStoreVersion", { promotional_text: "promotionalText" }, copy, dryRun);
    return;
  }
  if (!version) {
    throw new Error(
      "No version is editable, and Apple freezes name, subtitle, description and keywords outside one.\n" +
        "Create the version in App Store Connect — or, if an unsubmitted one exists, RENAME it (PATCH versionString keeps its text and screenshots).\n" +
        "Meanwhile: --promo-only.",
    );
  }
  const { data: infos } = await call("GET", `/apps/${app}/appInfos?limit=5`);
  // The appInfo being edited is the one not yet live, when there are two.
  const info = infos.find((i) => i.attributes?.appStoreState !== "READY_FOR_DISTRIBUTION" && i.attributes?.state !== "READY_FOR_DISTRIBUTION") ?? infos[0];
  console.log(`\nappInfo ${info.id}:`);
  await write("appInfoLocalizations", `appInfos/${info.id}`, "appInfo", APP_INFO, copy, dryRun);
  console.log(`\nappStoreVersion ${version.attributes.versionString} (${version.id}):`);
  await write("appStoreVersionLocalizations", `appStoreVersions/${version.id}`, "appStoreVersion", VERSION, copy, dryRun);
  console.log(`\n${dryRun ? "Dry run: nothing was written." : "Done."} Nothing was submitted for review.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
