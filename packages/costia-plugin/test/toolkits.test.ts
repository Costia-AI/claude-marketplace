import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSpec, type FlowSpec } from "../src/setup/spec.ts";
import { paramsFiles, resolveFlow, type SetupData } from "../src/setup/resolver.ts";

/** The toolkits published from this repository must be valid for the plugin that runs them. */

const toolkits = join(import.meta.dir, "../../../toolkits");
const flowsDir = join(toolkits, "flows");
const present = existsSync(flowsDir);

interface FlowFile {
  slug: string;
  name: string;
  spec: FlowSpec;
}

const load = (): FlowFile[] => readdirSync(flowsDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(flowsDir, f), "utf8")));
const bare = (ref: string) => ref.split("/").pop()!;

describe.skipIf(!present)("toolkit flows", () => {
  test("every flow validates, with the parameters of its closure", () => {
    const flows = load();
    const bySlug = new Map(flows.map((f) => [f.slug, f]));
    for (const flow of flows) {
      const known = new Set<string>();
      const queue = (flow.spec.requires ?? []).map((r) => bare(r.flow));
      const seen = new Set<string>();
      while (queue.length) {
        const slug = queue.shift()!;
        if (seen.has(slug)) continue;
        seen.add(slug);
        const required = bySlug.get(slug);
        expect(required, `${flow.slug} requires ${slug}, which is not in toolkits/flows`).toBeDefined();
        for (const p of required!.spec.params ?? []) known.add(p.key);
        queue.push(...(required!.spec.requires ?? []).map((r) => bare(r.flow)));
      }
      expect(validateSpec(flow.spec, known), flow.slug).toEqual([]);
    }
  });

  test("the parameter files the plugin writes read back through the toolkits' parser", async () => {
    const { parseEnv } = await import(join(toolkits, "_shared/params.mjs"));
    const flows = load();
    const data: SetupData = {
      requires: { item: flows.map((f) => f.slug) },
      flows: Object.fromEntries(flows.map((f) => [f.slug, { ref: `me/${f.slug}`, name: f.name, version: 1, spec: f.spec }])),
      setup: { states: [], params: Object.fromEntries(flows.map((f) => [f.slug, Object.fromEntries((f.spec.params ?? []).map((p) => [p.key, `v '$x" ${p.key}`]))])) },
    };
    const resolved = flows.map((f) => resolveFlow(f.slug, data, { project: "p" })!);
    const files = paramsFiles(resolved);
    const parsed = { ...parseEnv(files.shared ?? ""), ...parseEnv(files.local ?? "") };
    for (const flow of resolved) {
      for (const p of flow.entry.spec.params ?? []) {
        const env = p.env ?? p.key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
        if (files.conflicts.includes(env)) continue;
        expect(parsed[env], env).toBe(flow.values[p.key]!);
      }
    }
  });
});
