/* =====================================================================
   PWA helper - shared by index.html (online) and offline.html.
   1. Registers the service worker (sw.js) so the app works offline.
   2. Stops pinch-zoom, double-tap zoom and the "rubber band" bounce on iPhone.
   3. Adds class "standalone" to <html> when opened from the Home Screen / Dock.
   ===================================================================== */
(function () {
  window.pwaStatus = { sw: "unsupported", error: null };
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
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
    // let the lobby/menu panels scroll if they're taller than the screen
    if (e.touches.length > 1 || !(e.target.closest && e.target.closest(".panel"))) e.preventDefault();
  }, { passive: false });
  // (double-tap zoom is turned off by "touch-action: none" in the CSS)

  var standalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches);
  if (standalone) document.documentElement.classList.add("standalone");
})();
