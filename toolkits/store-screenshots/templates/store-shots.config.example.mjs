/**
 * What the store screenshots show and how they look. Read by the store-screenshots skill's
 * capture.mjs, frames.mjs and web-preview.mjs; lives in the app folder, next to package.json.
 *
 * Captions say only what is VISIBLE in their screen: a listing whose text names something the
 * picture does not show is the first thing anyone notices.
 */
export default {
  // The Expo web export, built with the seed switched on and every backend URL emptied, so the
  // capture is hermetic and never calls production. `SCREENSHOT_SEED=1` is added for you.
  build: {
    command: ["npx", "expo", "export", "-p", "web"],
    outDir: "dist",
    env: { EXPO_PUBLIC_API_URL: "" },
  },
  // Match what the production host sends. Only turn this on if the app needs SharedArrayBuffer.
  server: { port: 8080, crossOriginIsolated: false },

  // Capture locale -> caption language (also the output folder name).
  locales: { "en-US": "en", "es-ES": "es" },

  seed: {
    // The import specifier the app uses for the seed module, and its file (relative to this folder).
    module: "@/services/screenshot-seed",
    file: "src/services/screenshot-seed.ts",
    // The global the module assigns: (lang) => ids used by `path(ids)` below.
    global: "__screenshotSeed",
    // Optional: wait for this testID before seeding (a loading screen to disappear, say).
    // ready: { testId: "loading-screen", state: "detached" },
    // The test that keeps the seed out of production bundles.
    test: "src/__tests__/screenshot-seed-excluded.test.ts",
  },

  // Only if the screens need a session: a FAKE signed-in state the app accepts offline.
  // session: { localStorage: { "app.session": { user: { name: "Alex" }, token: "screenshot" } } },

  // Elements that only exist because this run has no backend (a "syncing…" pill).
  hide: ['[data-testid="sync-badge"]'],

  outDir: "store-assets",
  colorScheme: "light",

  brand: {
    background: "#0b0b10",
    ink: "#ffffff",
    accent: "#7c5cff",
    accent2: "#22d3ee",
    border: "#2a2833",
    // font: { file: "assets/fonts/Inter-ExtraBold.ttf", family: "Inter", weight: 800 },
  },

  // Five screens in listing order: what the app is, what it is for, what it gives back, then the rest.
  shots: [
    {
      key: "home",
      path: "/",
      anchor: { testId: "home-screen" },
      caption: { en: "Everything that matters,\nthe moment you open it", es: "Lo importante,\nnada más abrir" },
    },
    {
      key: "detail",
      path: (ids) => `/items/${ids.itemId}`,
      anchor: { text: { en: "Details", es: "Detalles" } },
      caption: { en: "Every detail\nin one place", es: "Cada detalle\nen un sitio" },
      // devices: ["phone"],           // only on some devices
      // open: async (page) => { await page.getByTestId("tab-stats").click(); },
      // settleMs: 2000,
    },
  ],

  // Optional overrides (defaults shown):
  // devices: {
  //   phone: { viewport: { width: 390, height: 844 }, scale: 3, radius: 0.082 },
  //   tablet: { viewport: { width: 1024, height: 1366 }, scale: 2, radius: 0.035 },
  // },
  // frames: [
  //   { name: "play", width: 1080, height: 1920, device: "phone" },
  //   { name: "apple", width: 1320, height: 2868, device: "phone" },
  //   { name: "apple-ipad", width: 2064, height: 2752, device: "tablet" },  // drop if supportsTablet is false
  // ],
};
