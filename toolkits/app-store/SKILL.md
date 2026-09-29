---
name: app-store
description: Change what the App Store shows for this app and get it through review — listing text, screenshots, age rating, EAS submission, submitting and withdrawing a version — through the App Store Connect API with a team key that never leaves Infisical. Use for any App Store listing edit, any submission, and any "why did Apple reject this".
---

# App Store Connect

The app is `ASC_APP_ID`; the team key is three Infisical secrets — the `.p8`, its key id and the
issuer id (`ASC_KEY_SECRET`, `ASC_KEY_ID_SECRET`, `ASC_ISSUER_ID_SECRET`), all from the
`asc-api-key` setup flow in `.claude/costia/params.env`. **The scripts read the key into memory and
never write it anywhere**; do not download it and do not ask the person for it. A `.p8` downloads
from Apple exactly once: if it is lost, it is revoked and a new one is issued.

Run the scripts from the app folder (`--app <dir>` otherwise). Everything is metadata: no Mac is
needed for any of it.

## 1. Is the access right?

```sh
node .claude/skills/app-store/scripts/asc-verify.mjs
```

## 2. The listing

```
store/appstore/<locale>/name.txt                ≤ 30    appInfo
store/appstore/<locale>/subtitle.txt            ≤ 30    appInfo
store/appstore/<locale>/privacy_policy_url.txt          appInfo
store/appstore/<locale>/description.txt         ≤ 4000  version
store/appstore/<locale>/keywords.txt            ≤ 100   version, comma-separated
store/appstore/<locale>/promotional_text.txt    ≤ 170   version — the only field that changes live
store/appstore/<locale>/support_url.txt                 version — required, per version
store/appstore/<locale>/marketing_url.txt               version — optional
```

(`ASC_COPY_DIR` moves the folder.)

```sh
node .claude/skills/app-store/scripts/asc-listing.mjs show
node .claude/skills/app-store/scripts/asc-listing.mjs push --dry-run
node .claude/skills/app-store/scripts/asc-listing.mjs push
node .claude/skills/app-store/scripts/asc-listing.mjs push --promo-only     # works on a live app
```

- **Almost everything is frozen unless a version is editable** (`PREPARE_FOR_SUBMISSION` or a
  rejected state). Apple answers a write to a frozen field with a 409 that does not say why; `show`
  says whether one is open.
- **If an unsubmitted version exists, rename it rather than creating another**: a `PATCH` of its
  `versionString` keeps its text, keywords and screenshots.
- `whatsNew` is not written here: release notes belong to a binary.

## 3. Screenshots

```sh
node .claude/skills/app-store/scripts/asc-screenshots.mjs show
node .claude/skills/app-store/scripts/asc-screenshots.mjs push
```

From `store-assets/<lang>/apple/` (iPhone 6.9", 1320×2868) and `store-assets/<lang>/apple-ipad/`
(iPad 13", 2064×2752) — the `store-screenshots` skill makes them. Each set is emptied and refilled,
and the script only reports success once Apple says every image is `COMPLETE`. **While the app
supports tablets, an iPad set is required in every localization**, or the version cannot be submitted
(a 409 that names nothing).

## 4. Age rating

```sh
node .claude/skills/app-store/scripts/asc-age-rating.mjs show
node .claude/skills/app-store/scripts/asc-age-rating.mjs push --dry-run
```

Answers live in `store/appstore/age-rating.json`. `show` marks what differs and lists questions
Apple added that the file does not answer yet — an unanswered one blocks submission. The **App
Privacy** label is not in the API: console work.

## 5. The binary

With EAS, on EAS's Macs:

```sh
npx eas build -p ios --profile production
node .claude/skills/app-store/scripts/eas-submit-ios.mjs --profile production
```

The submit wrapper points the profile at the team key for one `eas submit --latest
--non-interactive` and restores `eas.json` afterwards. **Two build counters** exist (the version
string and the build number); App Store Connect refuses a build number it has seen for that version.

## 6. Review

```sh
node .claude/skills/app-store/scripts/asc-review.mjs status
node .claude/skills/app-store/scripts/asc-review.mjs submit --dry-run
node .claude/skills/app-store/scripts/asc-review.mjs submit        # only when the person asks
node .claude/skills/app-store/scripts/asc-review.mjs cancel
```

Submitting is three calls and `submit` makes all three; half of them leaves a draft someone has to
find in the console. Withdrawing goes `CANCELING` → `WAITING_FOR_REVIEW` → `DEVELOPER_REJECTED` →
`PREPARE_FOR_SUBMISSION`; resubmitting works from `DEVELOPER_REJECTED` on — poll `status`.

## 7. Rules that cost a rejection

The listing script refuses the first two before sending anything:

- **Guideline 2.3.10 — no other platform.** Nothing in the listing or the iOS binary may name the
  words in `ASC_FORBIDDEN_WORDS` (Android, Google Play, Play Store by default). A description shared
  with Google Play usually has a line about Android: the iOS copy must drop it.
- **Guideline 1.5 — a support URL that answers.** It must reach a page that works without signing
  in; an app's root that redirects to a login does not count. It is set per version: a new version
  needs it again.
- **Guideline 3.1.2 — subscriptions need their terms.** Apple's standard EULA (or your own) linked
  from the description or the EULA field, plus the privacy policy. Do not drop it in an edit.
- **Guideline 3.1.1 — say what reviewers cannot see.** If the app has no in-app code redemption, a
  demo account, or anything that needs a server state, say so in the App Review notes
  (`appStoreReviewDetails`, editable any time).

## 8. Console only

Age-rating edge cases Apple adds between API versions, the App Privacy label, pricing and
availability, in-app purchase review screenshots. Record them for the person as manual tasks.
