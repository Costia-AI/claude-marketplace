import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { request as httpRequest } from "node:http";
import { runWizard } from "../src/setup/wizard/server.ts";
import { machineState } from "../src/setup/state.ts";
import type { SetupData } from "../src/setup/resolver.ts";
import { tempDir } from "./helpers.ts";

let state: ReturnType<typeof tempDir>;
let config: ReturnType<typeof tempDir>;
beforeEach(() => {
  state = tempDir();
  config = tempDir();
  process.env.COSTIA_STATE_DIR = state.path;
  process.env.COSTIA_CONFIG_DIR = config.path;
  process.env.COSTIA_WIZARD_TEST_VAR = "set";
});
afterEach(() => {
  state.cleanup();
  config.cleanup();
});

const plan: SetupData = {
  items: [{ id: "item1", name: "Thing", kind: "SKILL" }],
  requires: { item1: ["flow1"] },
  flows: {
    flow1: {
      ref: "me/env",
      name: "An environment variable",
      version: 1,
      spec: { schema: 1, steps: [{ id: "var", title: "Export it", scope: "machine", type: "check", check: { builtin: "env", name: "COSTIA_WIZARD_TEST_VAR" } }] },
    },
  },
  setup: { states: [], params: {} },
};

function call(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: init.method ?? "GET", headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function start() {
  const events: Record<string, unknown>[] = [];
  let url = "";
  const code = runWizard({ items: ["item1"], user: true, open: false, plan: async () => plan, out: (line) => events.push(JSON.parse(line)), onListening: (u) => (url = u) });
  while (!url) await new Promise((r) => setTimeout(r, 10));
  const token = url.split("/s/")[1]!.replace(/\/$/, "");
  const origin = new URL(url).origin;
  return { code, events, url, token, origin };
}

describe("wizard", () => {
  test("refuses a wrong token, host, origin or missing header", async () => {
    const w = await start();
    expect((await call(w.url.replace(w.token, "x".repeat(w.token.length)))).status).toBe(404);
    expect((await call(`${w.origin}/`)).status).toBe(404);
    expect((await call(w.url, { headers: { host: `evil.example:${new URL(w.url).port}` } })).status).toBe(421);
    const page = await call(w.url);
    expect(page.status).toBe(200);
    expect(page.body).toContain("<title>Costia · Set up</title>");

    const body = JSON.stringify({ flow: "flow1", step: "var" });
    const json = { "content-type": "application/json" };
    expect((await call(`${w.url}api/steps/check`, { method: "POST", headers: json, body })).status).toBe(403);
    expect((await call(`${w.url}api/steps/check`, { method: "POST", headers: { ...json, "x-costia-wizard": w.token, origin: "https://evil.example" }, body })).status).toBe(403);
    expect(machineState().steps["flow1/var"]).toBeUndefined();

    const ok = await call(`${w.url}api/steps/check`, { method: "POST", headers: { ...json, "x-costia-wizard": w.token, origin: w.origin }, body });
    expect(JSON.parse(ok.body).ok).toBe(true);
    expect(machineState().steps["flow1/var"]).toBeTruthy();
    expect(w.events).toContainEqual({ event: "step_done", flow: "flow1", step: "var", scope: "machine" });

    const planView = JSON.parse((await call(`${w.url}api/plan`)).body);
    expect(planView.flows[0].steps[0].done).toBe(true);

    await call(`${w.url}api/abort`, { method: "POST", headers: { "x-costia-wizard": w.token } });
    expect(await w.code).toBe(1);
    expect(w.events.at(-1)).toEqual({ event: "aborted", reason: "cancelled in the browser" });
  });

  test("the page carries a strict CSP", async () => {
    const w = await start();
    const res = await new Promise<import("node:http").IncomingMessage>((resolve) => httpRequest(w.url, resolve).end());
    expect(String(res.headers["content-security-policy"])).toContain("default-src 'none'");
    expect(String(res.headers["content-security-policy"])).toContain("connect-src 'self'");
    res.resume();
    await call(`${w.url}api/abort`, { method: "POST", headers: { "x-costia-wizard": w.token } });
    await w.code;
  });
});
