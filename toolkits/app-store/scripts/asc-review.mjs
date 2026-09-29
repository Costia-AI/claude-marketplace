#!/usr/bin/env node
/**
 * Submits the editable version for App Review, or withdraws it. Nothing here runs unless asked.
 *
 *   node asc-review.mjs status                   the version, its build, and any open submission
 *   node asc-review.mjs submit [--dry-run]       reviewSubmissions → reviewSubmissionItems → submitted:true
 *   node asc-review.mjs cancel                   canceled:true on the open submission
 *
 * Creating the first two and not the third leaves a draft someone has to hunt for in the console,
 * so `submit` checks first that no other submission is open, and does all three.
 *
 * Withdrawing is not immediate: the submission answers CANCELING, the version sits in
 * WAITING_FOR_REVIEW, then DEVELOPER_REJECTED, and only then PREPARE_FOR_SUBMISSION. Attaching a new
 * build and resubmitting works from DEVELOPER_REJECTED on; poll `status` rather than assuming.
 */
import { appId, call, EDITABLE } from "./asc-api.mjs";

const argv = process.argv.slice(2);
const OPEN = new Set(["READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES", "CANCELING"]);

async function main() {
  const command = argv[0];
  if (!["status", "submit", "cancel"].includes(command)) throw new Error("usage: asc-review.mjs status | submit [--dry-run] | cancel");
  const app = appId(argv);
  const { data: versions } = await call("GET", `/apps/${app}/appStoreVersions?limit=5&filter[platform]=IOS&include=build`);
  const version = versions.find((v) => EDITABLE.has(v.attributes.appStoreState)) ?? versions[0];
  const { data: submissions } = await call("GET", `/reviewSubmissions?filter[app]=${app}&filter[platform]=IOS&limit=10`);
  const open = submissions.filter((s) => OPEN.has(s.attributes.state));

  if (command === "status") {
    for (const v of versions) console.log(`version ${v.attributes.versionString.padEnd(10)} ${v.attributes.appStoreState}${v.relationships?.build?.data ? " (build attached)" : ""}`);
    for (const s of submissions.slice(0, 5)) console.log(`submission ${s.id} ${s.attributes.state} ${s.attributes.submittedDate ?? ""}`);
    return;
  }
  if (command === "cancel") {
    if (!open.length) throw new Error("No open submission to cancel.");
    for (const s of open) {
      await call("PATCH", `/reviewSubmissions/${s.id}`, { data: { type: "reviewSubmissions", id: s.id, attributes: { canceled: true } } });
      console.log(`submission ${s.id}: cancel requested (CANCELING → … → PREPARE_FOR_SUBMISSION; poll status).`);
    }
    return;
  }
  if (!version || !EDITABLE.has(version.attributes.appStoreState)) throw new Error("No editable version to submit.");
  if (!version.relationships?.build?.data) throw new Error(`Version ${version.attributes.versionString} has no build attached.`);
  if (open.length) throw new Error(`A submission is already open (${open.map((s) => `${s.id} ${s.attributes.state}`).join(", ")}). Cancel or finish it first.`);
  console.log(`Submitting ${version.attributes.versionString} (${version.attributes.appStoreState}) for review.`);
  if (argv.includes("--dry-run")) return;
  const { data: submission } = await call("POST", "/reviewSubmissions", {
    data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: app } } } },
  });
  await call("POST", "/reviewSubmissionItems", {
    data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } },
  });
  await call("PATCH", `/reviewSubmissions/${submission.id}`, { data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } } });
  console.log(`Submitted: ${submission.id}. Release type decides what happens on approval (MANUAL waits for a click; AFTER_APPROVAL publishes).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
