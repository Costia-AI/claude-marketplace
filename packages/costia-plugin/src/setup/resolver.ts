import { contextKey, machineState, type Context } from "./state.ts";
import { currentOs, envName, expand, expandDeep, instructionsFor, isSensitive, validateSpec, type FlowSpec, type Scope, type Step } from "./spec.ts";

/**
 * Which setup an item still needs (docs/setup-flows.md §5). Everything here is
 * pure over the manifest's `requires`, `flows` and `setup` plus this machine's
 * state, so gating decides the same way in a sync, a tool and the wizard.
 */

export interface FlowEntry {
  ref: string;
  name: string;
  version: number;
  versionId?: string;
  spec: FlowSpec;
  bindings?: Record<string, string | boolean>;
  sensitive?: boolean;
}

export interface StepState {
  flow: string;
  step: string;
  scope: Scope;
  version: number;
  doneAt: string;
  doneBy?: string;
}

/** The setup part of a manifest, or of `GET …/setup`. */
export interface SetupData {
  items?: { id: string; ref?: string; name: string; kind: string }[];
  requires?: Record<string, string[]>;
  flows?: Record<string, FlowEntry>;
  setup?: { states?: StepState[]; params?: Record<string, Record<string, string>> };
}

export interface StepStatus {
  step: Step;
  done: boolean;
  doneAt?: string;
  doneBy?: string;
}

export interface FlowStatus {
  id: string;
  entry: FlowEntry;
  /** Resolved parameter values, plus `project.name` and `os`. */
  values: Record<string, string>;
  /** The spec with every template expanded. */
  spec: FlowSpec;
  steps: StepStatus[];
  verified: boolean;
  /** Steps a person still has to do (everything but `claude`). */
  pending: Step[];
  /** `claude` steps not done yet. */
  claude: Step[];
  errors: string[];
  sensitive: boolean;
}

export interface ItemStatus {
  item: string;
  ready: boolean;
  flows: FlowStatus[];
}

const asText = (v: string | boolean | undefined): string | undefined => (v === undefined ? undefined : String(v));

/** A `requires` reference (an id once published, a ref in drafts) to the id it has in `data.flows`. */
function flowId(ref: string, data: SetupData): string | undefined {
  if (data.flows?.[ref]) return ref;
  return Object.entries(data.flows ?? {}).find(([, f]) => f.ref === ref || f.ref.endsWith(`/${ref}`))?.[0];
}

/** The flows a flow requires, nearest first (breadth-first in `requires` order), without itself. */
function requiredFlows(id: string, data: SetupData): string[] {
  const order: string[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = data.flows?.[queue.shift()!];
    for (const r of current?.spec?.requires ?? []) {
      const next = flowId(r.flow, data);
      if (next && !seen.has(next)) {
        seen.add(next);
        order.push(next);
        queue.push(next);
      }
    }
  }
  return order;
}

/** A flow's own parameter values before templates: stored, bound, or default. */
function ownValues(id: string, data: SetupData, machineParams: Record<string, Record<string, string>>): Record<string, string> {
  const entry = data.flows?.[id];
  const values: Record<string, string> = {};
  if (!entry || !Array.isArray(entry.spec?.params)) return values;
  const stored = { ...data.setup?.params?.[id], ...machineParams[id] };
  const bindings = entry.bindings ?? {};
  for (const p of entry.spec.params) {
    const bound = asText(bindings[p.key]);
    const value = bound !== undefined && !p.editable ? bound : stored[p.key] ?? bound ?? asText(p.default);
    if (value !== undefined) values[p.key] = value;
  }
  return values;
}

export function resolveFlow(id: string, data: SetupData, context: Context, projectName = ""): FlowStatus | null {
  const entry = data.flows?.[id];
  if (!entry) return null;
  const required = requiredFlows(id, data);
  const closureKeys = new Set(required.flatMap((r) => (data.flows?.[r]?.spec?.params ?? []).map((p) => p.key)));
  const errors = validateSpec(entry.spec, closureKeys);
  const machine = machineState();

  // Templates may use the parameters of the whole closure: the flow's own win, then the nearest required flow.
  const values: Record<string, string> = { "project.name": projectName, os: currentOs() };
  for (const source of [...required].reverse()) Object.assign(values, ownValues(source, data, machine.params));
  Object.assign(values, ownValues(id, data, machine.params));
  // Defaults may name other parameters; one pass is enough (a default never names itself).
  for (const key of Object.keys(values)) values[key] = expand(values[key]!, values);

  const spec = errors.length ? entry.spec : expandDeep(entry.spec, values);
  const states = data.setup?.states ?? [];
  const steps: StepStatus[] = (errors.length ? [] : spec.steps).map((step) => {
    if (step.scope === "machine") {
      const local = machine.steps[`${id}/${step.id}`];
      return { step, done: !!local, doneAt: local?.doneAt };
    }
    const remote = states.find((s) => s.flow === id && s.step === step.id && s.scope === step.scope);
    return { step, done: !!remote, doneAt: remote?.doneAt, doneBy: remote?.doneBy };
  });

  const verifiedAt = machine.verified[`${contextKey(context)}|${id}`];
  const needsVerify = !errors.length && (spec.verify?.length ?? 0) > 0;
  return {
    id,
    entry,
    values,
    spec,
    steps,
    verified: !needsVerify || verifiedAt?.version === entry.version,
    pending: steps.filter((s) => !s.done && s.step.type !== "claude").map((s) => s.step),
    claude: steps.filter((s) => !s.done && s.step.type === "claude").map((s) => s.step),
    errors: errors.map((e) => `${entry.ref}${e}`),
    sensitive: !errors.length && isSensitive(entry.spec),
  };
}

/** Every flow an item needs, in dependency order, with its status. */
export function itemStatus(item: string, data: SetupData, context: Context, projectName = ""): ItemStatus {
  const flows = (data.requires?.[item] ?? []).map((id) => resolveFlow(id, data, context, projectName));
  const missing = flows.some((f) => f === null);
  const resolved = flows.filter((f): f is FlowStatus => f !== null);
  const ready = !missing && resolved.every((f) => !f.errors.length && !f.pending.length && f.verified);
  return { item, ready, flows: resolved };
}

/** Items held back because their setup is incomplete. */
export function heldItems(data: SetupData, context: Context, projectName = ""): Map<string, ItemStatus> {
  const held = new Map<string, ItemStatus>();
  for (const item of Object.keys(data.requires ?? {})) {
    const status = itemStatus(item, data, context, projectName);
    if (!status.ready) held.set(item, status);
  }
  return held;
}

/** Every distinct flow of these items, in order, each once. */
export function closure(items: string[], data: SetupData, context: Context, projectName = ""): FlowStatus[] {
  const seen = new Map<string, FlowStatus>();
  for (const item of items) {
    for (const flow of itemStatus(item, data, context, projectName).flows) if (!seen.has(flow.id)) seen.set(flow.id, flow);
  }
  return [...seen.values()];
}

/** The OS-specific instructions of a step, expanded. */
export function stepInstructions(step: Step): string {
  return instructionsFor(step, currentOs());
}

function quote(value: string): string {
  return /^[\w@%+=:,./-]*$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * `.claude/costia/params.env` (scope `project`, committed) and
 * `.claude/costia/params.local.env` (the others, excluded from git) for the
 * flows these items use. Two flows giving one variable different values is a
 * conflict: the variable is left out and reported.
 */
export function paramsFiles(flows: FlowStatus[]): { shared: string | null; local: string | null; conflicts: string[] } {
  const shared = new Map<string, string>();
  const local = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const flow of flows) {
    for (const p of flow.errors.length ? [] : flow.entry.spec.params ?? []) {
      const value = flow.values[p.key];
      if (value === undefined || value === "") continue;
      const env = envName(p);
      const into = p.scope === "project" ? shared : local;
      const other = shared.get(env) ?? local.get(env);
      if (other !== undefined && other !== value) conflicts.add(env);
      into.set(env, value);
    }
  }
  const render = (map: Map<string, string>) => {
    const lines = [...map].filter(([k]) => !conflicts.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${quote(v)}`);
    return lines.length ? `# Generated by the costia plugin from setup flow parameters. Never holds secrets.\n${lines.join("\n")}\n` : null;
  };
  return { shared: render(shared), local: render(local), conflicts: [...conflicts] };
}
