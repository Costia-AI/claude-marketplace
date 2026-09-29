import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { envName, expand, validateSpec, type FlowSpec } from "../src/setup/spec.ts";
import { heldItems, itemStatus, paramsFiles, resolveFlow, type SetupData } from "../src/setup/resolver.ts";
import { recordStep, recordVerified } from "../src/setup/state.ts";
import { renderMarkdown } from "../src/setup/wizard/markdown.ts";
import { tempDir } from "./helpers.ts";

let state: ReturnType<typeof tempDir>;
beforeEach(() => {
  state = tempDir();
  process.env.COSTIA_STATE_DIR = state.path;
});
afterEach(() => state.cleanup());

const infisical: FlowSpec = {
  schema: 1,
  params: [
    { key: "infisicalProject", type: "string", scope: "project", pattern: "^[a-z0-9-]+$" },
    { key: "infisicalEnv", type: "string", scope: "project", default: "prod", editable: true },
    { key: "personalToken", type: "string", scope: "project_user" },
  ],
  steps: [
    { id: "cli", title: "Install the CLI", scope: "machine", type: "check", check: { builtin: "command", command: "infisical" } },
    { id: "project", title: "Name the project", scope: "project", type: "input", params: ["infisicalProject", "infisicalEnv"] },
    { id: "scaffold", title: "Write the scripts", scope: "project", type: "claude", prompt: "Create scripts for {{infisicalProject}}." },
  ],
  verify: [{ builtin: "infisical.project-exists", project: "{{infisicalProject}}" }],
};

function data(overrides: Partial<SetupData> = {}): SetupData {
  return {
    requires: { item1: ["flow1"] },
    flows: { flow1: { ref: "costia-ai/infisical-project", name: "Infisical project", version: 2, spec: infisical, bindings: { infisicalEnv: "staging" } } },
    setup: { states: [], params: {} },
    ...overrides,
  };
}

describe("validateSpec", () => {
  test("a good spec has no errors", () => {
    expect(validateSpec(infisical)).toEqual([]);
  });

  test("names every problem with its pointer", () => {
    const errors = validateSpec({
      schema: 2,
      params: [{ key: "a", type: "string", scope: "galaxy" }, { key: "a", type: "string", scope: "project" }],
      steps: [
        { id: "Bad Id", title: "", scope: "project", type: "input", params: ["missing"] },
        { id: "x", title: "x", scope: "project", type: "check" },
        { id: "y", title: "y", scope: "project", type: "confirm", instructions: { "*": "Use {{nope}}" } },
        { id: "z", title: "z", scope: "project", type: "claude" },
        { id: "w", title: "w", scope: "machine", type: "check", check: { builtin: "command", command: "rm -rf /" } },
      ],
      verify: [{ builtin: "teleport" }, { run: [] }],
    });
    for (const expected of [
      "/schema",
      "/params/0/scope",
      "/params/1/key",
      "/steps/0/id",
      "/steps/0/title",
      "/steps/0/params: unknown parameter missing",
      "/steps/1/check",
      "{{nope}}",
      "/steps/3/prompt",
      "/steps/4/check/command",
      "/verify/0/builtin",
      "/verify/1/run",
    ]) {
      expect(errors.some((e) => e.includes(expected))).toBe(true);
    }
  });

  test("env names and templates", () => {
    expect(envName({ key: "infisicalProject", type: "string", scope: "project" })).toBe("INFISICAL_PROJECT");
    expect(expand("{{a}}/{{ b }}/{{c}}", { a: "1", b: "2" })).toBe("1/2/{{c}}");
  });
});

describe("resolver", () => {
  test("bindings: editable ones are defaults, stored values win", () => {
    const flow = resolveFlow("flow1", data({ setup: { states: [], params: { flow1: { infisicalProject: "costia", infisicalEnv: "prod" } } } }), { project: "p" })!;
    expect(flow.values.infisicalProject).toBe("costia");
    expect(flow.values.infisicalEnv).toBe("prod");
    expect(resolveFlow("flow1", data(), { project: "p" })!.values.infisicalEnv).toBe("staging");
  });

  test("an item is held until every human step is done and verify passed here", async () => {
    const context = { project: "p" };
    expect(itemStatus("item1", data(), context).ready).toBe(false);
    await recordStep(context, "flow1", "cli", "machine", 2);
    const done = data({ setup: { states: [{ flow: "flow1", step: "project", scope: "project", version: 2, doneAt: "2026-09-30T10:00:00Z", doneBy: "ana" }], params: {} } });
    const status = itemStatus("item1", done, context);
    expect(status.flows[0]!.pending).toEqual([]);
    expect(status.ready).toBe(false); // verify never passed on this machine
    recordVerified(context, "flow1", 2);
    expect(itemStatus("item1", done, context).ready).toBe(true);
    // A new flow version must be verified again.
    const bumped = { ...done, flows: { flow1: { ...done.flows!.flow1!, version: 3 } } };
    expect(heldItems(bumped, context).has("item1")).toBe(true);
    // Claude steps never hold an item.
    expect(itemStatus("item1", done, context).flows[0]!.claude.map((s) => s.id)).toEqual(["scaffold"]);
    expect(itemStatus("item1", done, context).flows[0]!.claude[0]!.prompt).toBe("Create scripts for {{infisicalProject}}.");
  });

  test("a step done in another scope does not count", () => {
    const wrong = data({ setup: { states: [{ flow: "flow1", step: "project", scope: "user", version: 2, doneAt: "x" }], params: {} } });
    expect(resolveFlow("flow1", wrong, { project: "p" })!.pending.map((s) => s.id)).toContain("project");
  });

  test("an invalid spec holds its items", () => {
    const broken = data({ flows: { flow1: { ref: "a/b", name: "b", version: 1, spec: { schema: 1, steps: [] } as unknown as FlowSpec } } });
    const status = itemStatus("item1", broken, { project: "p" });
    expect(status.ready).toBe(false);
    expect(status.flows[0]!.errors.length).toBeGreaterThan(0);
  });

  test("parameter files split by scope, quote values and leave conflicts out", () => {
    const d = data({ setup: { states: [], params: { flow1: { infisicalProject: "costia", personalToken: "it's mine" } } } });
    const files = paramsFiles([resolveFlow("flow1", d, { project: "p" })!]);
    expect(files.shared).toContain("INFISICAL_PROJECT=costia\n");
    expect(files.shared).toContain("INFISICAL_ENV=staging");
    expect(files.local).toContain(`PERSONAL_TOKEN='it'\\''s mine'`);
    const other = resolveFlow("flow1", { ...d, setup: { states: [], params: { flow1: { infisicalProject: "other" } } } }, { project: "p" })!;
    const clash = paramsFiles([resolveFlow("flow1", d, { project: "p" })!, { ...other, id: "flow2" }]);
    expect(clash.conflicts).toEqual(["INFISICAL_PROJECT"]);
    expect(clash.shared).not.toContain("INFISICAL_PROJECT");
  });
});

describe("renderMarkdown", () => {
  test("escapes HTML and keeps only http(s) links", () => {
    const html = renderMarkdown("# Title\n\n<script>alert(1)</script> **bold** `x<y`\n\n1. one\n2. [two](https://example.com)\n\n[bad](javascript:alert(1))");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>x&lt;y</code>");
    expect(html).toContain('<ol><li>one</li><li><a href="https://example.com"');
    expect(html).not.toContain('href="javascript');
  });

  test("is self-contained, so the page can embed its source", () => {
    const rebuilt = new Function(`return (${renderMarkdown.toString()})`)() as typeof renderMarkdown;
    expect(rebuilt("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
  });
});
