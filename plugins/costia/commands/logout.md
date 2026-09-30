---
description: Sign out of Costia on this machine by forgetting its stored session. To revoke this device, use the web.
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/costia.mjs" logout`

Tell the user they are signed out on this machine. Other devices stay signed in; they can be revoked at https://claude.costia.app/devices.
