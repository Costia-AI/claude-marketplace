import { download, get, send, ApiError } from "../api/client.ts";
import type { SetupData } from "./resolver.ts";
import { validateSpec, type FlowSpec, type Scope } from "./spec.ts";
import type { Context } from "./state.ts";

/** Talking to the catalogue about flows: plans, drafts, new versions, attachments. */

interface Me {
  workspaces: { id: string; slug: string; name: string; kind: "PERSONAL" | "ORG" }[];
}

async function personal(): Promise<Me["workspaces"][number]> {
  const me = await get<Me>("/v1/me");
  const found = me.workspaces.find((w) => w.kind === "PERSONAL");
  if (!found) throw new Error("no personal workspace");
  return found;
}

export async function personalWorkspace(): Promise<string> {
  return (await personal()).id;
}

/** What these items need (docs/setup-flows.md, "State API"). */
export async function fetchPlan(context: Context, items: string[], target = "."): Promise<SetupData> {
  const query = new URLSearchParams({ items: items.join(",") });
  if ("project" in context) {
    query.set("target", target);
    return get<SetupData>(`/v1/projects/${context.project}/setup?${query}`);
  }
  return get<SetupData>(`/v1/me/setup?${query}`);
}

export interface ItemDetail {
  id: string;
  slug: string;
  name: string;
  kind: string;
  workspace: string;
  workspaceId?: string;
  description?: string;
  tags: string[];
  version?: number;
  /** Where the author suggests it lands; the installer decides. */
  defaultDestination?: "repo" | "private" | "user";
  payload?: Record<string, unknown> | null;
  files: { path: string; sha256: string; size: number; mode?: string }[];
}

/** `GET /v1/catalog/items/{ref}`, flattened: the item and its latest published version. */
export async function itemDetail(ref: string): Promise<ItemDetail> {
  const detail = await get<{ item?: Omit<ItemDetail, "files" | "payload">; files?: ItemDetail["files"]; payload?: ItemDetail["payload"] } & Partial<ItemDetail>>(
    `/v1/catalog/items/${encodeURIComponent(ref)}`,
  );
  const item = detail.item ?? (detail as unknown as ItemDetail);
  return { ...item, tags: item.tags ?? [], files: detail.files ?? [], payload: detail.payload ?? null };
}

/** Throws with every problem when a spec is invalid. */
export function assertValidSpec(spec: unknown): asserts spec is FlowSpec {
  const errors = validateSpec(spec);
  if (errors.length) throw new Error(`The flow is not valid:\n${errors.map((e) => `- ${e}`).join("\n")}`);
}

export async function createFlowItem(input: { workspace?: string; slug: string; name: string; description?: string; tags?: string[] }): Promise<string> {
  const ws = input.workspace ?? (await personalWorkspace());
  const created = await send<{ id: string }>("POST", `/v1/workspaces/${encodeURIComponent(ws)}/catalog/items`, {
    kind: "SETUP_FLOW",
    slug: input.slug,
    name: input.name,
    description: input.description,
    tags: input.tags ?? [],
  });
  return created.id;
}

export async function addFlowVersion(item: string, spec: FlowSpec, options: { publish: boolean; changelog?: string }): Promise<{ version: number; published: boolean }> {
  assertValidSpec(spec);
  return send("POST", `/v1/catalog/items/${encodeURIComponent(item)}/versions`, { payload: spec, publish: options.publish, changelog: options.changelog });
}

/** The path of a file inside its item, from its install path (docs/plugin-protocol.md). */
function insidePath(kind: string, slug: string, installPath: string): string {
  if (kind === "SKILL") return installPath.replace(new RegExp(`^\\.claude/skills/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "");
  if (kind === "HOOK") return installPath.replace(new RegExp(`^\\.claude/hooks/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "");
  return `${slug}.md`;
}

/**
 * A new version of an item that also requires `flow`: same files, same payload,
 * one more `requires` entry. Files are re-sent from their blobs byte for byte.
 */
export async function attachFlow(itemRef: string, flowRef: string, params: Record<string, string | boolean>, options: { publish: boolean; changelog?: string }): Promise<{ version: number; published: boolean }> {
  const item = await itemDetail(itemRef);
  const flow = await itemDetail(flowRef);
  if (flow.kind !== "SETUP_FLOW") throw new Error(`${flowRef} is a ${flow.kind}, not a setup flow`);
  const payload = { ...(item.payload ?? {}) } as Record<string, unknown>;
  const requires = ((payload.requires as { flow: string; params?: Record<string, unknown> }[] | undefined) ?? []).filter((r) => r.flow !== flow.id);
  requires.push({ flow: flow.id, ...(Object.keys(params).length ? { params } : {}) });
  payload.requires = requires;
  const files: Record<string, string> = {};
  const modes: Record<string, string> = {};
  for (const file of item.files) {
    const inside = insidePath(item.kind, item.slug, file.path);
    files[inside] = (await download(`/v1/blobs/${file.sha256}`)).toString("base64");
    if (file.mode === "0755") modes[inside] = "0755";
  }
  return send("POST", `/v1/catalog/items/${encodeURIComponent(item.id)}/versions`, {
    ...(Object.keys(files).length ? { files, modes } : {}),
    payload,
    publish: options.publish,
    changelog: options.changelog ?? `Requires the setup flow ${flow.workspace}/${flow.slug}`,
  });
}

/**
 * Saves a step someone added in the wizard as a draft version of the flow —
 * of theirs when they may edit it, else of a copy in their personal workspace.
 * Never published: the author decides that on the web.
 */
export async function saveDraftStep(flowRef: string, spec: FlowSpec, step: { title: string; instructions: string; scope: Scope }): Promise<string> {
  const taken = new Set(spec.steps.map((s) => s.id));
  let n = 1;
  while (taken.has(`custom-${n}`)) n += 1;
  const next: FlowSpec = {
    ...spec,
    steps: [...spec.steps, { id: `custom-${n}`, title: step.title.slice(0, 120), scope: step.scope, type: "confirm", instructions: { "*": step.instructions } }],
  };
  try {
    const saved = await addFlowVersion(flowRef, next, { publish: false, changelog: `Step added from the setup wizard: ${step.title}` });
    return `Saved as draft version ${saved.version} of the flow; publish it on the web to share it.`;
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 403 && error.status !== 404)) throw error;
  }
  const original = await itemDetail(flowRef);
  const slug = `${original.slug}-custom`.slice(0, 63);
  let copy: string;
  try {
    copy = await createFlowItem({ slug, name: `${original.name} (custom)`.slice(0, 120), description: `A copy of ${original.workspace}/${original.slug} with extra steps.`, tags: original.tags });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    copy = (await itemDetail(`${(await personal()).slug}/${slug}`)).id;
  }
  const saved = await addFlowVersion(copy, next, { publish: false, changelog: `Step added from the setup wizard: ${step.title}` });
  return `You cannot edit ${original.workspace}/${original.slug}, so the step went into your copy ${slug} (draft version ${saved.version}).`;
}
