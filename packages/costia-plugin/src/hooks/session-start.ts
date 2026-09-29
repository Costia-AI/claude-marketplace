import { execFileSync } from "node:child_process";
import { config } from "../config.ts";
import { get } from "../api/client.ts";
import { readCredentials } from "../auth/credentials.ts";
import { ensureBackgroundPoller, loginInstructions, readPendingLogin, startDeviceLogin } from "../auth/device-flow.ts";
import { checkoutFor } from "../state/checkouts.ts";
import { syncCheckout } from "../sync/runner.ts";
import { emit, readHookInput } from "./io.ts";

/**
 * Runs at every session start, under a hard budget, and never fails a session:
 *
 *  1. not signed in → start the device flow, poll in the background, tell the
 *     user where to confirm;
 *  2. in a registered checkout → pull each target's manifest and apply what
 *     needs no approval (sections, plain skills…);
 *  3. say what changed, what waits for review and what is open, in a few lines.
 *
 * Changed sections are repeated in the context: the session may already have
 * read AGENTS.md before this hook rewrote it.
 */

const BUDGET_MS = 4_000;

interface Input {
  cwd?: string;
  source?: string;
}

function gitRemote(cwd: string): string | null {
  try {
    return execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 500, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);
}

async function login(entry: string): Promise<string> {
  let pending = readPendingLogin();
  if (!pending) pending = await startDeviceLogin(2_000);
  ensureBackgroundPoller(pending, entry);
  return `${loginInstructions(pending)} Until then the costia tools answer "not signed in". Once confirmed, /costia:status shows the account.`;
}

async function sync(cwd: string): Promise<string[]> {
  const lines: string[] = [];
  const found = checkoutFor(cwd);
  if (!found) {
    const remote = gitRemote(cwd);
    if (remote) {
      const match = await get<{ projects: { id: string; name: string }[] }>(`/v1/resolve?remote=${encodeURIComponent(remote)}`, { timeoutMs: 1_500 }).catch(() => null);
      const project = match?.projects?.[0];
      if (project) lines.push(`This repository belongs to the Costia project "${project.name}" but this folder is not linked on this machine: /costia:adopt links it.`);
    }
    return lines;
  }

  const outcomes = await syncCheckout(found.root, found.checkout, { timeoutMs: 1_500 });
  for (const outcome of outcomes) {
    const where = outcome.target === "." ? "" : ` (${outcome.target})`;
    if (outcome.error) {
      lines.push(`Costia sync skipped${where}: ${outcome.error}.`);
      continue;
    }
    if (outcome.frozen) lines.push(`The workspace of this project is frozen: you are reading it as it was when its owner's Premium lapsed.`);
    const report = outcome.report;
    if (!report) continue;
    const { updated, added, removed } = report.sections;
    if (updated.length || added.length) {
      lines.push(`Managed AGENTS.md sections${where} changed (${[...added, ...updated].join(", ")}); the file on disk is current — re-read AGENTS.md before relying on those rules.`);
    }
    if (removed.length) lines.push(`Managed sections removed${where}: ${removed.join(", ")}.`);
    const files = report.written.filter((p) => p !== "AGENTS.md" && p !== "CLAUDE.md");
    if (files.length) lines.push(`Costia updated${where}: ${files.join(", ")}.`);
    if (report.pending.length) {
      lines.push(`${report.pending.length} change(s)${where} run code or widen permissions and wait for the user's approval: /costia:sync reviews them.`);
    }
    if (report.conflicts.length) lines.push(`Conflicts${where} (edited here and upstream): ${report.conflicts.join(", ")} — /costia:sync resolves them.`);
    if (report.drift.length) lines.push(`Edited locally, kept${where}: ${report.drift.join(", ")}.`);
  }

  const tasks = await get<{ tasks: { title: string; manual: boolean }[] }>(
    `/v1/projects/${found.checkout.projectId}/tasks?state=open&manual=true&limit=3`,
    { timeoutMs: 1_000 },
  ).catch(() => null);
  if (tasks?.tasks?.length) {
    lines.push(`Waiting on the user in "${found.checkout.projectName ?? "this project"}": ${tasks.tasks.map((t) => t.title).join("; ")}.`);
  }
  return lines;
}

export async function sessionStart(entry: string): Promise<void> {
  if (process.env.COSTIA_QUIET) return;
  const input = await readHookInput<Input>();
  const cwd = input.cwd || process.cwd();

  const run = async (): Promise<{ context: string[]; message?: string }> => {
    if (!config.staticToken && !readCredentials()) {
      const text = await login(entry);
      return { context: [text], message: text };
    }
    return { context: await sync(cwd) };
  };

  let outcome: { context: string[]; message?: string };
  try {
    const result = await withBudget(run(), BUDGET_MS);
    outcome = result === "timeout" ? { context: ["Costia did not answer in time; the session starts without syncing (/costia:sync retries)."] } : result;
  } catch (error) {
    outcome = { context: [`Costia is unavailable (${error instanceof Error ? error.message : String(error)}).`] };
  }

  if (!outcome.context.length) return;
  emit({
    ...(outcome.message ? { systemMessage: outcome.message } : {}),
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: outcome.context.join("\n") },
  });
}
