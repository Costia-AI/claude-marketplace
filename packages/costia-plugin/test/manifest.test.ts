import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../src/config.ts";

const repo = join(import.meta.dir, "../../..");
const plugin = join(repo, "plugins/costia");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("manifests", () => {
  test("one version everywhere", () => {
    const marketplace = json(join(repo, ".claude-plugin/marketplace.json"));
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === "costia");
    expect(entry.version).toBe(VERSION);
    expect(json(join(plugin, ".claude-plugin/plugin.json")).version).toBe(VERSION);
    expect(json(join(repo, "packages/costia-plugin/package.json")).version).toBe(VERSION);
  });

  test("commands only allow tools of this plugin, node and Read", () => {
    for (const file of readdirSync(join(plugin, "commands"))) {
      const text = readFileSync(join(plugin, "commands", file), "utf8");
      const allowed = /^allowed-tools:\s*(.*)$/m.exec(text)?.[1] ?? "";
      for (const tool of allowed.split(",").map((t) => t.trim()).filter(Boolean)) {
        expect(tool).toMatch(/^(mcp__plugin_costia_costia__\w+|Bash\(node:\*\)|Read)$/);
      }
    }
  });

  test("every skill has a name matching its folder and a description", () => {
    for (const dir of readdirSync(join(plugin, "skills"))) {
      const text = readFileSync(join(plugin, "skills", dir, "SKILL.md"), "utf8");
      expect(/^name:\s*(.+)$/m.exec(text)?.[1]?.trim()).toBe(dir);
      expect(/^description:\s*.+$/m.test(text)).toBe(true);
    }
  });
});
