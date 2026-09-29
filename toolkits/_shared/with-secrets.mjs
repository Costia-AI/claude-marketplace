#!/usr/bin/env node
/**
 * Runs one command with secrets from Infisical, and takes them away again when it exits.
 *
 *   node with-secrets.mjs [--env VAR=SECRET]... [--file VAR=SECRET]... [--all] -- <command> [args…]
 *
 *   --env  VAR=SECRET   export the secret's value as $VAR
 *   --file VAR=SECRET   write the value to a 0600 file in a private temp folder and export its path as $VAR
 *   --all               export every secret at the location under its own name
 *   --optional          a missing secret is skipped instead of failing
 *
 * The value reaches the child process only through its environment or a file only its user can
 * read. The folder is overwritten and removed when the command ends, including on Ctrl-C.
 * **A long-running process must run inside this, not beside it**: a watcher started separately
 * loses its file halfway and dies with an error that looks like something else.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, openSync, readdirSync, rmSync, statSync, writeFileSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadParams } from "./params.mjs";
import { describe, getSecrets, location } from "./infisical.mjs";

function usage(message) {
  if (message) console.error(message);
  console.error("usage: with-secrets.mjs [--env VAR=SECRET]... [--file VAR=SECRET]... [--all] [--optional] -- <command…>");
  process.exit(64);
}

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
if (split === -1 || split === argv.length - 1) usage("Nothing to run: put the command after --.");
const options = argv.slice(0, split);
const command = argv.slice(split + 1);

const envs = [];
const fileVars = [];
let all = false;
let optional = false;
for (let i = 0; i < options.length; i++) {
  const option = options[i];
  if (option === "--all") all = true;
  else if (option === "--optional") optional = true;
  else if (option === "--env" || option === "--file") {
    const pair = options[++i] ?? "";
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(pair);
    if (!match) usage(`${option} takes VAR=SECRET, got "${pair}".`);
    (option === "--env" ? envs : fileVars).push({ variable: match[1], secret: match[2] });
  } else usage(`Unknown option ${option}.`);
}
if (!all && envs.length === 0 && fileVars.length === 0) usage("Say which secrets: --env, --file or --all.");

/** Overwrites, then removes: a best effort on copy-on-write filesystems, a real one elsewhere. */
function shred(dir) {
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        const size = statSync(path).size;
        const fd = openSync(path, "r+");
        writeSync(fd, randomBytes(Math.max(size, 1)));
        closeSync(fd);
      } catch { /* removed below anyway */ }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

loadParams({ required: ["INFISICAL_PROJECT"], skill: "with-secrets" });
const loc = location();
const secrets = await getSecrets(loc).catch((error) => {
  console.error(error.message);
  process.exit(69);
});

const missing = [...envs, ...fileVars].map((m) => m.secret).filter((name) => !secrets.has(name));
if (missing.length && !optional) {
  console.error(`Missing from Infisical (${describe(loc)}): ${missing.join(", ")}`);
  process.exit(66);
}

process.umask(0o077);
const dir = mkdtempSync(join(tmpdir(), "with-secrets-"));
let cleaned = false;
const cleanup = () => {
  if (!cleaned) {
    cleaned = true;
    shred(dir);
  }
};
process.on("exit", cleanup);

const env = { ...process.env };
if (all) for (const [name, value] of secrets) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) env[name] = value;
for (const { variable, secret } of envs) if (secrets.has(secret)) env[variable] = secrets.get(secret);
for (const { variable, secret } of fileVars) {
  if (!secrets.has(secret)) continue;
  const path = join(dir, `${variable.toLowerCase()}-${randomBytes(4).toString("hex")}`);
  writeFileSync(path, secrets.get(secret), { mode: 0o600, flag: "wx" });
  env[variable] = path;
}

const child = spawn(command[0], command.slice(1), { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on("error", (error) => {
  console.error(`Could not start ${command[0]}: ${error.message}`);
  cleanup();
  process.exit(127);
});
child.on("exit", (code, signal) => {
  cleanup();
  process.exit(code ?? (signal ? 128 + 1 : 1));
});
