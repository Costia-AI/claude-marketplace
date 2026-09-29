---
name: infisical-secrets
description: Create, rotate, check and use Infisical secrets without anyone — you, the person, or the transcript — ever seeing their values. Use when a secret has to exist (a password, an API key, a signing key, a service-account file), when one must be rotated, or when a command needs one to run.
---

# Infisical secrets, without seeing them

This repository keeps its secrets in Infisical. The rule this skill exists for: **a secret value
never appears in a command line, in output, in a file that outlives one command, or in this
conversation.** Anything printed is recorded, and a recording cannot be rotated.

Where the secrets live comes from this repository's setup (`.claude/costia/params.env`, written by
the costia plugin's `infisical-project` flow):

| Variable | Meaning |
|---|---|
| `INFISICAL_DOMAIN` | the instance: `https://app.infisical.com`, `https://eu.infisical.com` or a self-hosted URL |
| `INFISICAL_PROJECT` | the project's slug |
| `INFISICAL_ENV` | the environment (`prod`, `dev`…) |
| `INFISICAL_PATH` | the folder, `/` unless set |

Authentication is the Infisical CLI's own login (`infisical login`) or `INFISICAL_TOKEN` for a machine
identity. If a command answers "No Infisical token", ask the person to run `infisical login`
themselves (`! infisical login` in Claude Code) — never ask them to paste a token.

All scripts are in `scripts/` next to this file. Run them from anywhere inside the repository.

## 1. Is it there?

```sh
node .claude/skills/infisical-secrets/scripts/secret.mjs list                 # names only
node .claude/skills/infisical-secrets/scripts/secret.mjs exists API_KEY DB_PASSWORD
```

`exists` exits 0 only when every name exists and is non-empty.

## 2. Creating one

Pick the source by who needs to know the value:

| Where the value comes from | Source |
|---|---|
| Nobody needs to know it (a password two services share, a signing key) | `--generate random:40` · `--generate random:64:hex` · `--generate rsa:2048` |
| The person has it in a file (a service-account JSON, a `.p8`) | `--from-file PATH` — ask them for the path, not the content |
| The person has it on a clipboard | they run it with `--prompt` themselves: `! node …/secret.mjs create NAME --prompt` |
| Another command produces it | pipe it: `producer | node …/secret.mjs create NAME --stdin` |

```sh
node .claude/skills/infisical-secrets/scripts/secret.mjs create DB_PASSWORD --generate random:40
```

- **Alphanumeric for anything a shell or a SQL heredoc will interpolate**; `random` is alphanumeric by
  default and has no trailing newline.
- **Never `infisical secrets set NAME=value`** (the value lands in `argv`, readable by every process)
  and **never `infisical secrets set NAME=@file`**: it does not read the file, it stores the literal
  string `@file`, prints `******` and looks exactly like success. It surfaces later as a key that will
  not parse or a login that fails; the tell is the length (23 characters where 40 were generated).
  The scripts here use the REST API with the value in the request body.
- A file given with `--from-file` is read and left where it was. If it was a download (a `.p8`, a
  JSON key), tell the person to delete it once it is stored: **a `.p8` downloads exactly once, and the
  copy that matters is now the one in Infisical.**

## 3. Checking it without looking

```sh
node …/secret.mjs shape DB_PASSWORD --pattern '[A-Za-z0-9]{40}'
node …/secret.mjs shape SIGNING_KEY --pem
node …/secret.mjs shape PLAY_SERVICE_ACCOUNT --json
```

It prints the length and whether it matches — never the value. Where the secret has a real consumer,
proving that consumer works (a login, an API call) is the better check: it covers the whole path.

## 4. Using one without seeing it

Wrap the command; the values reach it through its environment or a private temp file that is
overwritten and removed when it exits, including on Ctrl-C:

```sh
.claude/skills/infisical-secrets/scripts/with-secrets.sh \
  --env API_TOKEN=THIRD_PARTY_API_TOKEN \
  --file GOOGLE_APPLICATION_CREDENTIALS=GCP_SERVICE_ACCOUNT_JSON \
  -- node scripts/deploy.mjs
```

- `--env VAR=SECRET` exports the value as `$VAR`; `--file VAR=SECRET` exports the path of a `0600`
  file holding it; `--all` exports every secret under its own name.
- **To use the wrapper's own variables in the command, let a shell expand them inside it:**
  `with-secrets.sh --file KEY=SA_JSON -- bash -c 'tool --key "$KEY"'`. Written outside, `$KEY` is
  expanded before the wrapper runs, to nothing.
- **Long-running processes run inside the wrapper, not beside it.** A watcher started separately
  loses its file when the wrapper exits and dies with an error that looks unrelated.
- Never `cat`, `echo` or `print` a wrapped variable to "check" it. To check, use `shape`.

## 5. Rotating

```sh
node …/secret.mjs rotate DB_PASSWORD --generate random:40
```

It overwrites the value (Infisical keeps the previous version in its history) and lists the files in
this repository that name the secret. **Everything that copied the old value keeps using it until it
is resynced**: CI variables, EAS or Vercel environment variables, Kubernetes `ExternalSecret`s (they
refresh on their interval; force one with an annotation or a sync), other repositories. Go through
the list with the person and record what only they can do.

When the old value was exposed, rotate **first** and investigate after: every minute it is valid is
the exposure.

## 6. Things that fail silently

- **The wrong project or environment** does not fail on write; it fails later, as a consumer that
  cannot find its key. `list` first when in doubt.
- **A token for one instance does not work on another.** US cloud, EU cloud and self-hosted are
  separate; `infisical login` again and pick the instance in `INFISICAL_DOMAIN`.
- **Testing a token by printing it** — even a "does it start with…" check with an `echo` in its else
  branch — publishes it. Test with presence only.

Kubernetes clusters that read these secrets through External Secrets: see
`references/kubernetes-external-secrets.md`.
