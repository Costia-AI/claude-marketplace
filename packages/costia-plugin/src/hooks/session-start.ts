import { execFileSync } from "node:child_process";
import { config } from "../config.ts";
import { get } from "../api/client.ts";
import { readCredentials } from "../auth/credentials.ts";
import { ensureBackgroundPoller, loginInstructions, readPendingLogin, startDeviceLogin } from "../auth/device-flow.ts";
import { checkoutFor } from "../state/checkouts.ts";
import { syncCheckout, syncUser, type TargetOutcome } from "../sync/runner.ts";
import { isCheap, runCheck } from "../setup/checks.ts";
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

/** Setup lines for the digest: held items, Claude's steps, and machine checks that stopped holding. */
async function setupLines(outcome: TargetOutcome, folders: { target?: string; checkout?: string }): Promise<string[]> {
  const lines: string[] = [];
  const setup = outcome.setup;
  if (!setup) return lines;
  const where = outcome.target === "." ? "" : outcome.target === "~" ? " (your ~/.claude)" : ` (${outcome.target})`;
  if (setup.held.length) {
    const names = setup.held.map((h) => h.flows.map((f) => f.entry.name).join(" + ") || h.item);
    lines.push(`${setup.held.length} Costia item(s)${where} wait for their setup (${names.join("; ")}) and are not installed yet: setup_status says what is left; start_setup opens the wizard for the user.`);
  }
  if (setup.claude.length) {
    lines.push(`Setup steps for Claude remain${where}: ${setup.claude.map((c) => `"${c.step.title}"`).join(", ")} — setup_status gives the instructions, complete_claude_step records them.`);
  }
  const broken: string[] = [];
  for (const flow of setup.flows) {
    for (const { step, done } of flow.steps) {
      if (!done || step.scope !== "machine" || !step.check || !isCheap(step.check)) continue;
      const result = await runCheck(step.check, { ...folders, flow: flow.id, approved: new Set() });
      if (!result.ok) broken.push(`${flow.entry.name}: ${step.title} (${result.reason})`);
    }
  }
  if (broken.length) lines.push(`Setup that no longer holds on this machine${where}: ${broken.join("; ")}. verify_setup re-checks; start_setup walks the user through it again.`);
  return lines;
}

async function sync(cwd: string): Promise<string[]> {
  const lines: string[] = [];
  const user = await syncUser({ timeoutMs: 1_500 }).catch(() => null);
  if (user?.report) {
    const written = user.report.written.filter((p) => !p.startsWith("rules/"));
    const rules = user.report.written.filter((p) => p.startsWith("rules/"));
    if (written.length) lines.push(`Costia updated your ~/.claude: ${written.join(", ")}.`);
    if (rules.length) lines.push(`Your Costia rules changed (${rules.join(", ")}); they apply from the next session.`);
    if (user.report.pending.length) lines.push(`${user.report.pending.length} change(s) to your ~/.claude wait for approval: /costia:sync reviews them.`);
    lines.push(...(await setupLines(user, {})));
  }
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
    lines.push(...(await setupLines(outcome, { target: outcome.target === "." ? found.root : `${found.root}/${outcome.target}`, checkout: found.root })));
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
