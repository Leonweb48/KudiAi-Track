const { generateSW } = require("workbox-build");

generateSW({
  swDest: "build/service-worker.js",
  globDirectory: "build",
  globPatterns: [
    "**/*.{js,css,html}",
    "**/*.{png,jpg,jpeg,gif,svg,ico,webp}",
    "**/*.{woff,woff2,ttf,eot}",
  ],
  navigateFallback: "/index.html",
  navigateFallbackDenylist: [/^\/api\//],
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\//,
      handler: "NetworkFirst",
      options: {
        cacheName: "supabase-api",
        expiration: { maxEntries: 50, maxAgeSeconds: 300 },
        networkTimeoutSeconds: 4,
      },
    },
  ],
}).then(({ count, size }) => {
  console.log(`SW generated: ${count} files precached (${(size / 1024).toFixed(1)} KB)`);
}).catch(console.error);
