import { homedir } from "node:os";
import { join } from "node:path";
import { download, get, request, send } from "../api/client.ts";
import { getDevice } from "../state/device.ts";
import { files } from "../state/paths.ts";
import { readJson, writeJson } from "../state/json-file.ts";
import { approvedLocally } from "../state/trust.ts";
import { recordRevision, targetPath, type Checkout } from "../state/checkouts.ts";
import { VERSION } from "../config.ts";
import { syncTarget, syncUserRoot, type SyncReport } from "./apply.ts";
import { readTarGz } from "./tar.ts";
import type { Manifest, UserManifest } from "./types.ts";
import { closure, heldItems, itemStatus, paramsFiles, type FlowStatus, type ItemStatus, type SetupData } from "../setup/resolver.ts";
import { checkApprovals, verifyFlow } from "../setup/verify.ts";
import type { Context } from "../setup/state.ts";
import type { Step } from "../setup/spec.ts";

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
  /** Items held back by incomplete setup, and `claude` steps of applied items still to do. */
  setup?: SetupOutcome;
}

export interface SetupOutcome {
  /** Every flow the items here use. */
  flows: FlowStatus[];
  held: ItemStatus[];
  claude: { item: string; flow: FlowStatus; step: Step }[];
  /** Parameters two flows set differently: left out of the parameter files. */
  conflicts: string[];
}

/**
 * Gating (docs/setup-flows.md §5): which items are held, and — when asked —
 * verifies flows whose steps are all done but whose checks never passed on
 * this machine, so finishing the steps elsewhere is enough to unblock a sync.
 */
export async function evaluateSetup(
  data: SetupData,
  context: Context,
  options: { target?: string; checkout?: string; approved: Set<string>; projectName?: string; autoVerify?: boolean },
): Promise<{ held: Map<string, ItemStatus>; outcome: SetupOutcome; params?: { shared: string | null; local: string | null }; approvals: ReturnType<typeof checkApprovals> }> {
  let held = heldItems(data, context, options.projectName);
  if (options.autoVerify) {
    const verifiable = new Map<string, FlowStatus>();
    for (const status of held.values()) {
      for (const flow of status.flows) if (!flow.errors.length && !flow.pending.length && !flow.verified) verifiable.set(flow.id, flow);
    }
    for (const flow of verifiable.values()) await verifyFlow(flow, context, { target: options.target, checkout: options.checkout }, options.approved);
    if (verifiable.size) held = heldItems(data, context, options.projectName);
  }
  const items = Object.keys(data.requires ?? {});
  const flows = closure(items, data, context, options.projectName);
  const params = data.flows ? paramsFiles(flows) : undefined;
  const claude: SetupOutcome["claude"] = [];
  for (const item of items) {
    if (held.has(item)) continue;
    for (const flow of itemStatus(item, data, context, options.projectName).flows) {
      for (const step of flow.claude) if (!claude.some((c) => c.flow.id === flow.id && c.step.id === step.id)) claude.push({ item, flow, step });
    }
  }
  return {
    held,
    outcome: { flows, held: [...held.values()], claude, conflicts: params?.conflicts ?? [] },
    params: params ? { shared: params.shared, local: params.local } : undefined,
    approvals: checkApprovals(flows, options.approved),
  };
}

export async function syncCheckout(
  root: string,
  checkout: Checkout,
  options: { timeoutMs?: number; dryRun?: boolean; approved?: Set<string>; autoVerify?: boolean } = {},
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

      const checkoutRoot = targetPath(root, target);
      const setup = await evaluateSetup(manifest, { project: checkout.projectId }, {
        target: checkoutRoot,
        checkout: root,
        approved,
        projectName: checkout.projectName,
        autoVerify: options.autoVerify && !options.dryRun,
      });
      const report = await syncTarget({
        root: checkoutRoot,
        manifest,
        blobs: fetchBlobs,
        approved,
        held: new Set(setup.held.keys()),
        params: setup.params,
        dryRun: options.dryRun,
      });
      report.pending.push(...setup.approvals);
      if (!options.dryRun) {
        recordRevision(root, target, manifest.revision);
        await send("POST", `/v1/checkouts/${checkout.checkoutId}/report?target=${encodeURIComponent(target)}`, {
          applied: report.pending.length || setup.outcome.held.length ? null : manifest.revision,
          drift: report.drift,
          conflicts: report.conflicts,
          // What waits for approval, so the web can show it and approve it for this device.
          pendingSensitive: report.pending.map((p) => ({ approval: p.approval, kind: p.kind, key: p.key, reason: p.reason, preview: p.preview.slice(0, 2000) })),
          pendingSetup: setup.outcome.held.map((h) => ({
            item: h.item,
            flows: h.flows.filter((f) => f.pending.length || !f.verified || f.errors.length).map((f) => ({ flow: f.id, steps: f.pending.map((st) => st.id), verify: f.verified })),
          })),
          claudeSteps: setup.outcome.claude.map((c) => ({ item: c.item, flow: c.flow.id, step: c.step.id })),
          plugin: VERSION,
        }).catch(() => {});
      }
      outcomes.push({ target, report, frozen: manifest.frozen, unchanged: !report.changed, setup: setup.outcome });
    } catch (error) {
      outcomes.push({ target, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}

/** ~/.claude, or wherever $CLAUDE_CONFIG_DIR points Claude Code. */
export function userRoot(): string {
  return process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.startsWith("/") ? process.env.CLAUDE_CONFIG_DIR : join(homedir(), ".claude");
}

/**
 * The user destination: items the user installs into ~/.claude for every
 * project on every machine. A backend without it (404) is not an error.
 */
export async function syncUser(options: { timeoutMs?: number; dryRun?: boolean; approved?: Set<string>; autoVerify?: boolean } = {}): Promise<TargetOutcome | null> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  try {
    const cached = readJson<UserManifest | undefined>(files.userManifest(), undefined);
    let response;
    try {
      response = await request<UserManifest>(`/v1/me/manifest?device=${getDevice().machineUuid}`, { etag: cached?.revision, timeoutMs });
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
    const manifest = response.status === 304 ? cached : response.data;
    if (!manifest || (!manifest.files.length && !manifest.agents?.sections?.length && !readJson(files.userLock(), null))) return null;
    if (response.status !== 304) writeJson(files.userManifest(), manifest);
    const approved = options.approved ?? (await approvals(timeoutMs));
    const setup = await evaluateSetup(manifest, { user: true }, { approved, autoVerify: options.autoVerify && !options.dryRun });
    const report = await syncUserRoot({ root: userRoot(), manifest, blobs: fetchBlobs, approved, held: new Set(setup.held.keys()), dryRun: options.dryRun });
    report.pending.push(...setup.approvals);
    return { target: "~", report, unchanged: !report.changed, setup: setup.outcome };
  } catch (error) {
    return { target: "~", error: error instanceof Error ? error.message : String(error) };
  }
}
