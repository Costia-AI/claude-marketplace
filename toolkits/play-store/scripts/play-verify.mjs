#!/usr/bin/env node
/**
 * Proves the service account can edit this app: opens an edit, reads the listing languages and
 * discards the edit. Changes nothing.
 *
 *   node play-verify.mjs [--package com.example.app] [--key sa.json]
 */
import { accessToken, call, packageName, serviceAccount, withEdit } from "./play-api.mjs";

const argv = process.argv.slice(2);
try {
  const pkg = packageName(argv);
  const key = await serviceAccount(argv);
  const token = await accessToken(key);
  const listings = await withEdit(token, pkg, ({ base }) => call(token, "GET", `${base}/listings`), { commit: false });
  const locales = (listings?.listings ?? []).map((l) => l.language).sort();
  console.log(`${key.client_email} can edit ${pkg}. Listing languages: ${locales.join(", ") || "none yet"}.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
