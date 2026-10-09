// Sep 25 (per Mely): minimal service worker so the resident portal is
// installable on phone/tablet/computer. No offline caching — this is a
// live balance/payment portal, so serving stale cached data would be
// actively wrong. Exists only to satisfy PWA installability criteria.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Intentionally not intercepting anything — always falls through to
  // the network.
});

// Oct 9 (per Mely): Web Push + app-icon badge for the resident portal app.
// Payload { title, body, url, tag, badge } comes from the admin app's /api/push/dispatch.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Resident Portal", {
        body: data.body || "You have a new update.",
        icon: "/residents-app-icon-aloha.png",
        badge: "/residents-app-icon-aloha.png",
        tag: data.tag,
        data: { url: data.url || "/residents/dashboard" },
      }),
      (self.navigator && self.navigator.setAppBadge && data.badge) ? self.navigator.setAppBadge(data.badge).catch(() => {}) : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/residents/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
