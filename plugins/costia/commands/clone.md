---
description: Materialise one of your Costia projects in a folder — clones, folders and symlinks as its layout says, then its Claude setup.
argument-hint: "<project> [directory]"
allowed-tools: mcp__plugin_costia_costia__list_projects, mcp__plugin_costia_costia__get_project, mcp__plugin_costia_costia__clone_project
---

Arguments: `$ARGUMENTS`.

1. If no project was given, call `list_projects` and ask which one.
2. If no directory was given, propose `./<project slug>` and let the user change it.
3. Call `clone_project`. The user confirms the plan in a form; if the plan has unresolved symlinks (`?` lines), ask the user for the local path of each repository or whether to clone it, then save the adjusted layout only if they want it for everyone.
