---
description: Bring this checkout's Claude setup up to date, review sensitive changes and resolve conflicts.
allowed-tools: mcp__plugin_costia_costia__sync_status, mcp__plugin_costia_costia__sync_apply, mcp__plugin_costia_costia__sync_review, mcp__plugin_costia_costia__resolve_conflict, mcp__plugin_costia_costia__where_am_i
---

1. Call `sync_apply` and report what changed, per target.
2. If anything waits for approval, call `sync_review`: the user approves each change in a form. Never describe a sensitive change as harmless to push the user to approve it; show what it does.
3. For each conflict or local edit reported, ask the user whether to take the shared version or keep theirs, then call `resolve_conflict` with their choice. If they keep a managed AGENTS.md section they want shared with every repository, suggest `edit_section` instead.
