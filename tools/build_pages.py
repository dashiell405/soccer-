#!/usr/bin/env python3
"""Build the GitHub Pages site at the repository root.

The page people open is the offline game only: 1 player vs the computer,
2 players on one device, cup, shootout, and the team picker. It does not
load the online client, so it never opens a WebSocket.

Paths in the manifest, icons, and service worker are relative, so the app
works at https://dashiell405.github.io/soccer-/ (a project site, not the
domain root).

Run from the repo root:  python3 tools/build_pages.py
build.py calls this after it writes soccer.html.
"""
import json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOCCER = os.path.join(ROOT, "soccer.html")
ICON_SRC = os.path.join(ROOT, "multiplayer", "public", "icons")
PWA_SRC = os.path.join(ROOT, "multiplayer", "public", "pwa.js")
ICON_DST = os.path.join(ROOT, "icons")

SHELL_FILES = [
    "index.html",
    "pwa.js",
    "manifest.webmanifest",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/maskable-192.png",
    "icons/maskable-512.png",
    "icons/favicon-32.png",
]

def head_tags():
    return '''<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Stadium Soccer</title>
<!-- Home Screen app ("PWA"). All addresses are relative so this works
     under /soccer-/ on GitHub Pages. Online multiplayer is not on this page. -->
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0c2816">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Soccer">
<meta name="application-name" content="Stadium Soccer">
<meta name="format-detection" content="telephone=no">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">'''

def extra_css():
    return '''
  /* ---- Home Screen app: no bounce, keep clear of the iPhone notch ---- */
  html, body {
    position: fixed; inset: 0; width: 100%; overscroll-behavior: none;
    -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%;
  }
  .overlay {
    box-sizing: border-box;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  .panel { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  #joyBase   { left: calc(20px + env(safe-area-inset-left)); bottom: calc(20px + env(safe-area-inset-bottom)); }
  #shootBtn  { right: calc(18px + env(safe-area-inset-right)); bottom: calc(22px + env(safe-area-inset-bottom)); }
  #passBtn   { right: calc(28px + min(96px, 24vh) + env(safe-area-inset-right)); bottom: calc(14px + env(safe-area-inset-bottom)); }
  #sprintBtn { right: calc(30px + env(safe-area-inset-right)); bottom: calc(34px + min(96px, 24vh) + env(safe-area-inset-bottom)); }
  #skillBtn  { right: calc(40px + min(96px, 24vh) + min(72px, 18vh) + env(safe-area-inset-right)); bottom: calc(18px + env(safe-area-inset-bottom)); }
  #pauseBtn { top: calc(8px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right)); }
  #rotateHint { top: calc(6px + env(safe-area-inset-top)); }
  .soon {
    display: inline-block; margin: 3px; padding: 6px 12px; border-radius: 10px;
    border: 2px dashed rgba(255,255,255,.55); color: rgba(255,255,255,.85); font-size: 15px;
  }
  @media (max-height: 500px) {
    .soon { font-size: 13px; padding: 4px 8px; margin: 1px; }
  }
'''

SW_JS = r'''/* =====================================================================
   SERVICE WORKER - lets "Stadium Soccer" open with no internet.
   The first visit saves these files on the device. After that the game
   still opens when you are offline.

   Paths are relative (no leading /) so this works on GitHub Pages at
   https://dashiell405.github.io/soccer-/  and also at the domain root.
   This page is the offline game only. It does not open a WebSocket.
   Change VERSION when you change the list of files below.
   ===================================================================== */
const VERSION = "stadium-soccer-pages-v1";
const APP_SHELL = [
  "./",
  "index.html",
  "pwa.js",
  "manifest.webmanifest",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-192.png",
  "icons/maskable-512.png",
  "icons/favicon-32.png",
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
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // Never try to cache a websocket or the online server's debug routes.
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
'''

MANIFEST = {
    "id": "./",
    "name": "Stadium Soccer",
    "short_name": "Soccer",
    "description": "5-a-side stadium soccer. Play the computer, or 2 players on one device. Cup, penalty shootout, and team picker. Works offline.",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "display_override": ["fullscreen", "standalone"],
    "orientation": "landscape",
    "background_color": "#0c2816",
    "theme_color": "#0c2816",
    "categories": ["games", "sports"],
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
        {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        {"src": "icons/apple-touch-icon.png", "sizes": "180x180", "type": "image/png", "purpose": "any"},
    ],
}

def build_index(src_html):
    s = src_html
    if "<!-- Home Screen app" in s:
        raise SystemExit("soccer.html should stay the plain standalone file")
    s = re.sub(
        r'<meta name="viewport"[^>]*>\n<title>[^<]*</title>\n(<link rel="icon" href="data:,">\n)?',
        head_tags() + "\n",
        s,
        count=1,
    )
    s = s.replace("</style>", extra_css() + "</style>", 1)
    s = s.replace(
        '<h1><span class="b">SOCCER</span> <span class="r">SHOWDOWN</span> 2</h1>',
        '<h1><span class="b">STADIUM</span> <span class="r">SOCCER</span></h1>',
        1,
    )
    # Not a link: nothing here opens the online lobby or a WebSocket.
    soon = (
        '<div class="row"><button id="startBtn" class="big">KICK OFF</button></div>\n'
        '    <div class="row"><p class="soon" id="onlineSoon">Online play coming soon</p></div>'
    )
    needle = '<div class="row"><button id="startBtn" class="big">KICK OFF</button></div>'
    if needle not in s:
        raise SystemExit("could not find the kick off button in soccer.html")
    s = s.replace(needle, soon, 1)
    if "<script src=" in s:
        raise SystemExit("soccer.html should not load external scripts")
    s = s.replace("</body>", '<script src="pwa.js"></script>\n</body>', 1)
    return s

def main():
    if not os.path.isfile(SOCCER):
        raise SystemExit("missing soccer.html - run python3 build.py from the repo root")
    with open(SOCCER, encoding="utf-8") as f:
        index = build_index(f.read())
    checks = [
        ("onlineSoon", 'id="onlineSoon"' in index),
        ("no online link", 'id="onlineLink"' not in index),
        ("no websocket", "new WebSocket" not in index and "client_net" not in index),
        ("no online scripts", '<script src="client.js">' not in index and '<script src="game.js">' not in index),
        ("no lobby buttons", 'id="createBtn"' not in index and 'id="codeInput"' not in index),
        ("relative manifest", 'href="manifest.webmanifest"' in index),
        ("relative apple icon", 'href="icons/apple-touch-icon.png"' in index),
        ("relative pwa.js", '<script src="pwa.js"></script>' in index),
        ("no root-absolute asset", 'href="/' not in index and "src=\"/" not in index),
    ]
    bad = [name for name, ok in checks if not ok]
    if bad:
        raise SystemExit("pages index failed checks: " + ", ".join(bad))

    with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as f:
        f.write(index)
    with open(os.path.join(ROOT, "sw.js"), "w", encoding="utf-8") as f:
        f.write(SW_JS)
    with open(os.path.join(ROOT, "manifest.webmanifest"), "w", encoding="utf-8") as f:
        json.dump(MANIFEST, f, indent=2)
        f.write("\n")
    shutil.copy2(PWA_SRC, os.path.join(ROOT, "pwa.js"))
    os.makedirs(ICON_DST, exist_ok=True)
    for name in os.listdir(ICON_SRC):
        src = os.path.join(ICON_SRC, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(ICON_DST, name))

    # .nojekyll tells GitHub Pages to serve these files as-is (no Jekyll).
    open(os.path.join(ROOT, ".nojekyll"), "a", encoding="utf-8").close()

    missing = [p for p in SHELL_FILES if not os.path.isfile(os.path.join(ROOT, p))]
    if missing:
        raise SystemExit("missing pages files: " + ", ".join(missing))
    for rel in ("manifest.webmanifest", "sw.js", "pwa.js"):
        text = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        if re.search(r'''(?:href|src|register)\s*[\(=]\s*["']/(?!/)''', text):
            raise SystemExit(rel + " has a root-absolute URL; Pages needs relative paths")
    print("GitHub Pages site ready at repo root (" + str(len(index)) + " byte index.html)")

if __name__ == "__main__":
    sys.exit(main() or 0)
