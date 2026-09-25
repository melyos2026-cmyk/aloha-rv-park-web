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
