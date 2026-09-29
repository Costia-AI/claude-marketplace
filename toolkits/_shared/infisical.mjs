/**
 * Infisical over its REST API, with no dependency and no secret ever on a command line.
 *
 * Why the API and not `infisical secrets set`:
 *   - `argv` is readable by every process of the user, so `set NAME=value` publishes the value;
 *   - `infisical secrets set NAME=@file` is in the CLI's own help and **does not read the file**:
 *     it stores the literal string `@file`, prints `******`, and looks exactly like success.
 *
 * The token comes from `INFISICAL_TOKEN` (a machine identity, CI) or the CLI's own login
 * (`infisical user get token --plain`). It is kept in memory and never printed.
 *
 * Where secrets live comes from the setup flow `infisical-project`:
 *   INFISICAL_DOMAIN   https://app.infisical.com, https://eu.infisical.com or a self-hosted URL
 *   INFISICAL_PROJECT  the project's slug
 *   INFISICAL_ENV      the environment slug (prod, dev…)
 *   INFISICAL_PATH     the folder, "/" by default
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export class InfisicalError extends Error {}

/** The location from the parameters, with explicit overrides. */
export function location(overrides = {}) {
  const loc = {
    domain: (overrides.domain ?? process.env.INFISICAL_DOMAIN ?? "https://app.infisical.com").replace(/\/+$/, "").replace(/\/api$/, ""),
    project: overrides.project ?? process.env.INFISICAL_PROJECT,
    env: overrides.env ?? process.env.INFISICAL_ENV ?? "prod",
    path: overrides.path ?? process.env.INFISICAL_PATH ?? "/",
  };
  if (!loc.project) {
    throw new InfisicalError("No Infisical project: INFISICAL_PROJECT is not set (run the infisical-project setup, or export it).");
  }
  return loc;
}

let cachedToken;

/** A bearer token, from the environment or the CLI's login. Never logged. */
export async function token() {
  if (cachedToken) return cachedToken;
  if (process.env.INFISICAL_TOKEN) return (cachedToken = process.env.INFISICAL_TOKEN);
  try {
    const { stdout } = await run("infisical", ["user", "get", "token", "--plain"], { timeout: 15_000, maxBuffer: 1 << 20 });
    const lines = stdout.trim().split(/\r?\n/);
    const value = lines[lines.length - 1]?.trim();
    // Tested for presence only. A shape test with an `echo` in its else branch is how tokens leak.
    if (value) return (cachedToken = value);
  } catch { /* fall through */ }
  throw new InfisicalError("No Infisical token. Run `infisical login` (pick your instance), or export INFISICAL_TOKEN.");
}

async function api(loc, method, path, body) {
  const response = await fetch(`${loc.domain}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await token()}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  }).catch((error) => {
    throw new InfisicalError(`Could not reach ${loc.domain} (${error.cause?.code ?? error.name}). Check INFISICAL_DOMAIN and the network.`);
  });
  if (response.status === 404) return { status: 404, data: null };
  if (!response.ok) {
    // Deliberately not the body: secret endpoints can echo the value back.
    throw new InfisicalError(`${method} ${path.split("?")[0]} answered HTTP ${response.status}` +
      (response.status === 401 || response.status === 403 ? " — the token cannot reach this project (wrong instance, or not a member)." : "."));
  }
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

const projectIds = new Map();

/** The project's id from its slug. Machine identities need the id; the CLI has no command for it. */
export async function projectId(loc) {
  const key = `${loc.domain}|${loc.project}`;
  if (projectIds.has(key)) return projectIds.get(key);
  // Already an id.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(loc.project)) {
    projectIds.set(key, loc.project);
    return loc.project;
  }
  const { data } = await api(loc, "GET", "/v1/workspace");
  const found = (data?.workspaces ?? []).find((w) => w.slug === loc.project || w.id === loc.project);
  if (!found) throw new InfisicalError(`No project with slug "${loc.project}" is visible at ${loc.domain}.`);
  projectIds.set(key, found.id);
  return found.id;
}

function query(loc, id) {
  return new URLSearchParams({ workspaceId: id, environment: loc.env, secretPath: loc.path }).toString();
}

/** A secret's value, or null when it does not exist. Keep it in memory; never print it. */
export async function getSecret(loc, name) {
  const id = await projectId(loc);
  const { status, data } = await api(loc, "GET", `/v3/secrets/raw/${encodeURIComponent(name)}?${query(loc, id)}&type=shared`);
  if (status === 404) return null;
  return data?.secret?.secretValue ?? null;
}

/** Every secret at the location, as a Map of name to value. */
export async function getSecrets(loc) {
  const id = await projectId(loc);
  const { data } = await api(loc, "GET", `/v3/secrets/raw?${query(loc, id)}`);
  return new Map((data?.secrets ?? []).map((s) => [s.secretKey, s.secretValue]));
}

/** Names only: safe to show. */
export async function listNames(loc) {
  return [...(await getSecrets(loc)).keys()].sort();
}

/** Creates or overwrites a secret. The value travels in the request body and nowhere else. */
export async function setSecret(loc, name, value, { mode = "upsert" } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,254}$/.test(name)) throw new InfisicalError(`"${name}" is not a valid secret name.`);
  if (typeof value !== "string" || value.length === 0) throw new InfisicalError("Refusing to store an empty value.");
  const id = await projectId(loc);
  const exists = (await getSecret(loc, name)) !== null;
  if (mode === "create" && exists) throw new InfisicalError(`${name} already exists; rotate it instead.`);
  if (mode === "update" && !exists) throw new InfisicalError(`${name} does not exist; create it first.`);
  const body = { workspaceId: id, environment: loc.env, secretPath: loc.path, secretValue: value, type: "shared" };
  await api(loc, exists ? "PATCH" : "POST", `/v3/secrets/raw/${encodeURIComponent(name)}`, body);
  return exists ? "updated" : "created";
}

export function describe(loc) {
  return `${loc.domain} · ${loc.project} · ${loc.env} · ${loc.path}`;
}
