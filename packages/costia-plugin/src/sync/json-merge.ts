import { hashValue } from "./canonical.ts";

/**
 * Costia owns individual entries of `.claude/settings.json` and `.mcp.json`,
 * never the whole file. An entry is addressed by a key:
 *
 *   enabledPlugins.<plugin@marketplace>     object member
 *   extraKnownMarketplaces.<name>           object member
 *   env.<VAR>                               object member
 *   mcpServers.<name>                       object member
 *   hooks.<Event>#<sha256 of the group>     element of an array
 *   permissions.allow#<rule>                element of an array (also deny, ask, additionalDirectories)
 *   permissions.defaultMode                 object member
 *   <top-level key>                         the whole value
 *
 * The lockfile keeps, per owned key, the hash of the value Costia wrote. That
 * hash is the merge base: a value the user changed is left alone.
 */

type Json = Record<string, unknown>;

const MEMBER_TOPS = new Set(["enabledPlugins", "extraKnownMarketplaces", "env", "mcpServers"]);
const ARRAY_MEMBERS = new Set(["allow", "deny", "ask", "additionalDirectories"]);

interface Address {
  top: string;
  member?: string;
  item?: string;
}

function parseKey(key: string): Address {
  const dot = key.indexOf(".");
  if (dot === -1) return { top: key };
  const top = key.slice(0, dot);
  const rest = key.slice(dot + 1);
  const hash = rest.indexOf("#");
  if (hash === -1 || MEMBER_TOPS.has(top)) return { top, member: rest };
  return { top, member: rest.slice(0, hash), item: rest.slice(hash + 1) };
}

function matches(element: unknown, item: string): boolean {
  return element === item || hashValue(element) === item;
}

/** Splits a desired settings object into owned entries. */
export function flatten(desired: Json): Map<string, unknown> {
  const entries = new Map<string, unknown>();
  for (const [top, value] of Object.entries(desired)) {
    if (MEMBER_TOPS.has(top) && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [name, v] of Object.entries(value as Json)) entries.set(`${top}.${name}`, v);
    } else if (top === "hooks" && value && typeof value === "object") {
      for (const [event, groups] of Object.entries(value as Json)) {
        for (const group of (groups as unknown[]) ?? []) entries.set(`hooks.${event}#${hashValue(group)}`, group);
      }
    } else if (top === "permissions" && value && typeof value === "object") {
      for (const [member, v] of Object.entries(value as Json)) {
        if (ARRAY_MEMBERS.has(member) && Array.isArray(v)) for (const rule of v) entries.set(`permissions.${member}#${String(rule)}`, rule);
        else entries.set(`permissions.${member}`, v);
      }
    } else {
      entries.set(top, value);
    }
  }
  return entries;
}

export function readEntry(doc: Json, key: string): unknown {
  const { top, member, item } = parseKey(key);
  const container = doc[top];
  if (member === undefined) return container;
  if (!container || typeof container !== "object") return undefined;
  const value = (container as Json)[member];
  if (item === undefined) return value;
  return Array.isArray(value) ? value.find((element) => matches(element, item)) : undefined;
}

export function writeEntry(doc: Json, key: string, value: unknown): void {
  const { top, member, item } = parseKey(key);
  if (member === undefined) {
    doc[top] = value;
    return;
  }
  if (!doc[top] || typeof doc[top] !== "object" || Array.isArray(doc[top])) doc[top] = {};
  const container = doc[top] as Json;
  if (item === undefined) {
    container[member] = value;
    return;
  }
  if (!Array.isArray(container[member])) container[member] = [];
  const list = container[member] as unknown[];
  if (!list.some((element) => matches(element, item))) list.push(value);
}

export function removeEntry(doc: Json, key: string): void {
  const { top, member, item } = parseKey(key);
  if (member === undefined) {
    delete doc[top];
    return;
  }
  const container = doc[top] as Json | undefined;
  if (!container || typeof container !== "object") return;
  if (item === undefined) delete container[member];
  else if (Array.isArray(container[member])) {
    container[member] = (container[member] as unknown[]).filter((element) => !matches(element, item));
    if (!(container[member] as unknown[]).length) delete container[member];
  }
  if (!Object.keys(container).length) delete doc[top];
}

export interface PendingEntry {
  key: string;
  approval: string;
  reason: string;
  value: unknown;
}

export interface JsonMergeResult {
  doc: Json;
  changed: boolean;
  owned: Record<string, string>;
  added: string[];
  updated: string[];
  removed: string[];
  drift: string[];
  conflicts: string[];
  detached: string[];
  pending: PendingEntry[];
}

export function approvalHash(scope: string, key: string, value: unknown): string {
  return hashValue({ scope, key, value });
}

/**
 * Three-way merge of owned entries. `sensitivity` says why an entry needs
 * approval (or null), `approved` is the set of approval hashes this user
 * granted. A sensitive entry is written only when approved; otherwise the old
 * owned value stays as it is and the entry is reported as pending.
 */
export function mergeOwnedEntries(options: {
  scope: string;
  current: Json;
  desired: Map<string, unknown>;
  owned: Record<string, string>;
  sensitivity: (key: string, value: unknown) => string | null;
  approved: Set<string>;
}): JsonMergeResult {
  const doc = structuredClone(options.current);
  const result: JsonMergeResult = {
    doc,
    changed: false,
    owned: {},
    added: [],
    updated: [],
    removed: [],
    drift: [],
    conflicts: [],
    detached: [],
    pending: [],
  };

  const keys = new Set([...options.desired.keys(), ...Object.keys(options.owned)]);
  for (const key of [...keys].sort()) {
    const base = options.owned[key];
    const local = readEntry(doc, key);
    const localHash = local === undefined ? undefined : hashValue(local);
    const wanted = options.desired.has(key) ? options.desired.get(key) : undefined;
    const wantedHash = options.desired.has(key) ? hashValue(wanted) : undefined;

    const gate = (): boolean => {
      const reason = wanted === undefined ? null : options.sensitivity(key, wanted);
      if (!reason) return true;
      const approval = approvalHash(options.scope, key, wanted);
      if (options.approved.has(approval)) return true;
      result.pending.push({ key, approval, reason, value: wanted });
      return false;
    };

    if (wantedHash === undefined) {
      // No longer wanted.
      if (localHash === undefined) continue;
      if (localHash === base) {
        removeEntry(doc, key);
        result.removed.push(key);
      } else {
        result.detached.push(key);
      }
      continue;
    }

    if (base === undefined) {
      // New to this repository.
      if (localHash === wantedHash) {
        result.owned[key] = wantedHash;
      } else if (localHash !== undefined) {
        result.conflicts.push(key);
      } else if (gate()) {
        writeEntry(doc, key, wanted);
        result.owned[key] = wantedHash;
        result.added.push(key);
      }
      continue;
    }

    if (localHash === undefined) {
      result.detached.push(key);
      continue;
    }
    if (localHash === wantedHash) {
      result.owned[key] = wantedHash;
      continue;
    }
    if (localHash !== base) {
      if (wantedHash === base) result.drift.push(key);
      else result.conflicts.push(key);
      result.owned[key] = base;
      continue;
    }
    if (gate()) {
      // Array items are addressed by value, so an update is a remove plus an add.
      removeEntry(doc, key);
      writeEntry(doc, key, wanted);
      result.owned[key] = wantedHash;
      result.updated.push(key);
    } else {
      result.owned[key] = base;
    }
  }

  result.changed = JSON.stringify(doc) !== JSON.stringify(options.current);
  return result;
}
