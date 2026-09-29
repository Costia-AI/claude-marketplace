import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Keeps `private` destinations out of git: a managed block in the repository's
 * `info/exclude` (docs/plugin-protocol.md, "Excluded from git"). Lines outside
 * the block are never touched; nothing happens outside a repository.
 */

const BEGIN = "# costia:begin — managed by the costia plugin";
const END = "# costia:end";

/** The repository's top level and the directory holding its `info/exclude`, or null. */
export function gitPaths(from: string): { top: string; common: string } | null {
  let dir = realpathSync(from);
  for (;;) {
    const dotGit = join(dir, ".git");
    let stat;
    try {
      stat = lstatSync(dotGit);
    } catch {
      stat = null;
    }
    if (stat?.isDirectory()) return { top: dir, common: dotGit };
    if (stat?.isFile()) {
      // A worktree or a submodule: ".git" names the real git dir; a worktree shares info/ with its common dir.
      const pointer = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
      if (!pointer) return null;
      const gitDir = isAbsolute(pointer) ? pointer : resolve(dir, pointer);
      let common = gitDir;
      try {
        const commondir = readFileSync(join(gitDir, "commondir"), "utf8").trim();
        if (commondir) common = isAbsolute(commondir) ? commondir : resolve(gitDir, commondir);
      } catch {
        /* not a worktree */
      }
      return { top: dir, common };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function render(current: string, lines: string[]): string {
  const all = current.replace(/\r\n/g, "\n").split("\n");
  const begin = all.findIndex((l) => l === BEGIN);
  const end = begin === -1 ? -1 : all.findIndex((l, i) => i > begin && l === END);
  const outside = begin === -1 || end === -1 ? all : [...all.slice(0, begin), ...all.slice(end + 1)];
  while (outside.length && outside[outside.length - 1] === "") outside.pop();
  if (!lines.length) return outside.length ? `${outside.join("\n")}\n` : "";
  return `${[...outside, ...(outside.length ? [""] : []), BEGIN, ...lines, END].join("\n")}\n`;
}

/**
 * Makes the managed block list exactly `paths` (relative to `targetRoot`).
 * Returns the lines written, or null when `targetRoot` is not in a repository.
 */
export function updateGitExclude(targetRoot: string, paths: string[]): string[] | null {
  const git = gitPaths(targetRoot);
  if (!git) return null;
  const prefix = relative(git.top, realpathSync(targetRoot)).split(sep).join("/");
  const lines = [...new Set(paths)]
    .map((p) => `/${prefix ? `${prefix}/` : ""}${p}`)
    .map((p) => p.replace(/[*?[\]\\!#]/g, (c) => `\\${c}`))
    .sort();

  const info = join(git.common, "info");
  const file = join(info, "exclude");
  for (const path of [git.common, info]) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${path} is not a plain directory`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      mkdirSync(path, { mode: 0o755 });
    }
  }
  let current = "";
  try {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${file} is not a regular file`);
    current = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const next = render(current, lines);
  if (next === current) return lines;
  const temp = `${file}.costia-${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
  try {
    writeSync(fd, next);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    rmSync(temp, { force: true });
    throw error;
  }
  closeSync(fd);
  renameSync(temp, file);
  return lines;
}

/** The paths currently in the managed block, as written. */
export function excludedPaths(targetRoot: string): string[] {
  const git = gitPaths(targetRoot);
  if (!git) return [];
  let current = "";
  try {
    current = readFileSync(join(git.common, "info", "exclude"), "utf8");
  } catch {
    return [];
  }
  const all = current.split("\n");
  const begin = all.indexOf(BEGIN);
  const end = begin === -1 ? -1 : all.indexOf(END, begin);
  return begin === -1 || end === -1 ? [] : all.slice(begin + 1, end);
}
