/* =====================================================================
   SERVICE WORKER - lets "Stadium Soccer" open with no internet.
   The first visit saves these files on the device. After that the game
   still opens when you are offline.

   Paths are relative (no leading /) so this works on GitHub Pages at
   https://dashiell405.github.io/soccer-/  and also at the domain root.
   Online play (online.html) uses PeerJS from a CDN and a saved copy in
   vendor/. The broker, STUN and TURN servers are OTHER websites.
   This worker must not intercept those requests, or phones cannot connect.
   Change VERSION when you change the list of files below.
   ===================================================================== */
const VERSION = "stadium-soccer-pages-v25";
const APP_SHELL = [
  "./",
  "index.html",
  "online.html",
  "online.js",
  "game.js",
  "vendor/peerjs.min.js",
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
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
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
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // Leave cross-origin requests alone: the PeerJS CDN, the public broker
  // (0.peerjs.com), STUN and TURN. Also skip anything that is not a normal
  // GET of our own files (websockets are not fetch, but be explicit).
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.pathname.endsWith("/ws") || url.pathname.includes("/debug/") || url.pathname.endsWith("/healthz")) return;

  const isPage = req.mode === "navigate";
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
      if (res && res.ok && !res.redirected) {
        const key = isPage ? new Request(url.origin + url.pathname) : req;
        cache.put(key, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (isPage) return (await cache.match("./")) || (await cache.match("index.html"));
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
