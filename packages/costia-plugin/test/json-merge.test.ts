import { describe, expect, test } from "bun:test";
import { approvalHash, flatten, mergeOwnedEntries } from "../src/sync/json-merge.ts";
import { settingsEntrySensitivity } from "../src/sync/sensitivity.ts";

const merge = (current: Record<string, unknown>, desired: Record<string, unknown>, owned: Record<string, string> = {}, approved = new Set<string>()) =>
  mergeOwnedEntries({ scope: "settings", current, desired: flatten(desired), owned, sensitivity: settingsEntrySensitivity, approved });

describe("mergeOwnedEntries", () => {
  test("non-sensitive entries apply, sensitive ones wait for approval", () => {
    const result = merge({ model: "opus" }, { permissions: { deny: ["Read(.env)"] }, enabledPlugins: { "x@y": true } });
    expect(result.doc).toEqual({ model: "opus", permissions: { deny: ["Read(.env)"] } });
    expect(result.pending.map((p) => p.key)).toEqual(["enabledPlugins.x@y"]);
  });

  test("an approved sensitive entry applies", () => {
    const approval = approvalHash("settings", "enabledPlugins.x@y", true);
    const result = merge({}, { enabledPlugins: { "x@y": true } }, {}, new Set([approval]));
    expect(result.doc).toEqual({ enabledPlugins: { "x@y": true } });
    expect(result.owned["enabledPlugins.x@y"]).toBeDefined();
  });

  test("a user's own value is never overwritten", () => {
    const result = merge({ outputStyle: "mine" }, { outputStyle: "theirs" });
    expect(result.conflicts).toEqual(["outputStyle"]);
    expect(result.doc.outputStyle).toBe("mine");
  });

  test("owned values update, removed ones go, edited ones stay", () => {
    const first = merge({}, { outputStyle: "a", permissions: { deny: ["Read(.env)"] } });
    const second = merge(first.doc, { outputStyle: "b" }, first.owned);
    expect(second.doc).toEqual({ outputStyle: "b" });
    const edited = { ...second.doc, outputStyle: "mine" };
    const third = merge(edited, { outputStyle: "c" }, second.owned);
    expect(third.doc.outputStyle).toBe("mine");
    expect(third.conflicts).toEqual(["outputStyle"]);
  });

  test("hooks are owned per group and never touch the user's hooks", () => {
    const mine = { matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] };
    const ours = { matcher: "Edit", hooks: [{ type: "command", command: "echo ours" }] };
    const key = [...flatten({ hooks: { PreToolUse: [ours] } }).keys()][0]!;
    const approved = new Set([approvalHash("settings", key, ours)]);
    const result = merge({ hooks: { PreToolUse: [mine] } }, { hooks: { PreToolUse: [ours] } }, {}, approved);
    expect((result.doc.hooks as any).PreToolUse).toEqual([mine, ours]);
    const removed = merge(result.doc, {}, result.owned);
    expect((removed.doc.hooks as any).PreToolUse).toEqual([mine]);
  });
});
