/**
 * Setup flows, schema 1 (docs/setup-flows.md in the parent repository). The
 * backend validates a spec when it is saved; the plugin validates it again
 * before running anything from it, because the server is not trusted to have.
 */

export type Scope = "machine" | "user" | "project" | "project_user";
export const SCOPES: readonly Scope[] = ["machine", "user", "project", "project_user"];

export type StepType = "check" | "input" | "confirm" | "secret" | "claude";
const STEP_TYPES: readonly StepType[] = ["check", "input", "confirm", "secret", "claude"];

export type Os = "linux" | "darwin" | "windows";

export interface Param {
  key: string;
  label?: string;
  description?: string;
  type: "string" | "enum" | "boolean" | "url";
  scope: Scope;
  options?: string[];
  default?: string | boolean;
  pattern?: string;
  env?: string;
  editable?: boolean;
  /** An input step may complete with this parameter empty. */
  optional?: boolean;
}

export interface SecretLocation {
  store: "infisical";
  name: string;
  domain?: string;
  project: string;
  env: string;
  path?: string;
}

export interface SecretSpec extends SecretLocation {
  source: "file" | "text" | "generate";
  accept?: string;
  maxBytes?: number;
  generate?: { kind: "random"; length?: number; charset?: "alnum" | "hex" | "base64url" } | { kind: "rsa"; bits?: number };
}

/** Where `file` and `run` checks look: the target the item is applied to, or the checkout's root. */
export type Base = "target" | "checkout";

export type Check =
  | { builtin: "command"; command: string; minVersion?: string }
  | { builtin: "file"; path: string; base?: Base }
  | { builtin: "env"; name: string }
  | { builtin: "infisical.logged-in"; domain?: string }
  | { builtin: "infisical.project-exists"; domain?: string; project: string }
  | { builtin: "infisical.secret-exists"; domain?: string; project: string; env: string; path?: string; name: string }
  | { builtin: "google-play.access"; secret: SecretLocation; package: string }
  | {
      builtin: "app-store-connect.access";
      p8: SecretLocation;
      keyId: SecretLocation;
      issuerId: SecretLocation;
      appId: string;
    }
  | { run: string[]; base?: Base; timeoutMs?: number; expectExit?: number };

export interface Step {
  id: string;
  title: string;
  scope: Scope;
  type: StepType;
  instructions?: Partial<Record<"*" | Os, string>>;
  check?: Check;
  params?: string[];
  secret?: SecretSpec;
  rotate?: boolean;
  prompt?: string;
}

export interface FlowSpec {
  schema: 1;
  summary?: string;
  params?: Param[];
  requires?: { flow: string; params?: Record<string, string | boolean> }[];
  steps: Step[];
  verify?: Check[];
}

const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ENV = /^[A-Z][A-Z0-9_]{0,63}$/;
const TEMPLATE = /\{\{\s*([\w.]+)\s*\}\}/g;
const BUILTIN_VARIABLES = new Set(["project.name", "os"]);
const BUILTINS = new Set([
  "command",
  "file",
  "env",
  "infisical.logged-in",
  "infisical.project-exists",
  "infisical.secret-exists",
  "google-play.access",
  "app-store-connect.access",
]);

/** `infisicalProject` → `INFISICAL_PROJECT`. */
export function envName(param: Param): string {
  return param.env ?? param.key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown, max = 2000): v is string => typeof v === "string" && v.length <= max;

/** Every `{{name}}` in a string. */
export function templateNames(text: string): string[] {
  return [...text.matchAll(TEMPLATE)].map((m) => m[1]!);
}

/** Replaces `{{key}}` by its value; unknown names are left as they are (validation refuses them first). */
export function expand(text: string, values: Record<string, string>): string {
  return text.replace(TEMPLATE, (whole, name: string) => (name in values ? values[name]! : whole));
}

/** Expands every string inside a JSON value. */
export function expandDeep<T>(value: T, values: Record<string, string>): T {
  if (typeof value === "string") return expand(value, values) as T;
  if (Array.isArray(value)) return value.map((v) => expandDeep(v, values)) as T;
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandDeep(v, values)])) as T;
  return value;
}

function validateTemplates(value: unknown, pointer: string, known: Set<string>, errors: string[]): void {
  if (typeof value === "string") {
    for (const name of templateNames(value)) {
      if (!known.has(name) && !BUILTIN_VARIABLES.has(name)) errors.push(`${pointer}: unknown parameter {{${name}}}`);
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => validateTemplates(v, `${pointer}/${i}`, known, errors));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) validateTemplates(v, `${pointer}/${k}`, known, errors);
}

function validateLocation(value: unknown, pointer: string, errors: string[]): void {
  if (!isObject(value)) return void errors.push(`${pointer}: expected a secret location`);
  if (value.store !== undefined && value.store !== "infisical") errors.push(`${pointer}/store: only "infisical" is supported`);
  for (const field of ["name", "project", "env"]) if (!isString(value[field], 200) || !value[field]) errors.push(`${pointer}/${field}: required`);
  for (const field of ["domain", "path"]) if (value[field] !== undefined && !isString(value[field], 300)) errors.push(`${pointer}/${field}: must be a string`);
}

export function validateCheck(check: unknown, pointer: string, errors: string[]): void {
  if (!isObject(check)) return void errors.push(`${pointer}: expected an object`);
  if ("run" in check) {
    const run = check.run;
    if (!Array.isArray(run) || run.length === 0 || run.length > 50 || !run.every((a) => isString(a, 1000))) {
      errors.push(`${pointer}/run: 1 to 50 strings`);
    }
    if (check.base !== undefined && check.base !== "target" && check.base !== "checkout") errors.push(`${pointer}/base: "target" or "checkout"`);
    if (check.timeoutMs !== undefined && !(Number.isInteger(check.timeoutMs) && (check.timeoutMs as number) > 0 && (check.timeoutMs as number) <= 60_000)) {
      errors.push(`${pointer}/timeoutMs: 1 to 60000`);
    }
    if (check.expectExit !== undefined && !Number.isInteger(check.expectExit)) errors.push(`${pointer}/expectExit: an integer`);
    return;
  }
  const builtin = check.builtin;
  if (typeof builtin !== "string" || !BUILTINS.has(builtin)) return void errors.push(`${pointer}/builtin: unknown check ${String(builtin)}`);
  const need = (field: string) => {
    if (!isString(check[field], 300) || !check[field]) errors.push(`${pointer}/${field}: required`);
  };
  switch (builtin) {
    case "command":
      need("command");
      if (typeof check.command === "string" && !templateNames(check.command).length && !isCommand(check.command)) {
        errors.push(`${pointer}/command: an executable name or an absolute path`);
      }
      if (check.minVersion !== undefined && !/^\d+(\.\d+){0,3}$/.test(String(check.minVersion))) errors.push(`${pointer}/minVersion: like 1.2.3`);
      break;
    case "file":
      need("path");
      if (check.base !== undefined && check.base !== "target" && check.base !== "checkout") errors.push(`${pointer}/base: "target" or "checkout"`);
      if (typeof check.path === "string" && (check.path.startsWith("/") || check.path.split("/").includes("..") || check.path.includes("\\"))) {
        errors.push(`${pointer}/path: relative to the checkout, no ".."`);
      }
      break;
    case "env":
      need("name");
      break;
    case "infisical.project-exists":
      need("project");
      break;
    case "infisical.secret-exists":
      need("project");
      need("env");
      need("name");
      break;
    case "google-play.access":
      validateLocation(check.secret, `${pointer}/secret`, errors);
      need("package");
      break;
    case "app-store-connect.access":
      validateLocation(check.p8, `${pointer}/p8`, errors);
      validateLocation(check.keyId, `${pointer}/keyId`, errors);
      validateLocation(check.issuerId, `${pointer}/issuerId`, errors);
      need("appId");
      break;
  }
}

/** A bare executable name looked up on PATH, or an absolute path to one. */
export function isCommand(command: string): boolean {
  return /^[\w.+-]{1,64}$/.test(command) || (/^(\/|[A-Za-z]:\\)/.test(command) && !command.includes("\0") && command.length <= 1024);
}

/**
 * Validates a spec; returns every problem as `<json pointer>: <reason>`.
 * `known` are the parameters templates may use besides the flow's own — those
 * of the flows it requires (docs/setup-flows.md, "Templates"); `"any"` skips
 * that check when the closure is not at hand (the backend makes it on publish).
 */
export function validateSpec(spec: unknown, known: Set<string> | "any" = new Set()): string[] {
  const errors: string[] = [];
  if (!isObject(spec)) return ["/: a flow spec must be an object"];
  if (spec.schema !== 1) errors.push("/schema: must be 1");
  if (spec.summary !== undefined && !isString(spec.summary, 500)) errors.push("/summary: at most 500 characters");

  const params = spec.params ?? [];
  const keys = new Set<string>();
  const envs = new Set<string>();
  if (!Array.isArray(params) || params.length > 50) errors.push("/params: at most 50");
  else
    params.forEach((p, i) => {
      const at = `/params/${i}`;
      if (!isObject(p)) return void errors.push(`${at}: expected an object`);
      if (typeof p.key !== "string" || !KEY.test(p.key)) errors.push(`${at}/key: letters and digits, starting with a letter`);
      else if (keys.has(p.key)) errors.push(`${at}/key: ${p.key} is declared twice`);
      else keys.add(p.key);
      if (!["string", "enum", "boolean", "url"].includes(p.type as string)) errors.push(`${at}/type: string, enum, boolean or url`);
      if (!SCOPES.includes(p.scope as Scope)) errors.push(`${at}/scope: machine, user, project or project_user`);
      if (p.label !== undefined && !isString(p.label, 120)) errors.push(`${at}/label: at most 120 characters`);
      if (p.description !== undefined && !isString(p.description, 2000)) errors.push(`${at}/description: at most 2000 characters`);
      if (p.type === "enum" && (!Array.isArray(p.options) || !p.options.length || p.options.length > 50 || !p.options.every((o) => isString(o, 200)))) {
        errors.push(`${at}/options: 1 to 50 strings`);
      }
      if (p.pattern !== undefined) {
        if (!isString(p.pattern, 200)) errors.push(`${at}/pattern: at most 200 characters`);
        else
          try {
            new RegExp(p.pattern);
          } catch {
            errors.push(`${at}/pattern: not a valid regular expression`);
          }
      }
      if (p.env !== undefined && (typeof p.env !== "string" || !ENV.test(p.env))) errors.push(`${at}/env: UPPER_SNAKE_CASE`);
      if (typeof p.key === "string" && KEY.test(p.key)) {
        const env = envName(p as unknown as Param);
        if (envs.has(env)) errors.push(`${at}/env: ${env} is used twice`);
        envs.add(env);
      }
      if (typeof p.default === "string" && templateNames(p.default).includes(String(p.key))) errors.push(`${at}/default: refers to itself`);
      if (p.optional !== undefined && typeof p.optional !== "boolean") errors.push(`${at}/optional: true or false`);
      if (p.editable !== undefined && typeof p.editable !== "boolean") errors.push(`${at}/editable: true or false`);
    });

  if (spec.requires !== undefined) {
    if (!Array.isArray(spec.requires) || spec.requires.length > 20) errors.push("/requires: at most 20");
    else
      spec.requires.forEach((r, i) => {
        if (!isObject(r) || !isString(r.flow, 200) || !r.flow) errors.push(`/requires/${i}/flow: required`);
        else if (r.params !== undefined && !isObject(r.params)) errors.push(`/requires/${i}/params: an object`);
      });
  }

  const steps = spec.steps;
  const ids = new Set<string>();
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 50) errors.push("/steps: 1 to 50 steps");
  else
    steps.forEach((s, i) => {
      const at = `/steps/${i}`;
      if (!isObject(s)) return void errors.push(`${at}: expected an object`);
      if (typeof s.id !== "string" || !STEP_ID.test(s.id)) errors.push(`${at}/id: lowercase letters, digits and dashes`);
      else if (ids.has(s.id)) errors.push(`${at}/id: ${s.id} is used twice`);
      else ids.add(s.id);
      if (!isString(s.title, 120) || !s.title) errors.push(`${at}/title: 1 to 120 characters`);
      if (!SCOPES.includes(s.scope as Scope)) errors.push(`${at}/scope: machine, user, project or project_user`);
      if (!STEP_TYPES.includes(s.type as StepType)) errors.push(`${at}/type: check, input, confirm, secret or claude`);
      if (s.instructions !== undefined) {
        if (!isObject(s.instructions)) errors.push(`${at}/instructions: an object keyed by *, linux, darwin, windows`);
        else
          for (const [os, text] of Object.entries(s.instructions)) {
            if (!["*", "linux", "darwin", "windows"].includes(os)) errors.push(`${at}/instructions/${os}: unknown operating system`);
            if (!isString(text, 20_000)) errors.push(`${at}/instructions/${os}: at most 20000 characters`);
          }
      }
      if (s.check !== undefined) validateCheck(s.check, `${at}/check`, errors);
      if (s.type === "check" && s.check === undefined) errors.push(`${at}/check: a check step needs a check`);
      if (s.type === "input") {
        if (!Array.isArray(s.params) || !s.params.length) errors.push(`${at}/params: an input step names its parameters`);
        else for (const k of s.params) if (!keys.has(String(k))) errors.push(`${at}/params: unknown parameter ${String(k)}`);
      }
      if (s.type === "secret") {
        if (!isObject(s.secret)) errors.push(`${at}/secret: required`);
        else {
          validateLocation(s.secret, `${at}/secret`, errors);
          if (!["file", "text", "generate"].includes(s.secret.source as string)) errors.push(`${at}/secret/source: file, text or generate`);
          if (s.secret.maxBytes !== undefined && !(Number.isInteger(s.secret.maxBytes) && (s.secret.maxBytes as number) > 0 && (s.secret.maxBytes as number) <= 1_048_576)) {
            errors.push(`${at}/secret/maxBytes: 1 to 1048576`);
          }
          const g = s.secret.generate;
          if (s.secret.source === "generate" && g !== undefined && (!isObject(g) || !["random", "rsa"].includes(g.kind as string))) {
            errors.push(`${at}/secret/generate: kind random or rsa`);
          }
        }
      }
      if (s.type === "claude" && (!isString(s.prompt, 20_000) || !s.prompt)) errors.push(`${at}/prompt: a claude step needs a prompt`);
    });

  if (spec.verify !== undefined) {
    if (!Array.isArray(spec.verify) || spec.verify.length > 20) errors.push("/verify: at most 20 checks");
    else spec.verify.forEach((c, i) => validateCheck(c, `/verify/${i}`, errors));
  }

  if (known !== "any") {
    const all = new Set([...keys, ...known]);
    validateTemplates(spec.steps, "/steps", all, errors);
    validateTemplates(spec.verify, "/verify", all, errors);
  }
  return errors;
}

/** The instructions to show on this operating system. */
export function instructionsFor(step: Step, os: Os): string {
  return step.instructions?.[os] ?? step.instructions?.["*"] ?? "";
}

export function currentOs(): Os {
  return process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
}

/** Whether a flow runs a program its author chose (docs/setup-flows.md §7). */
export function isSensitive(spec: FlowSpec): boolean {
  const checks = [...spec.steps.flatMap((s) => (s.check ? [s.check] : [])), ...(spec.verify ?? [])];
  return checks.some((c) => "run" in c);
}
