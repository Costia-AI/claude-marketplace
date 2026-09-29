import { randomUUID } from "node:crypto";
import { config, VERSION } from "../config.ts";
import { accessToken, forgetCredentials, NotSignedInError } from "../auth/credentials.ts";
import { rotateDevice } from "../state/device.ts";

/** A problem+json answer from the backend, carrying its stable `code` (docs/contract.md §2). */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  etag?: string;
  ifMatch?: string;
  timeoutMs?: number;
  /** Plugin writes are replay-safe: the backend answers a repeated key with the first response. */
  idempotencyKey?: string;
}

export interface ApiResponse<T> {
  status: number;
  data: T | undefined;
  etag?: string;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    authorization: `Bearer ${await accessToken()}`,
    accept: "application/json",
    "user-agent": `costia-claude-plugin/${VERSION}`,
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.etag) headers["if-none-match"] = `"${options.etag}"`;
  if (options.ifMatch) headers["if-match"] = `"${options.ifMatch}"`;
  if (method !== "GET") headers["idempotency-key"] = options.idempotencyKey ?? randomUUID();

  const response = await fetch(`${config.api}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });

  const etag = response.headers.get("etag")?.replace(/^W\//, "").replace(/"/g, "") || undefined;
  if (response.status === 304) return { status: 304, data: undefined, etag };
  if (response.status === 204) return { status: 204, data: undefined, etag };

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const code = String(payload?.code ?? `HTTP_${response.status}`);
    if (response.status === 401) {
      if (code === "DEVICE_REVOKED") {
        // A revoked device stays revoked: signing in again gets a new device identity.
        forgetCredentials();
        rotateDevice();
      }
      throw new NotSignedInError(code === "DEVICE_REVOKED" ? "this device was revoked; sign in again with /costia:login" : "session rejected");
    }
    throw new ApiError(response.status, code, payload?.detail ?? payload?.title);
  }
  return { status: response.status, data: payload as T, etag };
}

export async function get<T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
  return (await request<T>(path, options)).data as T;
}

export async function send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  return (await request<T>(path, { method, body })).data as T;
}

/** Binary download (blobs and blob bundles). */
export async function download(path: string, init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}): Promise<Buffer> {
  const response = await fetch(`${config.api}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
  });
  if (!response.ok) throw new ApiError(response.status, `HTTP_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
