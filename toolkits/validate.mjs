#!/usr/bin/env node
/**
 * Checks every toolkit and setup flow here against the rules the backend enforces on publish
 * (costia-claudetools docs/setup-flows.md §2, docs/plugin-protocol.md "Destinations").
 *
 *   node toolkits/validate.mjs
 *
 * Exits 1 with one line per problem. `publish.mjs` runs it first and refuses to publish on any.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(fileURLToPath(import.meta.url));

const KINDS = ["SKILL", "SUBAGENT", "COMMAND", "HOOK", "MCP_SERVER", "PLUGIN_REF", "AGENTS_SECTION", "SETTINGS_FRAGMENT", "OUTPUT_STYLE", "SETUP_FLOW"];
const SCOPES = ["machine", "user", "project", "project_user"];
const PARAM_TYPES = ["string", "enum", "boolean", "url"];
const STEP_TYPES = ["check", "input", "confirm", "secret", "claude"];
const OSES = ["*", "linux", "darwin", "windows"];
const DESTINATIONS = ["repo", "private", "user"];
const BUILTINS = {
  command: { required: ["command"], optional: ["minVersion"] },
  file: { required: ["path"], optional: [] },
  env: { required: ["name"], optional: [] },
  "infisical.logged-in": { required: [], optional: ["domain"] },
  "infisical.project-exists": { required: ["domain", "project"], optional: [] },
  "infisical.secret-exists": { required: ["domain", "project", "env", "name"], optional: ["path"] },
  "google-play.access": { required: ["secret", "package"], optional: [] },
  "app-store-connect.access": { required: ["p8", "keyId", "issuerId", "appId"], optional: [] },
};
const BUILTIN_VARS = new Set(["project.name", "os"]);
const SLUG = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const TAG = /^[a-z0-9][a-z0-9+.-]{0,40}$/;

const upperSnake = (key) => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

export function loadFlows() {
  const dir = join(ROOT, "flows");
  const flows = new Map();
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const flow = JSON.parse(readFileSync(join(dir, name), "utf8"));
    flow.file = `flows/${name}`;
    flows.set(flow.slug, flow);
  }
  return flows;
}

export function loadToolkits() {
  return readdirSync(ROOT)
    .filter((name) => !name.startsWith("_") && name !== "flows" && existsSync(join(ROOT, name, "toolkit.json")))
    .sort()
    .map((name) => ({ ...JSON.parse(readFileSync(join(ROOT, name, "toolkit.json"), "utf8")), dir: join(ROOT, name), file: `${name}/toolkit.json` }));
}

/** Every string inside a value, with its JSON pointer. */
function strings(value, pointer, out = []) {
  if (typeof value === "string") out.push([pointer, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${pointer}/${i}`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, `${pointer}/${k}`, out);
  return out;
}

function closure(flows, slug, seen = new Set(), stack = []) {
  if (stack.includes(slug)) throw new Error(`cycle: ${[...stack, slug].join(" → ")}`);
  const flow = flows.get(slug);
  if (!flow) return seen;
  for (const req of flow.spec?.requires ?? []) {
    closure(flows, req.flow, seen, [...stack, slug]);
    seen.add(req.flow);
  }
  return seen;
}

function checkCheck(check, where, problems) {
  if (!check || typeof check !== "object") return problems.push(`${where}: a check must be an object`);
  if ("run" in check) {
    if (!Array.isArray(check.run) || !check.run.length || !check.run.every((a) => typeof a === "string" && a.length)) problems.push(`${where}: run must be a non-empty argv of strings`);
    if (check.cwd !== undefined) problems.push(`${where}: cwd is not a field; use base`);
    if (check.base !== undefined && !["checkout", "target"].includes(check.base)) problems.push(`${where}: base must be checkout or target`);
    if (check.timeoutMs !== undefined && !(Number.isInteger(check.timeoutMs) && check.timeoutMs > 0 && check.timeoutMs <= 60_000)) problems.push(`${where}: timeoutMs ≤ 60000`);
    if (check.expectExit !== undefined && !Number.isInteger(check.expectExit)) problems.push(`${where}: expectExit must be an integer`);
    return;
  }
  const spec = BUILTINS[check.builtin];
  if (!spec) return problems.push(`${where}: unknown builtin ${check.builtin}`);
  for (const field of spec.required) if (check[field] === undefined || check[field] === "") problems.push(`${where}: ${check.builtin} needs ${field}`);
  for (const field of Object.keys(check)) if (field !== "builtin" && !spec.required.includes(field) && !spec.optional.includes(field)) problems.push(`${where}: ${check.builtin} has no field ${field}`);
  for (const field of ["secret", "p8", "keyId", "issuerId"]) {
    if (field in check) {
      const loc = check[field];
      for (const part of ["store", "domain", "project", "env", "name"]) if (!loc?.[part]) problems.push(`${where}/${field}: needs ${part}`);
      if (loc?.store && loc.store !== "infisical") problems.push(`${where}/${field}: store must be infisical`);
    }
  }
}

export function validateFlow(flow, flows) {
  const problems = [];
  const at = (p) => `${flow.file}${p}`;
  if (!SLUG.test(flow.slug ?? "")) problems.push(at(": bad slug"));
  if (!flow.name || flow.name.length > 120) problems.push(at(": name 1–120"));
  for (const tag of flow.tags ?? []) if (!TAG.test(tag)) problems.push(at(`: bad tag ${tag}`));
  const spec = flow.spec;
  if (!spec || spec.schema !== 1) return [...problems, at(": spec.schema must be 1")];

  const params = new Map();
  for (const [i, p] of (spec.params ?? []).entries()) {
    const w = at(`/spec/params/${i}`);
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(p.key ?? "")) problems.push(`${w}: bad key`);
    if (params.has(p.key)) problems.push(`${w}: duplicate key ${p.key}`);
    params.set(p.key, p);
    if ((p.label ?? "").length > 120) problems.push(`${w}: label > 120`);
    if ((p.description ?? "").length > 2000) problems.push(`${w}: description > 2000`);
    if (!PARAM_TYPES.includes(p.type)) problems.push(`${w}: type ${p.type}`);
    if (!SCOPES.includes(p.scope)) problems.push(`${w}: scope ${p.scope}`);
    if (p.type === "enum" && !(Array.isArray(p.options) && p.options.length >= 1 && p.options.length <= 50 && p.options.every((o) => typeof o === "string"))) problems.push(`${w}: enum needs 1–50 string options`);
    if (p.pattern !== undefined) {
      if (p.pattern.length > 200) problems.push(`${w}: pattern > 200`);
      try {
        const re = new RegExp(p.pattern);
        if (typeof p.default === "string" && !re.test(p.default)) problems.push(`${w}: default does not match pattern`);
      } catch {
        problems.push(`${w}: pattern does not compile`);
      }
    }
    if (p.type === "enum" && p.default !== undefined && !p.options?.includes(p.default)) problems.push(`${w}: default not among options`);
    if (typeof p.default === "string" && p.default.includes(`{{${p.key}}}`)) problems.push(`${w}: default refers to itself`);
    const env = p.env ?? upperSnake(p.key ?? "");
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(env)) problems.push(`${w}: env ${env}`);
    if (p.editable !== undefined && typeof p.editable !== "boolean") problems.push(`${w}: editable must be boolean`);
    if (/secret|password|token/i.test(p.key) && !/Secret$/.test(p.key)) problems.push(`${w}: a parameter is never a secret (name the secret, not its value)`);
  }

  // Parameters visible to templates: this flow's and those of every flow it requires.
  let visible = new Set(params.keys());
  try {
    for (const slug of closure(flows, flow.slug)) for (const p of flows.get(slug)?.spec?.params ?? []) visible.add(p.key);
  } catch (error) {
    problems.push(at(`: ${error.message}`));
  }

  for (const [i, req] of (spec.requires ?? []).entries()) {
    const target = flows.get(req.flow);
    if (!target) problems.push(at(`/spec/requires/${i}: unknown flow ${req.flow}`));
    for (const key of Object.keys(req.params ?? {})) if (target && !target.spec.params?.some((p) => p.key === key)) problems.push(at(`/spec/requires/${i}: ${req.flow} has no param ${key}`));
  }

  const steps = spec.steps ?? [];
  if (steps.length < 1 || steps.length > 50) problems.push(at(": 1–50 steps"));
  const ids = new Set();
  for (const [i, s] of steps.entries()) {
    const w = at(`/spec/steps/${i}`);
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(s.id ?? "")) problems.push(`${w}: bad id`);
    if (ids.has(s.id)) problems.push(`${w}: duplicate id ${s.id}`);
    ids.add(s.id);
    if (!s.title || s.title.length > 120) problems.push(`${w}: title 1–120`);
    if (!SCOPES.includes(s.scope)) problems.push(`${w}: scope ${s.scope}`);
    if (!STEP_TYPES.includes(s.type)) problems.push(`${w}: type ${s.type}`);
    for (const [os, text] of Object.entries(s.instructions ?? {})) {
      if (!OSES.includes(os)) problems.push(`${w}: instructions for unknown OS ${os}`);
      if (typeof text !== "string" || text.length > 20_000) problems.push(`${w}: instructions.${os} must be ≤ 20000 characters`);
    }
    if (s.type !== "claude" && !s.instructions?.["*"] && !OSES.slice(1).every((os) => s.instructions?.[os])) problems.push(`${w}: instructions need "*" or every OS`);
    if (s.type === "check" && !s.check) problems.push(`${w}: a check step needs a check`);
    if (s.type === "input") {
      if (!Array.isArray(s.params) || !s.params.length) problems.push(`${w}: an input step names params`);
      for (const key of s.params ?? []) if (!params.has(key)) problems.push(`${w}: unknown param ${key}`);
    }
    if (s.type === "secret") {
      const sec = s.secret ?? {};
      if (sec.store !== "infisical") problems.push(`${w}: secret.store must be infisical`);
      for (const part of ["name", "domain", "project", "env"]) if (!sec[part]) problems.push(`${w}: secret.${part} is required`);
      if (!["file", "text", "generate"].includes(sec.source)) problems.push(`${w}: secret.source file, text or generate`);
      if (sec.source === "generate" && !["random", "rsa"].includes(sec.generate?.kind)) problems.push(`${w}: secret.generate.kind random or rsa`);
      if (s.rotate !== undefined && typeof s.rotate !== "boolean") problems.push(`${w}: rotate must be boolean`);
    }
    if (s.type === "claude" && (!s.prompt || s.prompt.length > 20_000)) problems.push(`${w}: a claude step needs a prompt ≤ 20000`);
    if (s.check) checkCheck(s.check, `${w}/check`, problems);
  }
  for (const [i, check] of (spec.verify ?? []).entries()) checkCheck(check, at(`/spec/verify/${i}`), problems);

  for (const [pointer, text] of strings(spec, "/spec")) {
    for (const match of text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      if (!visible.has(match[1]) && !BUILTIN_VARS.has(match[1])) problems.push(at(`${pointer}: unknown template {{${match[1]}}}`));
    }
  }
  return problems;
}

function allSteps(flows, slugs) {
  const out = [];
  for (const slug of slugs) {
    for (const s of flows.get(slug)?.spec?.steps ?? []) out.push({ slug, ...s });
    for (const p of flows.get(slug)?.spec?.params ?? []) out.push({ slug, id: `param ${p.key}`, scope: p.scope });
  }
  return out;
}

function walkFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "__pycache__" || entry.name === "toolkit.json" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, base, out);
    else out.push(path.slice(base.length + 1).split("\\").join("/"));
  }
  return out;
}

/** The files a toolkit publishes: its own plus `include`d shared ones, by path inside the item. */
export function toolkitFiles(toolkit) {
  const files = new Map();
  if (toolkit.kind === "AGENTS_SECTION") return files;
  for (const rel of walkFiles(toolkit.dir)) files.set(rel, join(toolkit.dir, rel));
  for (const [dest, source] of Object.entries(toolkit.include ?? {})) files.set(dest, resolve(toolkit.dir, source));
  return files;
}

export function validateToolkit(toolkit, flows) {
  const problems = [];
  const at = (p) => `${toolkit.file}${p}`;
  if (!KINDS.includes(toolkit.kind) || toolkit.kind === "SETUP_FLOW") problems.push(at(`: kind ${toolkit.kind}`));
  if (!SLUG.test(toolkit.slug ?? "")) problems.push(at(": bad slug"));
  if (!toolkit.name || toolkit.name.length > 120) problems.push(at(": name 1–120"));
  for (const tag of toolkit.tags ?? []) if (!TAG.test(tag)) problems.push(at(`: bad tag ${tag}`));
  if (!DESTINATIONS.includes(toolkit.defaultDestination)) problems.push(at(`: defaultDestination ${toolkit.defaultDestination}`));
  const required = new Set();
  for (const [i, req] of (toolkit.requires ?? []).entries()) {
    if (!flows.has(req.flow)) problems.push(at(`/requires/${i}: unknown flow ${req.flow}`));
    required.add(req.flow);
    try {
      for (const slug of closure(flows, req.flow)) required.add(slug);
    } catch (error) {
      problems.push(at(`: ${error.message}`));
    }
  }
  if (toolkit.defaultDestination === "user") {
    for (const s of allSteps(flows, required)) if (!["machine", "user"].includes(s.scope)) problems.push(at(`: destination user, but ${s.slug}/${s.id} is ${s.scope} scope`));
  }
  if (toolkit.kind === "SKILL") {
    const files = toolkitFiles(toolkit);
    if (!files.has("SKILL.md")) problems.push(at(": a skill needs SKILL.md"));
    const skill = files.has("SKILL.md") ? readFileSync(files.get("SKILL.md"), "utf8") : "";
    const name = /^---\n[\s\S]*?^name:\s*(.+)$/m.exec(skill)?.[1]?.trim();
    if (name !== toolkit.slug) problems.push(at(`: SKILL.md name "${name}" is not the slug`));
    if (!/^description:\s*\S/m.test(skill)) problems.push(at(": SKILL.md has no description"));
    let total = 0;
    for (const [rel, path] of files) {
      if (!existsSync(path)) {
        problems.push(at(`: ${rel} → ${path} does not exist`));
        continue;
      }
      for (const segment of rel.split("/")) if (!/^[\w@+.-]{1,100}$/.test(segment) || segment === "." || segment === "..") problems.push(at(`: bad file path ${rel}`));
      const size = statSync(path).size;
      if (size > 1024 * 1024) problems.push(at(`: ${rel} is larger than 1 MB`));
      total += size;
    }
    if (files.size > 100) problems.push(at(": more than 100 files"));
    if (total > 5 * 1024 * 1024) problems.push(at(": files add up to more than 5 MB"));
    for (const rel of Object.keys(toolkit.modes ?? {})) if (!files.has(rel)) problems.push(at(`: modes names ${rel}, which is not published`));
  }
  if (toolkit.kind === "AGENTS_SECTION") {
    if (!toolkit.title) problems.push(at(": a section needs a title"));
    const path = join(toolkit.dir, "section.md");
    if (!existsSync(path)) problems.push(at(": a section needs section.md"));
    else {
      const content = readFileSync(path, "utf8");
      if (content.length > 50_000) problems.push(at(": section longer than 50,000 characters"));
      if (content.includes("<!-- costia:")) problems.push(at(": a section cannot contain costia markers"));
    }
  }
  return problems;
}

export function validateAll() {
  const flows = loadFlows();
  const toolkits = loadToolkits();
  const problems = [];
  for (const flow of flows.values()) problems.push(...validateFlow(flow, flows));
  for (const toolkit of toolkits) problems.push(...validateToolkit(toolkit, flows));
  return { flows, toolkits, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { flows, toolkits, problems } = validateAll();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`${flows.size} flows and ${toolkits.length} toolkits are valid.`);
}
