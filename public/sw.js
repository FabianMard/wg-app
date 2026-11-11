// Service Worker der WG-App: zeigt Push-Nachrichten an und öffnet beim Antippen die passende Seite
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  event.waitUntil(Promise.all([
    self.registration.showNotification(d.title || "WG-App", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.tag,
      renotify: !!d.tag,
      data: { url: d.url || "/" },
    }),
    bumpBadge(),
  ]));
});

// Zahl auf dem App-Icon um 1 erhöhen (die App setzt beim Öffnen die genaue Zahl)
async function bumpBadge() {
  try {
    if (!self.navigator || !self.navigator.setAppBadge) return;
    const cache = await caches.open("wg-badge");
    const old = await cache.match("/badge-count");
    const n = (parseInt(old ? await old.text() : "0", 10) || 0) + 1;
    await cache.put("/badge-count", new Response(String(n)));
    await self.navigator.setAppBadge(n);
  } catch { /* nicht unterstützt */ }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) { await c.focus(); if ("navigate" in c) await c.navigate(url); return; }
    }
    await self.clients.openWindow(url);
  })());
});
