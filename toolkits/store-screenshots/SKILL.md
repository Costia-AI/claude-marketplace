---
name: store-screenshots
description: Produce framed App Store and Google Play screenshots of an Expo / React Native app — captured from its web export in headless Chrome with seeded data, then composed with captions for every store slot (Play 1080×1920, iPhone 6.9" 1320×2868, iPad 13" 2064×2752). Use to create or refresh store screenshots, change their captions or look, or add a screen.
---

# Store screenshots

The pictures are **captures of the app's web export** at phone and tablet sizes, filled with fixed
seed data, then framed: a caption above, the capture in a device outline, the brand's colours. No
device, simulator or signed build is needed.

Everything app-specific lives in `store-shots.config.mjs` in the app folder
(`STORE_SHOTS_APP_DIR`, set up by the `store-screenshots-init` flow). The scripts next to this file
are generic; do not copy them into the app.

## Run it

From the app folder:

```sh
bun run store:shots            # build with the seed, serve, capture every locale × device, frame
bun run store:frames           # re-frame only (a caption or colour changed): no build, no capture
```

or directly: `node <skill>/scripts/web-preview.mjs [--skip-build] [--locale en-US] [--device phone] [--no-frames]`.
`--serve` builds and serves without capturing, to open a route in your own browser.

Output:

| Path | What |
|---|---|
| `<outDir>/raw/<lang>/<device>/<key>.png` | bare captures (rebuilt every run; gitignored) |
| `<outDir>/<lang>/<frame>/<n>-<key>.png` | framed, in listing order: what the store scripts upload |

**Look at every picture before anything is uploaded**, and show them to the person. A capture of a
loading screen, an empty state or a "syncing…" badge is a failed capture even when the script exits 0.

## Changing what is shown

Edit `store-shots.config.mjs`:

- **Order is an argument.** Both stores show the first screenshot larger; most people never swipe
  past the third. What the app is, what it is for, what it gives back — then the rest.
- **Captions name only what is visible** in that capture. Two short lines, `\n` where the break
  should fall, one per caption language.
- **Anchors**: prefer a `testID` (add one to the component) over visible text; text changes with copy.
- `path` may be a function of the ids the seed returns: `(ids) => \`/items/${ids.itemId}\``.
- `hide` removes elements that only exist because the run has no backend (sync badges).
- A screen that makes no sense on a tablet: `devices: ["phone"]`.
- `frames`: drop `apple-ipad` only if the iOS app does not support tablets — with
  `supportsTablet: true`, Apple requires an iPad set in every localization and refuses the
  submission without one.

Then `node <skill>/scripts/capture.mjs --validate config`.

## The seed

`seed.file` fills the app with fixed data through its own data layer when the bundle is built with
`SCREENSHOT_SEED_ENV` (default `SCREENSHOT_SEED`) set to `1`, and exposes
`globalThis.__screenshotSeed(lang)`.

**It must never ship**: it writes into a real person's data. Three things keep it out, and all three
must stay true — `capture.mjs --validate all` checks them:

1. `metro.config.js` resolves `SCREENSHOT_SEED_MODULE` to `{ type: "empty" }` unless the variable is `"1"`;
2. the module is imported once, from the entry file, and from nowhere else;
3. the guard test (`seed.test`) fails if either half of the rule is renamed.

When the app's data model changes, update the seed in the same change, or the pictures show empty
screens. Keep the data fixed (same ids every run), dated relative to today, and uneven.

## Where they go

The `play-store` and `app-store` skills upload `<outDir>/<lang>/play/` and
`<outDir>/<lang>/apple*/` respectively. Uploading replaces the live set: regenerate first, look,
then upload.

## When it breaks

- **"no globalThis.__screenshotSeed in this bundle"**: the build ran without the switch, or Metro
  cached an old resolution — rebuild with `--clear` in `build.command`.
- **Every capture is the loading screen**: the app is waiting for something that never answers
  (a backend URL still set in `build.env`, a database that needs cross-origin isolation — see
  `server.crossOriginIsolated`), or `seed.ready` waits for the wrong test id.
- **Hydration errors**: a route served the wrong prerendered page. The server here serves
  `route.html` for `/route`; a custom one must too.
- **No Chrome found**: `CHROME_PATH` (the `chrome` setup flow) or install Google Chrome. Nothing is
  downloaded.
