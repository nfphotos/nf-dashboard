// Offline cache.
//
// The shell used to be cache-first, which meant a deployed change stayed
// invisible until VERSION was bumped by hand — easy to forget, and it looks
// exactly like "the fix didn't work". Now it's stale-while-revalidate: the
// cached copy paints immediately, a fresh copy is fetched in the background,
// and the next load is current. Data stays network-first (never stale).
const VERSION = "nf-v5";
const SHELL = [
  ".", "index.html",
  "assets/css/styles.css",
  "assets/js/app.js",
  "assets/js/config.js",
  "manifest.webmanifest",
  "assets/icons/icon.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Data must never be stale — a stale reading reads as today's.
  if (url.pathname.includes("/data/")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Shell: serve cache fast, refresh it in the background.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
