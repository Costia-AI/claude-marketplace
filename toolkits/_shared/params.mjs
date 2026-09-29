/**
 * Reads the parameters a setup flow resolved for this repository.
 *
 * The costia plugin writes them next to the configuration (docs/setup-flows.md §3):
 *
 *   .claude/costia/params.env        project parameters, committed
 *   .claude/costia/params.local.env  personal and machine parameters, excluded from git
 *
 * `KEY=value` lines with POSIX-quoted values. They never hold secrets. A variable already set in
 * the environment wins, so a one-off `INFISICAL_ENV=staging node …` works without editing anything.
 *
 * Without the plugin, write the same two files by hand, or export the variables.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = ["params.env", "params.local.env"];

/** Parses one POSIX-quoted shell word: 'single', "double" (with \" \\ \$ \` escapes), or bare. */
function unquote(raw) {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === "'") {
      const end = raw.indexOf("'", i + 1);
      if (end === -1) throw new Error("unterminated single quote");
      out += raw.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      i++;
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === "\\" && i + 1 < raw.length && '"\\$`'.includes(raw[i + 1])) i++;
        out += raw[i++];
      }
      if (raw[i] !== '"') throw new Error("unterminated double quote");
      i++;
    } else if (c === "\\" && i + 1 < raw.length) {
      out += raw[i + 1];
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    values[match[1]] = unquote(match[2]);
  }
  return values;
}

/** The `.claude/costia` folder of the target this script runs for. */
export function paramsDir() {
  if (process.env.COSTIA_PARAMS_DIR) return resolve(process.env.COSTIA_PARAMS_DIR);
  const candidates = [];
  // Installed in a repository: <target>/.claude/skills/<skill>/scripts/<file>
  const here = dirname(fileURLToPath(import.meta.url));
  candidates.push(resolve(here, "../../../costia"));
  // Anywhere else (the user destination, or a copy): walk up from the working directory.
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    candidates.push(join(dir, ".claude", "costia"));
    if (dirname(dir) === dir) break;
  }
  return candidates.find((dir) => FILES.some((file) => existsSync(join(dir, file)))) ?? null;
}

/**
 * Loads both files into `process.env` (without overriding what is already set) and returns the
 * merged values. `required` names variables that must end up set; missing ones fail with a
 * sentence saying how to set them.
 */
export function loadParams({ required = [], skill = "this skill" } = {}) {
  const dir = paramsDir();
  const values = {};
  if (dir) {
    for (const file of FILES) {
      const path = join(dir, file);
      if (existsSync(path)) Object.assign(values, parseEnv(readFileSync(path, "utf8")));
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `${skill} needs ${missing.join(", ")}. Finish its setup (/costia:install, or the costia wizard), ` +
        `or set them in .claude/costia/params.env or the environment.`,
    );
  }
  return { ...values, ...Object.fromEntries(required.map((key) => [key, process.env[key]])) };
}

/** Where the repository this target belongs to starts: the folder holding `.claude/`. */
export function targetRoot() {
  const dir = paramsDir();
  return dir ? resolve(dir, "..", "..") : process.cwd();
}
