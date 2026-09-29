import { describeCheck, runApproval, runCheck, type CheckResult } from "./checks.ts";
import { recordVerified, type Context } from "./state.ts";
import type { FlowStatus } from "./resolver.ts";
import type { Check } from "./spec.ts";
import type { PendingApproval } from "../sync/apply.ts";

export interface VerifyOutcome {
  flow: FlowStatus;
  results: { check: Check; label: string; result: CheckResult }[];
  ok: boolean;
}

/** The folders `file` and `run` checks are relative to (docs/setup-flows.md, "Checks"). */
export interface Folders {
  target?: string;
  checkout?: string;
}

/** Runs a flow's `verify` checks; when they all pass, records it for this machine and context. */
export async function verifyFlow(flow: FlowStatus, context: Context, folders: Folders, approved: Set<string>): Promise<VerifyOutcome> {
  const results: VerifyOutcome["results"] = [];
  for (const check of flow.spec.verify ?? []) {
    results.push({ check, label: describeCheck(check), result: await runCheck(check, { ...folders, flow: flow.id, approved }) });
  }
  const ok = !flow.errors.length && results.every((r) => r.result.ok);
  if (ok) recordVerified(context, flow.id, flow.entry.version);
  return { flow, results, ok };
}

/**
 * The `run` checks of these flows that wait for the user's approval, in the
 * shape a sync reports sensitive content in, so `sync_review` and the web's
 * approvals page handle them like any other.
 */
export function checkApprovals(flows: FlowStatus[], approved: Set<string>): PendingApproval[] {
  const pending: PendingApproval[] = [];
  for (const flow of flows) {
    const checks = [...flow.spec.steps.flatMap((s) => (s.check ? [s.check] : [])), ...(flow.spec.verify ?? [])];
    for (const check of checks) {
      if (!("run" in check)) continue;
      const approval = runApproval(flow.id, check);
      if (approved.has(approval) || pending.some((p) => p.approval === approval)) continue;
      pending.push({
        approval,
        kind: "check",
        key: `${flow.entry.ref}: ${check.run.join(" ")}`,
        reason: `the setup flow "${flow.entry.name}" runs a program to check itself`,
        preview: JSON.stringify(check, null, 2),
      });
    }
  }
  return pending;
}
