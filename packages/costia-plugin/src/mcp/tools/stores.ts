import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { get, send } from "../../api/client.ts";
import { config } from "../../config.ts";
import { itemDetail, personalWorkspace } from "../../setup/catalog.ts";
import { guarded } from "../server.ts";

/** Stores and the marketplace (docs/marketplace.md). */

interface StoreItem {
  id: string;
  slug: string;
  name: string;
  kind: string;
  description?: string;
  tags?: string[];
  workspace?: string;
  listed?: boolean;
}

interface Store {
  id: string;
  slug: string;
  name: string;
  tagline?: string;
  visibility: "PRIVATE" | "SHARED" | "PUBLIC";
  workspace?: string | { slug: string; name?: string };
  items?: StoreItem[];
  itemCount?: number;
}

const wsSlug = (s: Store) => (typeof s.workspace === "string" ? s.workspace : s.workspace?.slug ?? "?");

async function findStore(ref: string): Promise<Store> {
  if (/^[0-9a-f-]{36}$/i.test(ref)) return get<Store>(`/v1/stores/${ref}`);
  const [ws, slug] = ref.split("/");
  if (!ws || !slug) throw new Error('A store is an id or "workspace-slug/store-slug".');
  return get<Store>(`/v1/stores/by-slug/${encodeURIComponent(ws)}/${encodeURIComponent(slug)}`);
}

function itemLine(i: StoreItem): string {
  const ref = `${i.workspace ?? "?"}/${i.slug}`;
  return `- [${i.kind}] ${i.name} — ${i.description ?? ""}${i.tags?.length ? ` {${i.tags.join(", ")}}` : ""} → /costia:install ${ref} (${i.id})`;
}

export function registerTools(server: McpServer, _: unknown): void {
  server.registerTool(
    "search_marketplace",
    {
      description: "Searches the marketplace: public stores, stores shared with the user and their own, and the items listed in them.",
      inputSchema: z.object({ query: z.string().optional(), tag: z.string().optional(), kind: z.string().optional() }),
    },
    guarded(async ({ query, tag, kind }) => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (tag) params.set("tag", tag);
      if (kind) params.set("kind", kind);
      const found = await get<{ stores: Store[]; items: StoreItem[] }>(`/v1/marketplace?${params}`);
      const lines: string[] = [];
      if (found.stores?.length) {
        lines.push("Stores:");
        for (const s of found.stores) lines.push(`- ${s.name} (${wsSlug(s)}/${s.slug}, ${s.visibility.toLowerCase()})${s.tagline ? ` — ${s.tagline}` : ""} ${config.web}/s/${wsSlug(s)}/${s.slug}`);
      }
      if (found.items?.length) lines.push("Items:", ...found.items.map(itemLine));
      return lines.length ? lines.join("\n") : "Nothing in the marketplace matches.";
    }),
  );

  server.registerTool(
    "create_store",
    {
      description:
        "Creates a store: a list of catalogue items the user decides who sees — PRIVATE (the workspace), SHARED (people it is shared with, share_store) or PUBLIC (every signed-in person, listed in the marketplace).",
      inputSchema: z.object({
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
        name: z.string().min(1).max(80),
        tagline: z.string().max(160).optional(),
        description: z.string().max(5000).optional(),
        visibility: z.enum(["PRIVATE", "SHARED", "PUBLIC"]).default("PRIVATE"),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        workspace: z.string().optional(),
      }),
    },
    guarded(async ({ workspace, ...body }) => {
      const ws = workspace ?? (await personalWorkspace());
      const store = await send<Store>("POST", `/v1/workspaces/${encodeURIComponent(ws)}/stores`, body);
      return `Created the store ${store.name} (${store.id}), ${store.visibility.toLowerCase()}. Add items with add_to_store. ${config.web}/s/${wsSlug(store)}/${store.slug}`;
    }),
  );

  server.registerTool(
    "add_to_store",
    {
      description: "Adds catalogue items (\"workspace/slug\" or ids) to a store, after the ones it lists. The setup flows they require become visible with them.",
      inputSchema: z.object({ store: z.string(), items: z.array(z.string()).min(1) }),
    },
    guarded(async ({ store: ref, items }) => {
      const store = await findStore(ref);
      const current = (store.items ?? []).filter((i) => i.listed !== false).map((i) => i.id);
      const added: string[] = [];
      for (const item of items) {
        const detail = await itemDetail(item);
        if (!current.includes(detail.id)) {
          current.push(detail.id);
          added.push(detail.name);
        }
      }
      await send("PUT", `/v1/stores/${store.id}/items`, { items: current });
      return added.length ? `Added ${added.join(", ")} to ${store.name}; it lists ${current.length} item(s).` : `${store.name} already lists them.`;
    }),
  );

  server.registerTool(
    "share_store",
    {
      description:
        "Shares a store: with a person by Costia nickname, with anyone holding a link (link=true returns it once), or changes its visibility. Sharing makes a PRIVATE store SHARED.",
      inputSchema: z.object({
        store: z.string(),
        nick: z.string().optional(),
        link: z.boolean().default(false),
        visibility: z.enum(["PRIVATE", "SHARED", "PUBLIC"]).optional(),
      }),
    },
    guarded(async ({ store: ref, nick, link, visibility }) => {
      const store = await findStore(ref);
      const lines: string[] = [];
      const next = visibility ?? ((nick || link) && store.visibility === "PRIVATE" ? "SHARED" : undefined);
      if (next && next !== store.visibility) {
        await send("PATCH", `/v1/stores/${store.id}`, { visibility: next });
        lines.push(`${store.name} is now ${next.toLowerCase()}.`);
      }
      if (nick) {
        await send("POST", `/v1/stores/${store.id}/shares`, { nick });
        lines.push(`Shared with ${nick}.`);
      }
      if (link) {
        const created = await send<{ token: string; id?: string; url?: string }>("POST", `/v1/stores/${store.id}/links`, {});
        lines.push(`Share link (shown once; whoever opens it signed in gets access): ${created.url ?? `${config.web}/s/join/${created.token}`}`);
      }
      return lines.length ? lines.join("\n") : "Nothing to change.";
    }),
  );
}
