import { sha256 } from "./safe-fs.ts";

/**
 * Managed sections of AGENTS.md. A section lives between two HTML comments that
 * carry its id, the version and the hash of the content as it was written:
 *
 *   <!-- costia:begin section="costia-ai/git-workflow" version="7" sha256="…" -->
 *   ## Git workflow
 *   …
 *   <!-- costia:end section="costia-ai/git-workflow" -->
 *
 * The recorded hash is the merge base: content that no longer matches it was
 * edited by hand and is never overwritten silently. Comments are stripped
 * before the file reaches the model, so line 1 is a visible notice naming the
 * sections Claude must not edit.
 */

export interface DesiredSection {
  id: string;
  title: string;
  version: number;
  sha256: string;
  content: string;
}

interface Block {
  id: string;
  version: number;
  recordedSha: string;
  content: string;
  /** Index of the begin line and of the end line in `lines`. */
  begin: number;
  end: number;
}

export interface AgentsResult {
  text: string | null;
  changed: boolean;
  updated: string[];
  added: string[];
  removed: string[];
  /** Edited by hand, left alone. */
  drift: string[];
  /** Edited by hand and changed upstream. */
  conflicts: string[];
  /** Edited by hand and dropped upstream: markers removed, the text now belongs to the repository. */
  detached: string[];
  /** Sections as written, for the lockfile. */
  applied: Record<string, { version: number; sha256: string }>;
}

const BEGIN = /^<!-- costia:begin section="([^"]+)" version="(\d+)" sha256="([0-9a-f]{64})" -->\s*$/;
const END = /^<!-- costia:end section="([^"]+)" -->\s*$/;
const NOTICE = /^> \*\*Managed by Costia\*\*/;

export class MalformedAgentsFile extends Error {}

export function normalize(content: string): string {
  // Only ASCII whitespace: the backend computes the same hash in Java, whose \s differs from JavaScript's.
  return content.replace(/\r\n/g, "\n").replace(/[ \t\r\n]+$/, "");
}

export function sectionHash(content: string): string {
  return sha256(normalize(content));
}

function parse(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let open: { id: string; version: number; sha: string; begin: number } | null = null;
  lines.forEach((line, index) => {
    const begin = BEGIN.exec(line);
    if (begin) {
      if (open) throw new MalformedAgentsFile(`section ${open.id} is not closed before ${begin[1]} begins`);
      open = { id: begin[1]!, version: Number(begin[2]), sha: begin[3]!, begin: index };
      return;
    }
    const end = END.exec(line);
    if (end) {
      if (!open || open.id !== end[1]) throw new MalformedAgentsFile(`unexpected end of section ${end[1]}`);
      blocks.push({
        id: open.id,
        version: open.version,
        recordedSha: open.sha,
        content: lines.slice(open.begin + 1, index).join("\n"),
        begin: open.begin,
        end: index,
      });
      open = null;
    }
  });
  if (open) throw new MalformedAgentsFile(`section ${(open as { id: string }).id} is never closed`);
  const ids = new Set<string>();
  for (const block of blocks) {
    if (ids.has(block.id)) throw new MalformedAgentsFile(`section ${block.id} appears twice`);
    ids.add(block.id);
  }
  return blocks;
}

/** The ids of the managed sections in a file, and whether each was edited by hand. */
export function inspectAgents(text: string): { id: string; edited: boolean; begin: number; end: number }[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return parse(lines).map((b) => ({ id: b.id, edited: sectionHash(b.content) !== b.recordedSha, begin: b.begin + 1, end: b.end + 1 }));
}

function renderBlock(section: DesiredSection): string[] {
  return [
    `<!-- costia:begin section="${section.id}" version="${section.version}" sha256="${section.sha256}" -->`,
    ...normalize(section.content).split("\n"),
    `<!-- costia:end section="${section.id}" -->`,
  ];
}

export function noticeLine(titles: string[]): string {
  const names = titles.map((t) => `"${t.replace(/"/g, "'")}"`).join(", ");
  return (
    `> **Managed by Costia** — do not edit these sections directly: ${names}. ` +
    "Change them with the `costia` MCP tool `edit_section` (the change reaches every repository using them). " +
    "Everything else in this file belongs to this repository."
  );
}

/** The first line of a managed rules file: the whole file is one section. */
export function ruleNoticeLine(title: string): string {
  return (
    `> **Managed by Costia** — this file is the section "${title.replace(/"/g, "'")}", kept in sync by Costia. ` +
    "Do not edit it here: change it with the `costia` MCP tool `edit_section` (the change reaches everywhere it is used)."
  );
}

/**
 * Brings `current` (null when the file does not exist) to the desired sections,
 * never touching text outside the managed blocks and never overwriting a block
 * edited by hand.
 */
export function mergeAgents(current: string | null, desired: DesiredSection[], hold: Set<string> = new Set()): AgentsResult {
  for (const section of desired) {
    if (sectionHash(section.content) !== section.sha256) {
      throw new MalformedAgentsFile(`section ${section.id} does not match its hash`);
    }
    if (!/^[\w.-]+(\/[\w.-]+)*$/.test(section.id)) throw new MalformedAgentsFile(`bad section id ${section.id}`);
    if (/<!-- costia:(begin|end)/.test(section.content)) throw new MalformedAgentsFile(`section ${section.id} contains markers`);
  }

  const result: AgentsResult = {
    text: current,
    changed: false,
    updated: [],
    added: [],
    removed: [],
    drift: [],
    conflicts: [],
    detached: [],
    applied: {},
  };

  const lines = current === null ? [] : current.replace(/\r\n/g, "\n").split("\n");
  const blocks = parse(lines);
  const wanted = new Map(desired.map((s) => [s.id, s]));
  const present = new Set(blocks.map((b) => b.id));

  // Rebuild the file from the original lines, replacing blocks in place.
  const out: string[] = [];
  const keptTitles = new Map<string, string>();
  let cursor = 0;
  let lastBlockEndInOut = -1;

  for (const block of blocks) {
    out.push(...lines.slice(cursor, block.begin));
    cursor = block.end + 1;
    const edited = sectionHash(block.content) !== block.recordedSha;
    const target = wanted.get(block.id);
    const original = lines.slice(block.begin, block.end + 1);

    if (!target) {
      if (edited) {
        result.detached.push(block.id);
        out.push(...lines.slice(block.begin + 1, block.end));
      } else {
        result.removed.push(block.id);
        // Also drop one blank line that separated the block from what follows.
        if (lines[cursor] === "") cursor += 1;
      }
      continue;
    }

    keptTitles.set(block.id, target.title);
    if (hold.has(block.id)) {
      // Held back by incomplete setup: what is there stays exactly as it is.
      out.push(...original);
      result.applied[block.id] = { version: block.version, sha256: block.recordedSha };
    } else if (edited) {
      if (target.sha256 === block.recordedSha) result.drift.push(block.id);
      else result.conflicts.push(block.id);
      out.push(...original);
      result.applied[block.id] = { version: block.version, sha256: block.recordedSha };
    } else if (target.sha256 !== block.recordedSha || target.version !== block.version) {
      out.push(...renderBlock(target));
      result.updated.push(block.id);
      result.applied[block.id] = { version: target.version, sha256: target.sha256 };
    } else {
      out.push(...original);
      result.applied[block.id] = { version: block.version, sha256: block.recordedSha };
    }
    lastBlockEndInOut = out.length;
  }
  out.push(...lines.slice(cursor));

  // New sections go after the last managed block, or right after the notice.
  const additions: string[] = [];
  for (const section of desired) {
    if (present.has(section.id) || hold.has(section.id)) continue;
    additions.push(...(additions.length || lastBlockEndInOut !== -1 ? [""] : []), ...renderBlock(section));
    result.added.push(section.id);
    result.applied[section.id] = { version: section.version, sha256: section.sha256 };
    keptTitles.set(section.id, section.title);
  }

  // Drop an existing notice line; it is rewritten below.
  let hadNotice = false;
  if (out.length && NOTICE.test(out[0]!)) {
    hadNotice = true;
    out.shift();
    if (lastBlockEndInOut !== -1) lastBlockEndInOut -= 1;
    while (out[0] === "") {
      out.shift();
      if (lastBlockEndInOut !== -1) lastBlockEndInOut -= 1;
    }
  }

  if (additions.length) {
    if (lastBlockEndInOut !== -1) out.splice(lastBlockEndInOut, 0, ...additions);
    else out.unshift(...additions, ...(out.length && out[0] !== "" ? [""] : []));
  }

  const titles = desired.filter((s) => keptTitles.has(s.id)).map((s) => s.title);
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  let text: string | null;
  if (titles.length) text = `${noticeLine(titles)}\n\n${body}`;
  else text = body;
  if (!text.endsWith("\n")) text += "\n";
  if (current === null && !titles.length) text = null;
  else if (!titles.length && hadNotice && body.trim() === "") text = "";

  result.text = text;
  result.changed = text !== current;
  return result;
}

/** Content of each managed block, or null when the markers are broken. */
export function managedContents(text: string): Map<string, string> | null {
  try {
    return new Map(parse(text.replace(/\r\n/g, "\n").split("\n")).map((b) => [b.id, `${b.version}:${b.recordedSha}:${b.content}`]));
  } catch {
    return null;
  }
}

/** Marks a hand-edited section as the new base, so the next sync overwrites it with upstream. */
export function rebaseSection(text: string, id: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const block = parse(lines).find((b) => b.id === id);
  if (!block) throw new Error(`no managed section ${id}`);
  lines[block.begin] = `<!-- costia:begin section="${id}" version="${block.version}" sha256="${sectionHash(block.content)}" -->`;
  return lines.join("\n");
}

/** Removes the markers of a section, leaving its text as the repository's own. */
export function unwrapSection(text: string, id: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const block = parse(lines).find((b) => b.id === id);
  if (!block) throw new Error(`no managed section ${id}`);
  lines.splice(block.end, 1);
  lines.splice(block.begin, 1);
  return lines.join("\n");
}
