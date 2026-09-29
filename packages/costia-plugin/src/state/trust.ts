import { files } from "./paths.ts";
import { readJson, writeJson } from "./json-file.ts";

/**
 * Approval hashes this user granted on this machine for sensitive content.
 * Only `sync_review` adds to it, after the user answered the elicitation form.
 */
interface Trust {
  approved: Record<string, { at: string; what: string }>;
}

export function approvedLocally(): Set<string> {
  return new Set(Object.keys(readJson<Trust>(files.trust(), { approved: {} }).approved));
}

export function approve(entries: { approval: string; what: string }[]): void {
  const trust = readJson<Trust>(files.trust(), { approved: {} });
  const at = new Date().toISOString();
  for (const entry of entries) trust.approved[entry.approval] = { at, what: entry.what };
  writeJson(files.trust(), trust);
}
