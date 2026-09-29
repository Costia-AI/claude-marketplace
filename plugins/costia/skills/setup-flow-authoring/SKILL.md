---
name: setup-flow-authoring
description: How to write a Costia setup flow — the prerequisites a skill, hook or MCP server needs outside the repository (a CLI, a login, a secret manager project, a store service account) as steps with checks — and attach it to catalogue items. Use with /costia:flow, create_flow and attach_flow.
user-invocable: false
---

# Writing a setup flow

A setup flow is a catalogue item of kind `SETUP_FLOW`. Items that require it are not installed until every step is done and every final check passes. A person walks it in a local browser wizard; Claude only carries out `claude` steps. The full format is `setup-flows.md` in the Costia Claude Tools docs; this is how to write a good one.

## 1. Reuse before writing

Call `search_catalog` with kind `SETUP_FLOW`. Installing a CLI or signing in to a service is almost always there already. Require it (`requires`) instead of copying its steps: a flow reached from two items runs once, and a `machine` step done once is done for every project.

## 2. One flow, one prerequisite

Split by what can be reused: "Infisical CLI" (machine), "Infisical project" (project, requires the CLI), "Play service account" (project, requires the Infisical project). An item then requires the last one and gets the others through it.

## 3. Pick the scope of every step and parameter

| Scope | Use it for | Example |
|---|---|---|
| `machine` | anything installed or signed in on this computer | install a CLI, `infisical login` |
| `user` | something tied to the person in every project | accept an invitation sent to you |
| `project` | something the project needs once, for every member | create the secret manager project, name a secret, create a service account |
| `project_user` | a person's own thing in one project | a personal token |

A `project` step done by one member is done for everyone. Get the scope wrong and people redo work, or skip work that was theirs.

## 4. Write steps a stranger can follow

- **Title:** an imperative, specific enough to scan (`Create the service account`, not `Setup`).
- **Instructions:** numbered sub-steps, exact console menu paths in **bold**, links to the page. Give per-OS variants (`linux`, `darwin`, `windows`) when commands differ, and `*` otherwise.
- **Parameters:** use `{{param}}` in instructions and checks instead of hard-coding project names, packages, app ids or secret names. Give every parameter a `label`, a `pattern` when its shape is known, and an `env` name that scripts will read from `.claude/costia/params.env`.
- **Binding:** an item fixes or suggests values through `attach_flow` params. Mark a parameter `editable` when a binding is only a suggestion.

## 5. Prove every step

Give every step that can be checked a `check`, and give the flow `verify` checks that prove the end result, not the steps. For example, a real API call with the stored credentials beats "the secret exists".

Prefer the built-in checks:

- `command`, `file`, `env`
- `infisical.logged-in`, `infisical.project-exists`, `infisical.secret-exists`
- `google-play.access`, `app-store-connect.access`

A `run` check executes an arbitrary program. It needs every user's approval and every new version asks again, so use it only when no built-in fits.

## 6. Secrets never pass through you

A `secret` step stores the value straight from the wizard into the secret manager: `source: file` for a JSON key or a `.p8`, `text` for a pasted token, `generate` for a random value or an RSA key. Set `rotate: true` when rotating makes sense.

- Never ask for a secret in the chat.
- Never put one in a parameter.
- Never write a step that prints one.

Skills read secrets at run time through the secret manager's CLI, into memory or a `0600` temporary file.

## 7. Claude steps

Use a `claude` step for work in the repository that only makes sense once the item's files are there: scaffolding a config, a seed module, `package.json` scripts. Write the `prompt` as instructions for the model. Give it a `check` (for example `file`) so completing it means something. Claude steps never hold an item.

## 8. Save, try, publish

1. `create_flow` saves a draft.
2. `attach_flow` makes the item require it.
3. Install the item once yourself (`/costia:install`) to walk the wizard.
4. Fix what was unclear with `update_flow`.
5. Publish with `publish_flow`. Only published versions reach other people.
