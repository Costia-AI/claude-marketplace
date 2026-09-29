import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { get, send } from "../../api/client.ts";
import { config } from "../../config.ts";
import { checkoutFor, targetPath } from "../../state/checkouts.ts";
import { approve } from "../../state/trust.ts";
import { approvals, syncCheckout, syncUser, type TargetOutcome } from "../../sync/runner.ts";
import { summarize } from "../../sync/summary.ts";

export { summarize };
import { resolveConflict } from "../../sync/resolve.ts";
import { sectionHash } from "../../sync/agents-md.ts";
import { guarded, workdir } from "../server.ts";

/** This checkout's targets plus the user destination (~/.claude), when there is one. */
async function withUser(outcomes: TargetOutcome[], options: { dryRun?: boolean; approved?: Set<string>; autoVerify?: boolean }): Promise<TargetOutcome[]> {
  const user = await syncUser(options);
  return user ? [...outcomes, user] : outcomes;
}

function requireCheckout(path?: string) {
  const found = checkoutFor(workdir(path));
  if (!found) throw new Error("This folder is not linked to a Costia project on this machine (adopt_checkout links it).");
  return found;
}

export function registerTools(server: McpServer, _: unknown): void {
  server.registerTool(
    "sync_status",
    {
      description: "What a sync would change in this checkout, without writing anything: updates, sensitive changes waiting for approval, conflicts, local edits.",
      inputSchema: z.object({ path: z.string().optional() }),
    },
    guarded(async ({ path }) => {
      const { root, checkout } = requireCheckout(path);
      return summarize(await withUser(await syncCheckout(root, checkout, { dryRun: true }), { dryRun: true }));
    }),
  );

  server.registerTool(
    "sync_apply",
    {
      description:
        "Applies the project's Claude setup to this checkout, and the user's own items to ~/.claude: everything that needs no approval and whose setup is done. " +
        "Sensitive changes stay pending for sync_review; items with incomplete setup stay held (setup_status).",
      inputSchema: z.object({ path: z.string().optional() }),
    },
    guarded(async ({ path }) => {
      const { root, checkout } = requireCheckout(path);
      return summarize(await withUser(await syncCheckout(root, checkout, { autoVerify: true }), { autoVerify: true }));
    }),
  );

  server.registerTool(
    "sync_review",
    {
      description:
        "Shows the user each pending sensitive change (hooks, permissions, local MCP servers, scripts, marketplace plugins) and applies the ones they approve. " +
        "The user answers directly; the model cannot approve on their behalf.",
      inputSchema: z.object({ path: z.string().optional() }),
    },
    guarded(async ({ path }, ctx) => {
      const { root, checkout } = requireCheckout(path);
      const dry = await withUser(await syncCheckout(root, checkout, { dryRun: true }), { dryRun: true });
      const pending = dry.flatMap((o) => (o.report?.pending ?? []).map((p) => ({ ...p, target: o.target })));
      if (!pending.length) return "Nothing waits for approval.";

      const accepted: { approval: string; what: string }[] = [];
      for (const item of pending) {
        const answer = await ctx.mcpReq.elicitInput({
          mode: "form",
          message:
            (item.kind === "check" ? `A Costia setup flow wants to run a program on this machine: ${item.key}` : `Costia wants to write ${item.kind === "file" ? "the file" : "the entry"} ${item.key}`) +
            `${item.target === "." ? "" : item.target === "~" ? " in ~/.claude" : ` in ${item.target}`} — ${item.reason}.\n\n${item.preview}`,
          requestedSchema: {
            type: "object",
            properties: { approve: { type: "boolean", title: "Allow this exact content on this machine" } },
            required: ["approve"],
          },
        });
        if (answer.action === "cancel") break;
        if (answer.action === "accept" && answer.content?.approve === true) accepted.push({ approval: item.approval, what: `${item.target}:${item.key}` });
      }
      if (!accepted.length) return `Nothing approved; ${pending.length} change(s) still pending. They can also be approved for this device at ${config.web}/approvals.`;
      approve(accepted);
      const approved = await approvals(10_000);
      const outcomes = await withUser(await syncCheckout(root, checkout, { approved, autoVerify: true }), { approved, autoVerify: true });
      return `Approved ${accepted.length} of ${pending.length}.\n${summarize(outcomes)}`;
    }),
  );

  server.registerTool(
    "resolve_conflict",
    {
      description:
        "Resolves a conflict or a local edit reported by a sync. take_remote replaces the local version with the shared one on the next sync; " +
        "keep_local makes the file, entry or section this repository's own so Costia stops managing it here.",
      inputSchema: z.object({
        item: z.string().describe('As reported: a path, ".claude/settings.json <key>", ".mcp.json <key>" or "AGENTS.md section <id>"'),
        choice: z.enum(["take_remote", "keep_local"]),
        target: z.string().default(".").describe("The target folder the item belongs to"),
        path: z.string().optional(),
      }),
    },
    guarded(async ({ item, choice, target, path }) => {
      const { root, checkout } = requireCheckout(path);
      if (!checkout.targets.includes(target)) throw new Error(`${target} is not a target of this checkout (${checkout.targets.join(", ")})`);
      const message = resolveConflict(targetPath(root, target), { project: checkout.projectId, target }, item, choice);
      if (choice === "keep_local") return message;
      return `${message}\n${summarize(await syncCheckout(root, checkout))}`;
    }),
  );

  server.registerTool(
    "list_sections",
    {
      description: "Managed AGENTS.md sections in use by this project (or all sections the user can edit, with all=true).",
      inputSchema: z.object({ all: z.boolean().default(false), path: z.string().optional() }),
    },
    guarded(async ({ all, path }) => {
      const query = all ? "/v1/catalog/items?kind=AGENTS_SECTION&editable=true" : `/v1/projects/${requireCheckout(path).checkout.projectId}/sections`;
      const { items } = await get<{ items: { id: string; slug: string; name: string; version: number; workspace: string; usages?: number }[] }>(query);
      if (!items.length) return "No managed sections.";
      return items.map((s) => `- ${s.name} — ${s.workspace}/${s.slug} v${s.version}${s.usages !== undefined ? `, used by ${s.usages} project(s)` : ""} (${s.id})`).join("\n");
    }),
  );

  server.registerTool(
    "edit_section",
    {
      description:
        "Publishes a new version of a managed AGENTS.md section. It reaches every repository using the section on its next session start. " +
        "Write the full new Markdown of the section, heading included. For a rule that only applies to this repository, edit AGENTS.md outside the managed blocks instead.",
      inputSchema: z.object({
        section: z.string().describe("Section id (workspace/slug) or catalogue item id"),
        content: z.string().min(1).max(50_000),
        message: z.string().max(500).optional().describe("What changed and why, shown in the section's history"),
      }),
    },
    guarded(async ({ section, content, message }) => {
      const saved = await send<{ version: number; usages: number }>("PUT", `/v1/sections/${encodeURIComponent(section)}`, {
        content,
        sha256: sectionHash(content),
        changelog: message,
      });
      const here = checkoutFor(workdir());
      const local = here ? `\n${summarize(await syncCheckout(here.root, here.checkout))}` : "";
      return `Published version ${saved.version}; ${saved.usages} project(s) use it.${local}`;
    }),
  );

  server.registerTool(
    "detach_section",
    {
      description: "Makes a managed section this repository's own: the text stays in AGENTS.md without markers and the project stops receiving updates to it.",
      inputSchema: z.object({ section: z.string(), target: z.string().default("."), path: z.string().optional() }),
    },
    guarded(async ({ section, target, path }) => {
      const { root, checkout } = requireCheckout(path);
      await send("POST", `/v1/projects/${checkout.projectId}/config/selection`, { target, remove: [section] });
      return resolveConflict(targetPath(root, target), { project: checkout.projectId, target }, `AGENTS.md section ${section}`, "keep_local");
    }),
  );
}
