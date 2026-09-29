import { existsSync } from "node:fs";
import { files } from "../state/paths.ts";
import { readJson, writeJson } from "../state/json-file.ts";
import { normalizeRemote } from "./paths.ts";

/** remote → local clones on this machine, to point symlinks at. Never leaves the machine. */
type Index = Record<string, string[]>;

export function rememberRepo(remote: string, path: string): void {
  const index = readJson<Index>(files.repos(), {});
  const key = normalizeRemote(remote);
  const paths = new Set(index[key] ?? []);
  paths.add(path);
  index[key] = [...paths];
  writeJson(files.repos(), index);
}

export function localCloneOf(remote: string): string | null {
  const index = readJson<Index>(files.repos(), {});
  return (index[normalizeRemote(remote)] ?? []).find((p) => existsSync(p)) ?? null;
}
