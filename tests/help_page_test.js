/* Family help page: private links, the two alert buttons, and service-worker passthrough.
   NODE_PATH=/tmp/pwtest/node_modules node tests/help_page_test.js
*/
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const child = require("child_process");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const html = read("help/index.html");
const sw = read("sw.js");
const swPy = read("tools/build_pages.py");
const iosSw = read("ios/App/App/public/sw.js");
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
assert.ok(scriptMatch, "help page needs an inline script");
fs.writeFileSync("/tmp/help-page.js", scriptMatch[1]);
child.execFileSync(process.execPath, ["--check", "/tmp/help-page.js"]);

assert.strictEqual(sw, iosSw, "iOS copy of sw.js must match the Pages worker");
assert.strictEqual(sw.split("floodlight-kickoff-pages-v47").length - 1, 1);
assert.ok(!sw.includes("floodlight-kickoff-pages-v46"));
assert.ok(sw.includes('url.pathname.includes("/help/")'));
assert.ok(sw.includes('url.pathname.endsWith("/help")'));
assert.ok(swPy.includes("floodlight-kickoff-pages-v47"));
assert.ok(!swPy.includes("floodlight-kickoff-pages-v46"));
assert.ok(swPy.includes('includes("/help/")'));
assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(html), "help page must not load an external script");
assert.ok(!/<link\b[^>]*\bhref\s*=\s*["']https?:/i.test(html), "help page must not load an external stylesheet");
assert.ok(!html.includes("fetch(") && !html.includes("XMLHttpRequest") && !html.includes("sendBeacon"));
assert.ok(html.includes("PBKDF2") && html.includes("SHA-256") && html.includes("AES-GCM"));
assert.ok(html.includes("sms:/open?addresses="));
assert.ok(html.includes("Something's wrong") && html.includes("Can you help me"));
assert.ok(html.includes("Also send email") && html.includes("This page isn't for you."));
assert.ok(html.includes('href="tel:911"') && html.includes("localStorage"));
assert.ok(html.includes("Forgot code? Reset setup"));
assert.ok(html.includes("That code doesn't match the one saved on this phone."));
assert.ok(html.includes("This erases the setup on this phone. Links you already sent keep working until you make new ones."));
assert.ok(html.includes("too short") && html.includes("don't match"));
assert.ok(!html.includes("new-password") && !html.includes("current-password"));
const urls = html.match(/https?:\/\/[^"'\\\s)]+/g) || [];
assert.deepStrictEqual(urls, ["https://maps.google.com/?q="]);

const CODE = "river-stone-lamp";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36";

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
  return new Uint8Array(bin);
}
function bytesToB64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function mutateLink(link, mutate) {
  const url = new URL(link);
  const params = new URLSearchParams(url.hash.slice(1));
  const keyBytes = b64urlToBytes(params.get("k"));
  const packed = b64urlToBytes(params.get("d"));
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt", "encrypt"]);
  const plain = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)));
  mutate(plain);
  const iv2 = crypto.getRandomValues(new Uint8Array(12));
  const ct2 = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv2 }, key, new TextEncoder().encode(JSON.stringify(plain))));
  const packed2 = new Uint8Array(iv2.length + ct2.length);
  packed2.set(iv2, 0);
  packed2.set(ct2, iv2.length);
  url.hash = "k=" + params.get("k") + "&d=" + bytesToB64url(packed2);
  return url.toString();
}
function smsBody(url) {
  const at = url.indexOf("body=");
  assert.ok(at > 0, url);
  return decodeURIComponent(url.slice(at + 5));
}

function startServer() {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".txt": "text/plain; charset=utf-8",
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) { res.writeHead(403); res.end("no"); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const pageErrors = [];
async function openHelp(page, url) {
  if (!page.__tracked) {
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.__tracked = true;
  }
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const app = document.getElementById("app");
    return app && !app.hidden && app.getAttribute("data-screen");
  });
}

async function screen(page) {
  return page.evaluate(() => {
    const app = document.getElementById("app");
    return {
      name: app.getAttribute("data-screen"),
      text: app.innerText,
      controls: app.querySelectorAll("a, button, input").length,
    };
  });
}

async function noOverflow(page, label) {
  const n = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(n <= 1, label + " horizontal overflow " + n);
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch (e) {
    console.log("static help checks passed; browser checks skipped");
    return;
  }
  const shots = process.env.SHOTS || "/opt/cursor/artifacts";
  fs.mkdirSync(shots, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const BASE = "http://127.0.0.1:" + port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  async function installHooks(context, denyGeo) {
    await context.addInitScript((deny) => {
      window.__opened = [];
      window.__geo = 0;
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        const href = this.getAttribute("href") || "";
        if (/^(sms:|mailto:|tel:)/i.test(href)) {
          window.__opened.push(href);
          return;
        }
        return origClick.call(this);
      };
      if (navigator.geolocation) {
        const orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        navigator.geolocation.getCurrentPosition = function (ok, err, opts) {
          window.__geo += 1;
          if (deny) {
            if (err) err({ code: 1, message: "denied" });
            return;
          }
          return orig(ok, err, opts);
        };
      }
    }, !!denyGeo);
  }

  async function newPhone(ua, width, height, extra) {
    const context = await browser.newContext(Object.assign({
      viewport: { width: width, height: height },
      userAgent: ua,
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    }, extra || {}));
    await installHooks(context, false);
    return context;
  }

  try {
    const ownerCtx = await newPhone(IPHONE, 390, 844);
    const owner = await ownerCtx.newPage();
    await openHelp(owner, BASE + "/help/");
    let view = await screen(owner);
    assert.strictEqual(view.name, "denied");
    assert.ok(view.text.includes("This page isn't for you."));
    assert.strictEqual(view.controls, 0, "denied screen must not offer controls");
    assert.ok(!/setup/i.test(view.text));
    await noOverflow(owner, "denied 390");
    await owner.setViewportSize({ width: 320, height: 568 });
    await noOverflow(owner, "denied 320");
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.screenshot({ path: path.join(shots, "help-denied-iphone.png") });

    await openHelp(owner, BASE + "/help/#setup");
    view = await screen(owner);
    assert.strictEqual(view.name, "setup-create");
    assert.strictEqual(await owner.getAttribute("#setup-code", "type"), "password");
    assert.strictEqual(await owner.getAttribute("#setup-code", "autocomplete"), "off");
    assert.strictEqual(await owner.getAttribute("#setup-code", "autocapitalize"), "none");
    await owner.click("#toggle-code");
    assert.strictEqual(await owner.getAttribute("#setup-code", "type"), "text");
    assert.strictEqual(await owner.getAttribute("#setup-code-2", "type"), "text");
    await owner.fill("#setup-code", "abc");
    await owner.click("#toggle-code");
    assert.strictEqual(await owner.inputValue("#setup-code"), "abc");
    assert.strictEqual(await owner.getAttribute("#setup-code", "type"), "password");
    await owner.fill("#setup-code", "short");
    await owner.fill("#setup-code-2", "short");
    await owner.click("#code-submit");
    await owner.waitForSelector("#form-error:not([hidden])");
    assert.match(await owner.textContent("#form-error"), /too short/);
    await owner.fill("#setup-code", CODE);
    await owner.fill("#setup-code-2", CODE + "s");
    await owner.click("#code-submit");
    assert.match(await owner.textContent("#form-error"), /don't match/);
    await owner.fill("#setup-code", "River1");
    await owner.fill("#setup-code-2", "river1");
    await owner.click("#code-submit");
    assert.match(await owner.textContent("#form-error"), /don't match/);
    assert.match(await owner.textContent("#form-error"), /capital letters/);
    await owner.fill("#setup-code", CODE);
    await owner.fill("#setup-code-2", CODE);
    await owner.click("#code-submit");
    await owner.waitForSelector("#owner-name", { timeout: 20000 });
    assert.strictEqual(await owner.evaluate(() => document.getElementById("app").getAttribute("data-screen")), "setup");

    const hashCheck = await owner.evaluate(async (code) => {
      const raw = localStorage.getItem("familyHelpOwnerV1");
      if (!raw || raw.includes(code)) return "leaked";
      const obj = JSON.parse(raw);
      if (obj.code || obj.password || obj.setupCode) return "field";
      const salt = Uint8Array.from(atob(obj.salt), (c) => c.charCodeAt(0));
      const expected = Uint8Array.from(atob(obj.hash), (c) => c.charCodeAt(0));
      if (salt.length !== 16 || expected.length !== 32 || obj.iterations !== 210000) return "shape";
      const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"]);
      const bits = new Uint8Array(await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: obj.iterations },
        material,
        256
      ));
      for (let i = 0; i < bits.length; i++) if (bits[i] !== expected[i]) return "mismatch";
      if (sessionStorage.getItem("familyHelpOwnerUnlocked") !== "1") return "session";
      if (Object.values(sessionStorage).some((v) => String(v).includes(code))) return "session leak";
      return "ok";
    }, CODE);
    assert.strictEqual(hashCheck, "ok");

    await openHelp(owner, BASE + "/help/");
    view = await screen(owner);
    assert.strictEqual(view.name, "unfinished");
    assert.ok(!view.text.includes("Something's wrong"));
    await owner.click("text=Continue setup");
    await owner.waitForSelector("#owner-name");

    await owner.click("#save-links");
    await owner.waitForSelector("#form-error");
    assert.match(await owner.textContent("#form-error"), /Enter a name/);

    await owner.fill("#owner-name", "Jordan");
    await owner.fill("#contact-0", "+1 (555) 121-2000");
    await owner.click("[data-action=add-contact]");
    await owner.fill("#contact-1", "family@example.com");
    await owner.fill("#person-name-0", "Sam");
    await owner.fill("#person-contact-0", "+1 (555) 987-6000");
    await owner.click("[data-action=add-person]");
    await owner.fill("#person-name-1", "Riley");
    await owner.fill("#person-contact-1", "Riley@Example.com");
    await owner.fill("#expire-days", "7");
    await owner.click("#save-links");
    await owner.waitForSelector("[data-link-field='1']", { timeout: 10000 });
    assert.match(await owner.textContent("#form-notice"), /Links are ready/);
    assert.match(await owner.innerText("body"), /forwarded link works/i);
    assert.match(await owner.innerText("body"), /no server/i);
    const links = await owner.$$eval("[data-link-field]", (els) => els.map((el) => el.value));
    assert.strictEqual(links.length, 2);
    for (const link of links) {
      const parsed = new URL(link);
      assert.strictEqual(parsed.origin + parsed.pathname, BASE + "/help/");
      assert.ok(parsed.hash.startsWith("#k="));
      assert.ok(parsed.hash.includes("&d="));
      assert.strictEqual(parsed.search, "");
      const keyLen = b64urlToBytes(new URLSearchParams(parsed.hash.slice(1)).get("k")).length;
      assert.strictEqual(keyLen, 16);
    }
    await owner.setViewportSize({ width: 320, height: 700 });
    await noOverflow(owner, "setup 320");
    await owner.setViewportSize({ width: 390, height: 844 });
    await noOverflow(owner, "setup 390");
    await owner.screenshot({ path: path.join(shots, "help-setup-links.png"), fullPage: true });

    await owner.click("[data-action=send-link][data-index='0']");
    const invite = await owner.evaluate(() => window.__opened.slice());
    assert.strictEqual(invite.length, 1);
    assert.ok(invite[0].startsWith("sms:/open?addresses=%2B15559876000&body="), invite[0].slice(0, 80));
    assert.ok(smsBody(invite[0]).includes(links[0]));
    await owner.click("[data-action=send-link][data-index='1']");
    const inviteMail = await owner.evaluate(() => window.__opened[1]);
    assert.ok(inviteMail.startsWith("mailto:riley@example.com?"), inviteMail.slice(0, 80));

    await owner.click("[data-action=renew-link][data-index='0']");
    await owner.waitForFunction((old) => {
      const el = document.querySelector("[data-link-field='0']");
      return el && el.value && el.value !== old;
    }, links[0]);
    const renewed = await owner.inputValue("[data-link-field='0']");
    const rileyStill = await owner.inputValue("[data-link-field='1']");
    assert.notStrictEqual(renewed, links[0]);
    assert.strictEqual(rileyStill, links[1]);
    assert.match(await owner.textContent("#form-notice"), /New links were made for Sam/);

    await openHelp(owner, BASE + "/help/");
    view = await screen(owner);
    assert.strictEqual(view.name, "main");
    assert.match(view.text, /Hi Jordan/);
    assert.ok(view.text.includes("Edit contacts"));
    assert.ok(view.text.includes("Call 911"));
    assert.strictEqual(await owner.getAttribute("#call-911", "href"), "tel:911");
    assert.strictEqual(await owner.locator("[data-action=remove-recipient]").count(), 0);

    const samCtx = await newPhone(IPHONE, 390, 844, {
      geolocation: { latitude: 37.1, longitude: -122.2, accuracy: 12 },
      permissions: ["geolocation"],
    });
    const sam = await samCtx.newPage();
    await openHelp(sam, links[0]);
    view = await screen(sam);
    assert.strictEqual(view.name, "main", view.text);
    assert.match(view.text, /Hi Sam/);
    assert.match(view.text, /Saved on this phone/);
    assert.ok(view.text.includes("Something's wrong") && view.text.includes("Can you help me"));
    assert.ok(!view.text.includes("Edit contacts"));
    assert.ok(view.text.includes("+15551212000"));
    assert.ok(!view.text.includes("15559876000"));
    assert.ok(view.text.includes("family@example.com"));
    assert.strictEqual(await sam.evaluate(() => location.hash), "");
    const stored = await sam.evaluate((code) => {
      const raw = localStorage.getItem("familyHelpRecipientV1");
      return raw && !raw.includes(code) && raw.includes("Sam");
    }, CODE);
    assert.ok(stored);
    await noOverflow(sam, "main 390");
    const big = await sam.locator("#btn-wrong").boundingBox();
    assert.ok(big.height >= 64 && big.width >= 270, JSON.stringify(big));
    await sam.screenshot({ path: path.join(shots, "help-main-iphone.png") });
    await sam.setViewportSize({ width: 320, height: 568 });
    await noOverflow(sam, "main 320");
    const small = await sam.locator("#btn-wrong").boundingBox();
    assert.ok(small.height >= 64 && small.width >= 250, JSON.stringify(small));
    await sam.screenshot({ path: path.join(shots, "help-main-small.png") });
    await sam.setViewportSize({ width: 390, height: 844 });

    const geoBefore = await sam.evaluate(() => window.__geo || 0);
    await sam.click("#btn-wrong");
    await sam.waitForFunction(() => window.__opened.length > 0);
    const opened = await sam.evaluate(() => window.__opened[0]);
    const status = await sam.textContent("#status");
    const body = smsBody(opened);
    assert.ok(opened.startsWith("sms:/open?addresses=%2B15551212000&body="), opened.slice(0, 90));
    assert.ok(body.includes("Sam needs help. Something's wrong. Sent "), body);
    assert.ok(body.includes("Location: https://maps.google.com/?q=37.100000,-122.200000"), body);
    assert.match(body, /\(±\d+ m\)/);
    const tz = await sam.evaluate(() => new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName").value);
    assert.ok(body.includes(tz), body + " missing " + tz);
    assert.match(status, /Tap Send/);
    assert.match(status, /cannot send by itself/);
    const mailHref = await sam.getAttribute("#open-mail", "href");
    assert.ok(mailHref.startsWith("mailto:family@example.com?"), mailHref.slice(0, 60));
    assert.strictEqual(await sam.textContent("#open-mail"), "Also send email");
    assert.strictEqual(geoBefore, 0, "location must wait for a button press");
    await sam.evaluate(() => { window.__opened = []; document.getElementById("open-mail").click(); });
    const mailOpen = await sam.evaluate(() => window.__opened[0]);
    const mailQuery = mailOpen.slice(mailOpen.indexOf("?") + 1);
    const mailParams = new URLSearchParams(mailQuery);
    assert.strictEqual(decodeURIComponent(mailOpen.slice("mailto:".length).split("?")[0]), "family@example.com");
    assert.ok(mailParams.get("subject").includes("Sam needs help"));
    assert.ok(mailParams.get("body").includes("Something's wrong"));
    assert.ok(mailParams.get("body").includes("https://maps.google.com/?q=37.100000,-122.200000"));

    await sam.click("#btn-help");
    await sam.waitForFunction(() => window.__opened.length > 1);
    const helpBody = smsBody(await sam.evaluate(() => window.__opened[window.__opened.length - 1]));
    assert.ok(helpBody.includes("Sam needs help. Can you help me. Sent "), helpBody);
    assert.ok(!helpBody.includes("Something's wrong"));

    const oldCtx = await newPhone(IPHONE, 390, 844);
    const oldPage = await oldCtx.newPage();
    await openHelp(oldPage, links[0]);
    assert.match((await screen(oldPage)).text, /Hi Sam/);
    const newCtx = await newPhone(IPHONE, 390, 844);
    const newPage = await newCtx.newPage();
    await openHelp(newPage, renewed);
    assert.match((await screen(newPage)).text, /Hi Sam/);

    const bad = new URL(renewed);
    const badParams = new URLSearchParams(bad.hash.slice(1));
    const d = badParams.get("d");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const flipped = alphabet[(alphabet.indexOf(d[8]) + 7) % alphabet.length];
    bad.hash = "k=" + badParams.get("k") + "&d=" + d.slice(0, 8) + flipped + d.slice(9);
    const badPage = await newPhone(IPHONE, 390, 844).then((ctx) => ctx.newPage());
    await openHelp(badPage, bad.toString());
    view = await screen(badPage);
    assert.strictEqual(view.name, "denied", view.text);
    assert.strictEqual(view.controls, 0);

    const partial = await newPhone(IPHONE, 320, 568).then((ctx) => ctx.newPage());
    await openHelp(partial, BASE + "/help/#k=abcd");
    assert.strictEqual((await screen(partial)).name, "denied");

    const expiredLink = await mutateLink(links[1], (payload) => { payload.x = Date.now() - 5000; });
    const expiredPage = await newPhone(IPHONE, 390, 844).then((ctx) => ctx.newPage());
    await openHelp(expiredPage, expiredLink);
    view = await screen(expiredPage);
    assert.strictEqual(view.name, "expired", view.text);
    assert.ok(view.text.includes("This link has expired."));
    assert.strictEqual(view.controls, 0);
    assert.strictEqual(await expiredPage.evaluate(() => localStorage.getItem("familyHelpRecipientV1")), null);

    const switchCtx = await newPhone(IPHONE, 390, 844);
    const switcher = await switchCtx.newPage();
    await openHelp(switcher, links[1]);
    assert.match((await screen(switcher)).text, /Hi Riley/);
    await openHelp(switcher, renewed);
    view = await screen(switcher);
    assert.strictEqual(view.name, "switch", view.text);
    assert.match(view.text, /Riley/);
    assert.match(view.text, /Sam/);
    await switcher.click("[data-action=decline-link]");
    await switcher.waitForFunction(() => document.getElementById("app").getAttribute("data-screen") === "main");
    assert.match((await screen(switcher)).text, /Hi Riley/);
    await openHelp(switcher, renewed);
    await switcher.click("[data-action=accept-link]");
    await switcher.waitForFunction(() => /Hi Sam/.test(document.body.innerText));
    assert.strictEqual(await switcher.evaluate(() => location.hash), "");

    const androidCtx = await newPhone(ANDROID, 390, 844, {
      geolocation: { latitude: 37.1, longitude: -122.2, accuracy: 8 },
      permissions: ["geolocation"],
    });
    const android = await androidCtx.newPage();
    await openHelp(android, renewed);
    await android.click("#btn-wrong");
    await android.waitForFunction(() => window.__opened.length > 0);
    const androidSms = await android.evaluate(() => window.__opened[0]);
    assert.ok(androidSms.startsWith("sms:+15551212000?body="), androidSms.slice(0, 80));
    assert.ok(!androidSms.includes("/open?addresses="));
    assert.ok(smsBody(androidSms).includes("Something's wrong"));
    await android.click("[data-action=remove-recipient]");
    assert.match(await android.textContent("[data-action=remove-recipient]"), /Tap again/);
    await android.click("[data-action=remove-recipient]");
    await android.waitForFunction(() => document.getElementById("app").getAttribute("data-screen") === "denied");

    const denyCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: IPHONE,
      hasTouch: true,
      isMobile: true,
    });
    await installHooks(denyCtx, true);
    const deny = await denyCtx.newPage();
    await openHelp(deny, renewed);
    assert.strictEqual(await deny.evaluate(() => window.__geo), 0);
    await deny.click("#btn-help");
    await deny.waitForFunction(() => window.__opened.length > 0);
    const deniedBody = smsBody(await deny.evaluate(() => window.__opened[0]));
    assert.ok(deniedBody.includes("Can you help me"));
    assert.ok(deniedBody.includes("Location: not available."), deniedBody);
    assert.match(await deny.textContent("#status"), /Location is off/);

    await owner.evaluate(() => sessionStorage.clear());
    await openHelp(owner, BASE + "/help/#setup");
    assert.strictEqual((await screen(owner)).name, "setup-unlock");
    await owner.fill("#setup-code", "not-the-code");
    await owner.click("#code-submit");
    await owner.waitForSelector("#form-error:not([hidden])", { timeout: 20000 });
    assert.match(await owner.textContent("#form-error"), /doesn't match the one saved on this phone/);
    assert.strictEqual((await screen(owner)).name, "setup-unlock");
    const forgot = await owner.locator("#forgot-code").boundingBox();
    assert.ok(forgot && forgot.height >= 48 && forgot.width >= 250, JSON.stringify(forgot));
    await owner.fill("#setup-code", "  " + CODE + "\u00a0");
    await owner.click("#code-submit");
    await owner.waitForSelector("#owner-name", { timeout: 20000 });
    assert.strictEqual(await owner.inputValue("#owner-name"), "Jordan");

    const savedOwner = await owner.evaluate(() => localStorage.getItem("familyHelpOwnerV1"));
    const resetCtx = await newPhone(IPHONE, 390, 844);
    const resetPage = await resetCtx.newPage();
    await openHelp(resetPage, BASE + "/help/");
    await resetPage.evaluate((raw) => {
      localStorage.setItem("familyHelpOwnerV1", raw);
      localStorage.setItem("familyHelpRecipientV1", "keep-this-recipient");
    }, savedOwner);
    await openHelp(resetPage, BASE + "/help/#setup");
    view = await screen(resetPage);
    assert.strictEqual(view.name, "setup-unlock", view.text);
    assert.match(view.text, /already has a setup code/);
    assert.ok(view.text.includes("Forgot code? Reset setup"));
    await resetPage.fill("#setup-code", "brand-new-code");
    await resetPage.click("#code-submit");
    await resetPage.waitForSelector("#form-error:not([hidden])", { timeout: 20000 });
    assert.match(await resetPage.textContent("#form-error"), /doesn't match the one saved on this phone/);
    assert.ok(await resetPage.locator("#forgot-code").isVisible());
    await noOverflow(resetPage, "unlock 390");
    await resetPage.setViewportSize({ width: 320, height: 568 });
    await noOverflow(resetPage, "unlock 320");
    await resetPage.setViewportSize({ width: 390, height: 844 });
    await resetPage.screenshot({ path: path.join(shots, "help-unlock-iphone.png") });
    await resetPage.click("#forgot-code");
    await resetPage.waitForFunction(() => document.getElementById("app").getAttribute("data-screen") === "setup-reset");
    view = await screen(resetPage);
    assert.ok(view.text.includes("This erases the setup on this phone. Links you already sent keep working until you make new ones."));
    await noOverflow(resetPage, "reset 390");
    await resetPage.screenshot({ path: path.join(shots, "help-reset-iphone.png") });
    await resetPage.click("#cancel-reset");
    await resetPage.waitForFunction(() => document.getElementById("app").getAttribute("data-screen") === "setup-unlock");
    assert.ok(await resetPage.evaluate(() => !!localStorage.getItem("familyHelpOwnerV1")));
    await openHelp(resetPage, BASE + "/help/#reset");
    assert.strictEqual((await screen(resetPage)).name, "setup-reset");
    await resetPage.setViewportSize({ width: 320, height: 568 });
    await noOverflow(resetPage, "reset 320");
    await resetPage.click("#confirm-reset");
    await resetPage.waitForSelector("#setup-code-2");
    view = await screen(resetPage);
    assert.strictEqual(view.name, "setup-create", view.text);
    const left = await resetPage.evaluate(() => ({
      owner: localStorage.getItem("familyHelpOwnerV1"),
      recipient: localStorage.getItem("familyHelpRecipientV1"),
    }));
    assert.strictEqual(left.owner, null);
    assert.strictEqual(left.recipient, "keep-this-recipient");

    assert.deepStrictEqual(pageErrors, []);

    const swCtx = await browser.newContext();
    const swPage = await swCtx.newPage();
    const swErrors = [];
    swPage.on("pageerror", (err) => swErrors.push(String(err)));
    await swPage.goto(BASE + "/", { waitUntil: "load" });
    await swPage.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 20000 });
    const helpText = await swPage.evaluate(async () => {
      const res = await fetch("/help/index.html", { cache: "no-store" });
      return res.text();
    });
    assert.ok(helpText.includes("This page isn't for you."));
    assert.ok(!helpText.includes('id="startBtn"'));
    await swPage.goto(BASE + "/help/", { waitUntil: "domcontentloaded" });
    await swPage.waitForFunction(() => document.getElementById("app") && !document.getElementById("app").hidden);
    const helpView = await screen(swPage);
    assert.strictEqual(helpView.name, "denied");
    assert.ok(!helpView.text.includes("KICK OFF") && !helpView.text.includes("FLOODLIGHT"));
    const cacheInfo = await swPage.evaluate(async () => {
      const keys = await caches.keys();
      const names = [];
      for (const key of keys) {
        const cache = await caches.open(key);
        for (const req of await cache.keys()) names.push(key + " " + req.url);
      }
      return { keys: keys, names: names };
    });
    assert.ok(cacheInfo.keys.some((key) => key.includes("floodlight-kickoff-pages-v47")), cacheInfo.keys.join(","));
    assert.ok(!cacheInfo.names.some((name) => name.includes("/help")), cacheInfo.names.filter((name) => name.includes("help")).join(","));
    assert.ok(cacheInfo.names.some((name) => name.includes("index.html")), "game shell was not cached");
    await swCtx.setOffline(true);
    let offline = "";
    try {
      await swPage.goto(BASE + "/help/", { waitUntil: "domcontentloaded", timeout: 8000 });
      offline = await swPage.locator("body").innerText();
    } catch (e) {
      offline = "NAV_FAILED";
    }
    assert.ok(!offline.includes("KICK OFF") && !offline.includes("FLOODLIGHT"), offline.slice(0, 300));
    await swCtx.setOffline(false);
    await swPage.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    assert.ok(await swPage.locator("#startBtn").count() > 0, "offline passthrough must not break the game page");
    assert.deepStrictEqual(swErrors, []);
    console.log("help page checks passed");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
