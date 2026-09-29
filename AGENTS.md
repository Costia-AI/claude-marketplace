# Costia Claude marketplace

The Claude Code marketplace `costia-ai`. It holds one plugin, **`costia`**: the client side of
Costia Claude Tools (`claude.costia.app`). The web and the backend live in GitLab
(`costia-ai/costia-claude-tools`); this repository holds only what runs inside Claude Code. The
contract with the backend, the plugin protocol and the security model are in the parent
repository's `docs/` (`contract.md`, `plugin-protocol.md`, `security-model.md`).

## Layout

| Path | What |
|---|---|
| `.claude-plugin/marketplace.json` | the marketplace; plugin `costia` at `./plugins/costia` |
| `plugins/costia/` | **what Claude Code installs** — manifests, commands, skills, hooks, `dist/` |
| `plugins/costia/dist/` | the built plugin: `costia.mjs` (CLI and hooks) and one lazily loaded chunk (the MCP server). **Built, committed, never edited by hand** |
| `packages/costia-plugin/` | the TypeScript source and its tests |

## Commands

```
bun install
bun run test        # bun test in packages/costia-plugin
bun run typecheck
bun run build       # rebuilds plugins/costia/dist — commit the result
claude plugin validate plugins/costia
```

## Rules that fail silently if broken

- **Runtime is plain Node ≥ 20.** Source may use Bun only in tests; no `Bun.*` in `src/`. The build
  bundles every dependency, so a git install needs no `npm install`.
- **Hooks must be fast and must never fail a session.** `costia.mjs` must not import the MCP SDK
  statically (it lives in the lazy chunk); the PreToolUse hook returns in tens of milliseconds for
  files other than `AGENTS.md`. Every hook path swallows its errors.
- **One write path.** Only `src/sync/apply.ts` (through `SafeRoot`) writes into a repository, and
  only `AGENTS.md`, `CLAUDE.md`, `.mcp.json` and `.claude/**`. The layout materialiser writes
  clones and symlinks, and only after the user confirmed its plan. Add a test in
  `test/apply.test.ts` or `test/safe-fs.test.ts` for any change to either.
- **Sensitivity is local.** `src/sync/sensitivity.ts` decides; server flags are hints.
- **One version** in `plugin.json`, `marketplace.json`, `package.json` and `src/config.ts`
  (`test/manifest.test.ts` checks it).
- **Tool results are plain text**, written for the model; errors say what to do next.
- Code, tool descriptions, skills and commands are in English. Tasks the plugin records for the user
  follow the user's language.
