import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { branchOf, originOf } from "./git.ts";
import { rememberRepo } from "./repos.ts";
import type { LayoutEntry, LayoutSpec } from "./spec.ts";

const SKIP = new Set(["node_modules", ".git", ".idea", ".vscode", "build", "dist", "target", ".gradle", ".next", "vendor", "Pods"]);

function isRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

function hasClaudeFiles(dir: string): boolean {
  return ["AGENTS.md", "CLAUDE.md", ".claude"].some((name) => existsSync(join(dir, name)));
}

/**
 * Proposes a layout spec for a folder as it is on disk: its own repository,
 * child repositories up to two levels down, and symlinks to other repositories.
 * The user reviews it before it is saved. Every repository found is remembered
 * in the machine's repo index, so symlinks can be recreated elsewhere.
 */
export function captureLayout(rootDir: string): { spec: LayoutSpec; notes: string[] } {
  const root = realpathSync(rootDir);
  const notes: string[] = [];
  const entries: LayoutEntry[] = [];
  const claudeRoots = ["."];

  const rootRemote = isRepo(root) ? originOf(root) : null;
  if (rootRemote) rememberRepo(rootRemote, root);
  else if (isRepo(root)) notes.push("The folder is a git repository without an 'origin' remote; recorded as a plain folder.");

  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      if (SKIP.has(name) || (name.startsWith(".") && name !== ".claude")) continue;
      if (name === ".claude") continue;
      const full = join(dir, name);
      const path = relative(root, full).split("\\").join("/");
      let stat;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        let target: string;
        try {
          target = realpathSync(full);
        } catch {
          notes.push(`${path}: broken symlink, skipped.`);
          continue;
        }
        const remote = isRepo(target) ? originOf(target) : null;
        if (!remote) {
          notes.push(`${path}: symlink to ${target}, which is not a git repository with an origin; skipped.`);
          continue;
        }
        rememberRepo(remote, target);
        const style = isAbsolute(readlinkSync(full)) ? "absolute" : "relative";
        entries.push({ path, kind: "symlink", target: { remote }, style, fallback: "ask" });
        continue;
      }
      if (!stat.isDirectory()) continue;
      if (isRepo(full)) {
        const remote = originOf(full);
        if (!remote) {
          notes.push(`${path}: repository without an origin remote; skipped.`);
          continue;
        }
        rememberRepo(remote, full);
        const ref = branchOf(full);
        entries.push({ path, kind: "git", remote, ...(ref ? { ref } : {}) });
        if (hasClaudeFiles(full)) claudeRoots.push(path);
        continue;
      }
      if (depth < 2 && !rootRemote) walk(full, depth + 1);
    }
  };
  walk(root, 1);

  const ref = rootRemote ? branchOf(root) : null;
  const spec: LayoutSpec = {
    schema: 1,
    root: rootRemote ? { kind: "git", remote: rootRemote, ...(ref ? { ref } : {}) } : { kind: "dir" },
    entries,
    claudeRoots,
  };
  if (rootRemote && entries.some((e) => e.kind === "git")) {
    notes.push("Child repositories inside the root repository should be ignored by its .gitignore.");
  }
  return { spec, notes };
}
