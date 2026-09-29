/**
 * Which relative paths the plugin may ever write inside a target, and the checks
 * a manifest path must pass before it is even considered. See
 * docs/security-model.md in the parent repository.
 */

/** Files handled by a structured merge, never replaced wholesale. */
export const STRUCTURED = new Set([".claude/settings.json", ".mcp.json", "AGENTS.md", "CLAUDE.md"]);

/** Never written from a manifest. */
const DENIED = new Set([".claude/settings.local.json", ".claude/costia.lock.json"]);

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export class PathRejected extends Error {
  constructor(readonly path: string, reason: string) {
    super(`refused path ${JSON.stringify(path)}: ${reason}`);
  }
}

/** Throws unless `path` is a clean, relative, allowed path. Returns its segments. */
export function checkPath(path: string, options: { internal?: boolean } = {}): string[] {
  if (typeof path !== "string" || path.length === 0) throw new PathRejected(String(path), "empty");
  if (path.length > 512) throw new PathRejected(path, "too long");
  if (path.includes("\0")) throw new PathRejected(path, "NUL byte");
  if (path.includes("\\")) throw new PathRejected(path, "backslash");
  if (path.startsWith("/") || path.startsWith("~") || /^[a-zA-Z]:/.test(path)) throw new PathRejected(path, "not relative");
  if (path.normalize("NFC") !== path) throw new PathRejected(path, "not NFC");
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f<>:"|?*]/.test(path)) throw new PathRejected(path, "forbidden character");

  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") throw new PathRejected(path, "empty, '.' or '..' segment");
    if (WINDOWS_RESERVED.test(segment)) throw new PathRejected(path, "reserved name");
    if (segment.endsWith(".") || segment.endsWith(" ")) throw new PathRejected(path, "trailing dot or space");
  }

  if (DENIED.has(path) && !(options.internal && path === ".claude/costia.lock.json")) throw new PathRejected(path, "never written by a manifest");
  const allowed = path === "AGENTS.md" || path === "CLAUDE.md" || path === ".mcp.json" || (segments[0] === ".claude" && segments.length > 1);
  if (!allowed) throw new PathRejected(path, "outside AGENTS.md, CLAUDE.md, .mcp.json and .claude/");
  return segments;
}

/** Rejects two manifest paths that would land on the same file on a case-insensitive disk. */
export function checkNoCaseCollisions(paths: string[]): void {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const folded = path.toLowerCase();
    const other = seen.get(folded);
    if (other !== undefined && other !== path) throw new PathRejected(path, `collides with ${other} on a case-insensitive disk`);
    seen.set(folded, path);
  }
}
