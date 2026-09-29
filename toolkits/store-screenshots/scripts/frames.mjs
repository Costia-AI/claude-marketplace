#!/usr/bin/env node
/**
 * Composes the store screenshots: a line of copy above, the capture in a device outline under it,
 * on the brand's ground. Reads the bare captures `capture.mjs` wrote and needs no app running, so
 * redesigning the frame does not mean photographing the app again.
 *
 *   node frames.mjs [--app <dir>] [--language en]...
 *
 * Output: `<outDir>/<language>/<frame>/<n>-<key>.png`, in the order of `shots`, which is the order
 * both stores show them — the first larger than the rest, and most people never swipe past the third.
 * Each folder is emptied first: what is in it has to be what this run produced.
 *
 * Composed in the browser rather than with an image library because the caption is type: it needs
 * the app's own face, real kerning and a line break where it was written.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appDir, configProblems, loadConfig, shotDevices } from "./config.mjs";

const argv = process.argv.slice(2);

function which(command) {
  if (command.includes("/") || command.includes("\\")) return existsSync(command) ? command : null;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const extension of process.platform === "win32" ? ["", ".exe"] : [""]) {
      const candidate = join(dir, command + extension);
      if (dir && existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function fontFace(config) {
  const font = config.brand.font;
  if (!font?.file) return { css: "", family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" };
  const bytes = readFileSync(resolve(config.appDir, font.file)).toString("base64");
  const format = { ".ttf": "truetype", ".otf": "opentype", ".woff": "woff", ".woff2": "woff2" }[extname(font.file)] ?? "truetype";
  const family = font.family ?? "Brand";
  return {
    css: `@font-face { font-family: "${family}"; src: url(data:font/${format};base64,${bytes}) format("${format}"); font-weight: ${font.weight ?? 800}; }`,
    family: `"${family}", system-ui, sans-serif`,
  };
}

/** Every measurement is derived from the frame: 1320x2868 and 1080x1920 are different shapes. */
function frameHtml(config, frame, caption, capture) {
  const { brand } = config;
  const device = config.devices[frame.device];
  const ratio = device.viewport.height / device.viewport.width;
  const face = fontFace(config);
  const padTop = Math.round(frame.height * 0.056);
  const fontSize = Math.round(frame.width * 0.07);
  const lineHeight = 1.1;
  const lines = Math.max(1, caption.split("\n").length);
  const captionHeight = Math.round(fontSize * lineHeight * lines);
  const ruleGap = Math.round(frame.height * 0.02);
  const ruleHeight = Math.round(frame.width * 0.0074);
  const deviceGap = Math.round(frame.height * 0.03);
  const deviceTop = padTop + captionHeight + ruleGap + ruleHeight + deviceGap;
  const deviceWidth = Math.min(Math.round(frame.width * 0.8), Math.round((frame.height - deviceTop - frame.height * 0.03) / ratio));
  return `<!doctype html>
<meta charset="utf-8">
<style>
  ${face.css}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${frame.width}px; height: ${frame.height}px; overflow: hidden;
    background:
      radial-gradient(90% 45% at 50% 100%, ${brand.accent}40 0%, transparent 70%),
      radial-gradient(60% 30% at 88% 0%, ${brand.accent2}26 0%, transparent 70%),
      ${brand.background};
    font-family: ${face.family};
    display: flex; flex-direction: column; align-items: center;
  }
  h1 {
    margin-top: ${padTop}px; padding: 0 ${Math.round(frame.width * 0.067)}px;
    font-size: ${fontSize}px; font-weight: ${brand.font?.weight ?? 800}; line-height: ${lineHeight};
    letter-spacing: -0.015em; text-align: center; color: ${brand.ink}; white-space: pre-line;
  }
  .rule {
    margin-top: ${ruleGap}px; width: ${Math.round(frame.width * 0.122)}px; height: ${ruleHeight}px;
    border-radius: ${ruleHeight}px; background: linear-gradient(90deg, ${brand.accent}, ${brand.accent2});
  }
  .device {
    margin-top: ${deviceGap}px; width: ${deviceWidth}px;
    border-radius: ${Math.round(deviceWidth * device.radius)}px; overflow: hidden;
    border: 3px solid ${brand.border};
    box-shadow: 0 ${Math.round(frame.height * 0.025)}px ${Math.round(frame.height * 0.06)}px #000000a0;
  }
  .device img { display: block; width: 100%; }
</style>
<h1>${escapeHtml(caption)}</h1>
<div class="rule"></div>
<div class="device"><img src="data:image/png;base64,${capture.toString("base64")}"></div>
`;
}

async function main() {
  const config = await loadConfig(appDir(argv));
  const problems = configProblems(config);
  if (problems.length) throw new Error(`store-shots.config.mjs:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  const entry = createRequire(join(config.appDir, "package.json")).resolve("playwright-core");
  const { chromium } = await import(pathToFileURL(entry).href);
  const executable = process.env.CHROME_PATH ? which(process.env.CHROME_PATH) : null;
  const common = { args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  const browser = executable ? await chromium.launch({ ...common, executablePath: executable }) : await chromium.launch({ ...common, channel: "chrome" });

  const chosen = argv.flatMap((arg, i) => (arg === "--language" ? [argv[i + 1]] : []));
  const languages = [...new Set(Object.values(config.locales))].filter((l) => !chosen.length || chosen.includes(l));
  try {
    for (const language of languages) {
      for (const frame of config.frames) {
        const shots = config.shots.filter((shot) => shotDevices(config, shot).includes(frame.device));
        const directory = join(config.outDir, language, frame.name);
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { recursive: true });
        for (const [index, shot] of shots.entries()) {
          const raw = join(config.outDir, "raw", language, frame.device, `${shot.key}.png`);
          if (!existsSync(raw)) throw new Error(`${raw} is missing — run the capture first (store:shots).`);
          const context = await browser.newContext({ viewport: { width: frame.width, height: frame.height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
          const page = await context.newPage();
          await page.setContent(frameHtml(config, frame, shot.caption[language], readFileSync(raw)), { waitUntil: "load" });
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: join(directory, `${index + 1}-${shot.key}.png`), type: "png" });
          await context.close();
        }
        console.log(`  ${language}/${frame.name}: ${shots.length} screens ${frame.width}x${frame.height}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
