import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncTarget, syncUserRoot } from "../src/sync/apply.ts";
import { sectionHash } from "../src/sync/agents-md.ts";
import { files as stateFiles } from "../src/state/paths.ts";
import type { Manifest, UserManifest } from "../src/sync/types.ts";
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

const shared = "---\nname: shared\ndescription: x\n---\nFor everyone.\n";
const mine = "---\nname: mine\ndescription: x\n---\nOnly for me.\n";
const mineV2 = "---\nname: mine\ndescription: x\n---\nOnly for me, v2.\n";
const store = blobStore([shared, mine, mineV2]);
const privateSection = "## My rules\n\nShort answers.";
const read = (path: string) => readFileSync(join(repo.path, path), "utf8");
const git = (...args: string[]) => execFileSync("git", ["-C", repo.path, ...args], { stdio: "ignore" });

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    revision: "r1",
    project: "p1",
    target: ".",
    files: [
      { path: ".claude/skills/shared/SKILL.md", sha256: store.hash(shared), size: shared.length, item: "i-shared" },
      { path: ".claude/skills/mine/SKILL.md", sha256: store.hash(mine), size: mine.length, item: "i-mine", destination: "private" },
    ],
    agents: { sections: [{ id: "me/my-rules", title: "My rules", version: 1, sha256: sectionHash(privateSection), content: privateSection, destination: "private", item: "i-rules" }] },
    ...overrides,
  };
}

describe("private destination", () => {
  test("lands in .claude, stays out of the committed lockfile and out of git", async () => {
    git("init", "-q");
    const report = await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set(), params: { shared: "A=1\n", local: "B=2\n" } });
    expect(report.errors).toEqual([]);
    expect(read(".claude/skills/mine/SKILL.md")).toBe(mine);
    expect(read(".claude/rules/costia--me--my-rules.md")).toContain("Short answers.");
    expect(read(".claude/rules/costia--me--my-rules.md").startsWith("> **Managed by Costia**")).toBe(true);
    expect(existsSync(join(repo.path, "AGENTS.md"))).toBe(false);

    const lock = JSON.parse(read(".claude/costia.lock.json"));
    expect(Object.keys(lock.files)).toEqual([".claude/skills/shared/SKILL.md"]);
    const local = JSON.parse(read(".claude/costia.lock.local.json"));
    expect(Object.keys(local.files).sort()).toEqual([".claude/rules/costia--me--my-rules.md", ".claude/skills/mine/SKILL.md"]);

    const exclude = readFileSync(join(repo.path, ".git/info/exclude"), "utf8");
    expect(exclude).toContain("# costia:begin");
    for (const path of ["/.claude/skills/mine/SKILL.md", "/.claude/rules/costia--me--my-rules.md", "/.claude/costia.lock.local.json", "/.claude/costia/params.local.env"]) {
      expect(exclude).toContain(path);
    }
    expect(exclude).not.toContain("shared");
    expect(read(".claude/costia/params.env")).toBe("A=1\n");

    // git itself agrees: only the shared side shows up as untracked.
    const untracked = execFileSync("git", ["-C", repo.path, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
    expect(untracked).toContain(".claude/skills/shared/SKILL.md");
    expect(untracked).toContain(".claude/costia/params.env");
    expect(untracked).not.toContain("mine");
    expect(untracked).not.toContain("costia.lock.local.json");
    expect(untracked).not.toContain("params.local.env");
  });

  test("lines outside the managed block are kept, and the block goes when nothing is private", async () => {
    git("init", "-q");
    writeFileSync(join(repo.path, ".git/info/exclude"), "# mine\n*.log\n");
    await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() });
    expect(readFileSync(join(repo.path, ".git/info/exclude"), "utf8").startsWith("# mine\n*.log\n")).toBe(true);
    await syncTarget({ root: repo.path, manifest: manifest({ revision: "r2", files: [manifest().files[0]!], agents: { sections: [] } }), blobs: store.source, approved: new Set() });
    expect(readFileSync(join(repo.path, ".git/info/exclude"), "utf8")).toBe("# mine\n*.log\n");
    expect(existsSync(join(repo.path, ".claude/skills/mine/SKILL.md"))).toBe(false);
    expect(existsSync(join(repo.path, ".claude/costia.lock.local.json"))).toBe(false);
  });

  test("a worktree writes to the common git dir", async () => {
    git("init", "-q");
    git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "init");
    const worktree = join(repo.path, "wt");
    git("worktree", "add", "-q", worktree);
    await syncTarget({ root: worktree, manifest: manifest(), blobs: store.source, approved: new Set() });
    expect(readFileSync(join(repo.path, ".git/info/exclude"), "utf8")).toContain("/.claude/skills/mine/SKILL.md");
  });

  test("a symlinked info directory is refused", async () => {
    git("init", "-q");
    const elsewhere = tempDir();
    try {
      execFileSync("rm", ["-rf", join(repo.path, ".git/info")]);
      symlinkSync(elsewhere.path, join(repo.path, ".git/info"));
      const report = await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() });
      expect(report.errors.some((e) => e.includes("info/exclude"))).toBe(true);
      expect(existsSync(join(elsewhere.path, "exclude"))).toBe(false);
    } finally {
      elsewhere.cleanup();
    }
  });
});

describe("held items", () => {
  test("a held item is neither written nor removed", async () => {
    await syncTarget({ root: repo.path, manifest: manifest(), blobs: store.source, approved: new Set() });
    // v2 of the private skill arrives while its setup is incomplete: nothing changes.
    const next = manifest({ revision: "r2", files: [manifest().files[0]!, { ...manifest().files[1]!, sha256: store.hash(mineV2), size: mineV2.length }] });
    const held = await syncTarget({ root: repo.path, manifest: next, blobs: store.source, approved: new Set(), held: new Set(["i-mine"]) });
    expect(held.held).toEqual(["i-mine"]);
    expect(read(".claude/skills/mine/SKILL.md")).toBe(mine);
    // A new item that is held is not written at all.
    const fresh = manifest({ revision: "r3", files: [...manifest().files, { path: ".claude/skills/new/SKILL.md", sha256: store.hash(shared), size: shared.length, item: "i-new" }] });
    await syncTarget({ root: repo.path, manifest: fresh, blobs: store.source, approved: new Set(), held: new Set(["i-new"]) });
    expect(existsSync(join(repo.path, ".claude/skills/new/SKILL.md"))).toBe(false);
    // Released: it is applied.
    await syncTarget({ root: repo.path, manifest: next, blobs: store.source, approved: new Set() });
    expect(read(".claude/skills/mine/SKILL.md")).toBe(mineV2);
  });

  test("a held AGENTS.md section stays as it is", async () => {
    const content = "## Git\n\nEnglish.";
    const v2 = "## Git\n\nEnglish, always.";
    const section = (c: string, version: number) => ({ id: "ws/git", title: "Git", version, sha256: sectionHash(c), content: c, item: "i-git" });
    await syncTarget({ root: repo.path, manifest: manifest({ files: [], agents: { sections: [section(content, 1)] } }), blobs: store.source, approved: new Set() });
    await syncTarget({ root: repo.path, manifest: manifest({ revision: "r2", files: [], agents: { sections: [section(v2, 2)] } }), blobs: store.source, approved: new Set(), held: new Set(["i-git"]) });
    expect(read("AGENTS.md")).toContain("English.");
    expect(read("AGENTS.md")).not.toContain("always");
  });
});

describe("user destination", () => {
  const userManifest = (overrides: Partial<UserManifest> = {}): UserManifest => ({
    revision: "u1",
    files: [{ path: "skills/mine/SKILL.md", sha256: store.hash(mine), size: mine.length, item: "i-mine" }],
    agents: { sections: [{ id: "javirub/conventions", title: "Conventions", version: 1, sha256: sectionHash(privateSection), content: privateSection }] },
    ...overrides,
  });

  test("writes skills and rules under ~/.claude, lock in the state dir", async () => {
    const root = join(repo.path, "claude-home");
    const report = await syncUserRoot({ root, manifest: userManifest(), blobs: store.source, approved: new Set() });
    expect(report.errors).toEqual([]);
    expect(readFileSync(join(root, "skills/mine/SKILL.md"), "utf8")).toBe(mine);
    expect(readFileSync(join(root, "rules/costia--javirub--conventions.md"), "utf8")).toContain("Short answers.");
    expect(existsSync(join(root, "costia.lock.json"))).toBe(false);
    expect(JSON.parse(readFileSync(stateFiles.userLock(), "utf8")).files["skills/mine/SKILL.md"]).toBeTruthy();
  });

  test("refuses anything outside skills, agents, commands, output styles and costia rules", async () => {
    const root = join(repo.path, "claude-home");
    for (const path of ["settings.json", "CLAUDE.md", "plugins/x/y.md", "rules/other.md", "agents/nested/a.md", "../escape.md"]) {
      await expect(syncUserRoot({ root, manifest: userManifest({ files: [{ path, sha256: store.hash(mine), size: mine.length }], agents: { sections: [] } }), blobs: store.source, approved: new Set() })).rejects.toThrow();
    }
  });

  test("refuses a symlinked skills folder", async () => {
    const root = join(repo.path, "claude-home");
    const elsewhere = join(repo.path, "elsewhere");
    mkdirSync(root);
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(root, "skills"));
    await expect(syncUserRoot({ root, manifest: userManifest({ agents: { sections: [] } }), blobs: store.source, approved: new Set() })).rejects.toThrow(/symlink/);
    expect(existsSync(join(elsewhere, "mine"))).toBe(false);
  });
});
