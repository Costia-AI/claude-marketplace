import { spawn } from "node:child_process";
import { platform } from "node:os";
import { config } from "../config.ts";
import { getDevice } from "../state/device.ts";
import { files } from "../state/paths.ts";
import { readJson, removeFile, writeJson } from "../state/json-file.ts";
import { saveTokens, type Credentials } from "./credentials.ts";
import { endpoints, OAuthError, postForm, type TokenResponse } from "./oidc.ts";

/** A device authorization in progress (RFC 8628), shared by the hook and the background poll. */
export interface PendingLogin {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  intervalSeconds: number;
  pollerPid?: number;
}

interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export function readPendingLogin(): PendingLogin | null {
  const pending = readJson<PendingLogin | null>(files.pendingLogin(), null);
  if (!pending || pending.expiresAt <= Date.now()) return null;
  return pending;
}

/**
 * Starts a device authorization. The machine uuid goes along as `costia_device`
 * so accounts can show which computer is asking and stamp it into the token.
 */
export async function startDeviceLogin(timeoutMs = 3_000): Promise<PendingLogin> {
  const device = getDevice();
  const { deviceAuthorization } = await endpoints(timeoutMs);
  const response = await postForm<DeviceAuthorizationResponse>(
    deviceAuthorization,
    {
      client_id: config.clientId,
      scope: config.scope,
      costia_device: device.machineUuid,
      costia_device_label: device.label.slice(0, 120),
      costia_device_os: platform().slice(0, 40),
    },
    timeoutMs,
  );
  const pending: PendingLogin = {
    deviceCode: response.device_code,
    userCode: response.user_code,
    verificationUri: response.verification_uri,
    verificationUriComplete: response.verification_uri_complete,
    expiresAt: Date.now() + response.expires_in * 1000,
    intervalSeconds: response.interval ?? 5,
  };
  writeJson(files.pendingLogin(), pending);
  return pending;
}

export type PollResult =
  | { status: "done"; credentials: Credentials }
  | { status: "pending"; slowDown: boolean }
  | { status: "failed"; reason: string };

export async function pollOnce(pending: PendingLogin): Promise<PollResult> {
  const { token } = await endpoints();
  try {
    const tokens = await postForm<TokenResponse>(token, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: pending.deviceCode,
      client_id: config.clientId,
    });
    removeFile(files.pendingLogin());
    return { status: "done", credentials: saveTokens(tokens) };
  } catch (error) {
    if (error instanceof OAuthError) {
      if (error.code === "authorization_pending") return { status: "pending", slowDown: false };
      if (error.code === "slow_down") return { status: "pending", slowDown: true };
      removeFile(files.pendingLogin());
      return { status: "failed", reason: error.code === "access_denied" ? "sign-in was denied" : error.message };
    }
    return { status: "pending", slowDown: false };
  }
}

/** Polls until the user confirms, denies, or the code expires. */
export async function pollUntilDone(
  pending: PendingLogin,
  onDone?: (c: Credentials) => Promise<void>,
): Promise<Exclude<PollResult, { status: "pending" }>> {
  let interval = pending.intervalSeconds;
  while (Date.now() < pending.expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    const result = await pollOnce(pending);
    if (result.status === "done") {
      await onDone?.(result.credentials).catch(() => {});
      return result;
    }
    if (result.status === "failed") return result;
    if (result.slowDown) interval += 5;
  }
  removeFile(files.pendingLogin());
  return { status: "failed", reason: "the code expired" };
}

export function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `costia login-poll` detached, so the session is not held while the user
 * confirms in the browser. At most one poller runs at a time.
 */
export function ensureBackgroundPoller(pending: PendingLogin, entry: string): void {
  if (isAlive(pending.pollerPid)) return;
  const child = spawn(process.execPath, [entry, "login-poll"], { detached: true, stdio: "ignore" });
  child.unref();
  writeJson(files.pendingLogin(), { ...pending, pollerPid: child.pid });
}

export function loginInstructions(pending: PendingLogin): string {
  const url = pending.verificationUriComplete ?? pending.verificationUri;
  return `Sign in to Costia to use the costia plugin: open ${url} and confirm the code ${pending.userCode}.`;
}
