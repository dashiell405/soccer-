#!/usr/bin/env node
/* Copy the GitHub Pages game into www/ for the iPhone app.
   The files at the repo root stay where GitHub Pages serves them.
   Nothing here is uploaded over the live site. */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dest = path.join(root, "www");

const FILES = [
  "index.html",
  "online.html",
  "online.js",
  "game.js",
  "pwa.js",
  "sw.js",
  "manifest.webmanifest",
  "vendor/peerjs.min.js",
  "vendor/peerjs.LICENSE.txt",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-192.png",
  "icons/maskable-512.png",
  "assets/cover.png",
];

function copyFile(rel) {
  const from = path.join(root, rel);
  const to = path.join(dest, rel);
  if (!fs.existsSync(from)) {
    console.error("missing " + rel);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function injectNative(rel) {
  const file = path.join(dest, rel);
  let html = fs.readFileSync(file, "utf8");
  if (html.indexOf('src="native.js"') >= 0) return;
  const tag = '<script src="native.js"></script>\n';
  if (html.indexOf("</body>") < 0) {
    console.error(rel + " has no </body>");
    process.exit(1);
  }
  html = html.replace("</body>", tag + "</body>");
  fs.writeFileSync(file, html);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
FILES.forEach(copyFile);
fs.copyFileSync(path.join(root, "native", "native.js"), path.join(dest, "native.js"));
injectNative("index.html");
injectNative("online.html");

const index = fs.readFileSync(path.join(dest, "index.html"), "utf8");
if (index.indexOf('src="https://dashiell405.github.io') >= 0) {
  console.error("www/index.html loads the live website. It must use the copied files.");
  process.exit(1);
}
if (index.indexOf('src="native.js"') < 0 || index.indexOf('src="pwa.js"') < 0) {
  console.error("www/index.html is missing a script");
  process.exit(1);
}
console.log("collected " + (FILES.length + 1) + " files into www/");
