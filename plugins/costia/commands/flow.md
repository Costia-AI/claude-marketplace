---
description: Write a setup flow — the steps, checks and parameters an item needs outside the repository — and attach it to catalogue items.
argument-hint: "[what the flow should set up]"
allowed-tools: mcp__plugin_costia_costia__create_flow, mcp__plugin_costia_costia__update_flow, mcp__plugin_costia_costia__attach_flow, mcp__plugin_costia_costia__publish_flow, mcp__plugin_costia_costia__search_catalog, mcp__plugin_costia_costia__get_item, mcp__plugin_costia_costia__list_tags, Read
---

Help the user write a setup flow for: `$ARGUMENTS`. Follow the `setup-flow-authoring` skill: look for an existing flow to reuse or require first (`search_catalog` with kind `SETUP_FLOW`), draft the steps and checks with the user, save it with `create_flow` (a draft), attach it to the items that need it with `attach_flow`, and publish with `publish_flow` once the user has walked it once.
