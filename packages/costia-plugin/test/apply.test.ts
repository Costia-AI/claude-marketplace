import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncTarget } from "../src/sync/apply.ts";
import { sectionHash } from "../src/sync/agents-md.ts";
import { approvalHash } from "../src/sync/json-merge.ts";
import type { Manifest } from "../src/sync/types.ts";
import { blobStore, tempDir } from "./helpers.ts";

let repo: ReturnType<typeof tempDir>;
let state: ReturnType<typeof tempDir>;
beforeEach(() => {
  repo = tempDir();
  state = tempDir();
  process.env.COSTIA_STATE_DIR = state.path;
});
afterEach(() => {
  repo.cleanup();
  state.cleanup();
});

const skillV1 = "---\nname: migrations\ndescription: x\n---\nWrite Flyway migrations.\n";
const skillV2 = "---\nname: migrations\ndescription: x\n---\nWrite Flyway migrations. Never edit one.\n";
const script = "#!/bin/sh\necho hi\n";
const store = blobStore([skillV1, skillV2, script]);
const sectionContent = "## Git\n\nEnglish commits.";

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    revision: "r1",
    project: "p1",
    target: ".",
    files: [{ path: ".claude/skills/migrations/SKILL.md", sha256: store.hash(skillV1), size: skillV1.length }],
    settings: { permissions: { deny: ["Read(.env)"] } },
    agents: { sections: [{ id: "costia-ai/git", title: "Git", version: 1, sha256: sectionHash(sectionContent), content: sectionContent }] },
    ...overrides,
  };
}

const read = (path: string) => readFileSync(join(repo.path, path), "utf8");

describe("syncTarget", () => {
  test("first sync writes files, settings, AGENTS.md, CLAUDE.md and the lockfile", async () => {
    const report = await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() });
    expect(report.errors).toEqual([]);
    expect(read(".claude/skills/migrations/SKILL.md")).toBe(skillV1);
    expect(JSON.parse(read(".claude/settings.json"))).toEqual({ permissions: { deny: ["Read(.env)"] } });
    expect(read("AGENTS.md")).toContain("English commits.");
    expect(read("CLAUDE.md")).toBe("@AGENTS.md\n");
    const lock = JSON.parse(read(".claude/costia.lock.json"));
    expect(lock.revision).toBe("r1");
    expect(lock.files[".claude/skills/migrations/SKILL.md"].sha256).toBe(store.hash(skillV1));
  });

  test("second sync with the same manifest changes nothing", async () => {
    await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() });
    const report = await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() });
    expect(report.changed).toBe(false);
  });

  test("updates unedited files and keeps edited ones", async () => {
    await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() });
    const v2 = manifest({ revision: "r2", files: [{ path: ".claude/skills/migrations/SKILL.md", sha256: store.hash(skillV2), size: 1 }] });
    await syncTarget({ root: repo.path, manifest: v2, blobs: store.source, approved: new Set() });
    expect(read(".claude/skills/migrations/SKILL.md")).toBe(skillV2);

    writeFileSync(join(repo.path, ".claude/skills/migrations/SKILL.md"), "my own version");
    const report = await syncTarget({ root: repo.path, manifest: manifest({ revision: "r3" }), blobs: store.source, approved: new Set() });
    expect(report.conflicts).toEqual([".claude/skills/migrations/SKILL.md"]);
    expect(read(".claude/skills/migrations/SKILL.md")).toBe("my own version");
    expect(existsSync(join(state.path, "conflicts/p1/./.claude/skills/migrations/SKILL.md"))).toBe(true);
  });

  test("an untracked local file is not overwritten", async () => {
    mkdirSync(join(repo.path, ".claude/skills/migrations"), { recursive: true });
    writeFileSync(join(repo.path, ".claude/skills/migrations/SKILL.md"), "already here");
    const report = await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() });
    expect(report.conflicts).toContain(".claude/skills/migrations/SKILL.md");
    expect(read(".claude/skills/migrations/SKILL.md")).toBe("already here");
  });

  test("removes files dropped from the manifest, unless edited", async () => {
    await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() });
    await syncTarget({ root: repo.path, manifest: manifest({ revision: "r2", files: [] }), blobs: store.source, approved: new Set() });
    expect(existsSync(join(repo.path, ".claude/skills/migrations/SKILL.md"))).toBe(false);
  });

  test("a script waits for approval, then applies", async () => {
    const file = { path: ".claude/hooks/check.sh", sha256: store.hash(script), size: script.length, mode: "0755" as const };
    const m = manifest({ files: [file] });
    const report = await syncTarget({ root: repo.path, manifest: m, blobs: store.source, approved: new Set() });
    expect(report.pending.map((p) => p.key)).toEqual([".claude/hooks/check.sh"]);
    expect(existsSync(join(repo.path, ".claude/hooks/check.sh"))).toBe(false);

    const approval = approvalHash("file", file.path, `${file.sha256}:0755`);
    const approved = await syncTarget({ root: repo.path, manifest: m, blobs: store.source, approved: new Set([approval]) });
    expect(approved.pending).toEqual([]);
    expect(read(".claude/hooks/check.sh")).toBe(script);
  });

  test("a sensitive stdio MCP server waits for approval", async () => {
    const m = manifest({ mcpServers: { local: { command: "node", args: ["x.js"] } } });
    const report = await syncTarget({ root: repo.path, manifest: m, blobs: store.source, approved: new Set() });
    expect(report.pending.map((p) => p.key)).toEqual(["mcpServers.local"]);
    expect(existsSync(join(repo.path, ".mcp.json"))).toBe(false);
  });

  test("refuses a manifest that targets a path outside the allowlist", async () => {
    const m = manifest({ files: [{ path: ".git/hooks/pre-commit", sha256: store.hash(script), size: 1 }] });
    await expect(syncTarget({ root: repo.path, manifest: m, blobs: store.source, approved: new Set() })).rejects.toThrow();
  });

  test("refuses a manifest that ships settings.json as a file", async () => {
    const m = manifest({ files: [{ path: ".claude/settings.json", sha256: store.hash(skillV1), size: 1 }] });
    await expect(syncTarget({ root: repo.path, manifest: m, blobs: store.source, approved: new Set() })).rejects.toThrow();
  });

  test("refuses a blob whose content does not match its hash", async () => {
    const lying = async (hashes: string[]) => new Map(hashes.map((h) => [h, Buffer.from("not it")]));
    await expect(syncTarget({ root: repo.path, manifest: manifest(), blobs: lying, approved: new Set() })).rejects.toThrow(/hash/);
  });

  test("never writes through a symlinked .claude", async () => {
    const outside = tempDir();
    try {
      symlinkSync(outside.path, join(repo.path, ".claude"));
      await expect(syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() })).rejects.toThrow(/symlink/);
      expect(existsSync(join(outside.path, "skills"))).toBe(false);
    } finally {
      outside.cleanup();
    }
  });

  test("dry run writes nothing", async () => {
    const report = await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set(), dryRun: true });
    expect(report.changed).toBe(true);
    expect(existsSync(join(repo.path, "AGENTS.md"))).toBe(false);
  });
});
