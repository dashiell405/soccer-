// PWA test: manifest + icons, service worker, iPhone landscape, offline play with the server stopped.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const PORT = 3002, BASE = 'http://localhost:' + PORT;
const DIR = '/workspace/soccer/multiplayer';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let server = null;
function startServer() {
  server = spawn('node', ['server.js'], { cwd: DIR, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  return sleep(800);
}
function stopServer() { server.kill(); server = null; return sleep(500); }
function pngSize(buf) { return buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a' ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null; }

(async () => {
  const errors = [], offlineErrors = [], warnings = [];
  let phase = 'online';
  await startServer();
  // ---- 1. manifest + icons ----
  const mres = await fetch(BASE + '/manifest.webmanifest');
  const manifest = JSON.parse(await mres.text());
  console.log('manifest:', mres.headers.get('content-type'), '| name', manifest.name, '| short', manifest.short_name, '| display', manifest.display, '| orientation', manifest.orientation, '| start_url', manifest.start_url);
  for (const ic of manifest.icons) {
    const r = await fetch(BASE + '/' + ic.src); const sz = pngSize(Buffer.from(await r.arrayBuffer()));
    console.log('  icon', ic.src, r.status, sz && sz.join('x'), 'declared', ic.sizes, ic.purpose, sz && sz.join('x') === ic.sizes ? 'OK' : 'MISMATCH');
  }
  for (const pth of ['/apple-touch-icon.png', '/favicon.ico', '/sw.js', '/pwa.js', '/offline.html', '/healthz']) {
    const r = await fetch(BASE + pth); console.log('  GET', pth, r.status, r.headers.get('content-type'));
  }
  // ---- 2. iPhone landscape ----
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  page.on('console', m => {
    if (m.type() === 'error') (phase === 'server-down' ? offlineErrors : errors).push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + '/');
  await page.waitForFunction(() => window.pwaStatus && window.pwaStatus.sw === 'ready', null, { timeout: 15000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
  const sw = await page.evaluate(async () => {
    const keys = await caches.keys(); const c = await caches.open(keys[0]); const reqs = await c.keys();
    return { status: window.pwaStatus, cacheNames: keys, cached: reqs.map(r => new URL(r.url).pathname) };
  });
  console.log('service worker:', sw.status.sw, 'scope', sw.status.scope, '| caches', sw.cacheNames.join(','), '| cached', sw.cached.length, 'files:', sw.cached.join(' '));
  const head = await page.evaluate(() => ({
    viewport: document.querySelector('meta[name=viewport]').content,
    capable: document.querySelector('meta[name=apple-mobile-web-app-capable]').content,
    bar: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]').content,
    touchIcon: document.querySelector('link[rel=apple-touch-icon]').href,
    overscroll: getComputedStyle(document.body).overscrollBehaviorY,
    offlineBtnVisible: !!document.getElementById('offlineBtn').offsetParent,
  }));
  console.log('head/meta:', JSON.stringify(head));
  await sleep(500);
  await page.screenshot({ path: DIR + '/screenshot_pwa_home.png' });
  // pinch-zoom is blocked: a 2-finger touchmove gets preventDefault
  const pinchBlocked = await page.evaluate(() => {
    const t1 = new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: 100 });
    const t2 = new Touch({ identifier: 2, target: document.body, clientX: 200, clientY: 100 });
    const ev = new TouchEvent('touchmove', { touches: [t1, t2], cancelable: true, bubbles: true });
    document.body.dispatchEvent(ev); return ev.defaultPrevented;
  });
  console.log('pinch-zoom blocked:', pinchBlocked);
  // online path still fine: create a room from the phone
  await page.fill('#nameInput', 'Dash'); await page.click('#createBtn');
  await page.waitForFunction(() => mpDebug.state().room && mpDebug.state().room.code, null, { timeout: 8000 });
  console.log('online room created from iPhone view:', (await page.evaluate(() => mpDebug.state().room.code)));
  await page.click('#leaveBtn'); await sleep(300);

  // ---- 3. stop the server -> app still opens from cache ----
  phase = 'server-down';
  await stopServer();
  await page.goto(BASE + '/?room=ABCD');
  await page.waitForFunction(() => document.getElementById('homeMsg').textContent.includes('Offline'), null, { timeout: 10000 });
  console.log('server stopped -> home page loaded from cache, message:', JSON.stringify(await page.textContent('#homeMsg')));
  await page.click('#offlineBtn');
  await page.waitForURL(/offline\.html/);
  await page.waitForFunction(() => !!window.soccerDebug);
  console.log('offline.html loaded from cache, title:', await page.title(), '| online link present:', await page.isVisible('#onlineLink'));
  await page.screenshot({ path: '/tmp/soccertest/pwa_offline_menu.png' });
  await page.click('[data-mode="1p"]'); await page.click('#startBtn');
  await sleep(2500);
  const s1 = await page.evaluate(() => soccerDebug.state());
  // move with the touch joystick for a moment
  await page.evaluate(() => { const z = document.getElementById('joyZone'); const f = (t, x, y) => z.dispatchEvent(new PointerEvent(t, { pointerId: 3, clientX: x, clientY: y, bubbles: true })); f('pointerdown', 150, 250); f('pointermove', 220, 250); window.__f = f; });
  await sleep(2000);
  await page.evaluate(() => window.__f('pointerup', 220, 250));
  const s2 = await page.evaluate(() => soccerDebug.state());
  console.log('offline game: phase', s1.phase, '->', s2.phase, '| clock', s1.clock, '->', s2.clock, '| score', JSON.stringify(s2.score), '| touch buttons visible', await page.isVisible('#shootBtn'));
  await page.screenshot({ path: '/tmp/soccertest/pwa_offline_game.png' });
  // full offline match with autoplay (fast-forward)
  await page.evaluate(() => { soccerDebug.setAutoplay(true); for (let i = 0; i < 60 && !soccerDebug.state().winner; i++) soccerDebug.step(10); });
  await sleep(1300);   // the win screen now appears ~1 s after the final whistle
  const s3 = await page.evaluate(() => soccerDebug.state());
  console.log('offline full match:', JSON.stringify(s3.score), 'winner', s3.winner, '| win screen', await page.isVisible('#winScreen'));
  // back to online menu (still offline)
  await page.goto(BASE + '/offline.html'); await page.click('#onlineLink'); await page.waitForURL(BASE + '/');
  console.log('online link from offline game opens cached home:', await page.isVisible('#offlineBtn'));

  // ---- 4. server back -> home reconnects and clears the message ----
  phase = 'online';
  await startServer();
  await page.waitForFunction(() => document.getElementById('homeMsg').textContent === '', null, { timeout: 10000 });
  console.log('server restarted -> reconnected, message cleared');
  console.log('ERRORS (server up):', JSON.stringify(errors));
  console.log('Expected errors while server was stopped (WebSocket retries):', offlineErrors.length, JSON.stringify([...new Set(offlineErrors.map(e => e.replace(/ws:\/\/[^ ]+/, 'ws://…')))]));
  console.log('WARNINGS:', JSON.stringify(warnings));
  await browser.close(); stopServer();
})().catch(async (e) => { console.error('TEST FAILED', e); if (server) server.kill(); process.exit(1); });
