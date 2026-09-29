import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { existsSync } from "node:fs";
import { get, send } from "../../api/client.ts";
import { config } from "../../config.ts";
import { readCredentials } from "../../auth/credentials.ts";
import { getDevice } from "../../state/device.ts";
import { checkoutFor, registerCheckout, targetPath } from "../../state/checkouts.ts";
import { captureLayout } from "../../layout/capture.ts";
import { describePlan, materializeLayout, planLayout } from "../../layout/materialize.ts";
import { layoutSpec, type LayoutSpec } from "../../layout/spec.ts";
import { syncCheckout } from "../../sync/runner.ts";
import { guarded, workdir } from "../server.ts";
import { summarize } from "../../sync/summary.ts";

interface Me {
  account: { uuid: string; email?: string; displayName?: string };
  premium: { active: boolean; validUntil?: string };
  workspaces: { id: string; slug: string; name: string; kind: "PERSONAL" | "ORG"; role: string; state: string }[];
}

interface Project {
  id: string;
  name: string;
  slug: string;
  workspace: { id: string; name: string; state: string };
  description?: string;
  layout?: { version: number; spec: LayoutSpec };
  role?: string;
}

export async function findProject(ref: string): Promise<Project> {
  return get<Project>(`/v1/projects/${encodeURIComponent(ref)}`);
}

import { personalWorkspace } from "../../setup/catalog.ts";

export { personalWorkspace };

/** Registers a folder on this machine as a checkout of a project and syncs it. */
async function adopt(project: Project, root: string): Promise<string> {
  const device = getDevice();
  const spec = project.layout?.spec;
  const targets = (spec?.claudeRoots ?? ["."]).filter((t) => t === "." || existsSync(targetPath(root, t)));
  const checkout = await send<{ id: string }>("POST", "/v1/checkouts", {
    projectId: project.id,
    device: device.machineUuid,
    label: `${device.label}:${root.split("/").slice(-1)[0]}`,
    targets,
  });
  const key = registerCheckout(root, { projectId: project.id, checkoutId: checkout.id, projectName: project.name, targets });
  const outcomes = await syncCheckout(key, { projectId: project.id, checkoutId: checkout.id, projectName: project.name, targets });
  return `${root} is now a checkout of "${project.name}" (targets: ${targets.join(", ")}).\n${summarize(outcomes)}`;
}

export function registerTools(server: McpServer, _: unknown): void {
  server.registerTool(
    "whoami",
    { description: "The signed-in Costia account, its Premium state and its workspaces.", inputSchema: z.object({}) },
    guarded(async () => {
      const me = await get<Me>("/v1/me");
      const device = getDevice();
      return [
        `Signed in as ${me.account.email ?? me.account.uuid} on device "${device.label}".`,
        `Costia Premium: ${me.premium.active ? `active${me.premium.validUntil ? ` until ${me.premium.validUntil}` : ""}` : "not active (organisations and invitations need it)"}.`,
        "Workspaces:",
        ...me.workspaces.map((w) => `- ${w.name} (${w.kind.toLowerCase()}, ${w.role}${w.state !== "ACTIVE" ? `, ${w.state.toLowerCase()}` : ""}) — ${w.slug}`),
        `Web: ${config.web}`,
      ].join("\n");
    }),
  );

  server.registerTool(
    "where_am_i",
    {
      description: "Which Costia project and checkout the current folder belongs to, and its targets (folders whose .claude and AGENTS.md Costia manages).",
      inputSchema: z.object({ path: z.string().optional().describe("Folder to look at; defaults to the project folder") }),
    },
    guarded(async ({ path }) => {
      const cwd = workdir(path);
      const found = checkoutFor(cwd);
      if (!found) {
        return `${cwd} is not linked to a Costia project on this machine. Use adopt_checkout to link it to an existing project, or create_project to make one.${readCredentials() ? "" : " (Not signed in yet.)"}`;
      }
      const project = await findProject(found.checkout.projectId);
      return [
        `Project "${project.name}" (${project.id}) in workspace "${project.workspace.name}"${project.workspace.state !== "ACTIVE" ? ` — ${project.workspace.state.toLowerCase()}` : ""}.`,
        `Checkout root: ${found.root}`,
        `Targets: ${found.checkout.targets.join(", ")}`,
        `Web: ${config.web}/p/${project.id}`,
      ].join("\n");
    }),
  );

  server.registerTool(
    "list_projects",
    { description: "Projects visible to the user, across all workspaces.", inputSchema: z.object({ workspace: z.string().optional() }) },
    guarded(async ({ workspace }) => {
      const { projects } = await get<{ projects: Project[] }>(workspace ? `/v1/workspaces/${encodeURIComponent(workspace)}/projects` : "/v1/projects");
      if (!projects.length) return "No projects yet. create_project makes one from the current folder.";
      return projects.map((p) => `- ${p.name} (${p.slug}, ${p.id}) — ${p.workspace.name}${p.role ? `, ${p.role}` : ""}`).join("\n");
    }),
  );

  server.registerTool(
    "get_project",
    { description: "A project's details and its current layout spec.", inputSchema: z.object({ project: z.string().describe("Project id or slug") }) },
    guarded(async ({ project }) => {
      const p = await findProject(project);
      return [`${p.name} (${p.id}) in ${p.workspace.name}`, p.description ?? "", p.layout ? `Layout v${p.layout.version}:\n${JSON.stringify(p.layout.spec, null, 2)}` : "No layout saved yet."]
        .filter(Boolean)
        .join("\n");
    }),
  );

  server.registerTool(
    "create_project",
    {
      description: "Creates a Costia project. With capture=true (default) the current folder's layout is captured and saved as its first layout, and the folder becomes its checkout.",
      inputSchema: z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        workspace: z.string().optional().describe("Workspace id or slug; defaults to the personal workspace"),
        capture: z.boolean().default(true),
        path: z.string().optional(),
      }),
    },
    guarded(async ({ name, description, workspace, capture, path }) => {
      const ws = workspace ?? (await personalWorkspace());
      const created = await send<Project>("POST", `/v1/workspaces/${encodeURIComponent(ws)}/projects`, { name, description });
      if (!capture) return `Created "${created.name}" (${created.id}).`;
      const root = workdir(path);
      const { spec, notes } = captureLayout(root);
      await send("PUT", `/v1/projects/${created.id}/layout`, { spec });
      const adopted = await adopt({ ...created, layout: { version: 1, spec } }, root);
      return [`Created "${created.name}" (${created.id}) with this layout:`, JSON.stringify(spec, null, 2), ...notes, adopted].join("\n");
    }),
  );

  server.registerTool(
    "capture_layout",
    {
      description: "Proposes a layout spec for a folder as it is on disk: its repository, child repositories and symlinks to other repositories. Nothing is saved.",
      inputSchema: z.object({ path: z.string().optional() }),
    },
    guarded(async ({ path }) => {
      const { spec, notes } = captureLayout(workdir(path));
      return [JSON.stringify(spec, null, 2), ...notes, "Review it with the user, adjust it if needed, then save_layout."].join("\n");
    }),
  );

  server.registerTool(
    "save_layout",
    {
      description: "Saves a new version of a project's layout spec (schema 1: root, entries of kind git/symlink/dir, claudeRoots).",
      inputSchema: z.object({ project: z.string(), spec: z.string().describe("The layout spec as JSON") }),
    },
    guarded(async ({ project, spec }) => {
      const parsed = layoutSpec.parse(JSON.parse(spec));
      const saved = await send<{ version: number }>("PUT", `/v1/projects/${encodeURIComponent(project)}/layout`, { spec: parsed });
      return `Saved layout version ${saved.version}.`;
    }),
  );

  server.registerTool(
    "clone_project",
    {
      description:
        "Materialises a project in a folder: clones its repositories, creates its folders and symlinks as its layout says, links the folder as a checkout and applies its Claude setup. " +
        "The plan is shown to the user and must be confirmed.",
      inputSchema: z.object({ project: z.string(), directory: z.string().describe("Destination folder, absolute or relative to the project folder") }),
    },
    guarded(async ({ project, directory }, ctx) => {
      const p = await findProject(project);
      if (!p.layout) return `"${p.name}" has no layout yet: save one first (capture_layout in a folder where it is checked out).`;
      const destination = workdir(directory);
      const steps = planLayout(p.layout.spec, destination);
      const plan = describePlan(steps);
      const answer = await ctx.mcpReq.elicitInput({
        mode: "form",
        message: `Materialise "${p.name}" in ${destination}?\n\n${plan}`,
        requestedSchema: { type: "object", properties: { confirm: { type: "boolean", title: "Clone and link as shown" } }, required: ["confirm"] },
      });
      if (answer.action !== "accept" || !answer.content?.confirm) return `Nothing was done. The plan was:\n${plan}`;
      const result = materializeLayout(steps, destination);
      const lines = [`Done: ${result.done.join(", ") || "nothing"}.`];
      if (result.skipped.length) lines.push(`Skipped:\n${result.skipped.map((s) => `- ${s}`).join("\n")}`);
      if (result.failed.length) lines.push(`Failed:\n${result.failed.map((f) => `- ${f.path}: ${f.error}`).join("\n")}`);
      if (!result.failed.some((f) => f.path === ".")) lines.push(await adopt(p, destination));
      return lines.join("\n");
    }),
  );

  server.registerTool(
    "adopt_checkout",
    {
      description: "Links an existing folder on this machine to a Costia project as a checkout, then applies the project's Claude setup to it.",
      inputSchema: z.object({ project: z.string(), path: z.string().optional() }),
    },
    guarded(async ({ project, path }) => adopt(await findProject(project), workdir(path))),
  );

  server.registerTool(
    "list_devices",
    { description: "This account's devices, marking this one.", inputSchema: z.object({}) },
    guarded(async () => {
      const { devices } = await get<{ devices: { id: string; machineUuid: string; label: string; os?: string; lastSeenAt?: string; revokedAt?: string }[] }>("/v1/devices");
      const mine = getDevice().machineUuid;
      return devices
        .map((d) => `- ${d.label}${d.machineUuid === mine ? " (this device)" : ""} ${d.os ?? ""}${d.revokedAt ? " — revoked" : ""}${d.lastSeenAt ? `, last seen ${d.lastSeenAt}` : ""}`)
        .join("\n");
    }),
  );

}
