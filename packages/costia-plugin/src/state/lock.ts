import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

const STALE_MS = 15_000;

/**
 * A cross-process mutex made of a directory: `mkdir` either creates it or fails,
 * atomically, on every platform. The hook, the MCP server and a background login
 * poll can all run at once, and refresh tokens rotate — two processes refreshing
 * with the same token would burn it — so refreshing happens under this lock.
 */
export async function withLock<T>(path: string, run: () => Promise<T>, waitMs = 5_000): Promise<T> {
  const lock = `${path}.lock`;
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock, { recursive: true, force: true });
      } catch { /* it went away between the two calls */ }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${lock}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await run();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
