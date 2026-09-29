#!/usr/bin/env node
/**
 * Photographs the app's screens for the store listings, from its web export, in the installed Chrome.
 *
 *   node capture.mjs <baseUrl> [--locale en-US]... [--device phone]...   bare captures
 *   node capture.mjs --validate <config|seed|guard|scripts|all>          checks the wiring, captures nothing
 *
 * Captures go to `<outDir>/raw/<language>/<device>/<key>.png`; `frames.mjs` composes them.
 * `web-preview.mjs` builds, serves and calls this; run it directly only against a server you started.
 *
 * What this is honest about: these are captures of the **web** build at phone and tablet sizes,
 * not of a device. react-native-web renders the same components, the same copy, data and colours,
 * but not always the same millimetres. For a listing that is a fair picture; if it stops being
 * good enough, capture on a simulator and keep the framing.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appDir, configProblems, flag, loadConfig, seedEnv, shotDevices } from "./config.mjs";

const argv = process.argv.slice(2);

function read(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The wiring the setup flow asks Claude to build, checked by what is on disk. */
function validate(config, what) {
  const problems = [];
  const env = seedEnv();
  const want = (name) => what === "all" || what === name;

  if (want("config")) problems.push(...configProblems(config));

  if (want("seed")) {
    const { module, file } = config.seed;
    if (!module) problems.push("seed.module is not set (the import specifier the app uses, e.g. @/services/screenshot-seed)");
    if (!file) problems.push("seed.file is not set (the seed module's path relative to the app folder)");
    const source = file ? read(resolve(config.appDir, file)) : null;
    if (file && source === null) problems.push(`seed.file ${file} does not exist`);
    if (source !== null && !source.includes(config.seed.global)) problems.push(`${file} never assigns globalThis.${config.seed.global}`);
    const metro = read(resolve(config.appDir, "metro.config.js")) ?? read(resolve(config.appDir, "metro.config.cjs"));
    if (metro === null) problems.push("no metro.config.js in the app folder");
    else if (module) {
      if (!new RegExp(`SCREENSHOT_SEED_MODULE\\s*=\\s*["'\`]${escape(module)}["'\`]`).test(metro)) {
        problems.push(`metro.config.js does not declare SCREENSHOT_SEED_MODULE = "${module}"`);
      }
      if (!new RegExp(`process\\.env\\.${env}\\s*===\\s*["'\`]1["'\`]`).test(metro)) {
        problems.push(`metro.config.js does not check process.env.${env} === "1"`);
      }
      if (!/type:\s*["'`]empty["'`]/.test(metro)) problems.push("metro.config.js never resolves the seed to { type: \"empty\" }");
    }
    if (module) {
      const importers = [];
      const walk = (dir, depth) => {
        if (depth > 10) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (["node_modules", ".git", "dist", "build", ".expo", "ios", "android"].includes(entry.name)) continue;
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path, depth + 1);
          else if (/\.(t|j)sx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
            const text = readFileSync(path, "utf8");
            if (text.includes(`"${module}"`) || text.includes(`'${module}'`)) importers.push(relative(config.appDir, path));
          }
        }
      };
      walk(config.appDir, 0);
      const real = importers.filter((p) => p !== relative(config.appDir, resolve(config.appDir, "metro.config.js")));
      if (real.length === 0) problems.push(`nothing imports ${module}: import it once from the entry file`);
      if (real.length > 1) problems.push(`${module} is imported from ${real.length} files (${real.join(", ")}); import it from the entry file only`);
    }
  }

  if (want("guard")) {
    const test = config.seed.test;
    if (!test) problems.push("seed.test is not set (the path of the test that keeps the seed out of production)");
    else {
      const source = read(resolve(config.appDir, test));
      if (source === null) problems.push(`seed.test ${test} does not exist`);
      else {
        if (config.seed.module && !source.includes(config.seed.module)) problems.push(`${test} never names ${config.seed.module}`);
        if (!source.includes(env)) problems.push(`${test} never names ${env}`);
      }
    }
  }

  if (want("scripts")) {
    const pkg = JSON.parse(read(resolve(config.appDir, "package.json")) ?? "{}");
    const scripts = pkg.scripts ?? {};
    if (!/web-preview\.mjs/.test(scripts["store:shots"] ?? "")) problems.push('package.json has no "store:shots" running web-preview.mjs');
    if (!/frames\.mjs/.test(scripts["store:frames"] ?? "")) problems.push('package.json has no "store:frames" running frames.mjs');
    if (!pkg.devDependencies?.["playwright-core"] && !pkg.dependencies?.["playwright-core"]) problems.push("playwright-core is not a dependency");
  }
  return problems;
}

/** A command name to its path on PATH, or null. */
function which(command) {
  if (command.includes("/") || command.includes("\\")) return existsSync(command) ? command : null;
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(dir, command + extension);
      if (dir && existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** playwright-core from the app's own node_modules (this script lives elsewhere), and the installed Chrome. */
async function launch(config) {
  let chromium;
  try {
    const entry = createRequire(join(config.appDir, "package.json")).resolve("playwright-core");
    ({ chromium } = await import(pathToFileURL(entry).href));
  } catch {
    throw new Error("playwright-core is not installed in the app. Add it as a dev dependency.");
  }
  const common = { args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  const executable = process.env.CHROME_PATH ? which(process.env.CHROME_PATH) : null;
  if (executable) return chromium.launch({ ...common, executablePath: executable });
  try {
    return await chromium.launch({ ...common, channel: "chrome" });
  } catch {
    throw new Error("No Chrome found. Set CHROME_PATH (the chrome setup flow does), or install Google Chrome.");
  }
}

async function captureScreen(browser, config, baseUrl, locale, shot, device) {
  const language = config.locales[locale];
  const spec = config.devices[device];
  const context = await browser.newContext({
    colorScheme: config.colorScheme,
    locale,
    reducedMotion: "reduce",
    viewport: spec.viewport,
    deviceScaleFactor: spec.scale,
  });
  const host = new URL(baseUrl).host;
  if (config.blockExternal) {
    // Hermetic: the bundle may carry production URLs and a picture run has no business calling them.
    // The app's own server is exempt — its wasm and chunks are fetched from it.
    await context.route("**/*", (route) => {
      const request = route.request();
      if (new URL(request.url()).host === host) return route.continue();
      const type = request.resourceType();
      return type === "fetch" || type === "xhr"
        ? route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
        : route.abort();
    });
  }
  if (config.session?.localStorage) {
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    }, config.session.localStorage);
  }

  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });

  let ids = {};
  const global = config.seed.global;
  const seeded = await page
    .waitForFunction((name) => name in globalThis, global, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!seeded) throw new Error(`no globalThis.${global} in this bundle — was it built with ${seedEnv()}=1?`);
  if (config.seed.ready?.testId) {
    await page.getByTestId(config.seed.ready.testId).first().waitFor({ state: config.seed.ready.state ?? "visible", timeout: 60_000 });
  }
  ids = (await page.evaluate(([name, lang]) => globalThis[name](lang), [global, language])) ?? {};

  const path = typeof shot.path === "function" ? shot.path(ids, language) : shot.path;
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const anchor = shot.anchor.testId
    ? page.getByTestId(shot.anchor.testId)
    : page.getByText(typeof shot.anchor.text === "string" ? shot.anchor.text : shot.anchor.text[language], { exact: false });
  await anchor.first().waitFor({ state: "visible", timeout: 30_000 });
  if (shot.open) await shot.open(page, { ids, language });

  const hide = [...config.hide, ...(shot.hide ?? [])];
  if (hide.length) await page.addStyleTag({ content: `${hide.join(", ")} { display: none !important; }` });
  // Charts and transitions animate in; a frame taken mid-animation is a picture of half a bar.
  await page.waitForTimeout(shot.settleMs ?? config.settleMs ?? 1200);
  const buffer = await page.screenshot({ type: "png" });
  await context.close();
  return buffer;
}

async function main() {
  const dir = appDir(argv);
  const config = await loadConfig(dir);

  const what = flag(argv, "validate", null);
  if (argv.includes("--validate")) {
    const scope = what ?? "all";
    if (!["config", "seed", "guard", "scripts", "all"].includes(scope)) throw new Error(`--validate ${scope}: config, seed, guard, scripts or all`);
    const problems = validate(config, scope);
    if (problems.length) {
      console.error(`store-shots ${scope}: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}`);
      process.exit(1);
    }
    console.log(`store-shots ${scope}: ok`);
    return;
  }

  const problems = configProblems(config);
  if (problems.length) throw new Error(`store-shots.config.mjs:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  const baseUrl = (argv.find((arg) => !arg.startsWith("--") && /^https?:/.test(arg)) ?? `http://localhost:${config.server.port}`).replace(/\/$/, "");
  const pick = (name) => argv.flatMap((arg, i) => (arg === `--${name}` ? [argv[i + 1]] : []));
  const locales = pick("locale").length ? pick("locale") : Object.keys(config.locales);
  const devices = pick("device");

  const browser = await launch(config);
  let count = 0;
  try {
    for (const locale of locales) {
      if (!config.locales[locale]) throw new Error(`locale ${locale} is not in config.locales`);
      for (const shot of config.shots) {
        for (const device of shotDevices(config, shot)) {
          if (devices.length && !devices.includes(device)) continue;
          const buffer = await captureScreen(browser, config, baseUrl, locale, shot, device);
          const out = join(config.outDir, "raw", config.locales[locale], device);
          mkdirSync(out, { recursive: true });
          writeFileSync(join(out, `${shot.key}.png`), buffer);
          count++;
          console.log(`  ${locale} ${device.padEnd(7)} ${shot.key}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`${count} captures in ${relative(process.cwd(), join(config.outDir, "raw")) || "."}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
