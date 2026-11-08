/* iPhone app extras. scripts/collect-www.js copies this into www/ only.
   GitHub Pages never loads it. Inside the app, Capacitor injects
   window.Capacitor before this file runs. */
(function () {
  function nativeApp() {
    try {
      if (location.protocol === "capacitor:" || location.protocol === "ionic:") return true;
      if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return true;
    } catch (e) {}
    return false;
  }
  if (!nativeApp()) return;

  document.documentElement.classList.add("standalone", "native-app");

  function call(plugin, method, args) {
    try {
      if (!plugin || typeof plugin[method] !== "function") return;
      var ret = plugin[method](args || {});
      if (ret && typeof ret.catch === "function") ret.catch(function () {});
    } catch (e) {}
  }

  function dress() {
    var plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
    call(plugins.StatusBar, "setOverlaysWebView", { overlay: true });
    call(plugins.StatusBar, "setStyle", { style: "DARK" });
    call(plugins.StatusBar, "setBackgroundColor", { color: "#0c2816" });
    call(plugins.SplashScreen, "hide", { fadeOutDuration: 200 });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", dress);
  else dress();
  window.addEventListener("load", function () {
    setTimeout(dress, 300);
  });
})();
