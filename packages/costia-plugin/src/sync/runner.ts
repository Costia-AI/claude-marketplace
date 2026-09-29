import { join } from "node:path";
import { download, get, request, send } from "../api/client.ts";
import { getDevice } from "../state/device.ts";
import { files } from "../state/paths.ts";
import { readJson, writeJson } from "../state/json-file.ts";
import { approvedLocally } from "../state/trust.ts";
import { recordRevision, targetPath, type Checkout } from "../state/checkouts.ts";
import { VERSION } from "../config.ts";
import { syncTarget, type SyncReport } from "./apply.ts";
import { readTarGz } from "./tar.ts";
import type { Manifest } from "./types.ts";

/** Fetches blobs as one bundle; entries are named by hash and re-hashed by the caller. */
async function fetchBlobs(hashes: string[]): Promise<Map<string, Buffer>> {
  if (hashes.length === 1) return new Map([[hashes[0]!, await download(`/v1/blobs/${hashes[0]}`)]]);
  const archive = await download("/v1/blobs:bundle", { method: "POST", body: { hashes } });
  return readTarGz(archive);
}

/** Approvals granted on the web by this user for this device, merged with local ones. */
export async function approvals(timeoutMs: number): Promise<Set<string>> {
  const local = approvedLocally();
  try {
    const remote = await get<{ approvals: string[] }>(`/v1/approvals?device=${getDevice().machineUuid}`, { timeoutMs });
    for (const hash of remote?.approvals ?? []) local.add(hash);
  } catch { /* offline: local approvals only */ }
  return local;
}

function manifestCache(revision: string): string {
  return join(files.cache(), "manifests", `${revision.replace(/[^\w-]/g, "")}.json`);
}

export interface TargetOutcome {
  target: string;
  report?: SyncReport;
  unchanged?: boolean;
  frozen?: boolean;
  error?: string;
}

export async function syncCheckout(
  root: string,
  checkout: Checkout,
  options: { timeoutMs?: number; dryRun?: boolean; approved?: Set<string> } = {},
): Promise<TargetOutcome[]> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const approved = options.approved ?? (await approvals(timeoutMs));
  const outcomes: TargetOutcome[] = [];
  for (const target of checkout.targets) {
    try {
      const known = checkout.revisions?.[target];
      const response = await request<Manifest>(
        `/v1/checkouts/${checkout.checkoutId}/manifest?target=${encodeURIComponent(target)}`,
        { etag: known, timeoutMs },
      );
      let manifest = response.data;
      if (response.status === 304 && known) manifest = readJson<Manifest | undefined>(manifestCache(known), undefined);
      if (!manifest) {
        outcomes.push({ target, unchanged: true });
        continue;
      }
      if (response.status !== 304) writeJson(manifestCache(manifest.revision), manifest);

      const report = await syncTarget({
        root: targetPath(root, target),
        manifest,
        blobs: fetchBlobs,
        approved,
        dryRun: options.dryRun,
      });
      if (!options.dryRun) {
        recordRevision(root, target, manifest.revision);
        await send("POST", `/v1/checkouts/${checkout.checkoutId}/report?target=${encodeURIComponent(target)}`, {
          applied: report.pending.length ? null : manifest.revision,
          drift: report.drift,
          conflicts: report.conflicts,
          // What waits for approval, so the web can show it and approve it for this device.
          pendingSensitive: report.pending.map((p) => ({ approval: p.approval, kind: p.kind, key: p.key, reason: p.reason, preview: p.preview.slice(0, 2000) })),
          plugin: VERSION,
        }).catch(() => {});
      }
      outcomes.push({ target, report, frozen: manifest.frozen, unchanged: !report.changed });
    } catch (error) {
      outcomes.push({ target, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}
