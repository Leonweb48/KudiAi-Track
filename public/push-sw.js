/* Browser push handler — pulled into the generated Workbox service worker via
 * importScripts (scripts/build-sw.js). Handles the raw Web Push event FCM
 * delivers; no Firebase SDK is needed in the worker. FCM wire format:
 *   { notification: { title, body, icon }, data: { deepLink: "<json>" ... } }
 */

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

    await self.registration.showNotification(title, {
      body:  n.body || "",
      icon:  n.icon || "/icon.png",
      badge: "/icon.png",
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
