import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { resolve } from "node:path";
import { VERSION, config } from "../config.ts";
import { ApiError } from "../api/client.ts";
import { NotSignedInError } from "../auth/credentials.ts";
import { loginInstructions, readPendingLogin } from "../auth/device-flow.ts";
import { registerTools as registerProjectTools } from "./tools/projects.ts";
import { registerTools as registerSyncTools } from "./tools/sync.ts";
import { registerTools as registerCatalogTools } from "./tools/catalog.ts";
import { registerTools as registerTaskTools } from "./tools/tasks.ts";
import { registerTools as registerSetupTools } from "./tools/setup.ts";
import { registerTools as registerStoreTools } from "./tools/stores.ts";

export type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

export function text(value: string): Text {
  return { content: [{ type: "text", text: value }] };
}

/**
 * Wraps a handler so every failure becomes a readable sentence for the model:
 * not signed in, not allowed, frozen, Premium needed.
 */
export function guarded<A>(handler: (args: A, ctx: any) => Promise<string>) {
  return async (args: A, ctx: any): Promise<Text> => {
    try {
      return text(await handler(args, ctx));
    } catch (error) {
      if (error instanceof NotSignedInError) {
        const pending = readPendingLogin();
        return {
          isError: true,
          content: [{ type: "text", text: pending ? `Not signed in to Costia. ${loginInstructions(pending)}` : "Not signed in to Costia. Run /costia:login." }],
        };
      }
      if (error instanceof ApiError) {
        const reason: Record<string, string> = {
          PREMIUM_REQUIRED: "This needs Costia Premium (organisations and inviting people). Premium is bought in any Costia app; see " + `${config.web}/billing.`,
          WORKSPACE_FROZEN: "This workspace is frozen: its owner's Premium lapsed, so it is read-only for members until it is renewed.",
          FORBIDDEN: "Your role does not allow this.",
          NOT_FOUND: "Not found, or not visible to you.",
        };
        return { isError: true, content: [{ type: "text", text: reason[error.code] ?? error.message }] };
      }
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
    }
  };
}

/** The folder Claude Code was started in; a relative path in a tool call is relative to it. */
export function workdir(path?: string): string {
  const base = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  return path ? resolve(base, path) : resolve(base);
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "costia", version: VERSION },
    {
      instructions:
        "Costia keeps this user's projects, their on-disk layout, a tagged catalogue of Claude Code setup (skills, plugins, MCP servers, AGENTS.md sections…) and tasks. " +
        "Managed AGENTS.md sections are changed only with edit_section, never by editing the file. " +
        "Sensitive changes (hooks, permissions, local MCP servers, scripts, marketplace plugins) are applied only after the user approves them in sync_review. " +
        "Items with setup flows are installed with install_item: the user does the setup in a local browser wizard you start and watch; never ask for secret values in the chat. " +
        "People, roles and billing are managed on the web, not here. Tool results are plain text.",
    },
  );
  const ctx = { z };
  registerProjectTools(server, ctx);
  registerSyncTools(server, ctx);
  registerCatalogTools(server, ctx);
  registerTaskTools(server, ctx);
  registerSetupTools(server, ctx);
  registerStoreTools(server, ctx);
  return server;
}

export function runMcp(): void {
  serveStdio(() => createServer());
}
