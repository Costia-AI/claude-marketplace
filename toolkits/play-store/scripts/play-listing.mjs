#!/usr/bin/env node
/**
 * Pushes the Play Store listing — title, short and full description, phone screenshots and,
 * optionally, the icon and feature graphic — from this repository to Google Play, in one
 * transactional edit.
 *
 *   node play-listing.mjs                         dry run: reads, measures and reports; calls nothing
 *   node play-listing.mjs --commit [--graphics]   sends it
 *
 * Options: --app <dir> (default: the working directory), --package, --key, --copy <dir>
 * (default PLAY_COPY_DIR or store/play), --shots <dir> (default STORE_ASSETS_DIR or store-assets),
 * --locale en-US (repeatable; default every folder under the copy dir).
 *
 * Copy: <copy>/<locale>/{title,short_description,full_description}.txt
 * Screenshots: <shots>/<locale or its language>/play/*.png, sorted by name (the order Play shows)
 * Graphics (--graphics): <copy>/graphics/icon.png (512×512) and feature-graphic.png (1024×500)
 *
 * The edit is: insert → per locale (delete phone screenshots → upload each → update text) → commit.
 * `deleteall` is not optional when there are new screenshots: upload *adds*, and the listing would
 * show both sets. With no new screenshots for a locale, Play's current ones are left alone.
 *
 * Not reachable from the API, and so never touched: content rating, Data safety, app access,
 * target audience, contact details. Release notes belong to a release: play-release-notes.mjs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { accessToken, call, flag, packageName, serviceAccount, withEdit } from "./play-api.mjs";

const argv = process.argv.slice(2);
const LIMITS = { title: 30, short_description: 80, full_description: 4000 };
const MIN_SHOTS = 2;
const MAX_SHOTS = 8;

function read() {
  const app = resolve(flag(argv, "app", "."));
  const copyDir = resolve(app, flag(argv, "copy", process.env.PLAY_COPY_DIR || "store/play"));
  const shotsDir = resolve(app, flag(argv, "shots", process.env.STORE_ASSETS_DIR || "store-assets"));
  if (!existsSync(copyDir)) throw new Error(`No copy folder ${copyDir}: create <locale>/title.txt, short_description.txt and full_description.txt.`);
  const chosen = argv.flatMap((arg, i) => (arg === "--locale" ? [argv[i + 1]] : []));
  const locales = readdirSync(copyDir)
    .filter((name) => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(name) && statSync(join(copyDir, name)).isDirectory())
    .filter((name) => !chosen.length || chosen.includes(name))
    .sort();
  const problems = [];
  const listings = locales.map((locale) => {
    const text = {};
    for (const [field, limit] of Object.entries(LIMITS)) {
      const file = join(copyDir, locale, `${field}.txt`);
      if (!existsSync(file)) {
        problems.push(`${locale}: ${field}.txt is missing`);
        continue;
      }
      // The trailing newline belongs to the file, not the copy: Play counts it.
      const value = readFileSync(file, "utf8").replace(/\s+$/, "");
      if (!value) problems.push(`${locale}/${field}: empty`);
      if (value.length > limit) problems.push(`${locale}/${field}: ${value.length} characters, the maximum is ${limit}`);
      text[field] = value;
    }
    const folder = [join(shotsDir, locale, "play"), join(shotsDir, locale.split("-")[0], "play")].find((dir) => existsSync(dir));
    const screenshots = folder ? readdirSync(folder).filter((n) => n.endsWith(".png")).sort().map((n) => join(folder, n)) : [];
    if (screenshots.length > 0 && screenshots.length < MIN_SHOTS) problems.push(`${locale}: ${screenshots.length} screenshot, Play wants at least ${MIN_SHOTS}`);
    if (screenshots.length > MAX_SHOTS) problems.push(`${locale}: ${screenshots.length} screenshots, the maximum is ${MAX_SHOTS}`);
    return { locale, text, screenshots };
  });
  if (!listings.length) problems.push(`no locale folders in ${copyDir}`);
  const graphics = [
    { type: "icon", file: join(copyDir, "graphics", "icon.png") },
    { type: "featureGraphic", file: join(copyDir, "graphics", "feature-graphic.png") },
  ];
  if (argv.includes("--graphics")) for (const g of graphics) if (!existsSync(g.file)) problems.push(`--graphics: ${g.file} is missing`);
  return { listings, problems, graphics };
}

function report(listings) {
  for (const { locale, text, screenshots } of listings) {
    console.log(`\n${locale}`);
    for (const [field, limit] of Object.entries(LIMITS)) {
      const value = text[field] ?? "";
      const preview = value.split("\n")[0].slice(0, 60);
      console.log(`  ${field.padEnd(18)} ${String(value.length).padStart(5)}/${limit}  ${preview}${value.length > 60 ? "…" : ""}`);
    }
    console.log(`  screenshots        ${String(screenshots.length).padStart(5)}/${MAX_SHOTS}`);
  }
}

async function push(pkg, listings, graphics) {
  const token = await accessToken(await serviceAccount(argv));
  await withEdit(token, pkg, async ({ base, upload, id }) => {
    console.log(`Edit ${id} opened.`);
    for (const { locale, text, screenshots } of listings) {
      if (screenshots.length) {
        await call(token, "DELETE", `${base}/listings/${locale}/phoneScreenshots`);
        for (const file of screenshots) {
          await call(token, "POST", `${upload}/listings/${locale}/phoneScreenshots?uploadType=media`, { body: readFileSync(file), contentType: "image/png" });
        }
        console.log(`  ${locale}: ${screenshots.length} screenshots replaced`);
      } else console.log(`  ${locale}: no new screenshots, leaving Play's`);
      if (argv.includes("--graphics")) {
        for (const { type, file } of graphics) {
          await call(token, "DELETE", `${base}/listings/${locale}/${type}`);
          await call(token, "POST", `${upload}/listings/${locale}/${type}?uploadType=media`, { body: readFileSync(file), contentType: "image/png" });
        }
        console.log(`  ${locale}: icon and feature graphic replaced`);
      }
      await call(token, "PUT", `${base}/listings/${locale}`, {
        contentType: "application/json",
        body: JSON.stringify({ language: locale, title: text.title, shortDescription: text.short_description, fullDescription: text.full_description }),
      });
      console.log(`  ${locale}: text updated`);
    }
  });
  console.log("\nEdit committed. Play reviews listing changes before they are public.");
}

try {
  const { listings, problems, graphics } = read();
  report(listings);
  if (problems.length) {
    console.error(`\nNothing is sent:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  if (!argv.includes("--commit")) {
    console.log("\nDry run: Play was not called. Send it with --commit.");
    process.exit(0);
  }
  await push(packageName(argv), listings, graphics);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
