#!/usr/bin/env node
/**
 * Replaces the App Store screenshots of the editable version with the framed ones in the
 * repository, and refuses to claim success until Apple says every one is COMPLETE.
 *
 *   node asc-screenshots.mjs show | push [--dry-run] [--app <dir>] [--shots <dir>]
 *
 * Reads <STORE_ASSETS_DIR or store-assets>/<locale or its language>/<folder>/*.png, sorted by name:
 *   APP_IPHONE_67          ← apple       (1320×2868)
 *   APP_IPAD_PRO_3GEN_129  ← apple-ipad  (2064×2752) — required in every localization while the
 *                                         app supports tablets, or the submission is refused
 *
 * Each image is four calls, and the last one is the one that gets forgotten:
 *   POST /appScreenshotSets → POST /appScreenshots (reservation) → PUT <uploadOperations> →
 *   PATCH /appScreenshots/{id} {uploaded: true, sourceFileChecksum: md5}
 * Skipping that PATCH leaves the screenshot at UPLOAD_COMPLETE and invisible, with no error.
 * A set is emptied before it is filled: a rerun would otherwise stack two sets.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { appId, call, editableVersion, flag } from "./asc-api.mjs";

const argv = process.argv.slice(2);
const FAMILIES = { APP_IPHONE_67: "apple", APP_IPAD_PRO_3GEN_129: "apple-ipad" };

function shotsFor(locale, folder) {
  const root = resolve(resolve(flag(argv, "app", ".")), flag(argv, "shots", process.env.STORE_ASSETS_DIR || "store-assets"));
  const dir = [join(root, locale, folder), join(root, locale.split("-")[0], folder)].find((d) => existsSync(d));
  return dir ? readdirSync(dir).filter((n) => n.endsWith(".png")).sort().map((n) => join(dir, n)) : [];
}

async function setsByType(localizationId) {
  const { data } = await call("GET", `/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`);
  return Object.fromEntries(data.map((s) => [s.attributes.screenshotDisplayType, s.id]));
}

async function upload(setId, path) {
  const payload = readFileSync(path);
  const { data: reservation } = await call("POST", "/appScreenshots", {
    data: { type: "appScreenshots", attributes: { fileSize: payload.length, fileName: basename(path) }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } } },
  });
  for (const op of reservation.attributes.uploadOperations) {
    const response = await fetch(op.url, {
      method: op.method,
      headers: Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value])),
      body: payload.subarray(op.offset, op.offset + op.length),
    });
    if (!response.ok) throw new Error(`upload of ${basename(path)} → ${response.status}`);
  }
  await call("PATCH", `/appScreenshots/${reservation.id}`, {
    data: { type: "appScreenshots", id: reservation.id, attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(payload).digest("hex") } },
  });
}

/** COMPLETE with no errors, or it is not on the listing. UPLOAD_COMPLETE is not yet a verdict: Apple is still processing. */
async function settled(setId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data } = await call("GET", `/appScreenshotSets/${setId}/appScreenshots`);
    const problems = data
      .map((s) => ({ name: s.attributes.fileName, state: s.attributes.assetDeliveryState ?? {} }))
      .filter(({ state }) => state.state !== "COMPLETE" || (state.errors ?? []).length);
    if (!problems.length) return { count: data.length, problems: [] };
    if (problems.some(({ state }) => state.state !== "UPLOAD_COMPLETE" || (state.errors ?? []).length)) {
      return { count: data.length, problems: problems.map(({ name, state }) => `${name}: ${state.state} ${JSON.stringify(state.errors ?? [])}`) };
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  return { count: 0, problems: ["still processing after 90 s — check again with `show` before re-uploading anything"] };
}

async function main() {
  const command = argv[0];
  if (!["show", "push"].includes(command)) throw new Error("usage: asc-screenshots.mjs show | push [--dry-run]");
  const version = await editableVersion(appId(argv));
  if (!version) throw new Error("No editable version, so screenshots have nowhere to go.");
  console.log(`version ${version.attributes.versionString} (${version.attributes.appStoreState})`);
  const { data: locs } = await call("GET", `/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  const plan = [];
  for (const loc of locs) {
    const locale = loc.attributes.locale;
    const existing = await setsByType(loc.id);
    for (const [type, folder] of Object.entries(FAMILIES)) {
      const files = shotsFor(locale, folder);
      const live = existing[type] ? (await call("GET", `/appScreenshotSets/${existing[type]}/appScreenshots`)).data.length : 0;
      console.log(`  ${locale.padEnd(7)} ${type.padEnd(24)} ${live} live → ${files.length} local`);
      if (files.length > 10) throw new Error(`${locale}/${folder}: ${files.length} images, Apple takes at most 10.`);
      if (files.length) plan.push({ loc, locale, type, files });
      else if (command === "push") console.log(`    no local images for ${locale}/${folder}: left as it is`);
    }
  }
  if (command === "show" || argv.includes("--dry-run")) return;

  for (const { loc, locale, type, files } of plan) {
    const existing = await setsByType(loc.id);
    const setId = existing[type] ?? (await call("POST", "/appScreenshotSets", {
      data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: type }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } },
    })).data.id;
    const { data: old } = await call("GET", `/appScreenshotSets/${setId}/appScreenshots`);
    for (const shot of old) await call("DELETE", `/appScreenshots/${shot.id}`);
    for (const file of files) await upload(setId, file);
    console.log(`  ${locale} ${type}: ${old.length} removed, ${files.length} uploaded`);
  }

  console.log("\nReading back what Apple holds:");
  let failed = false;
  for (const { loc, locale, type } of plan) {
    const setId = (await setsByType(loc.id))[type];
    const { count, problems } = await settled(setId);
    console.log(problems.length ? `  ${locale} ${type}: ${problems.join("; ")}` : `  ${locale} ${type}: ${count} COMPLETE`);
    failed ||= problems.length > 0;
  }
  if (failed) throw new Error("\nSome screenshots did not finish: they are invisible on the listing.");
  console.log("\nDone. Nothing was submitted for review.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
