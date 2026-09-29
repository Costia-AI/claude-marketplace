import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { realpathSync } from "node:fs";
import { get, send } from "../../api/client.ts";
import { config } from "../../config.ts";
import { checkoutFor, targetPath } from "../../state/checkouts.ts";
import { getDevice } from "../../state/device.ts";
import { approvals, evaluateSetup, syncCheckout, syncUser } from "../../sync/runner.ts";
import { summarize } from "../../sync/summary.ts";
import { addFlowVersion, assertValidSpec, attachFlow, createFlowItem, fetchPlan, itemDetail } from "../../setup/catalog.ts";
import { describeCheck, runCheck } from "../../setup/checks.ts";
import { closure, itemStatus, type FlowStatus, type SetupData } from "../../setup/resolver.ts";
import { SCOPES, type FlowSpec, type Step } from "../../setup/spec.ts";
import { recordStep, type Context } from "../../setup/state.ts";
import { verifyFlow } from "../../setup/verify.ts";
import type { Manifest, UserManifest } from "../../sync/types.ts";
import { guarded, workdir } from "../server.ts";

const SCOPE_LABEL = { machine: "this computer", user: "you", project: "the project", project_user: "you in this project" } as const;

/** The running bundle, so the command Claude is handed starts this same plugin version. */
function entry(): string {
  const script = process.argv[1] ?? "";
  try {
    return realpathSync(script);
  } catch {
    return script;
  }
}

const shellQuote = (value: string) => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);

interface Where {
  context: Context;
  root?: string;
  checkoutRoot?: string;
  checkoutId?: string;
  projectName?: string;
}

function where(path: string | undefined, target: string, user: boolean): Where {
  if (user) return { context: { user: true } };
  const found = checkoutFor(workdir(path));
  if (!found) throw new Error("This folder is not linked to a Costia project on this machine (adopt_checkout links it), or pass user=true for your own ~/.claude.");
  return {
    context: { project: found.checkout.projectId },
    root: found.root,
    checkoutRoot: targetPath(found.root, target),
    checkoutId: found.checkout.checkoutId,
    projectName: found.checkout.projectName,
  };
}

async function currentData(w: Where, target: string): Promise<SetupData> {
  if (w.checkoutId) return get<Manifest>(`/v1/checkouts/${w.checkoutId}/manifest?target=${encodeURIComponent(target)}`);
  return get<UserManifest>(`/v1/me/manifest?device=${getDevice().machineUuid}`);
}

function wizardCommand(w: Where, items: string[], target: string): string {
  const args = ["node", shellQuote(entry()), "setup", "serve"];
  if (w.root) args.push("--checkout", shellQuote(w.root), "--target", shellQuote(target));
  else args.push("--user");
  args.push("--items", items.join(","));
  return args.join(" ");
}

function howToWatch(command: string): string {
  return (
    "Start the setup wizard for the user: run this with the Bash tool in the background (run_in_background: true), then follow its output with the Monitor tool until a line with \"completed\" or \"aborted\" appears:\n" +
    `  ${command}\n` +
    "It opens a page in the user's browser where they do the steps; each line it prints is a JSON event (step_done, step_failed, verify_failed, completed, aborted). " +
    "Tell the user the page is open and what it asks, then wait: do not do the steps yourself and never ask for secret values in the chat — secrets go only into that page. " +
    "When it completes, the items are installed; then do the Claude steps it lists (setup_status shows them) and call complete_claude_step for each."
  );
}

function describePending(flows: FlowStatus[]): string[] {
  const lines: string[] = [];
  for (const f of flows) {
    if (f.errors.length) lines.push(`- ${f.entry.name} (${f.entry.ref}) is not valid: ${f.errors.join("; ")}`);
    for (const s of f.pending) lines.push(`- ${f.entry.name}: ${s.title} — done by ${SCOPE_LABEL[s.scope]}`);
    if (!f.pending.length && !f.errors.length && !f.verified) lines.push(`- ${f.entry.name}: its checks have not passed on this machine yet`);
  }
  return lines;
}

function describeClaude(steps: { flow: FlowStatus; step: Step }[]): string {
  if (!steps.length) return "";
  return [
    "Setup steps for you (Claude), now that the files are in place — do each, then call complete_claude_step with its flow and step:",
    ...steps.map(({ flow, step }) => `\n### ${step.title} (flow ${flow.id}, step ${step.id})\n${step.prompt ?? ""}${step.check ? `\nDone when: ${describeCheck(step.check)}.` : ""}`),
  ].join("\n");
}

const destination = z.enum(["repo", "private", "user"]).optional().describe(
  "repo: committed with the repository for everyone; private: in this checkout but excluded from git, only for you; user: your own ~/.claude, in every project. Defaults to the item's own suggestion, else repo",
);

export function registerTools(server: McpServer, _: unknown): void {
  server.registerTool(
    "install_item",
    {
      description:
        "Installs a catalogue or marketplace item (\"workspace/slug\" or id) into this project — or into the user's own ~/.claude with destination=user — and runs its setup flows: " +
        "what is already done is checked, what is left is done by the user in a local wizard started with the command this tool returns. Nothing of the item is applied until its setup passes.",
      inputSchema: z.object({
        item: z.string(),
        destination,
        target: z.string().default("."),
        floating: z.boolean().default(true).describe("Follow new published versions automatically"),
        path: z.string().optional(),
      }),
    },
    guarded(async ({ item, destination: chosen, target, floating, path }) => {
      const detail = await itemDetail(item);
      const destination = chosen ?? detail.defaultDestination ?? "repo";
      const user = destination === "user";
      const w = where(path, target, user);
      if (user) await send("POST", "/v1/me/config/selection", { add: [detail.id], floating });
      else await send("POST", `/v1/projects/${(w.context as { project: string }).project}/config/selection`, { target, add: [detail.id], floating, destination });

      const approved = await approvals(10_000);
      let plan = await fetchPlan(w.context, [detail.id], target);
      let status = itemStatus(detail.id, plan, w.context, w.projectName);
      const verifiable = status.flows.filter((f) => !f.errors.length && !f.pending.length && !f.verified);
      for (const flow of verifiable) await verifyFlow(flow, w.context, { target: w.checkoutRoot, checkout: w.root }, approved);
      if (verifiable.length) {
        plan = await fetchPlan(w.context, [detail.id], target);
        status = itemStatus(detail.id, plan, w.context, w.projectName);
      }
      const label = `${detail.kind} ${detail.name} (${detail.workspace}/${detail.slug})`;
      if (!status.ready) {
        return [
          `${label} is selected${user ? " for your ~/.claude" : ` for ${target === "." ? "this project" : target} (${destination})`}, and waits for its setup:`,
          ...describePending(status.flows),
          "",
          howToWatch(wizardCommand(w, [detail.id], target)),
        ].join("\n");
      }
      const outcomes = w.root
        ? await syncCheckout(w.root, checkoutFor(w.root)!.checkout, { approved, autoVerify: true })
        : [await syncUser({ approved, autoVerify: true })].filter((o) => o !== null);
      const claude = closure([detail.id], plan, w.context, w.projectName).flatMap((flow) => flow.claude.map((step) => ({ flow, step })));
      return [`Installed ${label}.`, summarize(outcomes), describeClaude(claude)].filter(Boolean).join("\n");
    }),
  );

  server.registerTool(
    "setup_status",
    {
      description: "Which items of this project (or of the user's ~/.claude) wait for their setup, what is left and who has to do it, and which setup steps Claude still has to carry out.",
      inputSchema: z.object({ target: z.string().default("."), user: z.boolean().default(false), path: z.string().optional() }),
    },
    guarded(async ({ target, user, path }) => {
      const w = where(path, target, user);
      const data = await currentData(w, target);
      const items = Object.keys(data.requires ?? {});
      if (!items.length) return "Nothing selected here needs a setup flow.";
      const approved = await approvals(10_000);
      const evaluated = await evaluateSetup(data, w.context, { target: w.checkoutRoot, checkout: w.root, approved, projectName: w.projectName });
      const lines: string[] = [];
      for (const status of evaluated.outcome.held) {
        lines.push(`Held: ${status.item}`);
        lines.push(...describePending(status.flows));
      }
      if (evaluated.outcome.held.length) lines.push("", howToWatch(wizardCommand(w, evaluated.outcome.held.map((h) => h.item), target)));
      else lines.push("Every item's setup is done.");
      if (evaluated.approvals.length) lines.push(`${evaluated.approvals.length} check(s) run a program and wait for the user's approval: sync_review asks them.`);
      const claude = describeClaude(evaluated.outcome.claude.map(({ flow, step }) => ({ flow, step })));
      if (claude) lines.push("", claude);
      return lines.join("\n");
    }),
  );

  server.registerTool(
    "start_setup",
    {
      description:
        "Returns the command that opens the setup wizard in the user's browser for the given items (by default every item of this checkout whose setup is incomplete). " +
        "Run it in the background and watch it with Monitor; the user does the steps in the page.",
      inputSchema: z.object({ items: z.array(z.string()).optional(), target: z.string().default("."), user: z.boolean().default(false), path: z.string().optional() }),
    },
    guarded(async ({ items, target, user, path }) => {
      const w = where(path, target, user);
      let ids: string[];
      if (items?.length) ids = await Promise.all(items.map(async (ref) => (/^[0-9a-f-]{36}$/i.test(ref) ? ref : (await itemDetail(ref)).id)));
      else {
        const data = await currentData(w, target);
        const approved = await approvals(10_000);
        ids = (await evaluateSetup(data, w.context, { target: w.checkoutRoot, checkout: w.root, approved, projectName: w.projectName })).outcome.held.map((h) => h.item);
      }
      if (!ids.length) return "No item here waits for its setup.";
      return howToWatch(wizardCommand(w, ids, target));
    }),
  );

  server.registerTool(
    "verify_setup",
    {
      description: "Re-runs every check of the setup flows used here (steps and final checks) and reports what passes. Nothing secret is shown. Then syncs, so items whose checks now pass are applied.",
      inputSchema: z.object({ target: z.string().default("."), user: z.boolean().default(false), path: z.string().optional() }),
    },
    guarded(async ({ target, user, path }) => {
      const w = where(path, target, user);
      const data = await currentData(w, target);
      const approved = await approvals(10_000);
      const flows = closure(Object.keys(data.requires ?? {}), data, w.context, w.projectName);
      if (!flows.length) return "No setup flow is used here.";
      const lines: string[] = [];
      for (const flow of flows) {
        lines.push(`${flow.entry.name} (${flow.entry.ref} v${flow.entry.version}):`);
        for (const { step, done } of flow.steps) {
          if (!step.check) {
            lines.push(`  ${done ? "✓" : "·"} ${step.title}${done ? "" : " — not done"}`);
            continue;
          }
          const r = await runCheck(step.check, { target: w.checkoutRoot, checkout: w.root, flow: flow.id, approved });
          lines.push(`  ${r.ok ? "✓" : "✗"} ${step.title}: ${r.reason}`);
        }
        const v = await verifyFlow(flow, w.context, { target: w.checkoutRoot, checkout: w.root }, approved);
        for (const r of v.results) lines.push(`  ${r.result.ok ? "✓" : "✗"} final check — ${r.label}: ${r.result.reason}`);
      }
      const outcomes = w.root ? await syncCheckout(w.root, checkoutFor(w.root)!.checkout, { approved }) : [await syncUser({ approved })].filter((o) => o !== null);
      return `${lines.join("\n")}\n${summarize(outcomes)}`;
    }),
  );

  server.registerTool(
    "complete_claude_step",
    {
      description: "Marks a setup step meant for Claude as done, after carrying it out. Its check (if any) must pass first.",
      inputSchema: z.object({ flow: z.string(), step: z.string(), target: z.string().default("."), user: z.boolean().default(false), path: z.string().optional() }),
    },
    guarded(async ({ flow: flowId, step: stepId, target, user, path }) => {
      const w = where(path, target, user);
      const data = await currentData(w, target);
      const flow = closure(Object.keys(data.requires ?? {}), data, w.context, w.projectName).find((f) => f.id === flowId || f.entry.ref === flowId);
      const step = flow?.spec.steps.find((s) => s.id === stepId);
      if (!flow || !step) throw new Error(`No step ${stepId} in a flow ${flowId} used here (setup_status lists them).`);
      if (step.type !== "claude") throw new Error(`"${step.title}" is for a person, in the wizard (start_setup).`);
      if (step.check) {
        const r = await runCheck(step.check, { target: w.checkoutRoot, checkout: w.root, flow: flow.id, approved: await approvals(10_000) });
        if (!r.ok) return `Not done yet: ${r.reason}.`;
      }
      await recordStep(w.context, flow.id, step.id, step.scope, flow.entry.version);
      return `Recorded "${step.title}" as done for ${SCOPE_LABEL[step.scope]}.`;
    }),
  );

  const stepInput = z.object({
    id: z.string().optional().describe("lowercase-with-dashes; derived from the title when omitted"),
    title: z.string().min(1).max(120),
    type: z.enum(["check", "input", "confirm", "secret", "claude"]).default("confirm"),
    scope: z.enum(SCOPES as unknown as [string, ...string[]]).default("project"),
    instructions: z.union([z.string(), z.record(z.string(), z.string())]).optional().describe("Markdown, or {\"*\": …, \"linux\": …, \"darwin\": …, \"windows\": …}"),
    check: z.record(z.string(), z.unknown()).optional(),
    params: z.array(z.string()).optional(),
    secret: z.record(z.string(), z.unknown()).optional(),
    rotate: z.boolean().optional(),
    prompt: z.string().optional(),
  });

  function buildSpec(input: { spec?: Record<string, unknown>; summary?: string; params?: unknown[]; requires?: unknown[]; steps?: z.infer<typeof stepInput>[]; verify?: unknown[] }): FlowSpec {
    if (input.spec) return input.spec as unknown as FlowSpec;
    const used = new Set<string>();
    const steps = (input.steps ?? []).map((s) => {
      let id = s.id ?? (s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "step");
      while (used.has(id)) id = `${id.slice(0, 37)}-${used.size}`;
      used.add(id);
      const { instructions, ...rest } = s;
      return { ...rest, id, ...(instructions === undefined ? {} : { instructions: typeof instructions === "string" ? { "*": instructions } : instructions }) };
    });
    return { schema: 1, summary: input.summary, params: input.params as FlowSpec["params"], requires: input.requires as FlowSpec["requires"], steps: steps as unknown as Step[], verify: input.verify as FlowSpec["verify"] };
  }

  server.registerTool(
    "create_flow",
    {
      description:
        "Creates a setup flow in the catalogue: the prerequisites an item needs outside the repository, as steps for a person (check, input, confirm, secret) and for Claude (claude), with checks and final verify checks. " +
        "Pass a whole spec (docs: setup-flows.md schema 1), or summary/params/steps/verify and the tool fills ids and defaults. Saved as a draft unless publish=true. Follow the setup-flow-authoring skill.",
      inputSchema: z.object({
        slug: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}$/),
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        tags: z.array(z.string()).default([]),
        workspace: z.string().optional(),
        spec: z.record(z.string(), z.unknown()).optional(),
        summary: z.string().max(500).optional(),
        params: z.array(z.record(z.string(), z.unknown())).optional(),
        requires: z.array(z.object({ flow: z.string(), params: z.record(z.string(), z.union([z.string(), z.boolean()])).optional() })).optional(),
        steps: z.array(stepInput).optional(),
        verify: z.array(z.record(z.string(), z.unknown())).optional(),
        publish: z.boolean().default(false),
      }),
    },
    guarded(async (input) => {
      const spec = buildSpec(input);
      assertValidSpec(spec);
      const id = await createFlowItem({ workspace: input.workspace, slug: input.slug, name: input.name, description: input.description, tags: input.tags });
      const saved = await addFlowVersion(id, spec, { publish: input.publish, changelog: "First version" });
      return `Created the setup flow ${input.name} (${id}), version ${saved.version} ${saved.published ? "published" : "saved as a draft (publish_flow publishes it)"}. ` +
        `Attach it to an item with attach_flow. ${config.web}/catalog/${id}`;
    }),
  );

  server.registerTool(
    "update_flow",
    {
      description: "Adds a version to a setup flow, from a whole spec or from summary/params/steps/verify. Saved as a draft unless publish=true.",
      inputSchema: z.object({
        flow: z.string(),
        spec: z.record(z.string(), z.unknown()).optional(),
        summary: z.string().max(500).optional(),
        params: z.array(z.record(z.string(), z.unknown())).optional(),
        requires: z.array(z.object({ flow: z.string(), params: z.record(z.string(), z.union([z.string(), z.boolean()])).optional() })).optional(),
        steps: z.array(stepInput).optional(),
        verify: z.array(z.record(z.string(), z.unknown())).optional(),
        changelog: z.string().max(500).optional(),
        publish: z.boolean().default(false),
      }),
    },
    guarded(async (input) => {
      const spec = buildSpec(input);
      assertValidSpec(spec);
      const saved = await addFlowVersion(input.flow, spec, { publish: input.publish, changelog: input.changelog });
      return `Version ${saved.version} of ${input.flow} ${saved.published ? "published" : "saved as a draft"}.`;
    }),
  );

  server.registerTool(
    "attach_flow",
    {
      description: "Makes an item require a setup flow (a new version of the item with one more `requires` entry), with bindings for the flow's parameters.",
      inputSchema: z.object({
        item: z.string(),
        flow: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}).describe("Values this item fixes (or suggests, for editable parameters)"),
        changelog: z.string().max(500).optional(),
        publish: z.boolean().default(true),
      }),
    },
    guarded(async ({ item, flow, params, changelog, publish }) => {
      const saved = await attachFlow(item, flow, params, { publish, changelog });
      return `${item} version ${saved.version} now requires ${flow}${saved.published ? "" : " (draft)"}.`;
    }),
  );

  server.registerTool(
    "publish_flow",
    {
      description: "Publishes a draft version of a setup flow, so items requiring it start using it.",
      inputSchema: z.object({ flow: z.string(), version: z.number().int().positive() }),
    },
    guarded(async ({ flow, version }) => {
      await send("POST", `/v1/catalog/items/${encodeURIComponent(flow)}/versions/${version}/publish`);
      return `Published version ${version} of ${flow}.`;
    }),
  );
}
