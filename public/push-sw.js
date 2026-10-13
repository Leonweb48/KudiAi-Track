/* Browser push handler — pulled into the generated Workbox service worker via
 * importScripts (scripts/build-sw.js). Handles the raw Web Push event FCM
 * delivers; no Firebase SDK is needed in the worker. FCM wire format:
 *   { notification: { title, body, icon }, data: { deepLink: "<json>" ... } }
 */

// Inside the Android app (Capacitor serves the app from https://localhost) a service worker must never hold an old
// version of the app back: the app removes its service worker on start (src/index.js), so activate at once and let
// that code run. On the website a new worker waits and switches over only while the page is in the background.
self.addEventListener("install", () => {
  if (self.location.hostname === "localhost") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { /* non-JSON push */ }

  const n    = payload.notification || {};
  const data = payload.data || {};
  const title = n.title || "KudiAI Track";

  event.waitUntil((async () => {
    // If the app is already open and visible the in-app toast/bell covers it —
    // an OS notification on top of that would be a duplicate.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((c) => c.visibilityState === "visible")) return;

    const image = n.image || data.image;
    await self.registration.showNotification(title, {
      body:  n.body || "",
      icon:  n.icon || "/icon.png",
      // the KudiAI Track logo cut-out (monochrome) Chrome shows in the status bar
      badge: "/notification-badge.png",
      // a picture for promotions/offers, shown when the notification is expanded
      ...(image ? { image } : {}),
      // a button that does what tapping does — opens the screen the notification is about
      actions: [{ action: "open", title: data.deepLink ? "View" : "Open KudiAI Track" }],
      data,
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    // App already open somewhere: focus it and hand over the deep link.
    if (windows.length) {
      const client = windows[0];
      await client.focus();
      if (data.deepLink) client.postMessage({ type: "kt-push-click", deepLink: data.deepLink });
      return;
    }

    // Cold open: carry the deep link in the URL; the app consumes and clears it.
    const url = data.deepLink ? "/?kt_dl=" + encodeURIComponent(data.deepLink) : "/";
    await self.clients.openWindow(url);
  })());
});
