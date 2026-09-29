import type { TargetOutcome } from "./runner.ts";

/** One line per target, for tools and the CLI. */
export function summarize(outcomes: TargetOutcome[]): string {
  const lines: string[] = [];
  for (const o of outcomes) {
    const where = o.target === "." ? "root" : o.target;
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
    lines.push(`[${where}] ${parts.length ? parts.join(" | ") : "up to date."}`);
  }
  return lines.join("\n");
}
