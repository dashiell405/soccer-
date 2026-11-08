/* =====================================================================
   PWA helper - shared by index.html (online) and offline.html.
   1. Registers the service worker (sw.js) so the app works offline.
   2. Stops pinch-zoom, double-tap zoom and the "rubber band" bounce on iPhone.
   3. Adds class "standalone" to <html> when opened from the Home Screen / Dock.
   ===================================================================== */
(function () {
  window.pwaStatus = { sw: "unsupported", error: null };
  var nativeApp = false;
  try {
    nativeApp = location.protocol === "capacitor:" || location.protocol === "ionic:" ||
      (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
  } catch (e) { nativeApp = false; }
  // The iPhone app already contains the game files, so it works with no
  // internet. A service worker on capacitor://localhost is skipped: it is
  // not needed offline, and it must not intercept Supabase or PeerJS.
  if (!nativeApp && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.pwaStatus.sw = "registering";
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        window.pwaStatus.sw = "registered";
        window.pwaStatus.scope = reg.scope;
        return navigator.serviceWorker.ready;
      }).then(function () {
        window.pwaStatus.sw = "ready";
      }).catch(function (err) {
        window.pwaStatus.sw = "failed";
        window.pwaStatus.error = String(err);
        console.warn("Service worker failed:", err);   // warning only - the game still works online
      });
    });
  }

  // --- no zooming / bouncing (iOS ignores user-scalable=no in Safari) ---
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.addEventListener("gesturechange", function (e) { e.preventDefault(); });
  document.addEventListener("touchmove", function (e) {
    // Two fingers would pinch-zoom the pitch. One finger may scroll a menu,
    // Settings, or the create-player card when they are taller than the screen.
    if (e.touches.length > 1) { e.preventDefault(); return; }
    var t = e.target;
    if (t && t.closest && t.closest(".panel, #settingsCard, #playerCard")) return;
    e.preventDefault();
  }, { passive: false });
  // iOS zooms if you tap the pitch twice quickly. Don't do that to buttons:
  // a second tap within a third of a second would never become a click,
  // so Back, KICK OFF and SHOOT would feel broken.
  var lastTouchEnd = 0;
  document.addEventListener("touchend", function (e) {
    var t = e.target;
    if (!t || t.id !== "game") return;
    var now = Date.now();
    if (now - lastTouchEnd < 320) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  var standalone = nativeApp || window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches);
  if (standalone) document.documentElement.classList.add("standalone");
  if (nativeApp) document.documentElement.classList.add("native-app");
})();
