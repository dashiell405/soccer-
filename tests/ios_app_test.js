/* Checks the iPhone project is a bundled app, not a website wrapper.
   No Xcode on this machine, so this does not compile the app. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function exists(rel) {
  assert.ok(fs.existsSync(path.join(root, rel)), "missing " + rel);
}

const config = JSON.parse(read("capacitor.config.json"));
assert.strictEqual(config.appId, "com.dashiellgreen.kickoff");
assert.strictEqual(config.appName, "Kickoff");
assert.strictEqual(config.webDir, "www");
assert.strictEqual(config.zoomEnabled, false);
assert.strictEqual(config.ios.scrollEnabled, false);
assert.strictEqual(config.ios.contentInset, "never");
assert.strictEqual(config.ios.zoomEnabled, false);
assert.strictEqual(config.server.iosScheme, "capacitor");
assert.strictEqual(config.server.hostname, "localhost");
assert.ok(!config.server.url, "server.url would load a remote site");

const pkg = JSON.parse(read("package.json"));
assert.ok(pkg.scripts["ios:sync"].indexOf("collect-www.js") >= 0);
assert.ok(pkg.scripts["ios:sync"].indexOf("cap sync ios") >= 0);
assert.ok(pkg.dependencies["@capacitor/core"]);
assert.ok(pkg.dependencies["@capacitor/haptics"]);
assert.ok(pkg.dependencies["@capacitor/status-bar"]);
assert.ok(pkg.dependencies["@capacitor/splash-screen"]);
assert.ok(pkg.dependencies["@capacitor/app"]);

const plist = read("ios/App/App/Info.plist");
assert.ok(plist.indexOf("<string>Kickoff</string>") >= 0);
assert.ok(plist.indexOf("<string>kickoff</string>") >= 0);
assert.ok(plist.indexOf("UIInterfaceOrientationPortrait") >= 0);
assert.ok(plist.indexOf("UIInterfaceOrientationLandscapeLeft") >= 0);
assert.ok(plist.indexOf("UIInterfaceOrientationLandscapeRight") >= 0);
assert.ok(plist.indexOf("NSLocalNetworkUsageDescription") >= 0);
assert.ok(plist.indexOf("<key>ITSAppUsesNonExemptEncryption</key>") >= 0);

const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
assert.ok(pbx.indexOf("PRODUCT_BUNDLE_IDENTIFIER = com.dashiellgreen.kickoff;") >= 0);
const scene = read("ios/App/App/SceneDelegate.swift");
assert.ok(scene.indexOf("openURLContexts") >= 0);

const guide = read("IOS_APP.md");
assert.ok(guide.indexOf("npm install") >= 0);
assert.ok(guide.indexOf("npm run ios:sync") >= 0);
assert.ok(guide.indexOf("npm run ios:open") >= 0);
assert.ok(guide.indexOf("kickoff://login") >= 0);
assert.ok(guide.indexOf("capacitor.config.json") >= 0);
assert.ok(guide.indexOf("com.dashiellgreen.kickoff") >= 0);

const ignore = read("ios/.gitignore");
assert.ok(ignore.indexOf("App/App/public") < 0, "bundled game files must stay in git");

for (const rel of [
  "ios/App/App/public/index.html",
  "ios/App/App/public/online.html",
  "ios/App/App/public/online.js",
  "ios/App/App/public/game.js",
  "ios/App/App/public/pwa.js",
  "ios/App/App/public/native.js",
  "ios/App/App/public/sw.js",
  "ios/App/App/public/assets/cover.png",
  "ios/App/App/public/vendor/peerjs.min.js",
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  "ios/App/App/Assets.xcassets/Splash.imageset/Default@1x~universal~anyany.png",
  "resources/icon-only.png",
  "resources/splash.png",
]) exists(rel);

const bundled = read("ios/App/App/public/index.html");
const pages = read("index.html");
assert.ok(bundled.indexOf('<script src="native.js"></script>') >= 0);
assert.ok(pages.indexOf("native.js") < 0, "GitHub Pages index must not load the native script");
assert.ok(bundled.indexOf('src="https://dashiell405.github.io') < 0);
assert.ok(read("ios/App/App/public/sw.js").indexOf("floodlight-kickoff-pages-v39") >= 0);
assert.ok(read("sw.js").indexOf("floodlight-kickoff-pages-v39") >= 0);
assert.ok(read("ios/App/App/public/pwa.js").indexOf('location.protocol === "capacitor:"') >= 0);
assert.ok(read("ios/App/App/capacitor.config.json").indexOf('"scrollEnabled": false') >= 0);

const storyboard = read("ios/App/App/Base.lproj/LaunchScreen.storyboard");
assert.ok(storyboard.indexOf('image="Splash"') >= 0);
assert.ok(storyboard.indexOf("0.047058823529411764") >= 0);

console.log("ios app shell checks passed");
