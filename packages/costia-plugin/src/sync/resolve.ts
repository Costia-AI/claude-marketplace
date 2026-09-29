import { hashValue } from "./canonical.ts";
import { readEntry } from "./json-merge.ts";
import { readLock } from "./apply.ts";
import { rebaseSection, unwrapSection } from "./agents-md.ts";
import { SafeRoot } from "./safe-fs.ts";
import { LOCKFILE, type Manifest } from "./types.ts";

/**
 * Resolves a conflict or drift by moving the merge base, never by writing
 * upstream content directly — the next sync does that through the normal path:
 *
 *  - `take_remote`: the local version becomes the base, so the next sync
 *    replaces it with upstream;
 *  - `keep_local`: the path or entry is detached — this repository owns it and
 *    Costia stops managing it here.
 *
 * `item` is a name as reported by a sync: a file path, ".claude/settings.json <key>",
 * ".mcp.json <key>" or "AGENTS.md section <id>".
 */
export function resolveConflict(rootDir: string, manifest: Pick<Manifest, "project" | "target">, item: string, choice: "take_remote" | "keep_local"): string {
  const root = new SafeRoot(rootDir);
  const lock = readLock(root, manifest as Manifest);

  const section = /^AGENTS\.md section (.+)$/.exec(item);
  if (section) {
    const id = section[1]!;
    const text = root.read("AGENTS.md")?.toString("utf8");
    if (!text) throw new Error("AGENTS.md not found");
    if (choice === "take_remote") {
      root.write("AGENTS.md", rebaseSection(text, id));
      return `Section ${id} will be replaced by the shared version on the next sync.`;
    }
    root.write("AGENTS.md", unwrapSection(text, id));
    delete lock.agents.sections[id];
    root.write(LOCKFILE, `${JSON.stringify(lock, null, 2)}\n`);
    return `Section ${id} now belongs to this repository; remove it from the project's config on the web so it is not added back.`;
  }

  const entry = /^(\.claude\/settings\.json|\.mcp\.json) (.+)$/.exec(item);
  if (entry) {
    const [, file, key] = entry as unknown as [string, string, string];
    if (choice === "take_remote") {
      const raw = root.read(file);
      const value = raw ? readEntry(JSON.parse(raw.toString("utf8")), key) : undefined;
      const owned = file === ".mcp.json" ? lock.mcp.owned : lock.settings.owned;
      if (value === undefined) delete owned[key];
      else owned[key] = hashValue(value);
    } else {
      lock.detached = [...new Set([...(lock.detached ?? []), item])];
      delete (file === ".mcp.json" ? lock.mcp.owned : lock.settings.owned)[key];
    }
    root.write(LOCKFILE, `${JSON.stringify(lock, null, 2)}\n`);
    return choice === "take_remote" ? `${key} will take the shared value on the next sync.` : `${key} in ${file} now belongs to this repository.`;
  }

  const local = root.hash(item);
  if (choice === "take_remote") {
    if (local === null) delete lock.files[item];
    else lock.files[item] = { ...lock.files[item], sha256: local };
    lock.detached = (lock.detached ?? []).filter((p) => p !== item);
  } else {
    lock.detached = [...new Set([...(lock.detached ?? []), item])];
    delete lock.files[item];
  }
  root.write(LOCKFILE, `${JSON.stringify(lock, null, 2)}\n`);
  return choice === "take_remote" ? `${item} will be replaced by the shared version on the next sync.` : `${item} now belongs to this repository.`;
}
