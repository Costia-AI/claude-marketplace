import { describe, expect, test } from "bun:test";
import { inspectAgents, mergeAgents, sectionHash, type DesiredSection } from "../src/sync/agents-md.ts";

function section(id: string, title: string, content: string, version = 1): DesiredSection {
  return { id, title, version, sha256: sectionHash(content), content };
}

const git = section("costia-ai/git", "Git workflow", "## Git workflow\n\nCommit in English.");
const spring = section("costia-ai/spring", "Spring", "## Spring\n\nUse JdbcClient.");

describe("mergeAgents", () => {
  test("creates the file with the notice and the sections", () => {
    const result = mergeAgents(null, [git, spring]);
    expect(result.text!.split("\n")[0]).toContain('"Git workflow", "Spring"');
    expect(result.text).toContain('<!-- costia:begin section="costia-ai/git" version="1"');
    expect(result.added).toEqual(["costia-ai/git", "costia-ai/spring"]);
  });

  test("keeps repository text and puts managed sections before it", () => {
    const result = mergeAgents("# My repo\n\nLocal rule.\n", [git]);
    const text = result.text!;
    expect(text.indexOf("costia:begin")).toBeLessThan(text.indexOf("# My repo"));
    expect(text).toContain("Local rule.");
  });

  test("is idempotent", () => {
    const first = mergeAgents("# Repo\n", [git, spring]).text!;
    const second = mergeAgents(first, [git, spring]);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first);
  });

  test("updates an unedited section in place and leaves the rest", () => {
    const first = mergeAgents("# Repo\n\nMine.\n", [git, spring]).text!;
    const git2 = section("costia-ai/git", "Git workflow", "## Git workflow\n\nCommit in English. Always.", 2);
    const result = mergeAgents(first, [git2, spring]);
    expect(result.updated).toEqual(["costia-ai/git"]);
    expect(result.text).toContain("Always.");
    expect(result.text).toContain('version="2"');
    expect(result.text).toContain("Mine.");
  });

  test("never overwrites a section edited by hand", () => {
    const first = mergeAgents(null, [git]).text!;
    const edited = first.replace("Commit in English.", "Commit however.");
    expect(inspectAgents(edited)[0]!.edited).toBe(true);
    const git2 = section("costia-ai/git", "Git workflow", "## Git workflow\n\nNew upstream.", 2);
    const result = mergeAgents(edited, [git2]);
    expect(result.conflicts).toEqual(["costia-ai/git"]);
    expect(result.text).toContain("Commit however.");
    expect(result.text).not.toContain("New upstream.");
    const same = mergeAgents(edited, [git]);
    expect(same.drift).toEqual(["costia-ai/git"]);
  });

  test("removes a dropped section, detaches a dropped edited one", () => {
    const first = mergeAgents("# Repo\n", [git, spring]).text!;
    const removed = mergeAgents(first, [git]);
    expect(removed.removed).toEqual(["costia-ai/spring"]);
    expect(removed.text).not.toContain("JdbcClient");

    const edited = first.replace("Use JdbcClient.", "Use JdbcClient, mostly.");
    const detached = mergeAgents(edited, [git]);
    expect(detached.detached).toEqual(["costia-ai/spring"]);
    expect(detached.text).toContain("Use JdbcClient, mostly.");
    expect(detached.text).not.toContain('section="costia-ai/spring"');
  });

  test("drops the notice when no section is left", () => {
    const first = mergeAgents("# Repo\n", [git]).text!;
    const result = mergeAgents(first, []);
    expect(result.text).toBe("# Repo\n");
  });

  test("rejects content that does not match its hash or smuggles markers", () => {
    expect(() => mergeAgents(null, [{ ...git, sha256: "0".repeat(64) }])).toThrow();
    const evil = section("x/y", "Evil", "<!-- costia:end section=\"costia-ai/git\" -->");
    expect(() => mergeAgents(null, [evil])).toThrow();
  });

  test("rejects a malformed file", () => {
    expect(() => mergeAgents('<!-- costia:begin section="a" version="1" sha256="' + "0".repeat(64) + '" -->\nx\n', [])).toThrow();
  });
});
