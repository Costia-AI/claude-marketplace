import { z } from "zod";
import { checkLayoutPath } from "./paths.ts";

/** Layout spec, schema 1 (docs/plugin-protocol.md). */

const remote = z.string().min(1).max(512).refine((r) => /^(git@[\w.-]+:[\w./~-]+|https:\/\/[\w.-]+(:\d+)?\/[\w./~-]+|ssh:\/\/[\w@.:-]+\/[\w./~-]+)$/.test(r), "git remote over ssh or https");
const ref = z.string().max(255).regex(/^[\w./-]+$/).refine((r) => !r.startsWith("-"), "a ref cannot start with '-'");

const gitEntry = z.object({
  path: z.string(),
  kind: z.literal("git"),
  remote,
  ref: ref.optional(),
  sparse: z.array(z.string().regex(/^[\w./-]+$/)).max(50).optional(),
});
const symlinkEntry = z.object({
  path: z.string(),
  kind: z.literal("symlink"),
  target: z.object({ remote }),
  style: z.enum(["relative", "absolute"]).default("relative"),
  fallback: z.enum(["clone", "ask", "skip"]).default("ask"),
});
const dirEntry = z.object({ path: z.string(), kind: z.literal("dir") });

export const layoutSpec = z
  .object({
    schema: z.literal(1),
    root: z.union([z.object({ kind: z.literal("git"), remote, ref: ref.optional() }), z.object({ kind: z.literal("dir") })]),
    entries: z.array(z.discriminatedUnion("kind", [gitEntry, symlinkEntry, dirEntry])).max(100).default([]),
    claudeRoots: z.array(z.string()).min(1).max(50).default(["."]),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    for (const entry of spec.entries) {
      try {
        checkLayoutPath(entry.path);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: (error as Error).message, path: ["entries"] });
      }
      if (seen.has(entry.path)) ctx.addIssue({ code: "custom", message: `duplicate path ${entry.path}`, path: ["entries"] });
      seen.add(entry.path);
    }
    for (const root of spec.claudeRoots) {
      if (root === ".") continue;
      try {
        checkLayoutPath(root);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: (error as Error).message, path: ["claudeRoots"] });
      }
    }
  });

export type LayoutSpec = z.infer<typeof layoutSpec>;
export type LayoutEntry = LayoutSpec["entries"][number];
