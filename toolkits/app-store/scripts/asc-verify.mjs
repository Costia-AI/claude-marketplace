#!/usr/bin/env node
/**
 * Proves the team key can read this app. Changes nothing.
 *
 *   node asc-verify.mjs [--app-id 1234567890]
 */
import { appId, call } from "./asc-api.mjs";

const argv = process.argv.slice(2);
try {
  const id = appId(argv);
  const { data } = await call("GET", `/apps/${id}?fields[apps]=name,bundleId,primaryLocale`);
  console.log(`The key reads ${data.attributes.name} (${data.attributes.bundleId}, ${data.attributes.primaryLocale}).`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
