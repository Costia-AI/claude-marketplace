/*
 * The screenshot seed writes into a real person's data, so it is emptied out of every bundle that
 * does not ask for it by name. `SCREENSHOT_SEED_MODULE` must be the exact specifier the app imports;
 * a test asserts both halves of this rule, because a rule made of two strings in two files fails
 * silently the moment one of them is renamed.
 *
 * Merge this into metro.config.js: chain the resolver that is already there, and keep outer
 * wrappers (NativeWind, Uniwind, Sentry…) outermost, as their docs require.
 */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const SCREENSHOT_SEED_MODULE = "@/services/screenshot-seed";
const seedRequested = process.env.SCREENSHOT_SEED === "1";

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === SCREENSHOT_SEED_MODULE && !seedRequested) {
    return { type: "empty" };
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
