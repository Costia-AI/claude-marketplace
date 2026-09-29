import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { get, send } from "../../api/client.ts";
import { config } from "../../config.ts";
import { checkoutFor, registerCheckout, targetPath } from "../../state/checkouts.ts";
import { syncCheckout } from "../../sync/runner.ts";
import { guarded, workdir } from "../server.ts";
import { personalWorkspace } from "./projects.ts";
import { summarize } from "../../sync/summary.ts";
import { itemPath } from "../../setup/catalog.ts";

const KINDS = ["SKILL", "SUBAGENT", "COMMAND", "HOOK", "MCP_SERVER", "PLUGIN_REF", "AGENTS_SECTION", "SETTINGS_FRAGMENT", "OUTPUT_STYLE", "SETUP_FLOW"] as const;

interface Item {
  id: string;
  slug: string;
  name: string;
  kind: (typeof KINDS)[number];
  description?: string;
  tags: string[];
  workspace: string;
  version?: number;
  sensitive?: boolean;
  selected?: boolean;
}

function line(item: Item): string {
  return `- [${item.kind}] ${item.name} — ${item.description ?? ""} {${item.tags.join(", ")}} ${item.workspace}/${item.slug}${item.version ? ` v${item.version}` : ""}${item.sensitive ? " ⚠ needs approval" : ""}${item.selected ? " ✓ selected" : ""} (${item.id})`;
}

/** Stack signals in a folder, as suggested tags. */
function detectStack(dir: string): string[] {
  const tags = new Set<string>();
  const has = (...names: string[]) => names.some((n) => existsSync(join(dir, n)));
  const read = (name: string) => {
    try {
      return readFileSync(join(dir, name), "utf8");
    } catch {
      return "";
    }
  };
  if (has("build.gradle.kts", "build.gradle", "pom.xml")) tags.add("java").add("backend");
  if (/spring-boot|org\.springframework/.test(read("build.gradle.kts") + read("build.gradle") + read("pom.xml"))) tags.add("spring");
  if (has("settings.gradle.kts") && has("app/src/main/AndroidManifest.xml")) tags.add("android").add("mobile");
  if (has("package.json")) {
    const pkg = read("package.json");
    tags.add("typescript");
    if (/"next"/.test(pkg)) tags.add("nextjs").add("web").add("frontend");
    if (/"react"/.test(pkg)) tags.add("react");
    if (/"expo"/.test(pkg)) tags.add("expo").add("mobile").add("react-native");
    if (/"react-native"/.test(pkg)) tags.add("react-native").add("mobile");
    if (/"astro"/.test(pkg)) tags.add("astro").add("web");
    if (/"@tauri-apps/.test(pkg)) tags.add("tauri").add("desktop");
  }
  if (has("ios", "Podfile") || readdirSafe(dir).some((n) => n.endsWith(".xcodeproj"))) tags.add("ios").add("mobile");
  if (has("android")) tags.add("android").add("mobile");
  if (has("pubspec.yaml")) tags.add("flutter").add("mobile");
  if (has("Cargo.toml")) tags.add("rust");
  if (has("go.mod")) tags.add("go");
  if (has("pyproject.toml", "requirements.txt")) tags.add("python");
  if (has("Chart.yaml", "charts", "kustomization.yaml")) tags.add("kubernetes").add("infra");
  if (has(".gitlab-ci.yml")) tags.add("gitlab");
  if (has(".github")) tags.add("github");
  return [...tags].sort();
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Reads a local skill folder or single Markdown file as a bundle, refusing anything outside the project or secret-looking. */
function readBundle(source: string, projectDir: string): { kind: (typeof KINDS)[number]; slug: string; files: Record<string, string> } {
  const rel = relative(projectDir, source);
  if (rel.startsWith("..") || rel === "") throw new Error("publish_item only reads files inside the project folder");
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error("refusing to publish a symlink");
  const parts = rel.split(sep);
  const files: Record<string, string> = {};
  let total = 0;
  const add = (full: string, name: string) => {
    if (/(^|\/)(\.env|.*\.pem|.*\.key|id_rsa.*|credentials.*)$/i.test(name)) throw new Error(`refusing to publish ${name}: looks like a secret`);
    const content = readFileSync(full);
    if (content.length > 1024 * 1024) throw new Error(`${name} is larger than 1 MB`);
    total += content.length;
    if (total > 5 * 1024 * 1024) throw new Error("bundle larger than 5 MB");
    files[name] = content.toString("base64");
  };

  if (stat.isDirectory()) {
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".git" || name === ".DS_Store") continue;
        const full = join(dir, name);
        const s = lstatSync(full);
        if (s.isSymbolicLink()) continue;
        if (s.isDirectory()) walk(full);
        else if (s.isFile()) add(full, relative(source, full).split(sep).join("/"));
        if (Object.keys(files).length > 100) throw new Error("more than 100 files");
      }
    };
    walk(source);
    if (!files["SKILL.md"]) throw new Error("a skill folder needs a SKILL.md");
    return { kind: "SKILL", slug: basename(source), files };
  }

  const kind = parts.includes("agents") ? "SUBAGENT" : parts.includes("commands") ? "COMMAND" : parts.includes("output-styles") ? "OUTPUT_STYLE" : null;
  if (!kind) throw new Error("publish a skill folder, or a Markdown file from .claude/agents, .claude/commands or .claude/output-styles");
  add(source, basename(source));
  return { kind, slug: basename(source, ".md"), files };
}

export function registerTools(server: McpServer, _: unknown): void {
  server.registerTool(
    "list_tags",
    { description: "Tags available to classify catalogue items (mobile, ios, spring…).", inputSchema: z.object({}) },
    guarded(async () => {
      const { tags } = await get<{ tags: { slug: string; label: string; category: string; count?: number }[] }>("/v1/tags");
      const byCategory = new Map<string, string[]>();
      for (const t of tags) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), `${t.slug}${t.count ? ` (${t.count})` : ""}`]);
      return [...byCategory].map(([c, list]) => `${c}: ${list.join(", ")}`).join("\n");
    }),
  );

  server.registerTool(
    "detect_stack",
    { description: "Suggests tags for a folder from the files in it (build files, package.json, mobile projects…).", inputSchema: z.object({ path: z.string().optional() }) },
    guarded(async ({ path }) => {
      const tags = detectStack(workdir(path));
      return tags.length ? `Suggested tags: ${tags.join(", ")}` : "No stack detected; ask the user which tags apply.";
    }),
  );

  server.registerTool(
    "search_catalog",
    {
      description: "Searches the catalogue visible to the user (own, workspace and public items) by text, tags and kind.",
      inputSchema: z.object({
        query: z.string().optional(),
        tags: z.array(z.string()).optional().describe("Items with any of these tags"),
        kind: z.enum(KINDS).optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }),
    },
    guarded(async ({ query, tags, kind, limit }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) params.set("q", query);
      if (kind) params.set("kind", kind);
      for (const t of tags ?? []) params.append("tag", t);
      const { items } = await get<{ items: Item[] }>(`/v1/catalog/items?${params}`);
      return items.length ? items.map(line).join("\n") : "Nothing matches.";
    }),
  );

  server.registerTool(
    "get_item",
    { description: "A catalogue item with its latest version's files or content.", inputSchema: z.object({ item: z.string() }) },
    guarded(async ({ item }) => {
      const detail = await get<{ item: Item; files?: { path: string; size: number }[]; payload?: { content?: string } | null; changelog?: string }>(itemPath(item));
      const i = detail.item;
      return [line(i), detail.changelog ? `Latest change: ${detail.changelog}` : "", detail.payload?.content ?? "", ...(detail.files ?? []).map((f) => `  ${f.path} (${f.size} bytes)`), `${config.web}/catalog/${i.id}`]
        .filter(Boolean)
        .join("\n");
    }),
  );

  server.registerTool(
    "init_plan",
    {
      description:
        "What the catalogue offers a target of this project for the given tags, grouped by kind (AGENTS.md sections, skills, plugins, MCP servers, subagents, commands, hooks), with what is already selected. " +
        "Used by /costia:init to let the user choose.",
      inputSchema: z.object({ tags: z.array(z.string()).min(1), target: z.string().default("."), path: z.string().optional() }),
    },
    guarded(async ({ tags, target, path }) => {
      const found = checkoutFor(workdir(path));
      if (!found) throw new Error("Link this folder to a project first (create_project or adopt_checkout).");
      const plan = await send<{ groups: { kind: string; items: Item[] }[] }>("POST", `/v1/projects/${found.checkout.projectId}/init-plan`, { target, tags });
      if (!plan.groups.length) return `Nothing in the catalogue is tagged ${tags.join(", ")}. Items are added on the web (${config.web}/catalog/new) or with publish_item.`;
      return plan.groups.map((g) => `${g.kind}\n${g.items.map(line).join("\n")}`).join("\n\n");
    }),
  );

  server.registerTool(
    "set_selection",
    {
      description:
        "Changes which catalogue items a target of this project uses, and records its tags. Items are pinned to their current version unless floating=true. " +
        "Then syncs this checkout; sensitive items wait for sync_review.",
      inputSchema: z.object({
        target: z.string().default("."),
        add: z.array(z.string()).default([]),
        remove: z.array(z.string()).default([]),
        tags: z.array(z.string()).optional(),
        floating: z.boolean().default(true).describe("Follow new published versions automatically"),
        destination: z.enum(["repo", "private"]).default("repo").describe("repo: committed for everyone; private: only for you, excluded from git (install_item also offers user, your ~/.claude)"),
        path: z.string().optional(),
      }),
    },
    guarded(async ({ target, add, remove, tags, floating, destination, path }) => {
      const found = checkoutFor(workdir(path));
      if (!found) throw new Error("Link this folder to a project first (create_project or adopt_checkout).");
      const saved = await send<{ version: number }>("POST", `/v1/projects/${found.checkout.projectId}/config/selection`, { target, add, remove, tags, floating, destination });
      if (!found.checkout.targets.includes(target) && existsSync(targetPath(found.root, target))) {
        found.checkout.targets.push(target);
        registerCheckout(found.root, found.checkout);
      }
      return `Config version ${saved.version} saved.\n${summarize(await syncCheckout(found.root, found.checkout, { autoVerify: true }))}`;
    }),
  );

  server.registerTool(
    "publish_item",
    {
      description:
        "Publishes a local skill folder, subagent, command or output style from this project to the user's catalogue (a new item, or a new version of an existing one), with tags.",
      inputSchema: z.object({
        source: z.string().describe("Path of a skill folder or a .md file under .claude/agents, .claude/commands or .claude/output-styles"),
        tags: z.array(z.string()).default([]),
        item: z.string().optional().describe("Existing item id to publish a new version of"),
        workspace: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        changelog: z.string().optional(),
      }),
    },
    guarded(async ({ source, tags, item, workspace, name, description, changelog }) => {
      const projectDir = workdir();
      const bundle = readBundle(workdir(source), projectDir);
      let id = item;
      if (!id) {
        const ws = workspace ?? (await personalWorkspace());
        const created = await send<{ id: string }>("POST", `/v1/workspaces/${encodeURIComponent(ws)}/catalog/items`, {
          kind: bundle.kind,
          slug: bundle.slug,
          name: name ?? bundle.slug,
          description,
          tags,
        });
        id = created.id;
      }
      const version = await send<{ version: number; sensitive: boolean }>("POST", `/v1/catalog/items/${id}/versions`, {
        files: bundle.files,
        changelog,
        publish: true,
      });
      return `Published ${bundle.kind} ${bundle.slug} v${version.version} (${id})${version.sensitive ? "; it will need each user's approval where it is installed" : ""}.`;
    }),
  );
}
