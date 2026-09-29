import { describe, expect, test } from "bun:test";
import { checkNoCaseCollisions, checkPath } from "../src/sync/paths.ts";

describe("checkPath", () => {
  test.each([
    ".claude/skills/a/SKILL.md",
    ".claude/agents/reviewer.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".mcp.json",
    ".claude/settings.json",
  ])("allows %s", (path) => {
    expect(() => checkPath(path)).not.toThrow();
  });

  test.each([
    ["", "empty"],
    ["/etc/passwd", "absolute"],
    ["~/.ssh/id_rsa", "home"],
    ["C:/x", "drive"],
    [".claude/../.git/config", "dot-dot"],
    [".claude/./x", "dot"],
    [".claude//x", "empty segment"],
    [".claude\\x", "backslash"],
    [".claude/x\0y", "nul"],
    ["README.md", "outside allowlist"],
    [".git/hooks/pre-commit", "outside allowlist"],
    [".claude", "the folder itself"],
    [".claude/settings.local.json", "denied"],
    [".claude/costia.lock.json", "lockfile"],
    [".claude/con", "reserved"],
    [".claude/x.", "trailing dot"],
    [".claude/cafe\u0301.md", "not NFC"],
    [".claude/a:b", "colon"],
    ["src/.claude/x", "nested .claude"],
  ])("rejects %j (%s)", (path) => {
    expect(() => checkPath(path)).toThrow();
  });

  test("the lockfile is writable only internally", () => {
    expect(() => checkPath(".claude/costia.lock.json", { internal: true })).not.toThrow();
    expect(() => checkPath(".claude/settings.local.json", { internal: true })).toThrow();
  });

  test("case collisions", () => {
    expect(() => checkNoCaseCollisions([".claude/a.md", ".claude/A.md"])).toThrow();
    expect(() => checkNoCaseCollisions([".claude/a.md", ".claude/b.md"])).not.toThrow();
  });
});
