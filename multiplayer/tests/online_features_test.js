// Online tests for the new features (needs a DEBUG server at BASE)
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:3001';
const SHOTS = process.env.SHOTS || require('path').join(__dirname, '..', '..', 'screenshots_v3') + '/';
const errors = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getRooms = async () => (await fetch(BASE + '/debug/rooms')).json();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  async function client(name) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 660 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
    page.name = name; return page;
  }
  const st = (p) => p.evaluate(() => mpDebug.state());
  const dbg = (p, m) => p.evaluate((m) => mpDebug.send(Object.assign({ t: 'debug' }, m)), m);
  const A = await client('Alice'), B = await client('Bob');
  await A.goto(BASE); await A.fill('#nameInput', 'Alice'); await A.click('#createBtn');
  await A.waitForFunction(() => mpDebug.state().room && mpDebug.state().room.code);
  const code = (await st(A)).room.code;
  await B.goto(BASE + '/?room=' + code); await B.fill('#nameInput', 'Bob'); await B.click('#joinBtn');
  await A.waitForFunction(() => mpDebug.state().room.members.length === 2);
  // host picks teams + rules
  await A.selectOption('#blueTeamSel', 'eng'); await A.selectOption('#redTeamSel', 'ger');
  await sleep(300);
  ok(await B.isDisabled('#blueTeamSel'), 'guest cannot change teams');
  const t = await B.textContent('#redTitle');
  ok(/Germany/.test(t) && /away kit/.test(t), 'lobby shows Germany in away kit (seen by guest): ' + t);
  await A.screenshot({ path: SHOTS + '18_online_lobby_teams.png' });
  await A.click('#startBtn');
  await Promise.all([A, B].map(p => p.waitForFunction(() => mpDebug.state().phase !== 'lobby' && mpDebug.state().teams.blue === 'ENG')));
  let sb = await st(B);
  ok(sb.teams.blue === 'ENG' && sb.teams.red === 'GER' && sb.teams.redShirt === '#0b6e4f', 'clients apply kits ' + JSON.stringify(sb.teams));
  await sleep(500);
  // foul in the box -> penalty for Alice (blue)
  await dbg(A, { cmd: 'foul', team: 'blue', inBox: true });
  await A.waitForFunction(() => mpDebug.state().penalty, null, { timeout: 8000 });
  let sa = await st(A); sb = await st(B);
  ok(sa.penalty.iAmTaker && sb.penalty.iAmKeeper, 'online penalty: Alice takes it, Bob is in goal');
  await B.keyboard.down('ArrowDown'); await A.keyboard.down('KeyW'); await sleep(400); await B.keyboard.up('ArrowDown'); await A.keyboard.up('KeyW');
  await sleep(200);
  sa = await st(A);
  ok(sa.penalty && sa.penalty.gkChoice === 1, 'keeper choice + aim reach the server (aim ' + (sa.penalty && Math.round(sa.penalty.aimY)) + ')');
  await A.screenshot({ path: SHOTS + '19_online_penalty.png' });
  await A.keyboard.down('Space'); await sleep(400); await A.keyboard.up('Space');
  await sleep(1500);
  sa = await st(A);
  ok(!sa.penalty, 'online penalty kicked -> ' + sa.phase + ' ' + sa.score.blue + '-' + sa.score.red);
  // cards: two yellows on red #4 -> sent off
  let rooms = await getRooms();
  await sleep(3000);
  await dbg(A, { cmd: 'card', index: 12, kind: 'yellow' }); await sleep(400);
  sb = await st(B); ok(sb.cardPopup === 'yellow' && sb.yellows >= 1, 'online yellow card popup ' + JSON.stringify({cp: sb.cardPopup, y: sb.yellows, so: sb.sentOff, ph: sb.phase}));
  await dbg(A, { cmd: 'card', index: 12, kind: 'yellow' }); await sleep(400);
  sb = await st(B); rooms = await getRooms();
  const g = rooms.find(r => r.code === code).game;
  ok(sb.cardPopup === 'second' && sb.sentOff >= 1 && g.onPitch === 21, 'second yellow -> sent off online (on pitch ' + g.onPitch + ')');
  await B.screenshot({ path: SHOTS + '20_online_red_card.png' });
  // offside
  await sleep(2500);
  await dbg(A, { cmd: 'offside', team: 'blue' });
  await B.waitForFunction(() => mpDebug.state().flag, null, { timeout: 5000 }).then(() => ok(true, 'online offside flag'), () => ok(false, 'online offside flag'));
  await sleep(2500);
  // skill with the R key
  let skilled = false;
  for (let i = 0; i < 6 && !skilled; i++) {
    await dbg(A, { cmd: 'skill', team: 'blue', type: ['stepover', 'spin', 'flick', 'burst'][i % 4] });
    await sleep(250);
    rooms = await getRooms(); skilled = rooms.find(r => r.code === code).game.stats.skills > 0;
  }
  ok(skilled, 'online skill move (debug command)');
  // celebration + skip
  await dbg(A, { cmd: 'goal', team: 'red' });
  await A.waitForFunction(() => mpDebug.state().celebration, null, { timeout: 5000 });
  await sleep(1800);
  await A.screenshot({ path: SHOTS + '21_online_celebration.png' });
  await B.keyboard.press('KeyX');
  await A.waitForFunction(() => mpDebug.state().phase === 'setpiece', null, { timeout: 3000 }).then(() => ok(true, 'online celebration skipped by a key'), () => ok(false, 'online celebration skip'));
  // R key from a human with the ball
  // back to lobby -> shootout match type
  await dbg(A, { cmd: 'speed', value: 1 });
  await A.evaluate(() => mpDebug.send({ t: 'lobby' }));
  await A.waitForFunction(() => mpDebug.state().room.state === 'lobby');
  await A.click('[data-lmatch="shootout"]'); await A.uncheck('#lobbyOffside');
  await sleep(300);
  ok((await st(B)).room && !(await B.isChecked('#lobbyOffside')), 'rules toggle synced to guest');
  await A.click('#startBtn');
  await A.waitForFunction(() => mpDebug.state().shootout, null, { timeout: 8000 });
  await dbg(A, { cmd: 'autoplay', on: true }); await dbg(A, { cmd: 'speed', value: 8 });
  await A.waitForFunction(() => mpDebug.state().shootout && mpDebug.state().shootout.kicks.blue.length >= 2, null, { timeout: 20000 });
  await dbg(A, { cmd: 'speed', value: 1 });
  await sleep(600);
  await A.screenshot({ path: SHOTS + '22_online_shootout.png' });
  await dbg(A, { cmd: 'speed', value: 10 });
  await Promise.all([A, B].map(p => p.waitForFunction(() => mpDebug.state().winVisible, null, { timeout: 60000 })));
  sa = await st(A);
  ok(sa.winVisible && sa.shootout && sa.shootout.done, 'online shootout finished: ' + sa.shootout.kicks.blue.join('') + ' / ' + sa.shootout.kicks.red.join('') + ' winner ' + sa.winner);
  ok(/penalties/.test(await A.textContent('#winScore')), 'win screen shows penalties: ' + await A.textContent('#winScore'));
  ok(errors.length === 0, 'no console errors ' + JSON.stringify(errors.slice(0, 5)));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL ONLINE FEATURE TESTS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED', e); console.log('ERRORS', JSON.stringify(errors)); process.exit(2); });
