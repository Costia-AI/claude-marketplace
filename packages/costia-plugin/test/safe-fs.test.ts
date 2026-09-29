import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SafeRoot } from "../src/sync/safe-fs.ts";
import { tempDir } from "./helpers.ts";

let repo: ReturnType<typeof tempDir>;
let outside: ReturnType<typeof tempDir>;
beforeEach(() => {
  repo = tempDir();
  outside = tempDir();
});
afterEach(() => {
  repo.cleanup();
  outside.cleanup();
});

describe("SafeRoot", () => {
  test("writes and reads inside .claude, creating folders", () => {
    const root = new SafeRoot(repo.path);
    root.write(".claude/skills/x/SKILL.md", "hello");
    expect(readFileSync(join(repo.path, ".claude/skills/x/SKILL.md"), "utf8")).toBe("hello");
    expect(root.read(".claude/skills/x/SKILL.md")?.toString()).toBe("hello");
    expect(statSync(join(repo.path, ".claude/skills/x/SKILL.md")).mode & 0o777).toBe(0o644);
  });

  test("refuses a symlinked .claude", () => {
    symlinkSync(outside.path, join(repo.path, ".claude"));
    const root = new SafeRoot(repo.path);
    expect(() => root.write(".claude/skills/x/SKILL.md", "pwned")).toThrow(/symlink/);
    expect(existsSync(join(outside.path, "skills"))).toBe(false);
  });

  test("refuses a symlinked folder deeper down", () => {
    mkdirSync(join(repo.path, ".claude"));
    symlinkSync(outside.path, join(repo.path, ".claude/skills"));
    const root = new SafeRoot(repo.path);
    expect(() => root.write(".claude/skills/x.md", "pwned")).toThrow(/symlink/);
  });

  test("refuses to write through a symlinked file", () => {
    mkdirSync(join(repo.path, ".claude"));
    const victim = join(outside.path, "victim");
    writeFileSync(victim, "original");
    symlinkSync(victim, join(repo.path, ".claude/settings.json"));
    const root = new SafeRoot(repo.path);
    expect(() => root.write(".claude/settings.json", "{}")).toThrow(/symlink/);
    expect(() => root.read(".claude/settings.json")).toThrow(/symlink/);
    expect(readFileSync(victim, "utf8")).toBe("original");
  });

  test("refuses paths outside the allowlist", () => {
    const root = new SafeRoot(repo.path);
    expect(() => root.write("src/main.ts", "x")).toThrow();
    expect(() => root.write(".claude/../evil", "x")).toThrow();
  });

  test("a root that is itself a symlink resolves once and is then fixed", () => {
    const link = join(outside.path, "link");
    symlinkSync(repo.path, link);
    const root = new SafeRoot(link);
    root.write("AGENTS.md", "x");
    expect(readFileSync(join(repo.path, "AGENTS.md"), "utf8")).toBe("x");
  });
});
