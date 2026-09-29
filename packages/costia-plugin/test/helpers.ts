import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/sync/safe-fs.ts";

export function tempDir(prefix = "costia-test-"): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

export function blobStore(contents: string[]) {
  const map = new Map(contents.map((c) => [sha256(c), Buffer.from(c)]));
  return {
    hash: (c: string) => sha256(c),
    source: async (hashes: string[]) => new Map(hashes.filter((h) => map.has(h)).map((h) => [h, map.get(h)!])),
  };
}
