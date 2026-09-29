---
description: Install a catalogue or marketplace item into this project, a private copy outside git, or your own ~/.claude — running its setup flows first.
argument-hint: "<workspace/item> [repo|private|user]"
allowed-tools: mcp__plugin_costia_costia__install_item, mcp__plugin_costia_costia__setup_status, mcp__plugin_costia_costia__start_setup, mcp__plugin_costia_costia__verify_setup, mcp__plugin_costia_costia__complete_claude_step, mcp__plugin_costia_costia__search_marketplace, mcp__plugin_costia_costia__where_am_i, Bash(node:*)
---

Install `$ARGUMENTS`.

1. If no item was named, or the name is ambiguous, call `search_marketplace` and ask the user which one.
2. If no destination was given, ask with AskUserQuestion: **repo** (committed, for everyone in the project), **private** (in this checkout, excluded from git, only for you) or **user** (your own `~/.claude`, in every project). Suggest the item's default when it has one.
3. Call `install_item`.
4. If it returns a wizard command, run it exactly as given with the Bash tool and `run_in_background: true`, then follow its output with the Monitor tool until a `completed` or `aborted` line appears. Meanwhile tell the user a page opened in their browser and what it will ask. **Never ask for secret values in the chat** and never do the person's steps yourself.
5. On `completed`, call `setup_status` and carry out every setup step meant for Claude, calling `complete_claude_step` after each. On `aborted`, say nothing was installed and how to resume (`/costia:install` again).
6. Finish with `verify_setup` and report what is installed.
