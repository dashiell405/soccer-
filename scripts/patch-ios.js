#!/usr/bin/env node
/* Keep iPhone project settings that `cap sync` does not own.
   Safe to run more than once. */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const plistPath = path.join(root, "ios", "App", "App", "Info.plist");
const gitignorePath = path.join(root, "ios", ".gitignore");
const pbxPath = path.join(root, "ios", "App", "App.xcodeproj", "project.pbxproj");

if (!fs.existsSync(plistPath)) {
  console.error("missing " + plistPath + " — run npx cap add ios first");
  process.exit(1);
}

let plist = fs.readFileSync(plistPath, "utf8");

function ensureKey(key, xml) {
  if (plist.indexOf("<key>" + key + "</key>") >= 0) return;
  const needle = "</dict>\n</plist>";
  if (plist.indexOf(needle) < 0) {
    console.error("Info.plist does not end the way this script expects");
    process.exit(1);
  }
  plist = plist.replace(needle, xml + "\n" + needle);
}

if (plist.indexOf("<string>kickoff</string>") < 0) {
  ensureKey("CFBundleURLTypes", [
    "\t<key>CFBundleURLTypes</key>",
    "\t<array>",
    "\t\t<dict>",
    "\t\t\t<key>CFBundleTypeRole</key>",
    "\t\t\t<string>Editor</string>",
    "\t\t\t<key>CFBundleURLName</key>",
    "\t\t\t<string>com.dashiellgreen.kickoff</string>",
    "\t\t\t<key>CFBundleURLSchemes</key>",
    "\t\t\t<array>",
    "\t\t\t\t<string>kickoff</string>",
    "\t\t\t</array>",
    "\t\t</dict>",
    "\t</array>",
  ].join("\n"));
}

ensureKey(
  "NSLocalNetworkUsageDescription",
  "\t<key>NSLocalNetworkUsageDescription</key>\n\t<string>Kickoff uses Wi-Fi so you can play a match with friends.</string>"
);
ensureKey(
  "ITSAppUsesNonExemptEncryption",
  "\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>"
);

if (plist.indexOf("<key>CFBundleDisplayName</key>") >= 0) {
  plist = plist.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    "$1Kickoff$2"
  );
} else {
  ensureKey("CFBundleDisplayName", "\t<key>CFBundleDisplayName</key>\n\t<string>Kickoff</string>");
}

const orientations = [
  "UIInterfaceOrientationPortrait",
  "UIInterfaceOrientationLandscapeLeft",
  "UIInterfaceOrientationLandscapeRight",
];
for (const name of orientations) {
  if (plist.indexOf(name) < 0) {
    console.error("Info.plist is missing " + name + ". Portrait and landscape both need to stay allowed.");
    process.exit(1);
  }
}

fs.writeFileSync(plistPath, plist);

if (fs.existsSync(gitignorePath)) {
  const drop = {
    "App/App/public": 1,
    "App/App/capacitor.config.json": 1,
    "App/App/config.xml": 1,
  };
  const raw = fs.readFileSync(gitignorePath, "utf8");
  const lines = raw.split(/\n/).filter(function (line) {
    return !drop[line.trim()];
  });
  const next = lines.join("\n").replace(/\n+$/, "\n");
  if (next !== raw) fs.writeFileSync(gitignorePath, next);
}

const config = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf8"));
if (!config.appId || config.appName !== "Kickoff" || config.webDir !== "www") {
  console.error("capacitor.config.json needs an appId, appName Kickoff, and webDir www");
  process.exit(1);
}
if (fs.existsSync(pbxPath)) {
  const pbx = fs.readFileSync(pbxPath, "utf8");
  if (pbx.indexOf("PRODUCT_BUNDLE_IDENTIFIER = " + config.appId + ";") < 0) {
    console.log("Note: Xcode bundle id and capacitor.config.json appId do not match yet.");
    console.log("Set them to the same id before you upload to the App Store. See IOS_APP.md.");
  }
}
if (config.server && config.server.url) {
  console.error("capacitor.config.json server.url would load a website instead of the bundled game");
  process.exit(1);
}

console.log("iOS project patched (name Kickoff, scheme kickoff://login)");
