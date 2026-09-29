---
description: Costia account, device and the project this folder belongs to.
allowed-tools: Bash(node:*), mcp__plugin_costia_costia__whoami, mcp__plugin_costia_costia__where_am_i, mcp__plugin_costia_costia__sync_status
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/costia.mjs" status`

If signed in, also call `whoami`, `where_am_i` and, when this folder is a checkout, `sync_status`. Summarise in a few lines: account and Premium, project and targets, anything waiting (sensitive changes, conflicts).
