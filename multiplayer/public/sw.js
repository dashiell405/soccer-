/* =====================================================================
   SERVICE WORKER - lets "Floodlight Kickoff" open with no internet.
   The first time you visit, it saves the game files on your device
   (the "app shell"). After that:
     - with internet: it always tries the server first (so you get updates)
     - without internet: it uses the saved copy, so the
       "Offline vs Computer" game still works.
   Online matches still need the server, of course!
   Change VERSION whenever you change the list of files below.
   ===================================================================== */
const VERSION = "floodlight-kickoff-v4";
const APP_SHELL = [
  "./",
  "index.html",
  "offline.html",
  "client.js",
  "game.js",
  "pwa.js",
  "manifest.webmanifest",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-192.png",
  "icons/maskable-512.png",
  "icons/favicon-32.png",
  "assets/cover.png",
];
const NETWORK_TIMEOUT_MS = 4000;  // slow network? use the saved copy instead

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // delete caches from older versions
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => {
        if (k === VERSION) return false;
        return k.indexOf("stadium-soccer") === 0 || k !== VERSION;
      }).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/ws") || url.pathname.includes("/debug/") || url.pathname.endsWith("/healthz")) return;

  const isPage = req.mode === "navigate";
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      // 1. network first (fresh files when the server is reachable)
      const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
      if (res && res.ok) {
        // save a copy of pages without the ?room=CODE part
        const key = isPage ? new Request(url.origin + url.pathname) : req;
        cache.put(key, res.clone());
      }
      return res;
    } catch (err) {
      // 2. no network: use the saved copy
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (isPage) return (await cache.match("index.html")) || (await cache.match("offline.html"));
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
