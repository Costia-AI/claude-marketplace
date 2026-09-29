/**
 * What may run code or widen what Claude may do without asking. Decided here,
 * on the machine, from the content itself — a flag sent by the server is never
 * trusted, because the server is exactly what this protects against.
 */

const SCRIPT_EXTENSIONS = /\.(sh|bash|zsh|fish|py|js|mjs|cjs|ts|mts|cts|rb|pl|php|ps1|psm1|bat|cmd|exe|jar)$/i;
const POWERFUL_TOOLS = /\b(Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__[\w-]*)\b/;

function frontmatter(text: string): string | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? null : text.slice(3, end);
}

/** Why a file is sensitive, or null when it is not. */
export function fileSensitivity(path: string, content: Buffer, mode: number): string | null {
  if (mode & 0o111) return "executable";
  if (SCRIPT_EXTENSIONS.test(path)) return "script";
  if (path.startsWith(".claude/hooks/")) return "hook file";
  if (path.endsWith(".md")) {
    const text = content.toString("utf8");
    const fm = frontmatter(text);
    if (fm) {
      const tools = fm.match(/^(allowed-tools|allowedTools|tools)\s*:(.*(?:\n[ \t]+-.*)*)/m);
      if (tools && POWERFUL_TOOLS.test(tools[2] ?? "")) return `grants ${tools[1]}: ${(tools[2] ?? "").trim().slice(0, 80)}`;
      if (/^hooks\s*:/m.test(fm)) return "declares hooks";
    }
    // `!` followed by a backtick runs a shell command when a command or skill is loaded.
    if (/!`[^`]+`/.test(text)) return "runs shell commands";
  }
  return null;
}

/** Top-level keys of `.claude/settings.json` whose Costia-owned entries always need approval. */
const SENSITIVE_SETTINGS = new Set([
  "hooks",
  "env",
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "statusLine",
  "enableAllProjectMcpServers",
  "enabledMcpjsonServers",
  "mcpServers",
  "enabledPlugins",
  "extraKnownMarketplaces",
  "otelHeadersHelper",
  "forceLoginMethod",
]);

/** `key` is an owned-entry key such as `hooks.PreToolUse#…` or `permissions.allow#Bash(ls:*)`. */
export function settingsEntrySensitivity(key: string): string | null {
  const top = key.split(/[.#]/, 1)[0]!;
  if (SENSITIVE_SETTINGS.has(top)) return `settings ${top}`;
  if (key.startsWith("permissions.allow#")) return "allows a tool without asking";
  if (key === "permissions.defaultMode") return "changes the permission mode";
  if (key.startsWith("permissions.additionalDirectories")) return "widens accessible directories";
  return null;
}

/** An MCP server that Claude Code would start as a local process. */
export function mcpServerSensitivity(value: unknown): string | null {
  const server = value as { command?: unknown; type?: unknown; headersHelper?: unknown };
  if (server && (server.command !== undefined || server.type === "stdio")) return "starts a local process";
  if (server && server.headersHelper !== undefined) return "runs a headers helper";
  return null;
}
