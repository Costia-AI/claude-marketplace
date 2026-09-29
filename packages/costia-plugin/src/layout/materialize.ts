import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { git, originOf } from "./git.ts";
import { checkLayoutPath, normalizeRemote } from "./paths.ts";
import { localCloneOf, rememberRepo } from "./repos.ts";
import type { LayoutSpec } from "./spec.ts";

/**
 * Turns a layout spec into folders, clones and symlinks under `destination`.
 * Local only and always user-initiated: `planLayout` is shown to the user
 * before `materializeLayout` runs. Existing clones of the right remote are
 * reused; anything else already in the way stops the step instead of being
 * overwritten.
 */

export type Step =
  | { kind: "clone"; path: string; remote: string; ref?: string; sparse?: string[]; into: string }
  | { kind: "reuse"; path: string; remote: string; into: string }
  | { kind: "mkdir"; path: string; into: string }
  | { kind: "symlink"; path: string; at: string; target: string; style: "relative" | "absolute" }
  | { kind: "clone-for-symlink"; path: string; remote: string; into: string; at: string; style: "relative" | "absolute" }
  | { kind: "unresolved"; path: string; remote: string; reason: string }
  | { kind: "blocked"; path: string; reason: string };

function isEmptyDir(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    return true;
  }
}

function sameRemote(dir: string, remote: string): boolean {
  const origin = originOf(dir);
  return origin !== null && normalizeRemote(origin) === normalizeRemote(remote);
}

function repoNameOf(remote: string): string {
  return basename(normalizeRemote(remote)) || "repository";
}

export function planLayout(spec: LayoutSpec, destination: string): Step[] {
  const dest = resolve(destination);
  const steps: Step[] = [];

  if (spec.root.kind === "git") {
    if (existsSync(dest) && !isEmptyDir(dest)) {
      if (sameRemote(dest, spec.root.remote)) steps.push({ kind: "reuse", path: ".", remote: spec.root.remote, into: dest });
      else steps.push({ kind: "blocked", path: ".", reason: `${dest} is not empty and is not a clone of ${spec.root.remote}` });
    } else {
      steps.push({ kind: "clone", path: ".", remote: spec.root.remote, ref: spec.root.ref, into: dest });
    }
  } else if (!existsSync(dest)) {
    steps.push({ kind: "mkdir", path: ".", into: dest });
  }

  const ordered = [...spec.entries].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  for (const entry of ordered) {
    checkLayoutPath(entry.path);
    const at = join(dest, ...entry.path.split("/"));
    const exists = existsSync(at) || (() => { try { lstatSync(at); return true; } catch { return false; } })();

    if (entry.kind === "dir") {
      if (!exists) steps.push({ kind: "mkdir", path: entry.path, into: at });
      continue;
    }
    if (entry.kind === "git") {
      if (!exists || isEmptyDir(at)) steps.push({ kind: "clone", path: entry.path, remote: entry.remote, ref: entry.ref, sparse: entry.sparse, into: at });
      else if (sameRemote(at, entry.remote)) steps.push({ kind: "reuse", path: entry.path, remote: entry.remote, into: at });
      else steps.push({ kind: "blocked", path: entry.path, reason: `${at} already exists and is not a clone of ${entry.remote}` });
      continue;
    }
    // symlink
    if (exists) {
      const stat = lstatSync(at);
      if (stat.isSymbolicLink() && sameRemote(realpathSync(at), entry.target.remote)) continue;
      steps.push({ kind: "blocked", path: entry.path, reason: `${at} already exists` });
      continue;
    }
    const local = localCloneOf(entry.target.remote);
    if (local) {
      steps.push({ kind: "symlink", path: entry.path, at, target: local, style: entry.style });
    } else if (entry.fallback === "clone") {
      const into = join(dirname(dest), repoNameOf(entry.target.remote));
      if (existsSync(into) && !sameRemote(into, entry.target.remote)) {
        steps.push({ kind: "unresolved", path: entry.path, remote: entry.target.remote, reason: `${into} exists and is something else` });
      } else {
        steps.push({ kind: "clone-for-symlink", path: entry.path, remote: entry.target.remote, into, at, style: entry.style });
      }
    } else {
      steps.push({
        kind: "unresolved",
        path: entry.path,
        remote: entry.target.remote,
        reason: entry.fallback === "skip" ? "no local clone; skipped by the layout" : "no local clone known on this machine — give its path or let it be cloned",
      });
    }
  }
  return steps;
}

export function describePlan(steps: Step[]): string {
  return steps
    .map((s) => {
      switch (s.kind) {
        case "clone": return `clone   ${s.path}  ←  ${s.remote}${s.ref ? ` @ ${s.ref}` : ""}${s.sparse ? ` (sparse: ${s.sparse.join(", ")})` : ""}`;
        case "reuse": return `reuse   ${s.path}  (already a clone of ${s.remote})`;
        case "mkdir": return `folder  ${s.path}`;
        case "symlink": return `link    ${s.path}  →  ${s.target} (${s.style})`;
        case "clone-for-symlink": return `clone   ${s.into}  ←  ${s.remote}, then link ${s.path} to it (${s.style})`;
        case "unresolved": return `?       ${s.path}  →  ${s.remote}: ${s.reason}`;
        case "blocked": return `BLOCKED ${s.path}: ${s.reason}`;
      }
    })
    .join("\n");
}

function assertInside(dest: string, at: string): void {
  const rel = relative(dest, at);
  if (rel.startsWith("..") || resolve(dest, rel) !== at) throw new Error(`${at} is outside ${dest}`);
  // No parent between dest and `at` may be a symlink.
  let current = dest;
  for (const segment of rel.split(/[\\/]/).slice(0, -1)) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`${current} is a symlink`);
  }
}

function link(dest: string, at: string, target: string, style: "relative" | "absolute"): void {
  assertInside(dest, at);
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(style === "relative" ? relative(dirname(at), target) : target, at, "dir");
}

function clone(remote: string, into: string, ref?: string, sparse?: string[]): void {
  mkdirSync(dirname(into), { recursive: true });
  const args = ["clone", "--no-recurse-submodules"];
  if (ref) args.push("--branch", ref);
  if (sparse?.length) args.push("--filter=blob:none", "--sparse");
  git([...args, "--", remote, into]);
  if (sparse?.length) git(["sparse-checkout", "set", "--", ...sparse], { cwd: into });
  rememberRepo(remote, into);
}

export interface MaterializeResult {
  done: string[];
  skipped: string[];
  failed: { path: string; error: string }[];
}

/** Runs the steps. Blocked and unresolved steps are reported, never forced. */
export function materializeLayout(steps: Step[], destination: string): MaterializeResult {
  const dest = resolve(destination);
  const result: MaterializeResult = { done: [], skipped: [], failed: [] };
  if (steps.some((s) => s.kind === "blocked" && s.path === ".")) {
    result.failed.push({ path: ".", error: (steps.find((s) => s.path === ".") as { reason: string }).reason });
    return result;
  }
  for (const step of steps) {
    try {
      switch (step.kind) {
        case "clone":
          if (step.path !== ".") assertInside(dest, step.into);
          clone(step.remote, step.into, step.ref, step.sparse);
          break;
        case "reuse":
          rememberRepo(step.remote, step.into);
          break;
        case "mkdir":
          if (step.path !== ".") assertInside(dest, step.into);
          mkdirSync(step.into, { recursive: true });
          break;
        case "symlink":
          link(dest, step.at, step.target, step.style);
          break;
        case "clone-for-symlink":
          if (!existsSync(step.into)) clone(step.remote, step.into);
          link(dest, step.at, step.into, step.style);
          break;
        case "unresolved":
        case "blocked":
          result.skipped.push(`${step.path}: ${step.reason}`);
          continue;
      }
      result.done.push(step.path);
    } catch (error) {
      result.failed.push({ path: step.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
