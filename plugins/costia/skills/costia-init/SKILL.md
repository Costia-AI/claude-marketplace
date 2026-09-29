---
name: costia-init
description: The /costia:init flow — link a repository to a Costia project, choose tags per target, then choose which AGENTS.md sections, skills, plugins, MCP servers, subagents, commands and hooks to import from the catalogue.
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

Then call `set_selection` with the chosen items and the target's tags.

## 4. Finish

`set_selection` syncs the checkout. Report what was written.

If anything waits for approval, say what it is and offer `sync_review`. The user approves each change in a form, and nothing sensitive is applied until then.

Remind the user of two things:

- Managed AGENTS.md sections update themselves at every session start and are changed with `/costia:section`.
- Rules that apply only to this repository go outside the managed blocks.
