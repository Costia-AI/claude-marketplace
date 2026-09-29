import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, timingSafeEqual } from "node:crypto";
import { get } from "../../api/client.ts";
import { checkoutFor, targetPath } from "../../state/checkouts.ts";
import { approvals, syncCheckout, syncUser } from "../../sync/runner.ts";
import { summarize } from "../../sync/summary.ts";
import { fetchPlan, saveDraftStep } from "../catalog.ts";
import { describeCheck, runApproval, runCheck } from "../checks.ts";
import { writeSecret } from "../providers/infisical.ts";
import { closure, itemStatus, stepInstructions, type FlowStatus, type SetupData } from "../resolver.ts";
import { currentOs, SCOPES, type Scope, type SecretSpec, type Step } from "../spec.ts";
import { recordStep, resetStep, storeParams, type Context } from "../state.ts";
import { verifyFlow } from "../verify.ts";
import { wizardPage } from "./page.ts";

/**
 * The local setup wizard (docs/setup-flows.md §6). A person walks the steps in
 * a browser; the plugin runs the checks, stores the parameters and hands
 * secrets straight to their store. It listens on 127.0.0.1 only, under an
 * unguessable path, refuses foreign Host and Origin headers, needs a header a
 * cross-site form cannot send on every write, and never approves sensitive
 * content. Events go to stdout as JSON lines for Claude to watch.
 */

export interface WizardOptions {
  /** A registered checkout (or a folder inside one); absent for the user destination. */
  checkout?: string;
  target?: string;
  items: string[];
  user?: boolean;
  open?: boolean;
  idleMs?: number;
  /** Where events go; stdout by default. */
  out?: (line: string) => void;
  /** Overrides for tests. */
  plan?: (context: Context, items: string[], target: string) => Promise<SetupData>;
  onListening?: (url: string) => void;
}

export type WizardEvent =
  | { event: "listening" }
  | { event: "step_done"; flow: string; step: string; scope: Scope }
  | { event: "step_failed"; flow: string; step: string; reason: string }
  | { event: "verify_failed"; flow: string; check: number; reason: string }
  | { event: "completed"; applied: string[]; claudeSteps: { flow: string; step: string }[] }
  | { event: "aborted"; reason: string };

const MAX_BODY = 1024 * 1024 + 4096;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sameToken(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function openBrowser(url: string): boolean {
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(command, args as string[], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function generate(spec: SecretSpec): string {
  const g = spec.generate ?? { kind: "random" as const };
  if (g.kind === "rsa") {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: g.bits ?? 2048 });
    return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  }
  const length = Math.min(Math.max(g.length ?? 40, 16), 256);
  const charset = g.charset ?? "alnum";
  if (charset === "hex") return randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
  if (charset === "base64url") return randomBytes(length).toString("base64url").slice(0, length);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < 248 && out.length < length) out += alphabet[byte % 62];
    }
  }
  return out;
}

function validateValue(flow: FlowStatus, key: string, value: string): string | null {
  const param = flow.entry.spec.params?.find((p) => p.key === key);
  if (!param) return `unknown parameter ${key}`;
  if (value.length > 2000) return `${param.label ?? key} is longer than 2000 characters`;
  if (param.type === "boolean" && value !== "true" && value !== "false") return `${param.label ?? key} must be true or false`;
  if (param.type === "enum" && !(param.options ?? []).includes(value)) return `${param.label ?? key} must be one of ${(param.options ?? []).join(", ")}`;
  if (param.type === "url" && !/^https?:\/\/\S+$/.test(value)) return `${param.label ?? key} must be a URL`;
  if (!value) return param.optional ? null : `${param.label ?? key} is required`;
  if (param.pattern && !new RegExp(param.pattern).test(value)) return `${param.label ?? key} does not match ${param.pattern}`;
  return null;
}

export async function runWizard(options: WizardOptions): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const emit = (event: WizardEvent) => out(JSON.stringify(event));
  const target = options.target ?? ".";

  let context: Context;
  let root: string | undefined;
  let checkoutRoot: string | undefined;
  let projectName = "";
  const found = options.user ? null : checkoutFor(options.checkout ?? process.cwd());
  if (options.user) context = { user: true };
  else {
    if (!found) throw new Error(`${options.checkout ?? process.cwd()} is not a registered checkout (adopt_checkout links it)`);
    context = { project: found.checkout.projectId };
    root = found.root;
    checkoutRoot = targetPath(found.root, target);
    projectName = found.checkout.projectName ?? "";
  }
  const loadPlan = options.plan ?? ((c: Context, items: string[], t: string) => fetchPlan(c, items, t));

  let data = await loadPlan(context, options.items, target);
  let approved = await approvals(10_000);
  const flows = () => closure(options.items, data, context, projectName);
  const refresh = async () => {
    data = await loadPlan(context, options.items, target);
  };

  const token = randomBytes(32).toString("base64url");
  const prefix = `/s/${token}`;
  let port = 0;
  let finished: ((code: number) => void) | null = null;
  const done = new Promise<number>((resolve) => (finished = resolve));
  let idle: NodeJS.Timeout | undefined;
  const idleMs = options.idleMs ?? 30 * 60_000;
  const close = (code: number) => {
    clearTimeout(idle);
    setTimeout(() => {
      server.close();
      server.closeAllConnections?.();
      finished?.(code);
    }, 300);
  };
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      emit({ event: "aborted", reason: `no activity for ${Math.round(idleMs / 60_000)} minutes` });
      close(1);
    }, idleMs);
  };

  const find = (flowId: string, stepId: string): { flow: FlowStatus; step: Step } => {
    const flow = flows().find((f) => f.id === flowId);
    const step = flow?.spec.steps.find((s) => s.id === stepId);
    if (!flow || !step) throw new HttpError(404, "no such step");
    return { flow, step };
  };

  const complete = async (flow: FlowStatus, step: Step): Promise<{ ok: boolean; reason: string }> => {
    const check = step.check;
    if (check) {
      const result = await runCheck(check, { target: checkoutRoot, checkout: root, flow: flow.id, approved });
      if (!result.ok) {
        emit({ event: "step_failed", flow: flow.id, step: step.id, reason: result.reason });
        return result;
      }
    }
    await recordStep(context, flow.id, step.id, step.scope, flow.entry.version);
    emit({ event: "step_done", flow: flow.id, step: step.id, scope: step.scope });
    await refresh();
    return { ok: true, reason: check ? describeCheck(check) : "Done." };
  };

  const planView = () => {
    const list = flows();
    return {
      title: data.items?.length === 1 ? data.items[0]!.name : `${options.items.length} items`,
      context: "user" in context ? "user" : "project",
      projectName,
      os: currentOs(),
      items: data.items ?? [],
      flows: list.map((f) => ({
        id: f.id,
        ref: f.entry.ref,
        name: f.entry.name,
        version: f.entry.version,
        summary: f.spec.summary ?? "",
        errors: f.errors,
        verified: f.verified,
        approvals: [...f.spec.steps.flatMap((s) => (s.check ? [s.check] : [])), ...(f.spec.verify ?? [])]
          .filter((c) => "run" in c && !approved.has(runApproval(f.id, c)))
          .map(describeCheck),
        params: (f.errors.length ? [] : f.entry.spec.params ?? []).map((p) => ({
          ...p,
          value: f.values[p.key] ?? "",
          fixed: f.entry.bindings?.[p.key] !== undefined && !p.editable,
        })),
        steps: f.steps.map(({ step, done, doneAt, doneBy }) => ({
          id: step.id,
          title: step.title,
          scope: step.scope,
          type: step.type,
          instructions: stepInstructions(step),
          done,
          doneAt,
          doneBy,
          hasCheck: !!step.check,
          checkLabel: step.check ? describeCheck(step.check) : "",
          params: step.params ?? [],
          rotate: !!step.rotate,
          prompt: step.type === "claude" ? step.prompt : undefined,
          secret: step.secret ? { name: step.secret.name, project: step.secret.project, env: step.secret.env, path: step.secret.path ?? "/", source: step.secret.source, accept: step.secret.accept, maxBytes: step.secret.maxBytes } : undefined,
        })),
      })),
    };
  };

  const storeSecret = async (flowId: string, stepId: string, value: string) => {
    const { flow, step } = find(flowId, stepId);
    if (step.type !== "secret" || !step.secret) throw new HttpError(400, "not a secret step");
    if (!value) return { ok: false, reason: "empty value" };
    const how = await writeSecret(step.secret, value);
    // The value leaves memory with this scope; only its name is ever reported.
    const result = await complete(flow, { ...step, check: { builtin: "infisical.secret-exists", domain: step.secret.domain, project: step.secret.project, env: step.secret.env, path: step.secret.path, name: step.secret.name } });
    return result.ok ? { ok: true, reason: `${step.secret.name} ${how} in Infisical.` } : result;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, {
        "content-type": type === "application/json" ? "application/json; charset=utf-8" : type,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        ...(type.startsWith("text/html") ? { "content-security-policy": (body as { csp: string }).csp } : {}),
      });
      res.end(type.startsWith("text/html") ? (body as { html: string }).html : JSON.stringify(body));
    };

    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(421, { error: "wrong host" });
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (!url.pathname.startsWith(`${prefix}/`) && url.pathname !== prefix) return send(404, { error: "not found" });
    const given = url.pathname.slice(3, 3 + token.length);
    if (!sameToken(given, token)) return send(404, { error: "not found" });
    const path = url.pathname.slice(prefix.length).replace(/^\/+/, "");
    touch();

    if (req.method === "GET" && (path === "" || path === "index.html")) {
      const nonce = randomBytes(16).toString("base64");
      const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
      return send(200, { html: wizardPage(nonce), csp }, "text/html; charset=utf-8");
    }
    if (req.method === "GET" && path === "api/plan") return send(200, planView());
    if (req.method !== "POST") return send(405, { error: "method not allowed" });

    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(403, { error: "foreign origin" });
    if (!sameToken(req.headers["x-costia-wizard"] as string | undefined, token)) return send(403, { error: "missing wizard header" });

    const raw = await readBody(req, MAX_BODY);
    if (path === "api/steps/secret") {
      const flowId = url.searchParams.get("flow") ?? "";
      const stepId = url.searchParams.get("step") ?? "";
      const { step } = find(flowId, stepId);
      if (step.secret?.source !== "file") throw new HttpError(400, "this step does not take a file");
      if (raw.length > (step.secret.maxBytes ?? 65_536)) throw new HttpError(413, "the file is too large");
      return send(200, await storeSecret(flowId, stepId, raw.toString("utf8")));
    }
    let body: Record<string, unknown> = {};
    try {
      body = raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
    } catch {
      throw new HttpError(400, "not JSON");
    }
    const flowId = String(body.flow ?? "");
    const stepId = String(body.step ?? "");

    switch (path) {
      case "api/steps/check":
      case "api/steps/done": {
        const { flow, step } = find(flowId, stepId);
        if (step.type === "claude") throw new HttpError(400, "Claude does this step");
        if (step.type === "input" || step.type === "secret") {
          if (!step.check) throw new HttpError(400, "fill the step in first");
        }
        if (path === "api/steps/check" && !step.check) throw new HttpError(400, "this step has no check");
        return send(200, await complete(flow, step));
      }
      case "api/steps/reset": {
        const { flow, step } = find(flowId, stepId);
        await resetStep(context, flow.id, step.id, step.scope);
        await refresh();
        return send(200, { ok: true, reason: "Marked as not done." });
      }
      case "api/steps/input": {
        const { flow, step } = find(flowId, stepId);
        if (step.type !== "input") throw new HttpError(400, "not an input step");
        const values = (body.values ?? {}) as Record<string, unknown>;
        const byScope = new Map<Scope, Record<string, string>>();
        for (const key of step.params ?? []) {
          const param = flow.entry.spec.params?.find((p) => p.key === key);
          if (!param) continue;
          if (flow.entry.bindings?.[key] !== undefined && !param.editable) continue;
          const value = String(values[key] ?? "").trim();
          const problem = validateValue(flow, key, value);
          if (problem) return send(200, { ok: false, reason: problem });
          if (!value) continue;
          byScope.set(param.scope, { ...byScope.get(param.scope), [key]: value });
        }
        for (const [scope, vals] of byScope) await storeParams(context, flow.id, scope, vals);
        await refresh();
        const fresh = find(flowId, stepId);
        return send(200, await complete(fresh.flow, fresh.step));
      }
      case "api/steps/secret-text":
        return send(200, await storeSecret(flowId, stepId, String(body.text ?? "")));
      case "api/steps/secret-generate": {
        const { step } = find(flowId, stepId);
        if (!step.secret) throw new HttpError(400, "not a secret step");
        return send(200, await storeSecret(flowId, stepId, generate(step.secret)));
      }
      case "api/drafts": {
        const flow = flows().find((f) => f.id === flowId);
        if (!flow) throw new HttpError(404, "no such flow");
        const title = String(body.title ?? "").trim();
        const scope = String(body.scope ?? "project") as Scope;
        if (!title) throw new HttpError(400, "a step needs a title");
        if (!SCOPES.includes(scope)) throw new HttpError(400, "bad scope");
        const message = await saveDraftStep(flow.id, flow.entry.spec, { title, instructions: String(body.instructions ?? "").slice(0, 20_000), scope });
        return send(200, { ok: true, message });
      }
      case "api/verify": {
        approved = await approvals(10_000);
        const results: { flow: string; label: string; ok: boolean; reason: string }[] = [];
        let ok = true;
        for (const flow of flows()) {
          if (flow.pending.length || flow.errors.length) {
            ok = false;
            results.push({ flow: flow.entry.name, label: "steps", ok: false, reason: flow.errors[0] ?? `${flow.pending.length} step(s) left` });
            continue;
          }
          const outcome = await verifyFlow(flow, context, { target: checkoutRoot, checkout: root }, approved);
          outcome.results.forEach((r, i) => {
            results.push({ flow: flow.entry.name, label: r.label, ok: r.result.ok, reason: r.result.reason });
            if (!r.result.ok) emit({ event: "verify_failed", flow: flow.id, check: i, reason: r.result.reason });
          });
          if (!outcome.results.length) results.push({ flow: flow.entry.name, label: "steps", ok: true, reason: "all done" });
          ok &&= outcome.ok;
        }
        if (!ok) return send(200, { completed: false, results, message: "Some checks failed; nothing was installed." });
        await refresh();
        let summary = "";
        if (found && root) summary = summarize(await syncCheckout(root, found.checkout, { approved }));
        else {
          const outcome = await syncUser({ approved });
          summary = outcome ? summarize([outcome]) : "";
        }
        const applied = options.items.filter((item) => itemStatus(item, data, context, projectName).ready);
        const claudeSteps = flows().flatMap((f) => f.claude.map((s) => ({ flow: f.id, step: s.id, title: s.title })));
        emit({ event: "completed", applied, claudeSteps: claudeSteps.map(({ flow, step }) => ({ flow, step })) });
        close(0);
        return send(200, {
          completed: true,
          results,
          claudeSteps,
          message: applied.length ? `Installed and checked. ${summary.split("\n")[0] ?? ""}` : "Checked.",
        });
      }
      case "api/abort":
        emit({ event: "aborted", reason: "cancelled in the browser" });
        close(1);
        return send(200, { ok: true });
      default:
        return send(404, { error: "not found" });
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: message.slice(0, 300) }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}${prefix}/`;
  touch();
  emit({ event: "listening" });
  options.onListening?.(url);
  if (options.open !== false && !openBrowser(url)) process.stderr.write(`Open ${url} to continue the setup.\n`);

  const stop = () => {
    emit({ event: "aborted", reason: "interrupted" });
    close(1);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const code = await done;
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  return code;
}

/** For a CLI without a checkout argument: the items whose setup is incomplete in this checkout. */
export async function heldItemsHere(checkout: string, target: string): Promise<string[]> {
  const found = checkoutFor(checkout);
  if (!found) return [];
  const manifest = await get<SetupData>(`/v1/checkouts/${found.checkout.checkoutId}/manifest?target=${encodeURIComponent(target)}`);
  return Object.keys(manifest.requires ?? {}).filter((item) => !itemStatus(item, manifest, { project: found.checkout.projectId }, found.checkout.projectName).ready);
}
