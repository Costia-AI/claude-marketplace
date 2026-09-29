---
name: play-store
description: Change what Google Play shows for this app and ship to it — listing text, screenshots, icon and feature graphic, release notes, and uploading a bundle — through the Play Developer API with a service account whose key never leaves Infisical. Use for any Play listing edit, release notes, a submission, or "why did Play reject / 403 this".
---

# Google Play

Everything here is metadata or an upload: no signing keys are touched and nothing needs a device.
The app is `ANDROID_PACKAGE`; the service account's JSON key is the Infisical secret
`PLAY_SERVICE_ACCOUNT_SECRET` (both from the `play-service-account` setup flow, in
`.claude/costia/params.env`).

**The key is read from Infisical into memory by the scripts and never written to disk.** Do not
download it, do not ask the person for it. To hand it to another tool as a file, wrap that tool:

```sh
.claude/skills/play-store/scripts/with-secrets.sh --file GOOGLE_PLAY_KEY_PATH="$PLAY_SERVICE_ACCOUNT_SECRET" -- <command>
```

(set `PLAY_SERVICE_ACCOUNT_SECRET` from `params.env` first, or write the secret's name.)

Run the scripts from the app folder (`--app <dir>` otherwise). Every one is a **dry run unless
`--commit`** — run the dry run first, always: it checks every length before anything is sent.

## 1. Is the access right?

```sh
node .claude/skills/play-store/scripts/play-verify.mjs
```

It opens an edit, reads the listing languages and discards it. A **403** means the service account
is not invited into Play Console for this app, lacks the permission for the call, or the invitation
has not propagated (minutes; retry before suspecting the key). A **404 on edits** means Play knows no
app with that package, or its first bundle was never uploaded by hand — Google requires that one.

## 2. The listing

```
store/play/<locale>/title.txt              ≤ 30
store/play/<locale>/short_description.txt  ≤ 80
store/play/<locale>/full_description.txt   ≤ 4000
store/play/graphics/icon.png               512×512, only with --graphics
store/play/graphics/feature-graphic.png    1024×500, only with --graphics
store-assets/<locale|lang>/play/*.png      2–8 phone screenshots, sorted by name
```

```sh
node .claude/skills/play-store/scripts/play-listing.mjs              # dry run
node .claude/skills/play-store/scripts/play-listing.mjs --commit     # one transactional edit
```

- **The commit replaces the screenshots with whatever is in the folder.** Regenerate them first
  (the `store-screenshots` skill) and look at them: copy and pictures go up in the same transaction.
- **Only phone screenshots belong in `play/`.** Every `.png` there is uploaded as a screenshot; a
  feature graphic left in it is published as one, silently.
- The feature graphic: Play draws the video button over its centre and crops the edges — nothing
  legible in the middle or within 6 % of an edge.
- **Not reachable from the API**, and console work only: content rating, Data safety, app access,
  target audience, contact details, pricing. Record them for the person as manual tasks.

## 3. Release notes

```sh
node .claude/skills/play-store/scripts/play-release-notes.mjs                                   # measures, prints the paste block
node .claude/skills/play-store/scripts/play-release-notes.mjs --commit --version-code 42 --track production
```

From `store/play/<locale>/release_notes.txt` (≤ 500 each). Play accepts them on a release that is
already live. When they cannot go through the API, hand the person the dry run's block: it is the
exact format Play Console's *Release notes* field takes pasted, every language at once.

Every production release gets its notes in the same session, not later.

## 4. Uploading a bundle

With EAS:

```sh
npx eas build -p android --profile production                  # or --local
.claude/skills/play-store/scripts/with-secrets.sh --file GOOGLE_SERVICE_ACCOUNT_KEY_PATH=<secret name> -- \
  bash -c 'npx eas submit -p android --profile <profile> --path <file.aab> --non-interactive'
```

(point the profile's `serviceAccountKeyPath` at `$GOOGLE_SERVICE_ACCOUNT_KEY_PATH`, or let EAS use a
key stored in EAS itself.)

- **The track comes from the submit profile** (`submit.<profile>.android.track`), not from a flag.
  Keep a profile for `internal` and a separate one for `production`, and use production only when
  the person asks: with no over-the-air channel, a bad production binary stays on phones until each
  user updates.
- `eas build --local` must run with the working directory at the app folder. Launched elsewhere it
  fails with *Run this command inside a project directory* — and piped through `tail`, it exits 0.
- A **versionCode already used** is refused; bump it (or let EAS auto-increment) before building.

## 5. Permissions the service account holds

Set in the `play-service-account` flow. *View app information* is required for anything;
*Manage store presence* for the listing; *Release apps to testing tracks* for testing uploads and
notes; *Release to production…* only if production notes or uploads go through the API — that one
checkbox also allows unpublishing and excluding devices, so having it is not a licence to use it for
anything else.
