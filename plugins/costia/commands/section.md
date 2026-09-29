---
description: Change a managed AGENTS.md section for every repository that uses it.
argument-hint: "<section id> [what to change]"
allowed-tools: mcp__plugin_costia_costia__list_sections, mcp__plugin_costia_costia__edit_section, Read
---

Arguments: `$ARGUMENTS`.

1. Find the section (`list_sections`; its current text is in AGENTS.md between its `costia:begin`/`costia:end` markers).
2. Draft the full new text with the user. Remind them it reaches every repository using the section; if the rule is only for this repository, write it outside the managed blocks instead and stop.
3. Call `edit_section` with the full new Markdown and a one-line changelog.
