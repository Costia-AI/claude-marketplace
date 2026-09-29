---
description: Sign in to Costia on this machine (device code in the browser).
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/costia.mjs" status`

If the output above says the user is already signed in, say so and stop.

Otherwise, run `node "${CLAUDE_PLUGIN_ROOT}/dist/costia.mjs" login` with the Bash tool **in the background**, read its first line, and give the user the URL and code it prints: they confirm the code at `auth.costia.app/activate` with their Costia account (Google, Apple, passkey or email). When the command finishes, report the account it signed in as.
