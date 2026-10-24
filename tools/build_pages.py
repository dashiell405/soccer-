#!/usr/bin/env python3
"""Build the GitHub Pages site at the repository root.

The page people open is the offline game (1 player, 2 players on one
device, cup, shootout, team picker) plus a link to online.html.
online.html is peer-to-peer: the host's browser runs the match.
There is no game server and no WebSocket to one we host.

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
]
ONLINE_SRC = os.path.join(ROOT, "multiplayer", "public", "index.html")

def head_tags():
    return '''<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Stadium Soccer</title>
<!-- Home Screen app ("PWA"). All addresses are relative so this works
     under /soccer-/ on GitHub Pages. "Play online" opens online.html. -->
<script>if(/[?&]room=/.test(location.search))location.replace("online.html"+location.search+location.hash);</script>
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
  .panel { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
  a.btnlink {
    display: inline-block; text-decoration: none; font-size: 16px; font-weight: 700; padding: 8px 15px; margin: 3px;
    border-radius: 10px; border: 1px solid rgba(255,255,255,.35); background: #1f5fd6; color: #fff;
  }
  a.btnlink.big {
    font-size: 20px; padding: 10px 28px;
    background: linear-gradient(180deg, #4d8cff, #1f5fd6);
    border: 0; box-shadow: 0 4px 0 #123a86;
  }
  #onlineHint { font-size: 13px; opacity: .85; margin: 2px 0 0; }
'''

SW_JS = r'''/* =====================================================================
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
const VERSION = "stadium-soccer-pages-v12";
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
'''

MANIFEST = {
    "id": "./",
    "name": "Stadium Soccer",
    "short_name": "Soccer",
    "description": "5-a-side stadium soccer. Play the computer, 2 players on one device, or friends online with a room code. Cup, penalty shootout, and team picker. Works offline.",
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
    # Kick off stays the offline match. Online play is a separate page so the
    # offline game loop and the online client never run at the same time.
    online = (
        '<div class="row"><button id="startBtn" class="big">KICK OFF</button></div>\n'
        '    <div class="row"><a class="btnlink big" id="onlineLink" href="online.html">Play online</a></div>\n'
        '    <p id="onlineHint">Friends on other phones or computers join with a room code.</p>'
    )
    needle = '<div class="row"><button id="startBtn" class="big">KICK OFF</button></div>'
    if needle not in s:
        raise SystemExit("could not find the kick off button in soccer.html")
    s = s.replace(needle, online, 1)
    if "<script src=" in s:
        raise SystemExit("soccer.html should not load external scripts")
    s = s.replace("</body>", '<script src="pwa.js"></script>\n</body>', 1)
    return s

# PeerJS is loaded from the CDN first. If that is blocked, the copy in
# vendor/ is used. The service worker does not intercept the CDN request.
PEER_LOADER = r'''<script>
window.soccerPeerReady = new Promise(function (resolve) {
  if (window.Peer) { window.soccerPeerFrom = "already"; resolve(true); return; }
  var done = false, fallbackStarted = false;
  function finish(from) {
    if (done) return;
    if (window.Peer) { done = true; window.soccerPeerFrom = from; resolve(true); return; }
    if (from === "local") { done = true; window.soccerPeerFrom = "failed"; resolve(false); return; }
    if (fallbackStarted) return;
    fallbackStarted = true;
    var local = document.createElement("script");
    local.src = "vendor/peerjs.min.js";
    local.onload = function () { finish("local"); };
    local.onerror = function () { finish("local"); };
    document.head.appendChild(local);
  }
  var s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js";
  s.async = true;
  s.onload = function () { finish("cdn"); };
  s.onerror = function () { finish("cdn-error"); };
  setTimeout(function () { if (!window.Peer) finish("cdn-timeout"); }, 5000);
  document.head.appendChild(s);
});
</script>
'''

def build_online(src_html):
    s = src_html
    s = s.replace(
        'href="offline.html">Offline vs Computer</a>',
        'href="./">Play on this device</a>',
        1,
    )
    s = s.replace(
        "<div class=\"help\">1 player vs the computer, or 2 players on one keyboard.<br>Works with no internet.</div>",
        "<div class=\"help\">1 player, 2 players, cup and penalties on this device.<br>Works with no internet.</div>",
        1,
    )
    old = '<script src="pwa.js"></script>\n<script src="game.js"></script>\n<script src="client.js"></script>'
    new = PEER_LOADER + '<script src="game.js"></script>\n<script src="online.js"></script>\n<script src="pwa.js"></script>'
    if old not in s:
        raise SystemExit("could not find the online page scripts")
    s = s.replace(old, new, 1)
    if "new WebSocket" in s or '<script src="client.js">' in s:
        raise SystemExit("online.html still points at the Node server")
    return s

def main():
    if not os.path.isfile(SOCCER):
        raise SystemExit("missing soccer.html - run python3 build.py from the repo root")
    if not os.path.isfile(ONLINE_SRC):
        raise SystemExit("missing multiplayer/public/index.html")
    with open(SOCCER, encoding="utf-8") as f:
        index = build_index(f.read())
    with open(ONLINE_SRC, encoding="utf-8") as f:
        online = build_online(f.read())
    checks = [
        ("online link", 'id="onlineLink"' in index and 'href="online.html"' in index),
        ("kick off stays", 'id="startBtn"' in index),
        ("no websocket on the menu", "new WebSocket" not in index and "client_net" not in index),
        ("menu is not the lobby", 'id="createBtn"' not in index and 'id="codeInput"' not in index),
        ("relative manifest", 'href="manifest.webmanifest"' in index),
        ("relative apple icon", 'href="icons/apple-touch-icon.png"' in index),
        ("relative pwa.js", '<script src="pwa.js"></script>' in index),
        ("no root-absolute asset", 'href="/' not in index and 'src="/' not in index),
        ("room links open online", 'location.replace("online.html"' in index),
        ("online page hosts", 'id="createBtn"' in online and "Host a game" in online),
        ("online page joins", 'id="codeInput"' in online and 'id="joinBtn"' in online),
        ("peer loader", "cdn.jsdelivr.net/npm/peerjs@1.5.5" in online and "vendor/peerjs.min.js" in online),
        ("online scripts", '<script src="online.js"></script>' in online and '<script src="game.js"></script>' in online),
        ("no node client", '<script src="client.js">' not in online and "new WebSocket" not in online),
        ("back to offline", 'href="./"' in online),
    ]
    bad = [name for name, ok in checks if not ok]
    if bad:
        raise SystemExit("pages build failed checks: " + ", ".join(bad))

    with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as f:
        f.write(index)
    with open(os.path.join(ROOT, "online.html"), "w", encoding="utf-8") as f:
        f.write(online)
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
    for rel in ("manifest.webmanifest", "sw.js", "pwa.js", "online.html", "index.html"):
        text = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        if re.search(r'''(?:href|src|register)\s*[\(=]\s*["']/(?!/)''', text):
            raise SystemExit(rel + " has a root-absolute URL; Pages needs relative paths")
    sw = open(os.path.join(ROOT, "sw.js"), encoding="utf-8").read()
    if "stadium-soccer-pages-v12" not in sw or "url.origin !== self.location.origin" not in sw:
        raise SystemExit("service worker is missing the cache bump or the cross-origin bypass")
    online_js = open(os.path.join(ROOT, "online.js"), encoding="utf-8").read()
    if "new WebSocket" in online_js or "SOCCER" not in online_js or "stun:stun.l.google.com:19302" not in online_js:
        raise SystemExit("online.js is not the peer-to-peer client")
    print("GitHub Pages site ready at repo root (" + str(len(index)) + " byte index.html, " + str(len(online)) + " byte online.html)")

if __name__ == "__main__":
    sys.exit(main() or 0)
