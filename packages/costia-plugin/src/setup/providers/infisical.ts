import { execFile } from "node:child_process";
import type { SecretLocation } from "../spec.ts";

/**
 * Infisical over its REST API. Secret values only ever travel in HTTPS request
 * and response bodies held in memory: never on a command line (argv is readable
 * by every process of the user, and `infisical secrets set NAME=@file` stores
 * the literal string "@file"), never on disk, never in a log or a tool result.
 */

export const DEFAULT_DOMAIN = "https://app.infisical.com";

export class ProviderError extends Error {}

function base(domain?: string): string {
  const d = (domain || DEFAULT_DOMAIN).replace(/\/+$/, "").replace(/\/api$/, "");
  if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(d) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(d)) {
    throw new ProviderError(`${domain} is not an https origin`);
  }
  return d;
}

/** Runs a program with fixed arguments, no shell, and returns its stdout (kept in memory). */
export function run(file: string, args: string[], timeoutMs = 5_000, env: NodeJS.ProcessEnv = process.env, cwd?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, env, cwd, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 127) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
  });
}

const tokens = new Map<string, string>();

/** An access token: INFISICAL_TOKEN (a machine identity), or the CLI's signed-in user. */
export async function token(domain?: string): Promise<string> {
  if (process.env.INFISICAL_TOKEN) return process.env.INFISICAL_TOKEN;
  const key = base(domain);
  const cached = tokens.get(key);
  if (cached) return cached;
  // The CLI answers for the instance it signed in to; `domain` only picks the API the token is sent to.
  const { code, stdout } = await run("infisical", ["user", "get", "token", "--plain"], 8_000);
  const value = stdout.trim().split("\n").pop()?.trim() ?? "";
  if (code !== 0 || !value || /\s/.test(value)) throw new ProviderError("the Infisical CLI is not signed in (run `infisical login`)");
  tokens.set(key, value);
  return value;
}

async function call<T>(domain: string | undefined, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T | undefined }> {
  const response = await fetch(`${base(domain)}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${await token(domain)}`,
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data: T | undefined;
  try {
    data = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    data = undefined;
  }
  return { status: response.status, data };
}

interface ProjectRow {
  id: string;
  slug: string;
  name?: string;
}

const projectIds = new Map<string, string>();

/** The id of the project with this slug (or id), or null when the token cannot see it. */
export async function projectId(domain: string | undefined, project: string): Promise<string | null> {
  const key = `${base(domain)} ${project}`;
  const cached = projectIds.get(key);
  if (cached) return cached;
  let rows: ProjectRow[] = [];
  const current = await call<{ projects?: ProjectRow[] }>(domain, "/api/v1/projects");
  if (current.status === 200 && current.data?.projects) rows = current.data.projects;
  else {
    // Older self-hosted instances still answer only the legacy name.
    const legacy = await call<{ workspaces?: ProjectRow[] }>(domain, "/api/v1/workspace");
    if (legacy.status === 401 || legacy.status === 403) throw new ProviderError("Infisical refused the token");
    rows = legacy.data?.workspaces ?? [];
  }
  const found = rows.find((p) => p.slug === project || p.id === project);
  if (found) projectIds.set(key, found.id);
  return found?.id ?? null;
}

function query(id: string, location: SecretLocation): string {
  return new URLSearchParams({ workspaceId: id, environment: location.env, secretPath: location.path || "/" }).toString();
}

async function requireProject(location: SecretLocation): Promise<string> {
  const id = await projectId(location.domain, location.project);
  if (!id) throw new ProviderError(`no Infisical project "${location.project}" is visible to this account`);
  return id;
}

/** The secret's value, in memory, or null when it does not exist. The caller must not print it. */
export async function readSecret(location: SecretLocation): Promise<string | null> {
  const id = await requireProject(location);
  const found = await call<{ secret?: { secretValue?: string } }>(
    location.domain,
    `/api/v3/secrets/raw/${encodeURIComponent(location.name)}?${query(id, location)}`,
  );
  if (found.status === 404 || found.status === 400) return null;
  if (found.status !== 200) throw new ProviderError(`Infisical answered ${found.status} reading ${location.name}`);
  const value = found.data?.secret?.secretValue;
  return value === undefined || value === "" ? null : value;
}

export async function secretExists(location: SecretLocation): Promise<boolean> {
  return (await readSecret(location)) !== null;
}

/** Creates the secret, or updates it when it exists. The value travels only in the request body. */
export async function writeSecret(location: SecretLocation, value: string): Promise<"created" | "updated"> {
  if (!value) throw new ProviderError("refusing to store an empty secret");
  const id = await requireProject(location);
  const body = { workspaceId: id, environment: location.env, secretPath: location.path || "/", secretValue: value, type: "shared" };
  const path = `/api/v3/secrets/raw/${encodeURIComponent(location.name)}`;
  const created = await call(location.domain, path, { method: "POST", body });
  if (created.status === 200) return "created";
  const updated = await call(location.domain, path, { method: "PATCH", body });
  if (updated.status === 200) return "updated";
  throw new ProviderError(`Infisical answered ${updated.status} storing ${location.name}`);
}

/** For tests. */
export function resetCaches(): void {
  tokens.clear();
  projectIds.clear();
}
