#!/usr/bin/env node
/**
 * Publishes the setup flows and toolkits in this folder to a Costia Claude Tools workspace.
 *
 *   node toolkits/publish.mjs                              dry run: validates and prints the plan
 *   node toolkits/publish.mjs --commit [--workspace slug] [--only slug]... [--changelog "…"]
 *
 * Flows go first, in dependency order, then items. An item that exists (same workspace, kind and
 * slug) gets its metadata updated and a new version; the backend returns the latest version
 * unchanged when the content is identical, so re-running is harmless.
 *
 * `requires` and flow references are written here as bare slugs of flows in this folder; they are
 * published as `<workspace>/<slug>`, which the backend resolves to item ids.
 *
 * Authentication is the costia plugin's: `COSTIA_TOKEN`, or the credentials `/costia:login` saved
 * (refreshed here under the same file lock the plugin uses). Hosts: `COSTIA_API`, `COSTIA_ISSUER`.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { toolkitFiles, validateAll } from "./validate.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};
const commit = argv.includes("--commit");
const only = argv.flatMap((arg, i) => (arg === "--only" ? [argv[i + 1]] : []));
const changelog = flag("changelog", undefined);

const API = (process.env.COSTIA_API ?? "https://claude-api.costia.app").replace(/\/$/, "");
const ISSUER = (process.env.COSTIA_ISSUER ?? "https://id.costia.app").replace(/\/$/, "");
const CLIENT_ID = process.env.COSTIA_CLIENT_ID ?? "costia-claude-tools-cli";

// ------------------------------------------------------------------ credentials (as the plugin)

function configDir() {
  if (process.env.COSTIA_CONFIG_DIR) return process.env.COSTIA_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.startsWith("/") ? xdg : join(homedir(), ".config"), "costia");
}

const credentialsFile = () => join(configDir(), "credentials.json");

function readCredentials() {
  try {
    return JSON.parse(readFileSync(credentialsFile(), "utf8"));
  } catch {
    return null;
  }
}

function writeCredentials(value) {
  const path = credentialsFile();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temp, path);
}

async function withLock(path, run) {
  const lock = `${path}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 15_000) rmSync(lock, { recursive: true, force: true });
      } catch { /* gone */ }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${lock}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await run();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

async function tokenEndpoint() {
  try {
    const response = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) return (await response.json()).token_endpoint;
  } catch { /* default */ }
  return `${ISSUER}/oauth2/token`;
}

async function accessToken() {
  if (process.env.COSTIA_TOKEN) return process.env.COSTIA_TOKEN;
  const current = readCredentials();
  if (!current) throw new Error("Not signed in: run /costia:login in Claude Code, or export COSTIA_TOKEN.");
  if (current.expiresAt - 60_000 > Date.now()) return current.accessToken;
  return withLock(credentialsFile(), async () => {
    const fresh = readCredentials();
    if (fresh.expiresAt - 60_000 > Date.now()) return fresh.accessToken;
    if (!fresh.refreshToken) throw new Error("Session expired: run /costia:login again.");
    const response = await fetch(await tokenEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: fresh.refreshToken, client_id: CLIENT_ID }),
    });
    if (!response.ok) throw new Error(`Refreshing the session failed (HTTP ${response.status}): run /costia:login again.`);
    const tokens = await response.json();
    writeCredentials({
      ...fresh,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? fresh.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return tokens.access_token;
  });
}

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      accept: "application/json",
      "user-agent": "costia-toolkits-publish",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { "idempotency-key": randomBytes(16).toString("hex") }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${data?.code ?? ""} ${data?.detail ?? data?.title ?? ""}`.trim());
  return data;
}

// ------------------------------------------------------------------------------ plan

function flowOrder(flows) {
  const order = [];
  const visit = (slug) => {
    if (order.includes(slug)) return;
    for (const req of flows.get(slug).spec.requires ?? []) visit(req.flow);
    order.push(slug);
  };
  for (const slug of flows.keys()) visit(slug);
  return order;
}

const ref = (workspace, slug) => `${workspace}/${slug}`;

function flowPayload(flow, workspace) {
  const spec = structuredClone(flow.spec);
  if (spec.requires) spec.requires = spec.requires.map((r) => ({ ...r, flow: ref(workspace, r.flow) }));
  return spec;
}

function itemPayload(toolkit, workspace) {
  const requires = (toolkit.requires ?? []).map((r) => ({ ...r, flow: ref(workspace, r.flow) }));
  if (toolkit.kind === "AGENTS_SECTION") {
    const content = readFileSync(join(toolkit.dir, "section.md"), "utf8");
    return { title: toolkit.title, content, ...(requires.length ? { requires } : {}) };
  }
  return requires.length ? { requires } : undefined;
}

function itemFiles(toolkit) {
  const files = {};
  for (const [rel, path] of toolkitFiles(toolkit)) files[rel] = readFileSync(path).toString("base64");
  return files;
}

async function personalWorkspace() {
  const { workspaces } = await api("GET", "/v1/me");
  const personal = workspaces.find((w) => w.kind === "PERSONAL");
  if (!personal) throw new Error("No personal workspace; pass --workspace.");
  return personal.slug;
}

async function findItem(workspace, kind, slug) {
  const params = new URLSearchParams({ workspace, kind, q: slug, limit: "100" });
  const { items } = await api("GET", `/v1/catalog/items?${params}`);
  return items.find((i) => i.slug === slug && i.kind === kind) ?? null;
}

async function publish(workspace, entry) {
  const { kind, slug, name, description, tags, defaultDestination, payload, files, modes } = entry;
  let item = await findItem(workspace, kind, slug);
  if (item) {
    await api("PATCH", `/v1/catalog/items/${item.id}`, { name, description, tags, defaultDestination });
  } else {
    item = await api("POST", `/v1/workspaces/${encodeURIComponent(workspace)}/catalog/items`, { kind, slug, name, description, tags, defaultDestination });
  }
  const version = await api("POST", `/v1/catalog/items/${item.id}/versions`, {
    ...(files ? { files, modes } : {}),
    ...(payload ? { payload } : {}),
    changelog,
    publish: true,
  });
  return { id: item.id, version: version.versionNo ?? version.version };
}

async function main() {
  const { flows, toolkits, problems } = validateAll();
  if (problems.length) {
    console.error(`Nothing is published:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  const workspace = flag("workspace", null) ?? (commit ? await personalWorkspace() : "<your-workspace>");
  const wanted = (slug) => !only.length || only.includes(slug);

  const plan = [];
  for (const slug of flowOrder(flows)) {
    const flow = flows.get(slug);
    if (!wanted(slug)) continue;
    plan.push({ kind: "SETUP_FLOW", slug, name: flow.name, description: flow.description, tags: flow.tags ?? [], defaultDestination: undefined, payload: flowPayload(flow, workspace) });
  }
  for (const toolkit of toolkits) {
    if (!wanted(toolkit.slug)) continue;
    const files = toolkit.kind === "AGENTS_SECTION" ? undefined : itemFiles(toolkit);
    plan.push({
      kind: toolkit.kind,
      slug: toolkit.slug,
      name: toolkit.name,
      description: toolkit.description,
      tags: toolkit.tags ?? [],
      defaultDestination: toolkit.defaultDestination,
      payload: itemPayload(toolkit, workspace),
      files,
      modes: toolkit.modes,
    });
  }

  for (const entry of plan) {
    const size = entry.files ? Object.values(entry.files).reduce((n, b64) => n + Buffer.from(b64, "base64").length, 0) : 0;
    const requires = entry.kind === "SETUP_FLOW" ? entry.payload.requires : entry.payload?.requires;
    console.log(
      `${entry.kind.padEnd(15)} ${ref(workspace, entry.slug).padEnd(40)} ` +
        `${entry.files ? `${Object.keys(entry.files).length} files, ${(size / 1024).toFixed(1)} KB` : "payload only"}` +
        `${requires?.length ? `  requires ${requires.map((r) => r.flow).join(", ")}` : ""}`,
    );
  }
  if (!commit) {
    console.log("\nDry run: nothing was sent. Publish with --commit [--workspace <slug>].");
    return;
  }
  for (const entry of plan) {
    const { id, version } = await publish(workspace, entry);
    console.log(`  published ${ref(workspace, entry.slug)} v${version} (${id})`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
