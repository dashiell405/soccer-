// Phone playability: iPhone-sized WebKit and mobile Chrome, portrait and landscape.
//
//   NODE_PATH=/tmp/soccer-test/node_modules node tests/mobile_test.js
//
// Serves the GitHub Pages files. Online host/join uses a local PeerJS broker
// so the test does not depend on the public cloud.
const { chromium, webkit } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8777;
const BASE = "http://127.0.0.1:" + PORT;
const SHOTS = process.env.SHOTS || "/opt/cursor/artifacts/screenshots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

function startStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end("no"); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

function startPeerBroker() {
  const { PeerServer } = require("peer");
  const broker = PeerServer({ port: 9000, path: "/", key: "peerjs" });
  return new Promise((resolve, reject) => {
    broker.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") resolve(broker);
      else reject(err);
    });
    setTimeout(() => resolve(broker), 200);
  });
}

const PHONES = {
  iphone13: {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  iphone15: {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
};

function orient(spec, landscape) {
  const v = spec.viewport;
  return {
    ...spec,
    viewport: landscape ? { width: v.height, height: v.width } : { width: v.width, height: v.height },
  };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  const server = await startStatic();
  const broker = await startPeerBroker();

  const chrome = await chromium.launch({
    executablePath: process.env.CHROME || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });
  const safari = await webkit.launch();

  function fail(msg) { errors.push(msg); console.error("FAIL", msg); }

  async function openPhone(browser, spec, extra) {
    const ctx = await browser.newContext({ ...spec, ...(extra || {}), serviceWorkers: "allow" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => {
      // Headless WebKit rejects AudioContext when the machine has no sound card.
      if (/audio device|AudioContext/i.test(e.message)) { console.log("audio warning:", e.message); return; }
      fail("pageerror: " + e.message);
    });
    page.on("console", (m) => { if (m.type() === "error") console.log("console", m.text().slice(0, 240)); });
    page.ctx = ctx;
    return page;
  }

  async function shot(page, name) {
    await page.screenshot({ path: path.join(SHOTS, name) });
    console.log("shot", name);
  }

  // Geometry of the on-screen touch controls. Throws a readable reason.
  async function controlReport(page) {
    return page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      function rect(id) {
        const el = document.getElementById(id);
        if (!el) return null;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return null;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        return { id, x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
      }
      function overlaps(a, c) {
        return a.x < c.r - 2 && a.r > c.x + 2 && a.y < c.b - 2 && a.b > c.y + 2;
      }
      function inside(a) {
        return a.x >= -1 && a.y >= -1 && a.r <= vw + 1 && a.b <= vh + 1;
      }
      function topAt(a) {
        const el = document.elementFromPoint(a.x + a.w / 2, a.y + a.h / 2);
        return el ? (el.id || el.className || el.tagName) : null;
      }
      const ids = ["joyBase", "joyBase2", "shootBtn", "passBtn", "sprintBtn", "skillBtn", "shootBtn2", "passBtn2", "sprintBtn2", "skillBtn2", "pauseBtn"];
      const boxes = {};
      ids.forEach((id) => { const b = rect(id); if (b) boxes[id] = b; });
      const problems = [];
      for (const id of Object.keys(boxes)) {
        const a = boxes[id];
        if (!inside(a)) problems.push(id + " off screen " + JSON.stringify(a));
        if (id.indexOf("Btn") >= 0 && (a.w < 44 || a.h < 44)) problems.push(id + " smaller than 44px " + Math.round(a.w) + "x" + Math.round(a.h));
      }
      const buttons = Object.keys(boxes).filter((id) => id.indexOf("Btn") >= 0 && id !== "pauseBtn");
      for (const id of buttons) {
        const hit = topAt(boxes[id]);
        if (hit !== id) problems.push(id + " covered by " + hit);
        for (const other of buttons) {
          if (other <= id) continue;
          if (overlaps(boxes[id], boxes[other])) problems.push(id + " overlaps " + other);
        }
        for (const joy of ["joyBase", "joyBase2"]) {
          if (boxes[joy] && overlaps(boxes[id], boxes[joy])) problems.push(id + " overlaps " + joy);
        }
      }
      const canvas = document.getElementById("game").getBoundingClientRect();
      const vv = window.visualViewport;
      if (Math.abs(canvas.width - vv.width) > 2 || Math.abs(canvas.height - vv.height) > 2) {
        problems.push("canvas " + Math.round(canvas.width) + "x" + Math.round(canvas.height) + " viewport " + Math.round(vv.width) + "x" + Math.round(vv.height));
      }
      const body = getComputedStyle(document.body);
      if (body.touchAction !== "none") problems.push("body touch-action " + body.touchAction);
      if (document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0) problems.push("page scrolled");
      return {
        problems,
        boxes: Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, { x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.w), h: Math.round(v.h) }])),
        split: document.getElementById("touchControls").classList.contains("split"),
        hint: document.getElementById("rotateHint").classList.contains("hidden") ? "" : document.getElementById("rotateHint").textContent,
        help: (document.getElementById("controlsHelp") || {}).innerText || "",
        canvas: { w: Math.round(canvas.width), h: Math.round(canvas.height) },
        scale: vv.scale,
      };
    });
  }

  function assertControls(report, label, opts) {
    if (report.problems.length) fail(label + ": " + report.problems.join("; "));
    if (opts.split && !report.split) fail(label + ": expected two-player controls");
    if (!opts.split && report.split) fail(label + ": single player should have one stick");
    if (opts.split && !report.boxes.shootBtn2) fail(label + ": missing P2 SHOOT");
    if (!opts.split && report.boxes.shootBtn2) fail(label + ": P2 buttons showing in 1 player");
    if (!report.boxes.joyBase || !report.boxes.shootBtn || !report.boxes.passBtn || !report.boxes.sprintBtn || !report.boxes.skillBtn) {
      fail(label + ": missing stick or SHOOT/PASS/RUN/SKILL " + JSON.stringify(report.boxes));
    }
    if (opts.portrait && !/sideways/i.test(report.hint)) fail(label + ": rotate hint missing: " + report.hint);
    if (!opts.portrait && report.hint) fail(label + ": rotate hint showing in landscape: " + report.hint);
    if (/press space|\bspace\b|wasd/i.test(report.help)) fail(label + ": keyboard prompt still showing: " + report.help.slice(0, 180));
    if (report.scale && Math.abs(report.scale - 1) > 0.01) fail(label + ": page zoomed to " + report.scale);
    if (opts.split && report.boxes.joyBase && report.boxes.joyBase2) {
      if (!(report.boxes.joyBase.x < report.boxes.joyBase2.x)) fail(label + ": P1 stick is not on the left");
    }
  }

  async function visible(page, sel) {
    return page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return s.display !== "none" && r.width > 8 && r.height > 8 && r.top >= -2 && r.bottom <= window.innerHeight + 2 && r.left >= -2 && r.right <= window.innerWidth + 2;
    }, sel);
  }

  async function hold(page, zoneId, dx) {
    await page.evaluate(({ zoneId, dx }) => {
      const el = document.getElementById(zoneId);
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(64, r.width * 0.25);
      const y = Math.min(r.bottom - 30, window.innerHeight - 30);
      const opts = { bubbles: true, cancelable: true, pointerId: zoneId === "joyZone2" ? 22 : 11, pointerType: "touch", isPrimary: true, buttons: 1 };
      el.dispatchEvent(new PointerEvent("pointerdown", Object.assign({ clientX: x, clientY: y }, opts)));
      el.dispatchEvent(new PointerEvent("pointermove", Object.assign({ clientX: x + dx, clientY: y }, opts)));
    }, { zoneId, dx });
  }

  async function release(page, zoneId) {
    await page.evaluate((zoneId) => {
      const el = document.getElementById(zoneId);
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: zoneId === "joyZone2" ? 22 : 11, pointerType: "touch" }));
    }, zoneId);
  }

  async function playOffline(page, label, opts) {
    try {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(() => {
        const el = document.getElementById("startBtn");
        const menu = document.getElementById("menu");
        if (!el || !menu) return false;
        const r = el.getBoundingClientRect();
        return getComputedStyle(menu).display !== "none" && r.width > 20 && r.height > 20;
      }, null, { timeout: 8000 });
    } catch (err) {
      const dump = await page.evaluate(() => {
        const el = document.getElementById("startBtn");
        const r = el ? el.getBoundingClientRect() : null;
        return {
          url: location.href,
          menu: document.getElementById("menu") && document.getElementById("menu").className,
          screens: Array.from(document.querySelectorAll(".overlay")).map((e) => e.id + ":" + e.className),
          rect: r && { w: r.width, h: r.height, y: r.y },
          phase: window.soccerDebug ? soccerDebug.state().phase : null,
        };
      });
      fail(label + ": KICK OFF not on the menu " + JSON.stringify(dump));
      return;
    }
    const meta = await page.evaluate(() => {
      const v = document.querySelector('meta[name="viewport"]').content;
      const panel = document.querySelector("#menu .panel");
      return {
        viewport: v,
        touch: getComputedStyle(document.body).touchAction,
        panelTouch: getComputedStyle(panel).touchAction,
        touchDevice: isTouchDevice,
      };
    });
    if (!/viewport-fit=cover/.test(meta.viewport)) fail(label + ": viewport-fit missing");
    if (meta.touch !== "none") fail(label + ": body allows page gestures");
    if (meta.panelTouch.indexOf("pan-y") < 0) fail(label + ": menu cannot scroll (" + meta.panelTouch + ")");
    if (!meta.touchDevice) fail(label + ": phone was not detected as a touch device");
    if (!(await visible(page, "#startBtn"))) fail(label + ": KICK OFF is off screen");
    if (!(await visible(page, "#onlineLink"))) fail(label + ": Play online is off screen");
    const menuHelp = await page.evaluate(() => document.getElementById("controlsHelp").textContent);
    if (/press space|\bspace\b|wasd/i.test(menuHelp)) fail(label + ": menu still says to use a keyboard: " + menuHelp.slice(0, 160));
    const hintOn = await page.isVisible("#rotateHint");
    if (opts.portrait && !hintOn) fail(label + ": sideways hint hidden on the menu");
    if (!opts.portrait && hintOn) fail(label + ": sideways hint showing in landscape menu");

    if (opts.shots && opts.shots.menu) await shot(page, opts.shots.menu);

    // Team picker
    await page.tap("#blueTeamBtn");
    await page.waitForSelector("#teamGrid button");
    if (!(await visible(page, "#teamGrid button"))) fail(label + ": team picker has no tappable team");
    if (!(await visible(page, "#pickBackBtn"))) fail(label + ": team picker Back is off screen");
    const font = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("customName")).fontSize));
    if (font < 16) fail(label + ": team name box is " + font + "px and iPhone would zoom it");
    if (opts.shots && opts.shots.teams) await shot(page, opts.shots.teams);
    if (!(await visible(page, "#pickBackBtn"))) {
      await page.evaluate(() => document.getElementById("pickBackBtn").scrollIntoView({ block: "center" }));
    }
    await page.tap("#pickBackBtn");
    await page.waitForFunction(() => !document.getElementById("menu").classList.contains("hidden"), null, { timeout: 5000 });

    // 1 player vs computer
    await page.evaluate(() => soccerDebug.start({ mode: "1p", kind: "quick", difficulty: "easy" }));
    await page.waitForFunction(() => { const s = soccerDebug.state(); return s.phase === "play" || s.phase === "setpiece"; });
    await sleep(200);
    let report = await controlReport(page);
    assertControls(report, label + " 1p", { split: false, portrait: opts.portrait });
    await page.tap("body");
    await sleep(80);
    const audio = await page.evaluate(() => Sound.ctx ? Sound.ctx.state : "missing");
    // Headless WebKit often has no audio device, so the context can stay suspended
    // even after a real tap. Chrome with autoplay allowed should be running.
    if (label.indexOf("chrome") === 0 && audio === "suspended") fail(label + ": sound stayed locked after a tap");
    console.log(label, "1p audio", audio, "canvas", report.canvas.w + "x" + report.canvas.h);
    if (opts.shots && opts.shots.match) await shot(page, opts.shots.match);

    await page.evaluate(() => soccerDebug.giveBall("p1"));
    const before = await page.evaluate(() => {
      const c = controllers.find((k) => k.id === "p1");
      return c.active ? c.active.x : null;
    });
    await hold(page, "joyZone", 48);
    await sleep(450);
    const after = await page.evaluate(() => {
      const c = controllers.find((k) => k.id === "p1");
      return c && c.active ? { x: c.active.x, vx: c.active.vx, mx: c.input.mx } : null;
    });
    await release(page, "joyZone");
    if (!after || !(after.mx > 0.2 || after.x > before + 4)) fail(label + ": joystick did not move P1 " + JSON.stringify({ before, after }));

    // Double-tap should not zoom the page
    await page.tap("#shootBtn");
    await page.tap("#shootBtn");
    const scale = await page.evaluate(() => window.visualViewport.scale);
    if (Math.abs(scale - 1) > 0.01) fail(label + ": double-tap zoomed to " + scale);

    // 2 players, split sticks
    await page.evaluate(() => soccerDebug.start({ mode: "2p", kind: "quick" }));
    await page.waitForFunction(() => soccerDebug.state().mode === "2p" && (soccerDebug.state().phase === "play" || soccerDebug.state().phase === "setpiece"));
    await sleep(200);
    report = await controlReport(page);
    assertControls(report, label + " 2p", { split: true, portrait: opts.portrait });
    await page.evaluate(() => { soccerDebug.giveBall("p1"); soccerDebug.giveBall("p2"); });
    const startPos = await page.evaluate(() => controllers.filter((c) => !c.cpu && c.active).map((c) => ({ id: c.id, x: c.active.x })));
    await hold(page, "joyZone", 46);
    await hold(page, "joyZone2", -46);
    await sleep(500);
    const moved = await page.evaluate(() => controllers.filter((c) => !c.cpu && c.active).map((c) => ({ id: c.id, x: c.active.x, vx: c.active.vx, mx: c.input.mx })));
    await release(page, "joyZone");
    await release(page, "joyZone2");
    const p1 = moved.find((c) => c.id === "p1"), p2 = moved.find((c) => c.id === "p2");
    const p1s = startPos.find((c) => c.id === "p1"), p2s = startPos.find((c) => c.id === "p2");
    if (!p1 || !p2 || !(p1.mx > 0.2) || !(p2.mx < -0.2)) fail(label + ": split sticks did not drive each player " + JSON.stringify({ startPos, moved }));
    if (p1s && p2s && !(p1.x > p1s.x + 2) && !(p2.x < p2s.x - 2)) fail(label + ": players did not walk " + JSON.stringify({ startPos, moved }));
    console.log(label, "2p sticks", JSON.stringify(moved.map((c) => c.id + " mx " + c.mx.toFixed(2))));
    if (opts.shots && opts.shots.two) await shot(page, opts.shots.two);

    // Cup
    await page.evaluate(() => soccerDebug.start({ mode: "1p", kind: "cup", difficulty: "easy" }));
    await page.waitForSelector("#cupPlayBtn");
    if (!(await visible(page, "#cupPlayBtn"))) fail(label + ": cup PLAY button is off screen");
    if (opts.shots && opts.shots.cup) await shot(page, opts.shots.cup);
    await page.tap("#cupPlayBtn");
    await page.waitForFunction(() => { const s = soccerDebug.state(); return s.kind === "cup" && (s.phase === "play" || s.phase === "setpiece"); });
    await sleep(150);
    report = await controlReport(page);
    assertControls(report, label + " cup", { split: false, portrait: opts.portrait });

    // Penalty shootout
    await page.evaluate(() => soccerDebug.start({ mode: "1p", kind: "shootout" }));
    await page.waitForFunction(() => soccerDebug.state().kind === "shootout" && soccerDebug.state().phase !== "menu");
    await sleep(200);
    report = await controlReport(page);
    assertControls(report, label + " shootout", { split: false, portrait: opts.portrait });
    const penHint = await page.evaluate(() => keysHint("penTaker") + " | " + keysHint("setpiece"));
    if (/space|wasd/i.test(penHint)) fail(label + ": penalty hint is keyboard-only: " + penHint);
    if (opts.shots && opts.shots.pens) await shot(page, opts.shots.pens);
    console.log(label, "modes ok");
    } finally {
      await page.ctx.close();
    }
  }

  async function playOnline(hostBrowser, guestBrowser, hostSpec, guestSpec, label, shotName) {
    const q = "debug=1&peerhost=127.0.0.1&peerport=9000&icemode=host";
    const host = await openPhone(hostBrowser, hostSpec);
    const guest = await openPhone(guestBrowser, guestSpec);
    await host.goto(BASE + "/online.html?" + q, { waitUntil: "domcontentloaded" });
    await guest.goto(BASE + "/online.html?" + q, { waitUntil: "domcontentloaded" });
    await host.waitForFunction(() => window.Peer, null, { timeout: 12000 });
    await guest.waitForFunction(() => window.Peer, null, { timeout: 12000 });
    if (!(await visible(host, "#createBtn"))) fail(label + ": Host a game is off screen");
    if (!(await visible(host, "#joinBtn"))) fail(label + ": Join is off screen");
    const homeHelp = await host.evaluate(() => document.getElementById("matchHelp").textContent);
    if (/space|wasd/i.test(homeHelp)) fail(label + ": online menu still talks about the keyboard: " + homeHelp.slice(0, 160));
    await host.fill("#nameInput", "Kid");
    await host.tap("#createBtn");
    await host.waitForFunction(() => window.mpDebug && mpDebug.state().room && mpDebug.state().room.code, null, { timeout: 15000 });
    const code = await host.evaluate(() => mpDebug.state().room.code);
    if (!(await visible(host, "#startBtn"))) fail(label + ": lobby Start is off screen");
    if (shotName) await shot(host, shotName);
    await guest.fill("#nameInput", "Pal");
    await guest.fill("#codeInput", code);
    await guest.tap("#joinBtn");
    await guest.waitForFunction((want) => window.mpDebug && mpDebug.state().room && mpDebug.state().room.code === want, code, { timeout: 15000 });
    await host.tap("#startBtn");
    await host.waitForFunction(() => ["setpiece", "play"].includes(mpDebug.state().phase), null, { timeout: 10000 });
    await guest.waitForFunction(() => ["setpiece", "play"].includes(mpDebug.state().phase), null, { timeout: 10000 });
    await sleep(300);
    for (const [who, page] of [["host", host], ["guest", guest]]) {
      const rep = await controlReport(page);
      if (rep.problems.length) fail(label + " " + who + ": " + rep.problems.join("; "));
      if (!rep.boxes.shootBtn || !rep.boxes.joyBase) fail(label + " " + who + " missing touch controls");
      if (rep.boxes.shootBtn2) fail(label + " " + who + " showed a second player's buttons");
      if (rep.scale && Math.abs(rep.scale - 1) > 0.01) fail(label + " " + who + " zoomed");
    }
    console.log(label, "online room", code, "touch controls on both phones");
    await host.ctx.close();
    await guest.ctx.close();
  }

  try {
    const full = { portrait: true };
    await playOffline(await openPhone(safari, orient(PHONES.iphone13, false)), "webkit iphone13 portrait", {
      portrait: true,
      shots: { menu: "menu-portrait.png", match: "match-portrait.png", teams: "teams-portrait.png", cup: "cup-portrait.png" },
    });
    await playOffline(await openPhone(safari, orient(PHONES.iphone13, true)), "webkit iphone13 landscape", {
      portrait: false,
      shots: { menu: "menu-landscape.png", match: "match-landscape.png", two: "match-2p-landscape.png", pens: "shootout-landscape.png" },
    });
    await playOffline(await openPhone(safari, orient(PHONES.iphone15, false)), "webkit iphone15 portrait", full);
    await playOffline(await openPhone(safari, orient(PHONES.iphone15, true)), "webkit iphone15 landscape", { portrait: false });

    const pixel = {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
    };
    await playOffline(await openPhone(chrome, pixel), "chrome pixel portrait", { portrait: true });
    await playOffline(await openPhone(chrome, orient(pixel, true)), "chrome pixel landscape", { portrait: false });

    await playOnline(safari, safari, orient(PHONES.iphone13, false), orient(PHONES.iphone13, true), "webkit online", "online-lobby-portrait.png");
    await playOnline(chrome, chrome, orient(pixel, true), pixel, "chrome online", "online-match-landscape.png");

    // Home Screen (standalone) should fill the phone, not a browser window.
    const ctx = await safari.newContext({
      ...orient(PHONES.iphone13, true),
      serviceWorkers: "allow",
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true });
    });
    const solo = await ctx.newPage();
    solo.on("pageerror", (e) => fail("standalone pageerror: " + e.message));
    await solo.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const stand = await solo.evaluate(() => {
      const c = document.getElementById("game").getBoundingClientRect();
      const vv = window.visualViewport;
      return {
        cls: document.documentElement.classList.contains("standalone"),
        dw: Math.abs(c.width - vv.width),
        dh: Math.abs(c.height - vv.height),
        sw: document.getElementById("sw") ? "" : (window.pwaStatus && window.pwaStatus.sw),
      };
    });
    if (!stand.cls) fail("standalone class was not added for the Home Screen app");
    if (stand.dw > 2 || stand.dh > 2) fail("standalone canvas does not fill the screen " + JSON.stringify(stand));
    await solo.evaluate(() => soccerDebug.start({ mode: "1p", kind: "quick" }));
    await sleep(200);
    await shot(solo, "standalone-landscape.png");
    console.log("standalone", JSON.stringify(stand));
    await ctx.close();

    // Installed app cache name, so phones throw away the old copy.
    const swPage = await openPhone(chrome, pixel);
    await swPage.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await swPage.waitForFunction(() => window.pwaStatus && (window.pwaStatus.sw === "ready" || window.pwaStatus.sw === "failed"), null, { timeout: 15000 });
    const keys = await swPage.evaluate(async () => { const k = await caches.keys(); return k; });
    console.log("service worker caches", keys.join(","));
    if (!keys.some((k) => k.indexOf("stadium-soccer-pages-v3") >= 0)) fail("service worker cache was not bumped: " + keys.join(","));
    await swPage.ctx.close();
  } catch (err) {
    fail("test crashed: " + (err && err.stack ? err.stack : err));
  } finally {
    // WebKit sometimes never finishes closing. Don't leave the test hanging
    // after it has already printed the result.
    const code = errors.length ? 1 : 0;
    const killer = setTimeout(() => process.exit(code), 4000);
    try { await safari.close(); } catch (e) { /* ignore */ }
    try { await chrome.close(); } catch (e) { /* ignore */ }
    server.close();
    try { broker.close(); } catch (e) { /* already closed */ }
    clearTimeout(killer);
    process.exit(code);
  }

  if (errors.length) {
    console.error("\n" + errors.length + " problem(s):\n- " + errors.join("\n- "));
    process.exit(1);
  }
  console.log("\nMobile playability checks passed.");
})();
