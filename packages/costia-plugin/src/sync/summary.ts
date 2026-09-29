import type { TargetOutcome } from "./runner.ts";

/** One line per target, for tools and the CLI. */
export function summarize(outcomes: TargetOutcome[]): string {
  const lines: string[] = [];
  for (const o of outcomes) {
    const where = o.target === "." ? "root" : o.target === "~" ? "~/.claude" : o.target;
    if (o.error) {
      lines.push(`[${where}] failed: ${o.error}`);
      continue;
    }
    const r = o.report;
    if (!r) {
      lines.push(`[${where}] up to date.`);
      continue;
    }
    const parts: string[] = [];
    if (o.frozen) parts.push("workspace frozen: showing the snapshot");
    if (r.written.length) parts.push(`written: ${r.written.join(", ")}`);
    if (r.removed.length) parts.push(`removed: ${r.removed.join(", ")}`);
    if (r.pending.length) parts.push(`waiting for approval: ${r.pending.map((p) => `${p.key} (${p.reason})`).join("; ")}`);
    if (r.conflicts.length) parts.push(`conflicts: ${r.conflicts.join(", ")}`);
    if (r.drift.length) parts.push(`edited locally, kept: ${r.drift.join(", ")}`);
    if (r.detached.length) parts.push(`owned by this repository: ${r.detached.join(", ")}`);
    if (r.errors.length) parts.push(`errors: ${r.errors.join("; ")}`);
    for (const h of o.setup?.held ?? []) {
      const missing = h.flows.flatMap((f) => [
        ...f.pending.map((s) => `${f.entry.name}: ${s.title} (${s.scope})`),
        ...(f.pending.length || f.verified ? [] : [`${f.entry.name}: its checks have not passed on this machine`]),
        ...f.errors,
      ]);
      parts.push(`held until its setup is done: ${h.item} — ${missing.join("; ") || "a required flow is missing"} (start_setup)`);
    }
    if (o.setup?.claude.length) parts.push(`setup steps for Claude: ${o.setup.claude.map((c) => `${c.flow.entry.name}/${c.step.id}`).join(", ")} (setup_status)`);
    if (o.setup?.conflicts.length) parts.push(`parameters set differently by two flows, left out: ${o.setup.conflicts.join(", ")}`);
    lines.push(`[${where}] ${parts.length ? parts.join(" | ") : "up to date."}`);
  }
  return lines.join("\n");
}
