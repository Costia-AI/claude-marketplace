import { send } from "../api/client.ts";
import { files } from "../state/paths.ts";
import { readJson, writeJson } from "../state/json-file.ts";
import type { Scope } from "./spec.ts";

/**
 * Where the result of a step is kept (docs/setup-flows.md §3): scope `machine`
 * in the plugin's state on this computer, every other scope in the backend.
 * Parameter values are never secrets; secrets never reach either place.
 */

interface MachineState {
  steps: Record<string, { doneAt: string; version: number }>;
  params: Record<string, Record<string, string>>;
  /** `<context>|<flow id>`: the flow version whose verify last passed on this machine. */
  verified: Record<string, { version: number; at: string }>;
}

const empty = (): MachineState => ({ steps: {}, params: {}, verified: {} });

export function machineState(): MachineState {
  return { ...empty(), ...readJson<Partial<MachineState>>(files.setup(), {}) };
}

function save(state: MachineState): void {
  writeJson(files.setup(), state);
}

/** Where a flow runs: a project id, or "user" for the user destination. */
export type Context = { project: string } | { user: true };

export function contextKey(context: Context): string {
  return "project" in context ? context.project : "user";
}

export async function recordStep(context: Context, flow: string, step: string, scope: Scope, version: number): Promise<void> {
  if (scope === "machine") {
    const state = machineState();
    state.steps[`${flow}/${step}`] = { doneAt: new Date().toISOString(), version };
    return save(state);
  }
  if ((scope === "project" || scope === "project_user") && !("project" in context)) throw new Error(`a ${scope} step needs a project`);
  await send("PUT", "/v1/setup/states", { ...("project" in context ? { project: context.project } : {}), flow, step, scope, version });
}

export async function resetStep(context: Context, flow: string, step: string, scope: Scope): Promise<void> {
  if (scope === "machine") {
    const state = machineState();
    delete state.steps[`${flow}/${step}`];
    return save(state);
  }
  const query = new URLSearchParams({ flow, step, scope, ...("project" in context ? { project: context.project } : {}) });
  await send("DELETE", `/v1/setup/states?${query}`);
}

export async function storeParams(context: Context, flow: string, scope: Scope, values: Record<string, string>): Promise<void> {
  if (!Object.keys(values).length) return;
  if (scope === "machine") {
    const state = machineState();
    state.params[flow] = { ...state.params[flow], ...values };
    return save(state);
  }
  await send("PUT", "/v1/setup/params", { ...("project" in context ? { project: context.project } : {}), flow, scope, values });
}

export function recordVerified(context: Context, flow: string, version: number): void {
  const state = machineState();
  state.verified[`${contextKey(context)}|${flow}`] = { version, at: new Date().toISOString() };
  save(state);
}

export function forgetVerified(context: Context, flow: string): void {
  const state = machineState();
  delete state.verified[`${contextKey(context)}|${flow}`];
  save(state);
}
