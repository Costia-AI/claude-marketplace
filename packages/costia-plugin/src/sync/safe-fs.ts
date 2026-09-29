import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { checkPath, PathRejected } from "./paths.ts";

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * The only way the plugin touches a repository. Every operation is relative to
 * a root that was resolved once with realpath, and every component under it is
 * lstat'ed: a symlink anywhere on the way — a symlinked `.claude`, a symlinked
 * skill folder — refuses the operation instead of being followed.
 */
export class SafeRoot {
  readonly root: string;

  constructor(root: string) {
    this.root = realpathSync(root);
    if (!lstatSync(this.root).isDirectory()) throw new Error(`${root} is not a directory`);
  }

  /** Walks the parents of `path`, optionally creating them, refusing symlinks and non-directories. */
  private walkParents(path: string, create: boolean): string | null {
    const segments = checkPath(path, { internal: true });
    let current = this.root;
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      let stat;
      try {
        stat = lstatSync(current);
      } catch {
        if (!create) return null;
        mkdirSync(current, { mode: 0o755 });
        stat = lstatSync(current);
      }
      if (stat.isSymbolicLink()) throw new PathRejected(path, `${segment} is a symlink`);
      if (!stat.isDirectory()) throw new PathRejected(path, `${segment} is not a directory`);
    }
    return join(current, segments[segments.length - 1]!);
  }

  /** The file's content, or null when it does not exist. Refuses symlinks. */
  read(path: string): Buffer | null {
    const full = this.walkParents(path, false);
    if (!full) return null;
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      return null;
    }
    if (stat.isSymbolicLink()) throw new PathRejected(path, "is a symlink");
    if (!stat.isFile()) throw new PathRejected(path, "is not a regular file");
    const fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      return readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  hash(path: string): string | null {
    const content = this.read(path);
    return content === null ? null : sha256(content);
  }

  /** Writes through a fresh temporary file in the same directory, then renames it over the target. */
  write(path: string, content: Buffer | string, mode: 0o644 | 0o755 = 0o644): void {
    const full = this.walkParents(path, true)!;
    try {
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new PathRejected(path, "is a symlink");
      if (!stat.isFile()) throw new PathRejected(path, "is not a regular file");
    } catch (error) {
      if (error instanceof PathRejected) throw error;
    }
    const temp = `${full}.costia-${randomBytes(6).toString("hex")}.tmp`;
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode);
    try {
      const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
      writeSync(fd, data);
      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      rmSync(temp, { force: true });
      throw error;
    }
    closeSync(fd);
    renameSync(temp, full);
  }

  remove(path: string): void {
    const full = this.walkParents(path, false);
    if (!full) return;
    try {
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new PathRejected(path, "is a symlink");
      if (!stat.isFile()) throw new PathRejected(path, "is not a regular file");
    } catch (error) {
      if (error instanceof PathRejected) throw error;
      return;
    }
    rmSync(full);
  }
}
