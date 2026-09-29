/**
 * Fixed, believable data for the store screenshots, written into this app's own storage.
 *
 * THIS MODULE MUST NEVER REACH A SHIPPED BUNDLE. It writes into a real person's data — possibly
 * the only copy — and anything it writes may be synced under their account. `metro.config.js`
 * empties it unless the build sets SCREENSHOT_SEED=1, and a test fails if the two halves of that
 * rule ever drift apart.
 *
 * Rules for the data:
 * - fixed ids, so two runs produce the same pictures;
 * - dates relative to today at midnight, so "this week" screens are never empty;
 * - uneven values: a flat series hides an axis that starts in the wrong place;
 * - nothing a caption promises that the data does not show.
 */

// Replace with the app's own data layer: its database, store or cache.
// import { db } from "@/db";

type SeedIds = Record<string, string>;

const today = new Date();
today.setHours(0, 0, 0, 0);
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();

async function seed(lang: string): Promise<SeedIds> {
  const itemId = "5f0c2b1e-0000-4000-8000-000000000001";
  const name = lang === "es" ? "Ejemplo" : "Example";
  // await db.items.upsert({ id: itemId, name, createdAt: daysAgo(3) });
  void name;
  void daysAgo;
  return { itemId };
}

declare global {
  // eslint-disable-next-line no-var
  var __screenshotSeed: ((lang: string) => Promise<SeedIds>) | undefined;
}

globalThis.__screenshotSeed = seed;

export {};
