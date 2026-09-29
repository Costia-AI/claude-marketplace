import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/** Reads a JSON file, or returns `fallback` when it is missing or unreadable. */
export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Writes a JSON file atomically with owner-only permissions. Every file the
 * plugin keeps about the user goes through here, so none is ever world-readable
 * or left half-written by a killed process.
 */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temp, path);
}

export function removeFile(path: string): void {
  rmSync(path, { force: true });
}
