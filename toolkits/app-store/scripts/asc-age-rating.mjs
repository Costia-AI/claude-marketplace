#!/usr/bin/env node
/**
 * Answers App Store Connect's age-rating questionnaire from the repository.
 *
 *   node asc-age-rating.mjs show | push [--dry-run] [--file <path>]
 *
 * Answers: <ASC_COPY_DIR or store/appstore>/age-rating.json (relative to --app), an object of
 * ageRatingDeclaration attributes, for example:
 *
 *   { "violenceCartoonOrFantasy": "NONE", "gambling": false, "userGeneratedContent": false, … }
 *
 * Frequencies take NONE, INFREQUENT_OR_MILD or FREQUENT_OR_INTENSE; the rest are booleans. Write
 * the reasoning for each answer next to the listing copy, not here: this only delivers them.
 * `show` prints every attribute Apple currently has, including ones the file does not set yet —
 * Apple adds questions over time, and an unanswered one blocks submission.
 *
 * The App Privacy label is NOT part of this (the API does not expose it): that stays console work.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appId, call, flag } from "./asc-api.mjs";

const argv = process.argv.slice(2);

async function declaration(app) {
  const { data: infos } = await call("GET", `/apps/${app}/appInfos?limit=5`);
  const { data } = await call("GET", `/appInfos/${infos[0].id}/ageRatingDeclaration`);
  return data;
}

async function main() {
  const command = argv[0];
  if (!["show", "push"].includes(command)) throw new Error("usage: asc-age-rating.mjs show | push [--dry-run]");
  const current = await declaration(appId(argv));
  const live = current.attributes;
  const file = resolve(resolve(flag(argv, "app", ".")), flag(argv, "file", `${process.env.ASC_COPY_DIR || "store/appstore"}/age-rating.json`));
  const wanted = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;

  if (command === "show") {
    for (const [name, value] of Object.entries(live).sort()) {
      const mark = wanted && name in wanted ? (wanted[name] === value ? "=" : "≠") : " ";
      console.log(`  ${mark} ${name.padEnd(48)} ${JSON.stringify(value)}`);
    }
    const unknown = wanted ? Object.keys(wanted).filter((k) => !(k in live)) : [];
    if (unknown.length) console.log(`\nIn the file but unknown to Apple (renamed?): ${unknown.join(", ")}`);
    if (!wanted) console.log(`\nNo ${file} yet.`);
    return;
  }
  if (!wanted) throw new Error(`No ${file}.`);
  const unknown = Object.keys(wanted).filter((k) => !(k in live));
  if (unknown.length) throw new Error(`Apple does not know: ${unknown.join(", ")}. Run show and fix the file.`);
  const changes = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => live[k] !== v));
  const unanswered = Object.entries(live).filter(([k, v]) => v === null && !(k in wanted)).map(([k]) => k);
  if (unanswered.length) console.log(`Still unanswered (blocks submission): ${unanswered.join(", ")}`);
  if (!Object.keys(changes).length) {
    console.log("Nothing to change.");
    return;
  }
  for (const [k, v] of Object.entries(changes)) console.log(`  ${k}: ${JSON.stringify(live[k])} → ${JSON.stringify(v)}`);
  if (argv.includes("--dry-run")) return;
  await call("PATCH", `/ageRatingDeclarations/${current.id}`, { data: { type: "ageRatingDeclarations", id: current.id, attributes: changes } });
  console.log("Age rating updated.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
