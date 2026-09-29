# Toolkits

Ready-made catalogue items for [Costia Claude Tools](https://claude.costia.app) and the setup flows
they need. Each toolkit is generic: nothing in it names a project, an app, an account or a URL of
its author. Everything specific to a repository is a **setup-flow parameter**, asked once by the
costia plugin's local wizard and written to `.claude/costia/params.env` for the scripts to read.

| Toolkit | Kind | Tags | Destination | Needs (flows) |
|---|---|---|---|---|
| `javirub-conventions` | AGENTS.md section | `javirub` | user | — |
| `infisical-secrets` | skill | `infisical` | repo | `node-runtime`, `infisical-project` → `infisical-login` → `infisical-cli` |
| `store-screenshots` | skill | `react-native`, `mobile`, `ios`, `android` | repo | `store-screenshots-init` → `node-runtime`, `chrome` |
| `play-store` | skill | `infisical`, `android`, `mobile`, `react-native` | repo | `node-runtime`, `play-service-account` → `infisical-project` → … |
| `app-store` | skill | `infisical`, `ios`, `mobile`, `react-native` | repo | `node-runtime`, `asc-api-key` → `infisical-project` → …, `app-store-listing-rules` |

| Flow | Steps (scope) |
|---|---|
| `infisical-cli` | install (machine) |
| `infisical-login` | login (machine) |
| `infisical-project` | project: domain, slug, environment, folder (project) |
| `node-runtime` | Node.js ≥ 20 (machine) |
| `chrome` | Chrome executable (machine) |
| `store-screenshots-init` | app folder (project); config, seed, guard test, scripts (project, Claude) |
| `play-service-account` | package, GCP project, service account, Play Console invitation (project); JSON key → Infisical (project, secret) |
| `asc-api-key` | Apple ID, API access, team key (project); `.p8`, key id, issuer id → Infisical (project, secret) |
| `app-store-listing-rules` | forbidden words, copy folder (project) |

## Layout

```
toolkits/
  _shared/                 scripts several toolkits ship (params.mjs, infisical.mjs, with-secrets.mjs)
  flows/<slug>.json        a SETUP_FLOW: { slug, name, description, tags, spec }
  <slug>/toolkit.json      the item: kind, slug, name, description, tags, defaultDestination,
                           requires [{flow, params}], include {path in item: source}, modes {path: "0755"}
  <slug>/SKILL.md, scripts/, references/, templates/    a skill's files, published as they are
  <slug>/section.md        an AGENTS.md section's content (with `title` in toolkit.json)
  validate.mjs             the rules the backend enforces, checked locally
  publish.mjs              publishes flows, then items, to a workspace
```

`requires` and flow-to-flow references are bare slugs of flows in this folder; `publish.mjs` writes
them as `<workspace>/<slug>`. `include` copies shared files into an item at publish time, so each
skill is self-contained once installed.

The flow spec, the scopes, the checks and what the wizard does are specified in
`docs/setup-flows.md` of Costia Claude Tools.

## Publishing

```sh
/costia:login                                   # in Claude Code, once (or export COSTIA_TOKEN)
node toolkits/validate.mjs
node toolkits/publish.mjs                       # dry run: the plan
node toolkits/publish.mjs --commit [--workspace <slug>] [--only <slug>]... [--changelog "…"]
```

Re-running is harmless: identical content does not make a new version. Publishing makes items
available in your workspace; to offer them to other people, add them to a store on
`claude.costia.app/stores`.

## Writing your own

1. Copy a flow and change it. Keep secrets in `secret` steps — a parameter is never a secret.
2. Give every step the smallest scope that is true: `machine` for what is installed or signed in on
   this computer, `project` for what every member shares, `project_user` or `user` for what is yours.
3. Prove each step with a check where one exists; `verify` is what decides whether the item is applied.
4. Write `claude` steps as instructions for Claude working in the repository, with a check after.
5. `node toolkits/validate.mjs`, then publish.
