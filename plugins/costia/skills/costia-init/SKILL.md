---
name: costia-init
description: The /costia:init flow — link a repository to a Costia project, choose tags per target, then choose which AGENTS.md sections, skills, plugins, MCP servers, subagents, commands and hooks to import from the catalogue, where each lands (repo, private or user) and walk their setup flows.
user-invocable: false
---

# Setting up a repository from the Costia catalogue

Ask with the AskUserQuestion tool, one decision at a time, and never pick for the user what they were not asked about.

## 1. The project

Call `where_am_i`.

- **Linked already** → continue with its project.
- **Not linked** → call `list_projects`. Ask whether this folder is a checkout of one of them (`adopt_checkout`) or a new project (`create_project`, which captures the folder's layout).
- When a new layout was captured, show it and ask whether it is right: which child repositories and symlinks it has, and which folders are **targets**. A target is a folder whose `.claude/` and `AGENTS.md` Costia manages. A parent with a separate backend and frontend usually has three targets: `.`, `backend` and `frontend`. Fix it with `save_layout` if the user corrects something.

## 2. Tags, per target

For each target:

1. Call `detect_stack` on the target's folder.
2. Call `list_tags`.
3. Ask which tags describe that target: multi-select, with the detected ones first and marked as detected. An item can carry several tags; the user can pick several.
4. If the user passed tags as arguments, use them for the root target and still confirm them.

## 3. What to import, per target

Call `init_plan` with the target's tags. It returns items grouped by kind. Ask **one question per kind that has items**, as a multi-select, in this order:

1. AGENTS.md sections
2. skills
3. plugins
4. MCP servers
5. subagents
6. commands
7. hooks and settings

Rules for these questions:

- Mark what is already selected.
- Mark every item flagged "needs approval", and say it will ask again before it runs anything.
- When a group has more than 4 items, split it into several questions by tag.
- Offer the web as an alternative for long lists: `https://claude.costia.app/p/<project>/config`.

Then ask **where** the chosen items land, once for the whole selection unless the user wants to decide per item:

- **repo**: committed with the repository, for everyone in the project. This is the default.
- **private**: in this checkout but excluded from git, only for this user.
- **user**: the user's own `~/.claude`, in every project. Only skills, subagents, commands, output styles and AGENTS.md sections can go there.

Call `set_selection` with the repo items, then again with `destination: "private"` for the private ones. Install each **user** item with `install_item` and `destination: "user"`.

## 4. Finish

`set_selection` syncs the checkout. Report what was written.

If anything waits for approval, say what it is and offer `sync_review`. The user approves each change in a form, and nothing sensitive is applied until then.

If an item is **held until its setup is done**, its setup flow has steps the user still has to do. For example: install a CLI, create a project in a secret manager, give a service account access.

1. Call `start_setup`.
2. Run the command it returns in the background and follow it with Monitor.
3. Let the user work in the browser page it opens. Never ask for secrets in the chat.
4. When it completes, carry out the setup steps meant for Claude (`setup_status`), calling `complete_claude_step` after each.

Remind the user of two things:

- Managed AGENTS.md sections update themselves at every session start and are changed with `/costia:section`.
- Rules that apply only to this repository go outside the managed blocks.
