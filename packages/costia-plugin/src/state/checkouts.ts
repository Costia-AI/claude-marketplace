import { realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { files } from "./paths.ts";
import { readJson, writeJson } from "./json-file.ts";

/**
 * Which folders on this machine are checkouts of which project. Absolute paths
 * never leave the machine: the backend knows a checkout only by its id.
 */
export interface Checkout {
  projectId: string;
  checkoutId: string;
  projectName?: string;
  /** The layout's claudeRoots, relative to the checkout root. */
  targets: string[];
  /** Last revision applied per target, sent as If-None-Match. */
  revisions?: Record<string, string>;
}

type Index = Record<string, Checkout>;

function load(): Index {
  return readJson<Index>(files.checkouts(), {});
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function fold(path: string): string {
  return process.platform === "darwin" || process.platform === "win32" ? path.toLowerCase() : path;
}

/** The checkout containing `cwd`: the longest registered root that is a prefix of it. */
export function checkoutFor(cwd: string): { root: string; checkout: Checkout } | null {
  const here = fold(canonical(cwd));
  let best: { root: string; checkout: Checkout } | null = null;
  for (const [root, checkout] of Object.entries(load())) {
    const r = fold(root);
    if (here === r || here.startsWith(r.endsWith(sep) ? r : r + sep)) {
      if (!best || root.length > best.root.length) best = { root, checkout };
    }
  }
  return best;
}

export function registerCheckout(root: string, checkout: Checkout): string {
  const index = load();
  const key = canonical(root);
  index[key] = checkout;
  writeJson(files.checkouts(), index);
  return key;
}

export function forgetCheckout(root: string): void {
  const index = load();
  delete index[canonical(root)];
  writeJson(files.checkouts(), index);
}

export function recordRevision(root: string, target: string, revision: string): void {
  const index = load();
  const checkout = index[root];
  if (!checkout) return;
  checkout.revisions = { ...checkout.revisions, [target]: revision };
  writeJson(files.checkouts(), index);
}

export function listCheckouts(): [string, Checkout][] {
  return Object.entries(load());
}

export function targetPath(root: string, target: string): string {
  return target === "." ? root : join(root, target);
}
