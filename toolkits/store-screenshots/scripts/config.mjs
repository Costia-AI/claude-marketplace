/**
 * Loads `store-shots.config.mjs` from the app folder and fills in the defaults.
 *
 * The app folder is `STORE_SHOTS_APP_DIR` (a setup parameter, "." by default) relative to the
 * folder this skill is installed in; `--app <dir>` on any script overrides it.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadParams, targetRoot } from "./params.mjs";

export const DEFAULT_DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, scale: 3, radius: 0.082 },
  tablet: { viewport: { width: 1024, height: 1366 }, scale: 2, radius: 0.035 },
};

/** Play takes 9:16; the App Store's 6.9" iPhone slot is 1320x2868 and its 13" iPad slot 2064x2752. */
export const DEFAULT_FRAMES = [
  { name: "play", width: 1080, height: 1920, device: "phone" },
  { name: "apple", width: 1320, height: 2868, device: "phone" },
  { name: "apple-ipad", width: 2064, height: 2752, device: "tablet" },
];

export function flag(argv, name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
}

export function appDir(argv = process.argv.slice(2)) {
  loadParams({ skill: "store-screenshots" });
  const explicit = flag(argv, "app", null);
  return resolve(explicit ? process.cwd() : targetRoot(), explicit ?? process.env.STORE_SHOTS_APP_DIR ?? ".");
}

export function seedEnv() {
  return process.env.SCREENSHOT_SEED_ENV || "SCREENSHOT_SEED";
}

export async function loadConfig(dir) {
  const file = resolve(dir, "store-shots.config.mjs");
  if (!existsSync(file)) {
    throw new Error(`No store-shots.config.mjs in ${dir}. Copy templates/store-shots.config.example.mjs there and fill it in.`);
  }
  const raw = (await import(pathToFileURL(file).href)).default;
  if (!raw || typeof raw !== "object") throw new Error("store-shots.config.mjs must `export default` an object.");
  const devices = { ...DEFAULT_DEVICES, ...(raw.devices ?? {}) };
  const frames = raw.frames ?? DEFAULT_FRAMES;
  const config = {
    ...raw,
    file,
    appDir: dir,
    outDir: resolve(dir, raw.outDir ?? process.env.STORE_ASSETS_DIR ?? "store-assets"),
    build: {
      command: ["npx", "expo", "export", "-p", "web"],
      outDir: "dist",
      ...(raw.build ?? {}),
      env: { [seedEnv()]: "1", ...(raw.build?.env ?? {}) },
    },
    server: { port: 8080, crossOriginIsolated: false, ...(raw.server ?? {}) },
    locales: raw.locales ?? { "en-US": "en" },
    devices,
    frames,
    seed: { global: "__screenshotSeed", ...(raw.seed ?? {}) },
    brand: {
      background: "#0b0b10",
      ink: "#ffffff",
      accent: "#7c5cff",
      accent2: "#22d3ee",
      border: "#2a2833",
      ...(raw.brand ?? {}),
    },
    hide: raw.hide ?? [],
    blockExternal: raw.blockExternal ?? true,
    colorScheme: raw.colorScheme ?? "light",
    shots: raw.shots ?? [],
  };
  return config;
}

/** Every problem with the config itself; an empty list means it is usable. */
export function configProblems(config) {
  const problems = [];
  const languages = [...new Set(Object.values(config.locales))];
  if (!Object.keys(config.locales).length) problems.push("locales is empty");
  if (!Array.isArray(config.shots) || config.shots.length === 0) problems.push("shots is empty");
  if (config.shots.length > 10) problems.push(`${config.shots.length} shots: the App Store takes 10 per set, Play 8`);
  const keys = new Set();
  for (const [index, shot] of config.shots.entries()) {
    const where = `shots[${index}]${shot?.key ? ` (${shot.key})` : ""}`;
    if (!shot?.key || !/^[a-z0-9][a-z0-9-]*$/.test(shot.key)) problems.push(`${where}: key must be lowercase letters, digits and dashes`);
    if (keys.has(shot?.key)) problems.push(`${where}: duplicate key`);
    keys.add(shot?.key);
    if (typeof shot?.path !== "string" && typeof shot?.path !== "function") problems.push(`${where}: path must be a string or (ids) => string`);
    if (!shot?.anchor?.testId && !shot?.anchor?.text) problems.push(`${where}: anchor needs testId or text`);
    for (const language of languages) {
      if (!shot?.caption?.[language]) problems.push(`${where}: no caption for "${language}"`);
      if (shot?.anchor?.text && typeof shot.anchor.text === "object" && !shot.anchor.text[language]) {
        problems.push(`${where}: no anchor text for "${language}"`);
      }
    }
    for (const device of shot?.devices ?? []) if (!config.devices[device]) problems.push(`${where}: unknown device ${device}`);
  }
  for (const frame of config.frames) {
    if (!config.devices[frame.device]) problems.push(`frame ${frame.name}: unknown device ${frame.device}`);
    if (!(frame.width > 0 && frame.height > 0)) problems.push(`frame ${frame.name}: width and height`);
  }
  if (config.brand.font?.file && !existsSync(resolve(config.appDir, config.brand.font.file))) {
    problems.push(`brand.font.file ${config.brand.font.file} does not exist`);
  }
  return problems;
}

/** The devices a shot is captured on: its own list, or every device a frame uses. */
export function shotDevices(config, shot) {
  return shot.devices ?? [...new Set(config.frames.map((frame) => frame.device))];
}
