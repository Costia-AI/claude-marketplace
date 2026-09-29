# Costia Claude marketplace

Claude Code plugins by [Costia](https://costia.app).

## `costia` — Costia Claude Tools

Your Claude Code setup as a Costia account, at [claude.costia.app](https://claude.costia.app). It manages:

- **Projects and their layout.** A layout describes how a project is checked out: a parent repository with children, symlinks to shared repositories, one folder or several. `/costia:clone` rebuilds a project anywhere.
- **A tagged catalogue** of skills, subagents, commands, hooks, MCP servers, marketplace plugins and `AGENTS.md` sections. `/costia:init` asks what kind of application a repository is and imports what fits.
- **Managed `AGENTS.md` sections.** They update themselves in every repository that uses them. They are changed with `/costia:section`, never by hand.
- **Tasks**, including the manual ones only you can do, on a board in the web.
- **Setup flows.** Some items need things outside the repository first: a CLI, a login, a project in a secret manager, a store service account. A setup flow walks you through them in a local browser page, checks each one, and only then installs the item. Secrets go from that page straight to your secret manager. They never reach Costia or Claude.
- **Stores and the marketplace.** You can gather items into stores that are private, shared with chosen people or public. `/costia:install` puts an item in the repository, in a private copy outside git, or in your own `~/.claude`.

Nothing runs locally besides the plugin. You sign in with your Costia account; it is free. Organisations and inviting people need Costia Premium.

```
/plugin marketplace add Costia-AI/claude-marketplace
/plugin install costia@costia-ai
```

It needs Node.js 20 or newer. Commands: `/costia:login`, `/costia:status`, `/costia:init`, `/costia:install`, `/costia:sync`, `/costia:clone`, `/costia:adopt`, `/costia:tasks`, `/costia:publish`, `/costia:flow`, `/costia:section`, `/costia:logout`.

**What it may change in your repositories.** Only these, and never by following a symlink:

- `AGENTS.md`, `CLAUDE.md`, `.mcp.json` and `.claude/`;
- a managed block of `.git/info/exclude`, for private items;
- in `~/.claude`, only skills, subagents, commands, output styles and its own `rules/costia--*.md`.

- Anything that runs code or widens permissions waits for your explicit approval on your machine: hooks, permission rules, local MCP servers, scripts and marketplace plugins.
- Nothing is committed for you.
