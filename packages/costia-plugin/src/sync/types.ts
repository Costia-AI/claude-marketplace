import type { DesiredSection } from "./agents-md.ts";

/** What the backend says a target should contain (docs/plugin-protocol.md). */
export interface Manifest {
  revision: string;
  project: string;
  target: string;
  frozen?: boolean;
  files: ManifestFile[];
  settings?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  agents?: { sections: DesiredSection[] };
}

export interface ManifestFile {
  path: string;
  sha256: string;
  size: number;
  mode?: "0644" | "0755";
  item?: string;
  version?: number;
  /** A hint for display only; sensitivity is recomputed locally. */
  sensitive?: boolean;
}

/** `.claude/costia.lock.json`: the merge base, committed with the repository. */
export interface Lockfile {
  schema: 1;
  project: string;
  target: string;
  revision: string;
  files: Record<string, { sha256: string; item?: string; version?: number }>;
  settings: { owned: Record<string, string> };
  mcp: { owned: Record<string, string> };
  agents: { sections: Record<string, { version: number; sha256: string }> };
  /** Paths and entry keys this repository took over: never written again. */
  detached?: string[];
}

export function emptyLock(project: string, target: string): Lockfile {
  return { schema: 1, project, target, revision: "", files: {}, settings: { owned: {} }, mcp: { owned: {} }, agents: { sections: {} } };
}

export const LOCKFILE = ".claude/costia.lock.json";
