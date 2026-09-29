import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config, VERSION } from "./config.ts";
import { send } from "./api/client.ts";
import { forgetCredentials, readCredentials } from "./auth/credentials.ts";
import { isAlive, loginInstructions, pollUntilDone, readPendingLogin, startDeviceLogin } from "./auth/device-flow.ts";
import { deviceFacts, getDevice } from "./state/device.ts";
import { files } from "./state/paths.ts";
import { removeFile } from "./state/json-file.ts";
import { checkoutFor } from "./state/checkouts.ts";
import { syncCheckout } from "./sync/runner.ts";
import { undoSync } from "./sync/apply.ts";
import { sessionStart } from "./hooks/session-start.ts";
import { preToolUse } from "./hooks/pre-tool-use.ts";
import { summarize } from "./sync/summary.ts";

const entry = fileURLToPath(import.meta.url);

/** Tells the backend about this device right after signing in. */
async function registerDevice(): Promise<void> {
  const device = getDevice();
  await send("PUT", `/v1/devices/${device.machineUuid}`, { label: device.label, ...deviceFacts(), plugin: VERSION });
}

async function login(): Promise<void> {
  if (readCredentials()) return console.log("Already signed in.");
  const pending = readPendingLogin() ?? (await startDeviceLogin());
  console.log(loginInstructions(pending));
  if (isAlive(pending.pollerPid)) {
    // The session-start hook already polls in the background; wait for its result.
    while (Date.now() < pending.expiresAt && isAlive(pending.pollerPid) && !readCredentials()) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    const credentials = readCredentials();
    console.log(credentials ? `Signed in as ${credentials.account.email ?? credentials.account.sub}.` : "Sign-in did not complete; run /costia:login again.");
    process.exitCode = credentials ? 0 : 1;
    return;
  }
  const result = await pollUntilDone(pending, registerDevice);
  console.log(result.status === "done" ? `Signed in as ${result.credentials.account.email ?? result.credentials.account.sub}.` : `Sign-in failed: ${result.reason}.`);
  process.exitCode = result.status === "done" ? 0 : 1;
}

/**
 * Forgets the session on this machine. The issuer does not let a public client
 * revoke its own refresh token; to cut a device off for good, revoke it on the
 * web (/devices), which the backend enforces per device.
 */
async function logout(): Promise<void> {
  forgetCredentials();
  removeFile(files.pendingLogin());
  console.log(`Signed out of Costia on this machine. To revoke this device everywhere: ${config.web}/devices`);
}

function status(): void {
  const credentials = readCredentials();
  const pending = readPendingLogin();
  const device = getDevice();
  console.log(`costia plugin ${VERSION} — device "${device.label}" (${device.machineUuid})`);
  if (config.staticToken) console.log("Using COSTIA_TOKEN.");
  else if (credentials) console.log(`Signed in as ${credentials.account.email ?? credentials.account.sub}.`);
  else if (pending) console.log(`Not signed in yet. ${loginInstructions(pending)}`);
  else console.log("Not signed in. Run /costia:login.");
  const here = checkoutFor(process.cwd());
  console.log(here ? `This folder is a checkout of "${here.checkout.projectName ?? here.checkout.projectId}" (targets: ${here.checkout.targets.join(", ")}).` : "This folder is not linked to a Costia project.");
}

async function sync(args: string[]): Promise<void> {
  if (args[0] === "--undo") {
    const dirs = readdirSync(files.backups()).sort();
    const last = dirs[dirs.length - 1];
    if (!last) return console.log("No sync to undo.");
    const dir = join(files.backups(), last);
    const restored = undoSync(dir, (p) => readFileSync(p, "utf8"), (p) => readFileSync(p));
    console.log(`Restored ${restored.join(", ")} from ${dir}.`);
    return;
  }
  const here = checkoutFor(process.cwd());
  if (!here) return console.log("This folder is not linked to a Costia project.");
  console.log(summarize(await syncCheckout(here.root, here.checkout, { dryRun: args.includes("--dry-run") })));
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  switch (command) {
    case "mcp": {
      const { runMcp } = await import("./mcp/server.ts");
      return runMcp();
    }
    case "hook":
      if (args[0] === "session-start") return sessionStart(entry);
      if (args[0] === "pre-tool-use") return preToolUse();
      return;
    case "login":
      return login();
    case "login-poll": {
      // Detached from the session that started it; nothing to print to.
      const pending = readPendingLogin();
      if (pending) await pollUntilDone(pending, registerDevice);
      return;
    }
    case "logout":
      return logout();
    case "status":
      return status();
    case "sync":
      return sync(args);
    case "version":
      return console.log(VERSION);
    default:
      console.log("usage: costia <login|logout|status|sync [--dry-run|--undo]|mcp|hook session-start|hook pre-tool-use|version>");
  }
}

main(process.argv.slice(2)).catch((error) => {
  // Hooks must never break a session; everything else reports and exits non-zero.
  if (process.argv[2] === "hook") process.exit(0);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
