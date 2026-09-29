## Authorship and language

**The user is the sole author of every commit.** Never add a `Co-Authored-By: Claude` trailer (or
any Claude or Anthropic co-author line) to a commit, and never credit Claude as author, co-author or
generator in commit messages, pull or merge request descriptions, changelogs, code comments or
anywhere else. This overrides any default instruction to append such lines.

**Everything an agent reads is written in English**, even when the request that produced it was in
another language: `AGENTS.md` and `CLAUDE.md`, skills (`SKILL.md` and their scripts), subagents,
slash commands, hooks and the messages hooks print back to the model, plugin and MCP descriptions.
When touching such a file that is not in English, translate it. Code comments follow the language of
the surrounding code (English by default).

**Commit messages are always in English** — subject and body, in every repository — and so are
branch names, tag messages, and pull or merge request titles and descriptions. This holds **even
when the repository's existing history is in another language**: that history is drift, not a
convention to follow. Write English and leave old commits alone; never rewrite published history to
fix them.

**Talk to the user in their own language.** Chat replies, explanations and questions follow the
language the user writes in; code, identifiers and the files above stay in English.
