const { generateSW } = require("workbox-build");

// Website service worker (2026-10-14 rework — see setupServiceWorker() in src/index.js).
//  • Precache only the app itself: JS, CSS, the app page and the small root icons — not every image on the site. The old
//    setup precached ~245 files / 12+ MB (bank logos, screenshots, every marketing page) on the first visit, competing with
//    the app's own requests on slow mobile data. Images are now cached as they are used (CacheFirst, 30 days).
//  • The main bundle is ~2.1 MB — over Workbox's default 2 MB limit — so it was silently NOT precached and the app could
//    not start offline. The limit is raised to 6 MB.
//  • skipWaiting: false — a new version waits and is switched in by the page only while it is in the background (the
//    page posts {type:"SKIP_WAITING"}; generateSW adds that message listener when skipWaiting is false). Inside the
//    Android app the worker activates at once (public/push-sw.js) and the app then removes it.
//  • The old runtime rule for *.supabase.co never matched (production calls go through kudiai.app/sb) and caching signed-in
//    API answers in a shared cache is wrong anyway — removed. The app keeps its own offline copy of the data.
//  • A failed build of this worker now fails the build instead of shipping without one.
generateSW({
  swDest: "build/service-worker.js",
  globDirectory: "build",
  globPatterns: [
    "index.html",
    "static/**/*.{js,css}",
    "*.{png,ico,webmanifest}",
  ],
  globIgnores: ["**/*.map", "**/*.LICENSE.txt", "icon-bg.png", "logo1.png"],   // two 1-2 MB decorative images; cached when shown
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  navigateFallback: "/index.html",
  navigateFallbackDenylist: [/^\/api\//, /^\/sb\//],
  skipWaiting: false,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  // Browser push (public/push-sw.js): raw push + notificationclick handlers.
  importScripts: ["push-sw.js"],
  runtimeCaching: [
    {
      // logos, pictures and icons used by the app, cached the first time they are shown
      urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === "image",
      handler: "CacheFirst",
      options: {
        cacheName: "kudiai-images",
        expiration: { maxEntries: 400, maxAgeSeconds: 30 * 24 * 3600 },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "kudiai-fonts", expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 3600 } },
    },
  ],
}).then(({ count, size, warnings }) => {
  (warnings || []).forEach((w) => console.warn("SW warning:", w));
  console.log(`SW generated: ${count} files precached (${(size / 1024).toFixed(1)} KB)`);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
