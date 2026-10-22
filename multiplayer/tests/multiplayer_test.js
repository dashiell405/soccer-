const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = '/workspace/soccer/multiplayer/';
const errors = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getRooms = async () => (await fetch(BASE + '/debug/rooms')).json();
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  async function client(name, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 660 }, hasTouch: !!opts.touch, isMobile: !!opts.touch });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
    page.name = name; page.ctx = ctx;
    return page;
  }
  const st = (p) => p.evaluate(() => mpDebug.state());
  async function create(p, mode) {
    await p.goto(BASE); await p.fill('#nameInput', p.name);
    if (mode === '2v2') await p.click('[data-cmode="2v2"]');
    await p.click('#createBtn');
    await p.waitForFunction(() => mpDebug.state().room && mpDebug.state().room.code);
    return (await st(p)).room.code;
  }
  async function join(p, code) {
    await p.goto(BASE + '/?room=' + code); await p.fill('#nameInput', p.name);
    await p.click('#joinBtn');
    await p.waitForFunction(() => mpDebug.state().room && mpDebug.state().room.code);
  }
  const waitAll = (pages, fn, arg, timeout = 15000) => Promise.all(pages.map(p => p.waitForFunction(fn, arg, { timeout })));

  // ================= 1v1 =================
  const A = await client('Alice'), B = await client('Bob');
  const code = await create(A, '1v1');
  await join(B, code);
  await A.waitForFunction(() => mpDebug.state().room.members.length === 2);
  await sleep(300);
  await A.screenshot({ path: OUT + 'screenshot_lobby.png' });
  const lobby = (await st(A)).room;
  console.log('1v1 room', code, 'members', lobby.members.map(m => m.name + ':' + m.team).join(', '), '| B sees host is A:', (await st(B)).room.hostId === (await st(A)).myId);
  console.log('B start button hidden:', await B.isHidden('#startBtn'), '| A start visible:', await A.isVisible('#startBtn'));
  await A.click('#startBtn');
  await waitAll([A, B], () => ['setpiece', 'play'].includes(mpDebug.state().phase));
  // skip kickoff wait: whoever kicks off - tap pass on both
  await A.keyboard.press('KeyE'); await B.keyboard.press('KeyE');
  await waitAll([A, B], () => mpDebug.state().phase === 'play', null, 10000);
  await sleep(500);
  // sync check: compare each client's newest snapshot with the server
  const server = (await getRooms()).find(r => r.code === code).game;
  const [sa, sb] = [await st(A), await st(B)];
  const dball = (s) => Math.hypot(s.ball.x - server.ball.x, s.ball.y - server.ball.y).toFixed(1);
  console.log('sync: server ball', Math.round(server.ball.x), Math.round(server.ball.y), '| A off by', dball(sa), '| B off by', dball(sb), '| A vs B', Math.hypot(sa.ball.x - sb.ball.x, sa.ball.y - sb.ball.y).toFixed(1));
  console.log('controllers on A:', JSON.stringify(sa.controllers));
  // inputs: A holds D (right), B holds ArrowLeft (left)
  await A.keyboard.down('KeyD'); await B.keyboard.down('ArrowLeft');
  await sleep(450);
  const [ia, ib] = [await st(A), await st(B)];
  await A.keyboard.up('KeyD'); await B.keyboard.up('ArrowLeft');
  console.log('input test: A active vx', ia.myRaw && ia.myRaw.vx, '(want > 100) | B active vx', ib.myRaw && ib.myRaw.vx, '(want < -100)');
  // goal for blue -> everyone sees it
  const before = (await st(A)).score;
  await A.evaluate(() => mpDebug.send({ t: 'debug', cmd: 'goal', team: 'blue' }));
  await waitAll([A, B], (b) => mpDebug.state().score.blue === b + 1, before.blue, 5000);
  console.log('goal: A score', JSON.stringify((await st(A)).score), 'B score', JSON.stringify((await st(B)).score), 'B phase', (await st(B)).phase);
  // autoplay + fast forward to the end
  await A.evaluate(() => { mpDebug.send({ t: 'debug', cmd: 'autoplay', on: true }); mpDebug.send({ t: 'debug', cmd: 'speed', value: 20 }); });
  await waitAll([A, B], () => mpDebug.state().winVisible, null, 90000);
  const wa = await st(A), wb = await st(B);
  console.log('win: A', JSON.stringify(wa.score), wa.winner, 'winVisible', wa.winVisible, '| B', JSON.stringify(wb.score), wb.winner, 'winVisible', wb.winVisible,
    '| A title', await A.textContent('#winTitle'), '| rematch btn A', await A.isVisible('#rematchBtn'), 'B waits', await B.isVisible('#waitHost2'));
  await A.screenshot({ path: '/tmp/soccertest/mp_win.png' });
  // rematch
  await A.click('#rematchBtn');
  await waitAll([A, B], () => !mpDebug.state().winVisible && mpDebug.state().score.blue === 0 && mpDebug.state().score.red === 0 && ['setpiece', 'play'].includes(mpDebug.state().phase));
  console.log('rematch ok on both');
  await A.ctx.close(); await B.ctx.close();

  // ================= 2v2 =================
  const P = [await client('Ann'), await client('Ben'), await client('Cat'), await client('Dan', { touch: true, viewport: { width: 844, height: 390 } })];
  const code2 = await create(P[0], '2v2');
  for (const p of P.slice(1)) await join(p, code2);
  await P[0].waitForFunction(() => mpDebug.state().room.members.length === 4);
  const r2 = (await st(P[0])).room;
  console.log('2v2 room', code2, r2.members.map(m => m.name + ':' + m.team).join(', '));
  await P[0].click('#startBtn');
  await waitAll(P, () => ['setpiece', 'play'].includes(mpDebug.state().phase));
  for (const p of P) await p.keyboard.press('KeyE');
  await waitAll(P, () => mpDebug.state().phase === 'play', null, 10000);
  await sleep(600);
  const s4 = await Promise.all(P.map(st));
  const actives = s4[0].controllers.map(c => c.active);
  console.log('2v2 controllers (from Ann):', JSON.stringify(s4[0].controllers.map(c => ({ name: r2.members.find(m => m.id === c.id).name, active: c.active, cpu: c.cpu }))), 'distinct actives:', new Set(actives).size === 4);
  const sv = (await getRooms()).find(r => r.code === code2).game;
  console.log('2v2 sync ball offsets vs server:', s4.map(s => Math.hypot(s.ball.x - sv.ball.x, s.ball.y - sv.ball.y).toFixed(1)).join(', '), '| scores', s4.map(s => s.score.blue + '-' + s.score.red).join(' '));
  // each moves: blue players right (D), red players left (ArrowLeft)
  const teams = P.map((p, i) => r2.members.find(m => m.id === s4[i].myId).team);
  await Promise.all(P.map((p, i) => p.keyboard.down(teams[i] === 'blue' ? 'KeyD' : 'ArrowLeft')));
  await sleep(450);
  const mv = await Promise.all(P.map(st));
  await Promise.all(P.map((p, i) => p.keyboard.up(teams[i] === 'blue' ? 'KeyD' : 'ArrowLeft')));
  console.log('2v2 input vx:', mv.map((s, i) => P[i].name + '(' + teams[i] + ')=' + (s.myRaw ? Math.round(s.myRaw.vx) : 'none')).join(', '));
  // touch input for Dan (mobile): drag joystick
  const danTeam = teams[3];
  const box = await P[3].evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await P[3].evaluate(() => { const z = document.getElementById('joyZone'); const fire = (type, x, y) => z.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true })); fire('pointerdown', 120, 250); window.__fire = fire; });
  await P[3].evaluate((d) => window.__fire('pointermove', d === 'blue' ? 180 : 60, 250), danTeam);
  await sleep(450);
  const dm = await st(P[3]);
  await P[3].evaluate(() => window.__fire('pointerup', 60, 250));
  console.log('touch joystick: Dan(' + danTeam + ') vx', dm.myRaw ? Math.round(dm.myRaw.vx) : 'none', '| touch controls visible:', await P[3].isVisible('#shootBtn'));
  await sleep(300);
  await P[0].screenshot({ path: OUT + 'screenshot_4p.png' });
  await P[3].screenshot({ path: '/tmp/soccertest/mp_mobile.png' });
  // disconnect Cat -> CPU
  const catId = s4[2].myId;
  await P[2].ctx.close();
  await sleep(800);
  const srv = (await getRooms()).find(r => r.code === code2);
  const catCtrl = srv.game.controllers.find(c => c.id === catId);
  const annView = await st(P[0]);
  console.log('disconnect: server says Cat cpu =', catCtrl.cpu, '| Ann sees Cat cpu =', annView.controllers.find(c => c.id === catId).cpu, '| Ann member list connected =', annView.room.members.find(m => m.id === catId).connected);
  // Cat rejoins from a "new device" using the same name
  const C2 = await client('Cat');
  await join(C2, code2);
  await C2.waitForFunction(() => mpDebug.state().phase === 'play' || mpDebug.state().phase === 'setpiece' || mpDebug.state().phase === 'dead' || mpDebug.state().phase === 'goal');
  await sleep(500);
  const srv2 = (await getRooms()).find(r => r.code === code2);
  console.log('rejoin: same id', (await st(C2)).myId === catId, '| server cpu =', srv2.game.controllers.find(c => c.id === catId).cpu, '| members', srv2.members.length);
  // full 2v2 game via autoplay
  await P[0].evaluate(() => { mpDebug.send({ t: 'debug', cmd: 'autoplay', on: true }); mpDebug.send({ t: 'debug', cmd: 'speed', value: 20 }); });
  const all = [P[0], P[1], C2, P[3]];
  await waitAll(all, () => mpDebug.state().winVisible, null, 90000);
  const fin = await Promise.all(all.map(st));
  console.log('2v2 win on all 4:', fin.map(s => s.winVisible + ' ' + s.score.blue + '-' + s.score.red + ' ' + s.winner).join(' | '));
  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); console.log('ERRORS:', JSON.stringify(errors)); process.exit(1); });
