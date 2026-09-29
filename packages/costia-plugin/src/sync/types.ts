import type { DesiredSection } from "./agents-md.ts";
import type { SetupData } from "../setup/resolver.ts";

/** Where a selection lands (docs/plugin-protocol.md, "Destinations"). */
export type Destination = "repo" | "private";

/** What the backend says a target should contain (docs/plugin-protocol.md). */
export interface Manifest extends SetupData {
  revision: string;
  project: string;
  target: string;
  frozen?: boolean;
  files: ManifestFile[];
  settings?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  agents?: { sections: ManifestSection[] };
}

export interface ManifestSection extends DesiredSection {
  item?: string;
  destination?: Destination;
}

/** `GET /v1/me/manifest`: the user destination, paths relative to ~/.claude. */
export interface UserManifest extends SetupData {
  revision: string;
  files: ManifestFile[];
  agents?: { sections: ManifestSection[] };
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
  destination?: Destination;
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
/** The merge base of `private` entries; excluded from git like the entries themselves. */
export const LOCKFILE_LOCAL = ".claude/costia.lock.local.json";
export const PARAMS_FILE = ".claude/costia/params.env";
export const PARAMS_FILE_LOCAL = ".claude/costia/params.local.env";

/** The managed rules file a private or user section becomes. */
export function rulesFileName(sectionId: string): string {
  return `costia--${sectionId.replace(/\//g, "--")}.md`;
}
