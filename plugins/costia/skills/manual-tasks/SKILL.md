---
name: manual-tasks
description: Record, correct and close the things only the user can do by hand — a form in some console, a secret to seed, a DNS record, a store review, a promotion to trigger. Use whenever what you just delivered cannot take effect until someone acts somewhere you have no access, and whenever such a task already recorded changes.
---

# Manual tasks

**What counts.** Some steps can only be done by the user. Examples:

- a secret seeded in a vault;
- a record in a DNS console;
- an app review in a store;
- an OAuth client created in a provider's console.

When your work depends on one of these, record it as a Costia task with `manual: true` (`create_task`) in the current project, instead of burying it in a chat message that will scroll away.

**How to write the task.**

- Write it in the user's language.
- The title says what to do and where: "Seed COSTIA_CLAUDE_TOOLS_DB_PASSWORD in Infisical".
- Give one step per action (`steps`). Include exact names, values that are not secret, URLs and the order that matters.
- Never put a secret value in a task. Say where it comes from and how to generate it.
- Use `priority: high` when something is blocked until it is done.

**While working.**

- Before creating a task, check the open ones (`list_tasks` with `manual: true`). If one already covers it, update that task instead of duplicating it.
- If the facts change (a name, an order, a new prerequisite), fix the task with `update_task` or `add_steps`.
- When the user says a step is done, mark it (`complete_steps`). Mark the task done only when all of it is done.
- At the end of your answer, mention the manual tasks you created or changed, in one line each.
