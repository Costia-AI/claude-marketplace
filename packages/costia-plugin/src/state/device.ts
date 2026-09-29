import { randomUUID } from "node:crypto";
import { arch, hostname, platform } from "node:os";
import { files } from "./paths.ts";
import { readJson, writeJson } from "./json-file.ts";

export interface Device {
  machineUuid: string;
  label: string;
}

/**
 * This machine's identity: a random uuid created once and never derived from
 * hardware. It is sent as `costia_device` when signing in and ends up as the
 * `cdev` claim, so every token names the device it was issued to.
 */
export function getDevice(): Device {
  const existing = readJson<Device | null>(files.device(), null);
  if (existing?.machineUuid) return existing;
  const device = { machineUuid: randomUUID(), label: hostname() };
  writeJson(files.device(), device);
  return device;
}

export function deviceFacts() {
  return { os: platform(), arch: arch() };
}

/** A new identity for this machine, after the old one was revoked. Checkouts keep working: they are re-linked on the next adopt. */
export function rotateDevice(): Device {
  const device = { machineUuid: randomUUID(), label: getDevice().label };
  writeJson(files.device(), device);
  return device;
}
