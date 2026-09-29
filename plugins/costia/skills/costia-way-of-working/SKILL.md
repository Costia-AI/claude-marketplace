---
name: costia-way-of-working
description: How repositories set up through Costia work day to day — managed AGENTS.md sections, the lockfile, sensitive changes, conflicts, several targets in one checkout. Use when the user asks why a file changed by itself, how to change a shared rule, or what .claude/costia.lock.json is.
---

# Working in a repository set up by Costia

**Managed sections.** The first line of `AGENTS.md` names the sections Costia manages. Each section is wrapped in `costia:begin`/`costia:end` markers.

- They update themselves at session start in every repository that uses them.
- Never edit them in the file; a hook blocks it.
- To change one for everyone, use `edit_section` (or `/costia:section`).
- To stop sharing one here, use `detach_section`.
- Rules for this repository only go outside the blocks.

**The lockfile.**

- `.claude/costia.lock.json` records what Costia wrote, per file, settings entry and section. It is committed with the repository.
- It is how Costia tells its own changes from the user's. A file edited by hand is never overwritten silently: it shows up as *edited locally* or as a *conflict*.
- `/costia:sync` resolves those, taking either the shared version or the local one.

**Sensitive changes.** These are never applied until the user approves that exact content on this machine:

- hooks and permission rules;
- local MCP servers;
- marketplace plugins;
- scripts;
- skills that grant Bash, Write or Edit.

The user approves them either in `sync_review` or on the web at `/approvals`. Costia never commits anything to git.

**Several targets.** A checkout can manage several folders, such as the root, `backend` and `frontend`, each with its own config and lockfile. `where_am_i` lists them.

**Frozen workspaces.** When an organisation's owner loses Costia Premium, members keep the setup exactly as it was, read-only, until the owner renews. Nothing is deleted.
