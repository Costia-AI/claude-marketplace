import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSecret, resetCaches, writeSecret } from "../src/setup/providers/infisical.ts";
import { tempDir } from "./helpers.ts";

const SECRET = "s3cr3t-value-that-must-never-be-in-argv";
let bin: ReturnType<typeof tempDir>;
let calls: { url: string; body?: string }[];
const realFetch = globalThis.fetch;
const realPath = process.env.PATH;

beforeEach(() => {
  resetCaches();
  bin = tempDir();
  calls = [];
  delete process.env.INFISICAL_TOKEN;
  // A fake `infisical` that records its arguments and prints a token.
  writeFileSync(join(bin.path, "infisical"), `#!/bin/sh\necho "$@" >> "${bin.path}/argv.log"\necho token-123\n`);
  chmodSync(join(bin.path, "infisical"), 0o755);
  process.env.PATH = `${bin.path}:${realPath}`;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.includes("/api/v1/projects")) return new Response(JSON.stringify({ projects: [{ id: "pid", slug: "costia" }] }), { status: 200 });
    if (url.includes("/api/v3/secrets/raw/") && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ secret: { secretValue: SECRET } }), { status: 200 });
    if (url.includes("/api/v3/secrets/raw/") && init?.method === "POST") return new Response(JSON.stringify({ error: "Secret already exists" }), { status: 400 });
    if (url.includes("/api/v3/secrets/raw/") && init?.method === "PATCH") return new Response(JSON.stringify({ secret: {} }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.PATH = realPath;
  bin.cleanup();
});

const location = { store: "infisical" as const, domain: "https://eu.infisical.com", project: "costia", env: "prod", name: "PLAY_KEY" };

describe("infisical provider", () => {
  test("a secret travels only in a request body, never on a command line or in a URL", async () => {
    expect(await writeSecret(location, SECRET)).toBe("updated");
    const argv = readFileSync(join(bin.path, "argv.log"), "utf8");
    expect(argv).toContain("user get token --plain");
    expect(argv).not.toContain(SECRET);
    for (const call of calls) expect(call.url).not.toContain(SECRET);
    const writes = calls.filter((c) => c.body?.includes(SECRET));
    expect(writes.length).toBe(2); // POST refused as existing, then PATCH
    expect(JSON.parse(writes[1]!.body!)).toMatchObject({ workspaceId: "pid", environment: "prod", secretPath: "/" });
  });

  test("reading resolves the project slug and returns the value in memory only", async () => {
    expect(await readSecret(location)).toBe(SECRET);
    expect(calls[0]!.url).toBe("https://eu.infisical.com/api/v1/projects");
    expect(calls[1]!.url).toContain("workspaceId=pid");
  });

  test("an INFISICAL_TOKEN skips the CLI altogether", async () => {
    process.env.INFISICAL_TOKEN = "machine-identity";
    await readSecret(location);
    expect(() => readFileSync(join(bin.path, "argv.log"), "utf8")).toThrow();
    delete process.env.INFISICAL_TOKEN;
  });

  test("refuses a plain-http domain", async () => {
    await expect(readSecret({ ...location, domain: "http://infisical.example.com" })).rejects.toThrow(/https/);
  });
});
