---
name: catalog-authoring
description: How to turn a skill, subagent, command or output style from this repository into a reusable Costia catalogue item with good tags, or publish a new version of one.
user-invocable: false
---

# Publishing to the Costia catalogue

An item is installed in other repositories, often by other people, so it has to read well without this repository's context.

1. **Read it as a stranger.** Look for references to this repository that will not exist elsewhere: paths, service names, internal URLs, people. Replace them with general wording, or ask the user whether the item should stay private to this project.
2. **Keep the frontmatter honest.** A `description` must say when the item applies. Keep `allowed-tools` to the minimum. Anything that grants Bash, Write or Edit, runs scripts, or declares hooks is **sensitive**: every user installing it approves it on their machine, and every new version asks again. Say so to the user.
3. **Tag it.**
   - Call `list_tags` and reuse existing tags; do not invent synonyms.
   - Tag by where the item applies, not by what it is:
     - platform: `ios`, `android`, `web`, `desktop`;
     - language and framework: `java`, `spring`, `react`, `expo`;
     - domain: `payments`, `infra`.
   - An item for every repository gets the tag `general`.
4. **Avoid duplicates.** Call `search_catalog` first. If the item exists and the user owns it, publish a new version (`item` argument) with a one-line `changelog`.
5. **Publish** with `publish_item`, then give the item's web link.

AGENTS.md sections are not published from files: they are created on the web or changed with `edit_section`.
