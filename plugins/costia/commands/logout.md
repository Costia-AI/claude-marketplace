---
description: Sign out of Costia on this machine and revoke its refresh token.
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/costia.mjs" logout`

Tell the user they are signed out on this machine. Other devices stay signed in; they can be revoked at https://claude.costia.app/devices.
