import { execFileSync } from "node:child_process";

/**
 * git without a shell, without prompts, over ssh or https only, never through
 * the file protocol and never recursing into submodules. `--` always separates
 * options from remotes and paths, so no value can be read as a flag.
 */
export function git(args: string[], options: { cwd?: string; timeoutMs?: number } = {}): string {
  return execFileSync("git", ["-c", "protocol.file.allow=never", "-c", "submodule.recurse=false", ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_ALLOW_PROTOCOL: "ssh:https", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

export function tryGit(args: string[], cwd: string): string | null {
  try {
    return git(args, { cwd, timeoutMs: 2_000 }) || null;
  } catch {
    return null;
  }
}

export function originOf(dir: string): string | null {
  return tryGit(["remote", "get-url", "origin"], dir);
}

export function branchOf(dir: string): string | null {
  const branch = tryGit(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  return branch && branch !== "HEAD" ? branch : null;
}
