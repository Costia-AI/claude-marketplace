#!/usr/bin/env node
/**
 * Builds the app's web export with the screenshot seed in, serves it, photographs it and frames it.
 *
 *   node web-preview.mjs [--app <dir>] [--skip-build] [--serve] [--port 8080] [--no-frames]
 *                        [--locale en-US]... [--device phone]...
 *
 * `--serve` stops after the server is up, to open a route in your own browser and look at it.
 *
 * The server serves the export the way static hosts do (`cleanUrls`): `/settings` answers with
 * `settings.html`. Falling through to `index.html` instead makes the browser hydrate the shell
 * prerendered for `/` against another route's tree, React throws a hydration error, and the
 * capture is of a screen that rebuilt itself on the client.
 *
 * Cross-origin isolation (COOP/COEP) is off unless the config asks for it
 * (`server.crossOriginIsolated`): some in-browser databases need `SharedArrayBuffer`, but
 * isolation also blocks third-party sign-in iframes. Match what the production host sends.
 */
import { execFileSync, spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { appDir, flag, loadConfig } from "./config.mjs";

const argv = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".css": "text/css", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon", ".js": "text/javascript",
  ".json": "application/json", ".map": "application/json", ".mjs": "text/javascript", ".otf": "font/otf",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".wasm": "application/wasm",
  ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
};

const config = await loadConfig(appDir(argv));
const port = Number(flag(argv, "port", config.server.port));
const root = resolve(config.appDir, config.build.outDir);

if (!argv.includes("--skip-build")) {
  const [command, ...args] = config.build.command;
  // An empty value beats .env.local, which dotenv would otherwise fill in.
  execFileSync(command, args, { cwd: config.appDir, stdio: "inherit", env: { ...process.env, ...config.build.env } });
}
if (!existsSync(join(root, "index.html"))) {
  console.error(`No build in ${root}. Drop --skip-build, or check build.command and build.outDir.`);
  process.exit(1);
}

const isFile = (candidate) => existsSync(candidate) && statSync(candidate).isFile();
function resolveFile(candidate) {
  if (isFile(candidate)) return candidate;
  if (isFile(`${candidate}.html`)) return `${candidate}.html`;
  if (isFile(join(candidate, "index.html"))) return join(candidate, "index.html");
  return join(root, "index.html");
}

const server = http.createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (config.server.crossOriginIsolated) {
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  // A request cannot climb out of the export, however it spells the path.
  const requested = resolve(join(root, decodeURIComponent(url.pathname)));
  const inRoot = requested === root || requested.startsWith(root + sep);
  const file = inRoot ? resolveFile(requested) : join(root, "index.html");
  response.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});

/**
 * `spawn`, never `execFileSync`: the synchronous version blocks this process's event loop, so this
 * very server would answer nothing while the browser asked for pages.
 */
function run(script, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(here, script), "--app", config.appDir, ...args], { stdio: "inherit" });
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

server.listen(port, "127.0.0.1", async () => {
  if (argv.includes("--serve")) {
    console.log(`Serving ${root} on http://localhost:${port}. Ctrl-C to stop.`);
    return;
  }
  const passThrough = argv.flatMap((arg, i) => (arg === "--locale" || arg === "--device" ? [arg, argv[i + 1]] : []));
  let code = await run("capture.mjs", [`http://localhost:${port}`, ...passThrough]);
  server.close();
  if (code === 0 && !argv.includes("--no-frames")) code = await run("frames.mjs", []);
  process.exit(code);
});
