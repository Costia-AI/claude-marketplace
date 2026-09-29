import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { files as stateFiles } from "../state/paths.ts";
import { mergeAgents, type AgentsResult } from "./agents-md.ts";
import { approvalHash, flatten, mergeOwnedEntries, type JsonMergeResult, type PendingEntry } from "./json-merge.ts";
import { checkNoCaseCollisions, checkPath, PathRejected, STRUCTURED } from "./paths.ts";
import { SafeRoot, sha256 } from "./safe-fs.ts";
import { fileSensitivity, mcpServerSensitivity, settingsEntrySensitivity } from "./sensitivity.ts";
import { emptyLock, LOCKFILE, type Lockfile, type Manifest, type ManifestFile } from "./types.ts";

/**
 * The single write path from a manifest to a repository. Everything the web or
 * a teammate changes reaches a disk through `syncTarget`, under the rules of
 * docs/security-model.md:
 *
 *  - only AGENTS.md, CLAUDE.md, .mcp.json and .claude/** — checked per path;
 *  - no symlink is ever followed (SafeRoot);
 *  - content only by hash, re-hashed after download;
 *  - three-way merge against the lockfile, so hand edits are never lost;
 *  - sensitive content only when this user approved that exact hash.
 */

export type BlobSource = (hashes: string[]) => Promise<Map<string, Buffer>>;

export interface SyncOptions {
  root: string;
  manifest: Manifest;
  blobs: BlobSource;
  approved: Set<string>;
  /** Compute and report, write nothing. */
  dryRun?: boolean;
  now?: Date;
}

export interface PendingApproval {
  approval: string;
  kind: "file" | "settings" | "mcp";
  key: string;
  reason: string;
  /** The content to show the user before approving. */
  preview: string;
}

export interface SyncReport {
  root: string;
  revision: string;
  changed: boolean;
  written: string[];
  removed: string[];
  drift: string[];
  conflicts: string[];
  detached: string[];
  pending: PendingApproval[];
  sections: { updated: string[]; added: string[]; removed: string[] };
  backup?: string;
  errors: string[];
}

type FileAction =
  | { kind: "write"; file: ManifestFile }
  | { kind: "lock"; file: ManifestFile }
  | { kind: "keep"; file: ManifestFile }
  | { kind: "delete"; path: string }
  | { kind: "drift"; path: string; file?: ManifestFile }
  | { kind: "conflict"; path: string; file?: ManifestFile }
  | { kind: "detached"; path: string };

function readLock(root: SafeRoot, manifest: Manifest): Lockfile {
  const raw = root.read(LOCKFILE);
  if (!raw) return emptyLock(manifest.project, manifest.target);
  try {
    const lock = JSON.parse(raw.toString("utf8")) as Lockfile;
    if (lock.schema !== 1 || lock.project !== manifest.project || lock.target !== manifest.target) {
      return emptyLock(manifest.project, manifest.target);
    }
    return { ...emptyLock(manifest.project, manifest.target), ...lock };
  } catch {
    return emptyLock(manifest.project, manifest.target);
  }
}

function planFiles(root: SafeRoot, manifest: Manifest, lock: Lockfile): FileAction[] {
  const actions: FileAction[] = [];
  const detached = new Set(lock.detached ?? []);
  const wanted = new Map(manifest.files.filter((f) => !detached.has(f.path)).map((f) => [f.path, f]));
  const paths = new Set([...wanted.keys(), ...Object.keys(lock.files)]);
  for (const path of [...paths].sort()) {
    const file = wanted.get(path);
    const base = lock.files[path]?.sha256;
    const local = root.hash(path) ?? undefined;
    if (!file) {
      if (local === undefined) continue;
      if (local === base) actions.push({ kind: "delete", path });
      else actions.push({ kind: "detached", path });
      continue;
    }
    if (base === undefined) {
      if (local === undefined) actions.push({ kind: "write", file });
      else if (local === file.sha256) actions.push({ kind: "lock", file });
      else actions.push({ kind: "conflict", path, file });
      continue;
    }
    if (local === undefined) actions.push({ kind: "detached", path });
    else if (local === file.sha256) actions.push({ kind: local === base ? "keep" : "lock", file });
    else if (local !== base) actions.push(file.sha256 === base ? { kind: "drift", path, file } : { kind: "conflict", path, file });
    else actions.push({ kind: "write", file });
  }
  return actions;
}

function validateManifest(manifest: Manifest): void {
  for (const file of manifest.files) {
    checkPath(file.path);
    if (STRUCTURED.has(file.path)) throw new PathRejected(file.path, "managed through settings, mcpServers or agents, not as a file");
    if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new PathRejected(file.path, "bad hash");
    if (file.size > 1024 * 1024) throw new PathRejected(file.path, "larger than 1 MB");
    if (file.mode && file.mode !== "0644" && file.mode !== "0755") throw new PathRejected(file.path, "bad mode");
  }
  checkNoCaseCollisions(manifest.files.map((f) => f.path));
}

function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n… (${text.length - 4000} more characters)` : text;
}

function parseJsonFile(root: SafeRoot, path: string): { doc: Record<string, unknown>; ok: boolean } {
  const raw = root.read(path);
  if (!raw) return { doc: {}, ok: true };
  try {
    const doc = JSON.parse(raw.toString("utf8"));
    return doc && typeof doc === "object" && !Array.isArray(doc) ? { doc, ok: true } : { doc: {}, ok: false };
  } catch {
    return { doc: {}, ok: false };
  }
}

export { readLock };

export async function syncTarget(options: SyncOptions): Promise<SyncReport> {
  const { manifest } = options;
  validateManifest(manifest);
  const root = new SafeRoot(options.root);
  const lock = readLock(root, manifest);
  const report: SyncReport = {
    root: root.root,
    revision: manifest.revision,
    changed: false,
    written: [],
    removed: [],
    drift: [],
    conflicts: [],
    detached: [],
    pending: [],
    sections: { updated: [], added: [], removed: [] },
    errors: [],
  };

  // 1. Plain files.
  const actions = planFiles(root, manifest, lock);
  const needed = actions.flatMap((a) => (a.kind === "write" || a.kind === "conflict") && "file" in a && a.file ? [a.file.sha256] : []);
  const blobs = needed.length ? await options.blobs([...new Set(needed)]) : new Map<string, Buffer>();
  for (const [hash, content] of blobs) {
    if (sha256(content) !== hash) throw new Error(`blob ${hash} does not match its hash`);
  }

  const nextFiles: Lockfile["files"] = {};
  const writes: { path: string; content: Buffer; mode: 0o644 | 0o755 }[] = [];
  const deletes: string[] = [];
  const conflictCopies: { path: string; content: Buffer }[] = [];

  for (const action of actions) {
    switch (action.kind) {
      case "write": {
        const content = blobs.get(action.file.sha256);
        if (!content) {
          report.errors.push(`${action.file.path}: blob missing`);
          if (lock.files[action.file.path]) nextFiles[action.file.path] = lock.files[action.file.path]!;
          break;
        }
        const mode = action.file.mode === "0755" ? 0o755 : 0o644;
        const reason = fileSensitivity(action.file.path, content, mode);
        const approval = approvalHash("file", action.file.path, `${action.file.sha256}:${action.file.mode ?? "0644"}`);
        if (reason && !options.approved.has(approval)) {
          report.pending.push({ approval, kind: "file", key: action.file.path, reason, preview: preview(content.toString("utf8")) });
          if (lock.files[action.file.path]) nextFiles[action.file.path] = lock.files[action.file.path]!;
          break;
        }
        writes.push({ path: action.file.path, content, mode });
        nextFiles[action.file.path] = { sha256: action.file.sha256, item: action.file.item, version: action.file.version };
        break;
      }
      case "lock":
      case "keep":
        nextFiles[action.file.path] = { sha256: action.file.sha256, item: action.file.item, version: action.file.version };
        break;
      case "delete":
        deletes.push(action.path);
        break;
      case "drift":
        report.drift.push(action.path);
        nextFiles[action.path] = lock.files[action.path]!;
        break;
      case "conflict": {
        report.conflicts.push(action.path);
        const incoming = action.file && blobs.get(action.file.sha256);
        if (incoming) conflictCopies.push({ path: action.path, content: incoming });
        if (lock.files[action.path]) nextFiles[action.path] = lock.files[action.path]!;
        break;
      }
      case "detached":
        report.detached.push(action.path);
        break;
    }
  }

  // 2. Owned entries of .claude/settings.json and .mcp.json.
  const jsonTargets: { path: string; scope: "settings" | "mcp"; desired: Map<string, unknown>; owned: Record<string, string> }[] = [
    {
      path: ".claude/settings.json",
      scope: "settings",
      desired: flatten(manifest.settings ?? {}),
      owned: lock.settings.owned,
    },
    {
      path: ".mcp.json",
      scope: "mcp",
      desired: flatten(manifest.mcpServers ? { mcpServers: manifest.mcpServers } : {}),
      owned: lock.mcp.owned,
    },
  ];
  const jsonResults = new Map<string, JsonMergeResult>();
  const detachedKeys = new Set(lock.detached ?? []);
  for (const target of jsonTargets) {
    for (const key of [...target.desired.keys()]) if (detachedKeys.has(`${target.path} ${key}`)) target.desired.delete(key);
    if (!target.desired.size && !Object.keys(target.owned).length) continue;
    const { doc, ok } = parseJsonFile(root, target.path);
    if (!ok) {
      report.conflicts.push(`${target.path} (not valid JSON)`);
      continue;
    }
    const merged = mergeOwnedEntries({
      scope: target.scope,
      current: doc,
      desired: target.desired,
      owned: target.owned,
      sensitivity: (key, value) =>
        target.scope === "mcp" ? mcpServerSensitivity(value) ?? "project MCP server" : settingsEntrySensitivity(key),
      approved: options.approved,
    });
    jsonResults.set(target.path, merged);
    const name = (key: string) => `${target.path} ${key}`;
    report.drift.push(...merged.drift.map(name));
    report.conflicts.push(...merged.conflicts.map(name));
    report.detached.push(...merged.detached.map(name));
    report.pending.push(
      ...merged.pending.map((p: PendingEntry) => ({ approval: p.approval, kind: target.scope, key: p.key, reason: p.reason, preview: preview(p.value) })),
    );
    if (merged.changed) writes.push({ path: target.path, content: Buffer.from(`${JSON.stringify(merged.doc, null, 2)}\n`), mode: 0o644 });
  }

  // 3. AGENTS.md and CLAUDE.md.
  let agents: AgentsResult | undefined;
  const sections = manifest.agents?.sections ?? [];
  const current = root.read("AGENTS.md")?.toString("utf8") ?? null;
  if (sections.length || Object.keys(lock.agents.sections).length || current?.includes("costia:begin")) {
    agents = mergeAgents(current, sections);
    report.sections = { updated: agents.updated, added: agents.added, removed: agents.removed };
    report.drift.push(...agents.drift.map((id) => `AGENTS.md section ${id}`));
    report.conflicts.push(...agents.conflicts.map((id) => `AGENTS.md section ${id}`));
    report.detached.push(...agents.detached.map((id) => `AGENTS.md section ${id}`));
    if (agents.changed && agents.text !== null) writes.push({ path: "AGENTS.md", content: Buffer.from(agents.text), mode: 0o644 });
    if (sections.length && root.read("CLAUDE.md") === null) {
      writes.push({ path: "CLAUDE.md", content: Buffer.from("@AGENTS.md\n"), mode: 0o644 });
    }
  }

  // 4. The new lockfile.
  const nextLock: Lockfile = {
    schema: 1,
    project: manifest.project,
    target: manifest.target,
    revision: manifest.revision,
    files: nextFiles,
    settings: { owned: jsonResults.get(".claude/settings.json")?.owned ?? lock.settings.owned },
    mcp: { owned: jsonResults.get(".mcp.json")?.owned ?? lock.mcp.owned },
    agents: { sections: agents?.applied ?? lock.agents.sections },
    ...(lock.detached?.length ? { detached: lock.detached } : {}),
  };
  const lockText = `${JSON.stringify(nextLock, null, 2)}\n`;
  const lockChanged = root.read(LOCKFILE)?.toString("utf8") !== lockText;

  report.written = writes.map((w) => w.path);
  report.removed = deletes;
  report.changed = writes.length > 0 || deletes.length > 0 || lockChanged;
  if (options.dryRun || !report.changed) return report;

  // 5. Back up, write, record.
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDir = join(stateFiles.backups(), stamp);
  const index: { root: string; files: { path: string; existed: boolean }[] } = { root: root.root, files: [] };
  for (const path of [...writes.map((w) => w.path), ...deletes, LOCKFILE]) {
    const before = root.read(path);
    index.files.push({ path, existed: before !== null });
    if (before !== null) {
      mkdirSync(dirname(join(backupDir, "files", path)), { recursive: true, mode: 0o700 });
      writeFileSync(join(backupDir, "files", path), before, { mode: 0o600 });
    }
  }
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(backupDir, "index.json"), JSON.stringify(index, null, 2), { mode: 0o600 });
  report.backup = backupDir;

  for (const write of writes) root.write(write.path, write.content, write.mode);
  for (const path of deletes) root.remove(path);
  root.write(LOCKFILE, lockText);

  for (const copy of conflictCopies) {
    const destination = join(stateFiles.conflicts(), manifest.project, manifest.target.replace(/[^\w.-]/g, "_"), copy.path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, copy.content, { mode: 0o600 });
  }
  return report;
}

/** Restores the files a sync overwrote or created, from its backup. */
export function undoSync(backupDir: string, readIndex: (path: string) => string, readBackup: (path: string) => Buffer): string[] {
  const index = JSON.parse(readIndex(join(backupDir, "index.json"))) as { root: string; files: { path: string; existed: boolean }[] };
  const root = new SafeRoot(index.root);
  const restored: string[] = [];
  for (const file of index.files) {
    if (file.existed) root.write(file.path, readBackup(join(backupDir, "files", file.path)));
    else root.remove(file.path);
    restored.push(file.path);
  }
  return restored;
}
