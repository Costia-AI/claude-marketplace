import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { approvalHash } from "../sync/json-merge.ts";
import { appStoreConnectAccess, googlePlayAccess } from "./providers/stores.ts";
import { projectId, ProviderError, readSecret, run, secretExists, token } from "./providers/infisical.ts";
import { isCommand, type Check } from "./spec.ts";

/**
 * Runs one check on this machine. The answer is pass or fail and a reason this
 * code wrote: a program's output never leaves here, and a secret read to prove
 * something is dropped as soon as the proof is made.
 */

export interface CheckResult {
  ok: boolean;
  reason: string;
  /** Set when a `run` check waits for the user's approval of this hash. */
  approval?: string;
}

export interface CheckContext {
  /** The folder the item is applied to: `file` and `run` checks with base "target" (the default). */
  target?: string;
  /** The checkout's root: base "checkout". Absent for the user destination. */
  checkout?: string;
  flow: string;
  approved: Set<string>;
}

function baseFolder(base: "target" | "checkout" | undefined, ctx: CheckContext): string | undefined {
  return base === "checkout" ? ctx.checkout ?? ctx.target : ctx.target ?? ctx.checkout;
}

/** The approval a `run` check needs: the flow and the expanded check, hashed. */
export function runApproval(flow: string, check: Check): string {
  return approvalHash("check", flow, check);
}

/** A human label for a check, for lists and reports. */
export function describeCheck(check: Check): string {
  if ("run" in check) return `\`${check.run.join(" ")}\` exits ${check.expectExit ?? 0}`;
  switch (check.builtin) {
    case "command":
      return `${check.command}${check.minVersion ? ` ≥ ${check.minVersion}` : ""} is installed`;
    case "file":
      return `${check.path} exists`;
    case "env":
      return `$${check.name} is set`;
    case "infisical.logged-in":
      return "the Infisical CLI is signed in";
    case "infisical.project-exists":
      return `the Infisical project ${check.project} exists`;
    case "infisical.secret-exists":
      return `the secret ${check.name} exists in ${check.project}/${check.env}`;
    case "google-play.access":
      return `the service account can edit ${check.package} in Play Console`;
    case "app-store-connect.access":
      return `the App Store Connect key can read app ${check.appId}`;
  }
}

/** The executable's full path (a name on PATH, or an absolute path), or null. */
export function which(command: string): string | null {
  if (isAbsolute(command)) {
    try {
      if (!statSync(command).isFile()) return null;
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = join(dir, command + ext);
      try {
        if (!statSync(full).isFile()) continue;
        accessSync(full, constants.X_OK);
        return full;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

function versionAtLeast(found: string, wanted: string): boolean {
  const a = found.split(".").map(Number);
  const b = wanted.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

function inside(root: string, relative: string): string | null {
  if (isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) return null;
  const full = resolve(root, relative);
  return full === root || full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : null;
}

/** Whether a check can run within a session-start budget: no network, no program but `--version`. */
export function isCheap(check: Check): boolean {
  return !("run" in check) && (check.builtin === "file" || check.builtin === "env" || (check.builtin === "command" && !check.minVersion));
}

export async function runCheck(check: Check, ctx: CheckContext): Promise<CheckResult> {
  try {
    if ("run" in check) {
      const approval = runApproval(ctx.flow, check);
      if (!ctx.approved.has(approval)) return { ok: false, reason: `waits for approval to run ${check.run[0]}`, approval };
      const [file, ...args] = check.run;
      const cwd = baseFolder(check.base, ctx);
      if (!cwd) return { ok: false, reason: "no folder to run in" };
      const { code } = await run(file!, args, check.timeoutMs ?? 30_000, process.env, cwd);
      const expected = check.expectExit ?? 0;
      return code === expected ? { ok: true, reason: `${file} exited ${code}` } : { ok: false, reason: `${file} exited ${code}, expected ${expected}` };
    }
    switch (check.builtin) {
      case "command": {
        if (!isCommand(check.command)) return { ok: false, reason: `${check.command} is not an executable name or an absolute path` };
        const found = which(check.command);
        if (!found) return { ok: false, reason: `${check.command} is not on PATH` };
        if (!check.minVersion) return { ok: true, reason: `${check.command} is installed` };
        const { stdout } = await run(found, ["--version"], 5_000);
        const version = /(\d+\.\d+(?:\.\d+)?)/.exec(stdout)?.[1];
        if (!version) return { ok: false, reason: `could not read the version of ${check.command}` };
        return versionAtLeast(version, check.minVersion)
          ? { ok: true, reason: `${check.command} ${version}` }
          : { ok: false, reason: `${check.command} ${version} is older than ${check.minVersion}` };
      }
      case "file": {
        const root = baseFolder(check.base, ctx);
        if (!root) return { ok: false, reason: "no folder to look in" };
        const full = inside(root, check.path);
        if (!full) return { ok: false, reason: `${check.path} is outside the checkout` };
        return existsSync(full) ? { ok: true, reason: `${check.path} exists` } : { ok: false, reason: `${check.path} does not exist` };
      }
      case "env":
        return process.env[check.name] ? { ok: true, reason: `$${check.name} is set` } : { ok: false, reason: `$${check.name} is not set` };
      case "infisical.logged-in":
        if (!process.env.INFISICAL_TOKEN && !which("infisical")) return { ok: false, reason: "the Infisical CLI is not installed" };
        await token(check.domain);
        return { ok: true, reason: "Infisical accepts this machine's session" };
      case "infisical.project-exists":
        return (await projectId(check.domain, check.project))
          ? { ok: true, reason: `the project ${check.project} is visible` }
          : { ok: false, reason: `no project ${check.project} is visible to this Infisical account` };
      case "infisical.secret-exists": {
        const exists = await secretExists({ store: "infisical", domain: check.domain, project: check.project, env: check.env, path: check.path, name: check.name });
        return exists ? { ok: true, reason: `${check.name} exists` } : { ok: false, reason: `${check.name} does not exist in ${check.project}/${check.env}${check.path && check.path !== "/" ? check.path : ""}` };
      }
      case "google-play.access": {
        const json = await readSecret(check.secret);
        if (json === null) return { ok: false, reason: `${check.secret.name} does not exist` };
        return await googlePlayAccess(json, check.package);
      }
      case "app-store-connect.access": {
        const [p8, keyId, issuerId] = await Promise.all([readSecret(check.p8), readSecret(check.keyId), readSecret(check.issuerId)]);
        const missing = [p8 === null && check.p8.name, keyId === null && check.keyId.name, issuerId === null && check.issuerId.name].filter(Boolean);
        if (missing.length) return { ok: false, reason: `missing ${missing.join(", ")}` };
        return await appStoreConnectAccess(p8!, keyId!, issuerId!, check.appId);
      }
    }
  } catch (error) {
    if (error instanceof ProviderError) return { ok: false, reason: error.message };
    const message = error instanceof Error ? error.message : String(error);
    // Network errors can quote a URL but never a secret; keep them short anyway.
    return { ok: false, reason: message.slice(0, 200) };
  }
}
