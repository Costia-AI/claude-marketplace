#!/usr/bin/env node
/**
 * Creates, rotates and checks Infisical secrets without anyone seeing them.
 *
 *   node secret.mjs list                                   names only
 *   node secret.mjs exists NAME [NAME…]                    exit 0 only when all exist and are non-empty
 *   node secret.mjs create NAME <source>                   fails if it exists
 *   node secret.mjs rotate NAME <source>                   fails if it does not; lists what reads it
 *   node secret.mjs shape  NAME (--pattern REGEX | --pem | --json)   length and a yes/no, never the value
 *
 * <source> is one of:
 *   --generate random[:LENGTH[:CHARSET]]   CHARSET alnum (default), hex, base64url
 *   --generate rsa[:BITS]                  a PKCS#8 PEM private key (2048 by default)
 *   --from-file PATH                       read, sent, never copied; the file is left as it was
 *   --stdin                                piped in (a trailing newline is dropped)
 *   --prompt                               typed by a person at a terminal, not echoed
 *
 * Location flags override the parameters: --domain, --project, --env, --path.
 * Nothing this prints contains a value.
 */
import { generateKeyPairSync, randomInt } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadParams, targetRoot } from "./params.mjs";
import { describe, getSecret, listNames, location, setSecret } from "./infisical.mjs";

const CHARSETS = {
  alnum: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  hex: "0123456789abcdef",
  base64url: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
};

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) positional.push(arg);
    else if (["--stdin", "--prompt", "--pem", "--json"].includes(arg)) flags[arg.slice(2)] = true;
    else flags[arg.slice(2)] = argv[++i];
  }
  return { positional, flags };
}

function generate(spec) {
  const [kind, a, b] = spec.split(":");
  if (kind === "random") {
    const length = Number(a ?? 40);
    const charset = CHARSETS[b ?? "alnum"];
    if (!charset || !Number.isInteger(length) || length < 8 || length > 4096) fail(`Bad --generate ${spec}`, 64);
    let out = "";
    for (let i = 0; i < length; i++) out += charset[randomInt(charset.length)];
    return out;
  }
  if (kind === "rsa") {
    const bits = Number(a ?? 2048);
    if (![2048, 3072, 4096].includes(bits)) fail("rsa bits: 2048, 3072 or 4096", 64);
    return generateKeyPairSync("rsa", { modulusLength: bits, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;
  }
  fail(`Unknown generator ${kind}: random or rsa.`, 64);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function prompt(label) {
  if (!process.stdin.isTTY) fail("--prompt needs a terminal. Ask the person to run this command themselves (in Claude Code: `! node …`).", 64);
  process.stderr.write(`${label} (input hidden): `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  return new Promise((resolve) => {
    process.stdin.on("data", (data) => {
      for (const char of data.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") fail("\ncancelled", 130);
        if (char === "\u007f") value = value.slice(0, -1);
        else value += char;
      }
    });
  });
}

async function value(flags, name) {
  const sources = ["generate", "from-file", "stdin", "prompt"].filter((key) => flags[key] !== undefined);
  if (sources.length !== 1) fail("Give exactly one source: --generate, --from-file, --stdin or --prompt.", 64);
  if (flags.generate) return generate(flags.generate);
  if (flags["from-file"]) return readFileSync(flags["from-file"], "utf8");
  if (flags.stdin) return readStdin();
  return prompt(name);
}

/** Files in this repository that name the secret: what a rotation has to reach. */
function consumers(name) {
  const root = targetRoot();
  const found = [];
  const skip = new Set([".git", "node_modules", "dist", "build", ".expo", ".next", "Pods", ".gradle", "vendor"]);
  const walk = (dir, depth) => {
    if (depth > 8 || found.length >= 50) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile()) {
        try {
          if (statSync(path).size > 512 * 1024) continue;
          if (readFileSync(path, "utf8").includes(name)) found.push(relative(root, path));
        } catch { /* unreadable */ }
      }
    }
  };
  walk(root, 0);
  return found;
}

const [command, ...rest] = process.argv.slice(2);
const { positional, flags } = parse(rest);
loadParams({ required: ["INFISICAL_PROJECT"], skill: "infisical-secrets" });
const loc = location({ domain: flags.domain, project: flags.project, env: flags.env, path: flags.path });

try {
  switch (command) {
    case "list": {
      const names = await listNames(loc);
      console.log(`${describe(loc)}\n${names.length ? names.map((n) => `  ${n}`).join("\n") : "  (empty)"}`);
      break;
    }
    case "exists": {
      if (!positional.length) fail("exists NAME [NAME…]", 64);
      let ok = true;
      for (const name of positional) {
        const v = await getSecret(loc, name);
        const present = typeof v === "string" && v.length > 0;
        ok &&= present;
        console.log(`${present ? "yes" : "no "}  ${name}`);
      }
      process.exit(ok ? 0 : 1);
      break;
    }
    case "create":
    case "rotate": {
      const name = positional[0] ?? fail(`${command} NAME <source>`, 64);
      const secret = await value(flags, name);
      const result = await setSecret(loc, name, secret, { mode: command === "create" ? "create" : "update" });
      console.log(`${name} ${result} at ${describe(loc)} (${secret.length} characters).`);
      if (command === "rotate") {
        const files = consumers(name);
        console.log("\nThe old value is still in use wherever it was copied. Resync these:");
        console.log(files.length ? files.map((f) => `  ${f}`).join("\n") : "  (nothing in this repository names it)");
        console.log("  and anything outside it: CI variables, EAS/Vercel secrets, Kubernetes ExternalSecrets (refresh or wait for their interval), other repositories.");
      }
      break;
    }
    case "shape": {
      const name = positional[0] ?? fail("shape NAME (--pattern REGEX | --pem | --json)", 64);
      const v = await getSecret(loc, name);
      if (v === null) fail(`${name} does not exist.`, 1);
      let ok;
      if (flags.pem) ok = /^-----BEGIN [A-Z ]+-----\r?\n[\s\S]+\r?\n-----END [A-Z ]+-----\s*$/.test(v);
      else if (flags.json) {
        try {
          JSON.parse(v);
          ok = true;
        } catch {
          ok = false;
        }
      } else if (flags.pattern) ok = new RegExp(`^(?:${flags.pattern})$`).test(v);
      else fail("shape needs --pattern, --pem or --json", 64);
      console.log(`${name}: ${v.length} characters, ${ok ? "matches" : "DOES NOT match"}.`);
      process.exit(ok ? 0 : 1);
      break;
    }
    default:
      fail("usage: secret.mjs list | exists NAME… | create NAME <source> | rotate NAME <source> | shape NAME …", 64);
  }
} catch (error) {
  fail(error.message);
}
