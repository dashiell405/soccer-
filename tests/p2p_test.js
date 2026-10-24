// Two browser tabs: one hosts, one joins by room code, and both see the same goal.
// Serves the GitHub Pages files (repo root) with a plain static server.
//
//   npm install --prefix /tmp/soccer-test playwright-core peer
//   NODE_PATH=/tmp/soccer-test/node_modules node tests/p2p_test.js
//
// By default this uses PeerJS's public broker (0.peerjs.com), the same path
// as the live site. If that broker can't be reached, set PEER_HOST=127.0.0.1
// after starting a local PeerServer (the test can do that itself).
const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8765;
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
      const ext = path.extname(file);
      res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
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
    // PeerServer listens immediately inside the constructor.
    setTimeout(() => resolve(broker), 200);
  });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  const server = await startStatic();
  let broker = null;
  const useLocal = process.env.PEER_HOST === "127.0.0.1" || process.env.PEER_LOCAL === "1";
  if (useLocal) broker = await startPeerBroker();

  const browser = await chromium.launch({
    executablePath: process.env.CHROME || "/usr/bin/google-chrome",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
    ],
  });

  function query(extra) {
    const q = new URLSearchParams(extra || "");
    q.set("debug", "1");
    if (useLocal) {
      q.set("peerhost", "127.0.0.1");
      q.set("peerport", "9000");
      q.set("icemode", "host");
    }
    return q.toString();
  }

  async function openTab(name, opts) {
    const ctx = await browser.newContext({
      viewport: (opts && opts.viewport) || { width: 1100, height: 700 },
      hasTouch: !!(opts && opts.touch),
      isMobile: !!(opts && opts.touch),
      serviceWorkers: "allow",
    });
    const page = await ctx.newPage();
    const mine = [];
    page.on("pageerror", (e) => { mine.push(name + " pageerror: " + e.message); errors.push(name + " pageerror: " + e.message); });
    page.on("console", (m) => {
      if (m.type() === "error") mine.push(name + ": " + m.text());
    });
    page.name = name;
    page.ctx = ctx;
    page.mine = mine;
    return page;
  }
  const st = (p) => p.evaluate(() => mpDebug.state());

  try {
    // ---- offline menu still works, and the online button is real ----
    const menu = await openTab("menu");
    await menu.goto(BASE + "/");
    await menu.waitForSelector("#onlineLink");
    const href = await menu.getAttribute("#onlineLink", "href");
    if (href !== "online.html") throw new Error("online link href is " + href);
    if (await menu.$("#onlineSoon")) throw new Error("coming soon placeholder is still on the menu");
    await menu.click("#startBtn");
    await menu.waitForFunction(() => {
      const s = soccerDebug.state();
      return s.phase === "setpiece" || s.phase === "play";
    }, null, { timeout: 8000 });
    console.log("offline kick off:", (await menu.evaluate(() => soccerDebug.state().phase)));
    await menu.goto(BASE + "/index.html?room=k7mp");
    await menu.waitForURL(/online\.html\?room=k7mp/i, { timeout: 8000 });
    await menu.waitForFunction(() => document.getElementById("codeInput").value.toUpperCase() === "K7MP");
    console.log("room link on the home page opens online.html with the code filled in");
    await menu.ctx.close();

    // ---- service worker does not swallow the CDN ----
    const swPage = await openTab("sw");
    await swPage.goto(BASE + "/online.html");
    await swPage.waitForFunction(() => window.pwaStatus && (window.pwaStatus.sw === "ready" || window.pwaStatus.sw === "failed"), null, { timeout: 15000 });
    await swPage.waitForFunction(() => window.Peer || window.soccerPeerFrom === "failed", null, { timeout: 12000 });
    const swInfo = await swPage.evaluate(async () => {
      const keys = await caches.keys();
      let cached = [];
      if (keys.length) {
        const c = await caches.open(keys[0]);
        cached = (await c.keys()).map((r) => new URL(r.url).pathname.split("/").pop());
      }
      let cdn = "skipped";
      try {
        const res = await fetch("https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js", { cache: "no-store" });
        cdn = res.status + " " + (res.headers.get("content-type") || "");
      } catch (e) { cdn = "error " + e; }
      return { status: window.pwaStatus.sw, keys, cached, cdn, peer: typeof Peer !== "undefined", from: window.soccerPeerFrom || null };
    });
    console.log("service worker:", JSON.stringify(swInfo));
    if (!swInfo.keys.some((k) => k.indexOf("stadium-soccer-pages-v16") >= 0)) throw new Error("service worker cache was not bumped: " + swInfo.keys.join(","));
    if (swInfo.cached.indexOf("online.html") < 0 || swInfo.cached.indexOf("online.js") < 0) throw new Error("online files were not cached: " + swInfo.cached.join(","));
    if (String(swInfo.cdn).indexOf("200") !== 0) throw new Error("CDN fetch failed with the service worker running: " + swInfo.cdn);
    if (!swInfo.peer) throw new Error("PeerJS did not load (" + swInfo.from + ")");
    await swPage.ctx.close();

    // ---- 1 vs 1: host, join by code, synced goal ----
    const host = await openTab("host");
    const guest = await openTab("guest");
    await host.goto(BASE + "/online.html?" + query());
    await host.waitForFunction(() => window.Peer, null, { timeout: 12000 });
    const brokerInfo = await host.evaluate(() => mpDebug.state().net);
    console.log("broker:", JSON.stringify(brokerInfo));
    if (!useLocal && brokerInfo.broker !== "0.peerjs.com") throw new Error("expected the public PeerJS broker");
    if (!brokerInfo.turn && !useLocal) throw new Error("TURN servers missing from the public config");

    await host.fill("#nameInput", "Alex");
    await host.click("#createBtn");
    await host.waitForFunction(() => mpDebug.state().room && mpDebug.state().room.code && mpDebug.state().host, null, { timeout: 20000 });
    const code = (await st(host)).room.code;
    console.log("room code", code, "link", await host.textContent("#shareUrl"));
    if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error("bad room code " + code);

    await guest.goto(BASE + "/online.html?" + query("room=" + code));
    await guest.waitForFunction(() => window.Peer, null, { timeout: 12000 });
    await guest.fill("#nameInput", "Sam");
    if ((await guest.inputValue("#codeInput")).toUpperCase() !== code) await guest.fill("#codeInput", code);
    await guest.click("#joinBtn");
    await guest.waitForFunction((want) => mpDebug.state().room && mpDebug.state().room.code === want, code, { timeout: 25000 });
    await host.waitForFunction(() => mpDebug.state().room.members.length === 2, null, { timeout: 10000 });
    const lobby = (await st(host)).room;
    console.log("lobby", lobby.members.map((m) => m.name + ":" + m.team).join(", "), "guest sees host", (await st(guest)).room.hostId === (await st(host)).myId);
    if (await guest.isVisible("#startBtn")) throw new Error("guest should not see Start");
    if (!(await host.isVisible("#startBtn"))) throw new Error("host should see Start");
    await host.screenshot({ path: path.join(SHOTS, "lobby.png") });

    await host.click("#startBtn");
    await Promise.all([host, guest].map((p) => p.waitForFunction(() => ["setpiece", "play"].includes(mpDebug.state().phase), null, { timeout: 10000 })));
    const before = (await st(host)).score.blue;
    await host.evaluate(() => mpDebug.send({ t: "debug", cmd: "goal", team: "blue" }));
    await Promise.all([host, guest].map((p) => p.waitForFunction((n) => mpDebug.state().score.blue === n + 1, before, { timeout: 8000 })));
    await sleep(400);
    const [hs, gs] = [await st(host), await st(guest)];
    const ballGap = Math.hypot(hs.ball.x - gs.ball.x, hs.ball.y - gs.ball.y);
    console.log("goal sync host", JSON.stringify(hs.score), "guest", JSON.stringify(gs.score), "phases", hs.phase, gs.phase, "snapshot ball gap", ballGap.toFixed(1));
    if (hs.score.blue !== gs.score.blue || hs.score.red !== gs.score.red) throw new Error("scores diverged");
    if (ballGap > 150) throw new Error("snapshot balls are not the same picture: gap " + ballGap);
    await host.screenshot({ path: path.join(SHOTS, "match.png") });
    await guest.screenshot({ path: path.join(SHOTS, "match-guest.png") });

    // Closing the guest's tab drops the peer connection.
    const guestId = gs.myId;
    await guest.ctx.close();
    await host.waitForFunction(() => {
      const t = document.getElementById("connBanner").textContent || "";
      return /left the game|left the room|computer/i.test(t);
    }, null, { timeout: 12000 });
    await host.waitForFunction((id) => {
      const c = mpDebug.state().controllers.find((x) => x.id === id);
      return !!(c && c.cpu);
    }, guestId, { timeout: 5000 });
    const note = await host.textContent("#connBanner");
    console.log("leave notice:", note);

    // wrong code is a friendly message, not a crash
    const stranger = await openTab("stranger");
    await stranger.goto(BASE + "/online.html?" + query());
    await stranger.waitForFunction(() => window.Peer, null, { timeout: 12000 });
    await stranger.fill("#nameInput", "Jo");
    await stranger.fill("#codeInput", "ZZZZ");
    await stranger.click("#joinBtn");
    await stranger.waitForFunction(() => {
      const t = document.getElementById("homeMsg").textContent || "";
      return /code|connect|Wi-Fi|internet|long/i.test(t);
    }, null, { timeout: 20000 });
    console.log("bad code message:", JSON.stringify(await stranger.textContent("#homeMsg")));
    await stranger.ctx.close();

    // 2 vs 2: four tabs join the lobby and all see a goal
    const names = ["Ann", "Ben", "Cat", "Dan"];
    const pages = [];
    for (let i = 0; i < 4; i++) pages.push(await openTab(names[i], i === 3 ? { touch: true, viewport: { width: 844, height: 390 } } : null));
    await pages[0].goto(BASE + "/online.html?" + query());
    await pages[0].waitForFunction(() => window.Peer);
    await pages[0].fill("#nameInput", names[0]);
    await pages[0].click('[data-cmode="2v2"]');
    await pages[0].click("#createBtn");
    await pages[0].waitForFunction(() => mpDebug.state().room && mpDebug.state().room.code, null, { timeout: 20000 });
    const code4 = (await st(pages[0])).room.code;
    for (let i = 1; i < 4; i++) {
      await pages[i].goto(BASE + "/online.html?" + query("room=" + code4));
      await pages[i].waitForFunction(() => window.Peer);
      await pages[i].fill("#nameInput", names[i]);
      if ((await pages[i].inputValue("#codeInput")).toUpperCase() !== code4) await pages[i].fill("#codeInput", code4);
      await pages[i].click("#joinBtn");
      await pages[i].waitForFunction((n) => mpDebug.state().room && mpDebug.state().room.members.length >= n, i + 1, { timeout: 25000 });
    }
    await pages[0].waitForFunction(() => mpDebug.state().room.members.length === 4);
    const teams = (await st(pages[0])).room.members.map((m) => m.name + ":" + m.team).join(", ");
    console.log("2v2 lobby", code4, teams);
    const blue = (await st(pages[0])).room.members.filter((m) => m.team === "blue").length;
    const red = (await st(pages[0])).room.members.filter((m) => m.team === "red").length;
    if (blue !== 2 || red !== 2) throw new Error("2v2 slots were not 2 and 2: " + teams);
    await pages[0].click("#startBtn");
    await Promise.all(pages.map((p) => p.waitForFunction(() => ["setpiece", "play", "dead", "goal"].includes(mpDebug.state().phase), null, { timeout: 10000 })));
    await pages[0].evaluate(() => mpDebug.send({ t: "debug", cmd: "goal", team: "red" }));
    await Promise.all(pages.map((p) => p.waitForFunction(() => mpDebug.state().score.red >= 1, null, { timeout: 8000 })));
    const scores = [];
    for (const p of pages) scores.push((await st(p)).score.red);
    console.log("2v2 red scores", scores.join(","));
    if (scores.some((n) => n !== scores[0])) throw new Error("2v2 scores diverged " + scores.join(","));
    // touch controls exist on the phone-sized tab
    const touchOn = await pages[3].isVisible("#shootBtn");
    console.log("phone shoot button visible:", touchOn);

    const serious = errors.filter((e) => !/favicon|source map|peerjs\.min\.js\.map/i.test(e));
    if (serious.length) {
      console.log("PAGE ERRORS:", JSON.stringify(serious, null, 2));
      throw new Error(serious[0]);
    }
    console.log("P2P TEST PASSED");
  } finally {
    await browser.close();
    server.close();
    if (broker && broker.close) { try { broker.close(); } catch (e) { /* ignore */ } }
  }
})().catch((err) => {
  console.error("TEST FAILED");
  console.error(err);
  process.exit(1);
});
