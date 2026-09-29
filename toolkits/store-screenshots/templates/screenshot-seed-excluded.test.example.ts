import fs from "fs";
import path from "path";

/**
 * The screenshot seed must never reach a shipped bundle: it writes into a real person's data.
 * The protection is a Metro rule that empties the module unless the build asks for it by name —
 * and a rule made of two strings in two files fails silently the moment one of them is renamed.
 *
 * Asserted structurally rather than by building: a build takes minutes and would only be run
 * when somebody remembered to.
 *
 * Adapt ROOT, ENTRY, SEED_FILE, MODULE and ENV_VAR to this app, and the runner's API (jest,
 * vitest, bun:test) if it is not jest.
 */
const ROOT = path.join(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

const MODULE = "@/services/screenshot-seed";
const SEED_FILE = "src/services/screenshot-seed.ts";
const ENTRY = "src/app/_layout.tsx";
const ENV_VAR = "SCREENSHOT_SEED";

describe("the screenshot seed is excluded unless it is asked for", () => {
  it("exists, so the rest of this file is about something", () => {
    expect(fs.existsSync(path.join(ROOT, SEED_FILE))).toBe(true);
  });

  it("is emptied by metro.config.js behind the environment variable", () => {
    const metro = read("metro.config.js");
    expect(metro).toContain(`const SCREENSHOT_SEED_MODULE = "${MODULE}"`);
    expect(metro).toContain(`process.env.${ENV_VAR} === "1"`);
    expect(metro).toMatch(/moduleName === SCREENSHOT_SEED_MODULE && !seedRequested[\s\S]{0,60}type: "empty"/);
  });

  it("is imported from the entry file and from nowhere else", () => {
    expect(read(ENTRY)).toContain(`import "${MODULE}";`);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const relative = path.relative(ROOT, full);
          if (relative === ENTRY || relative === SEED_FILE) continue;
          if (fs.readFileSync(full, "utf8").includes("screenshot-seed")) offenders.push(relative);
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });

  it("is the only thing the environment variable turns on", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(full);
        } else if (/\.(t|j)sx?$/.test(entry.name) && fs.readFileSync(full, "utf8").includes(ENV_VAR)) {
          hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(hits).toEqual([]);
    expect(read("metro.config.js").split(ENV_VAR).length - 1).toBe(1);
  });
});
