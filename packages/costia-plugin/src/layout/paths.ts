/** Validation of layout entry paths: relative, clean, inside the destination root. */
export function checkLayoutPath(path: string): string[] {
  if (!path || path.length > 255) throw new Error(`bad layout path ${JSON.stringify(path)}`);
  if (path.includes("\0") || path.includes("\\") || path.startsWith("/") || path.startsWith("~") || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`layout path must be relative: ${JSON.stringify(path)}`);
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") throw new Error(`bad segment in layout path ${JSON.stringify(path)}`);
    if (segment === ".git") throw new Error(`layout path cannot touch .git: ${JSON.stringify(path)}`);
    if (segment.startsWith("-")) throw new Error(`layout path segment cannot start with '-': ${JSON.stringify(path)}`);
  }
  return segments;
}

/** A remote in a comparable form: host and path, no scheme, user or `.git`. */
export function normalizeRemote(remote: string): string {
  let r = remote.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(r);
  if (scp) r = `${scp[1]}/${scp[2]}`;
  else r = r.replace(/^[a-z+]+:\/\//, "").replace(/^[^@/]+@/, "").replace(/:\d+\//, "/");
  return r.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
}
