// Offline game tests (soccer.html) in headless Chromium
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || require('path').join(__dirname, '..', '..', 'screenshots_v3') + '/';
const FILE = 'file://' + (process.env.FILE || require('path').join(__dirname, '..', '..', 'soccer.html'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(FILE);
  await sleep(500);
  const D = (fn, ...a) => page.evaluate(fn, ...a);
  // --- menu + team picker ---
  ok(await page.isVisible('#menu'), 'menu visible');
  const menuFmt = await page.textContent('#formatLine');
  ok(/10 minute game/.test(menuFmt) && !/first to/i.test(menuFmt), 'menu says 10 minute game: ' + menuFmt);
  await page.click('[data-kind="cup"]');
  const cupFmt = await page.textContent('#formatLine');
  ok(/10 minutes/.test(cupFmt) && /penalt/i.test(cupFmt) && !/first to/i.test(cupFmt), 'cup menu: 10 minutes, draw = penalties: ' + cupFmt);
  await page.click('[data-kind="quick"]');
  await page.click('#blueTeamBtn'); await sleep(200);
  ok(await page.isVisible('#teamPicker'), 'team picker opens');
  await page.screenshot({ path: SHOTS + '01_team_picker.png' });
  await page.click('[data-team="bra"]'); await sleep(150);
  await page.click('#redTeamBtn'); await sleep(150);
  await page.click('[data-team="arg"]'); await sleep(150);
  const menuText = await page.textContent('#blueTeamBtn') + ' / ' + await page.textContent('#redTeamBtn');
  ok(/Brazil/.test(menuText) && /Argentina/.test(menuText), 'teams picked: ' + menuText.replace(/\s+/g, ' '));
  await page.screenshot({ path: SHOTS + '02_menu.png' });
  // kit clash: England (white) vs Germany (white) -> away kit
  let st = await D(() => soccerDebug.start({ blue: 'eng', red: 'ger' }));
  ok(st.teams.red.away === true && st.teams.red.shirt === '#0b6e4f', 'kit clash -> Germany wears away kit ' + JSON.stringify(st.teams.red));
  st = await D(() => soccerDebug.start({ blue: 'bra', red: 'arg' }));
  ok(st.teams.blue.short === 'BRA' && st.teams.blue.shirt === '#ffd500' && st.teams.red.short === 'ARG', 'kits applied BRA vs ARG');
  // custom team
  await D(() => soccerDebug.setAutoplay(false));
  await D(() => { document.getElementById('pauseMenuBtn').click(); });
  await page.click('#blueTeamBtn'); await sleep(150);
  await page.fill('#customName', 'Dash FC');
  await page.$eval('#customShirt', (e) => { e.value = '#ff00aa'; });
  await page.click('#customSaveBtn'); await sleep(150);
  st = await D(() => soccerDebug.start({}));
  ok(st.teams.blue.name === 'Dash FC' && st.teams.blue.shirt === '#ff00aa' && st.teams.blue.short === 'DAS', 'custom team applied ' + JSON.stringify(st.teams.blue));
  // --- 10:00 match: goals do not end it, the clock does ---
  st = await D(() => soccerDebug.start({ blue: 'fra', red: 'esp', difficulty: 'hard' }));
  ok(st.timeLimit === 600 && !st.knockout, 'quick match is 10:00 with no goal limit');
  await D(() => soccerDebug.setAutoplay(true));
  st = await D(() => soccerDebug.step(2));
  for (let i = 0; i < 15 && st.phase !== 'play'; i++) st = await D(() => soccerDebug.step(0.25));
  st = await D(() => soccerDebug.setScore(7, 4));
  st = await D(() => soccerDebug.step(1));
  ok(st.phase !== 'win' && st.score.blue === 7 && st.score.red === 4, 'seven goals does not end the match: ' + st.phase + ' ' + st.score.blue + '-' + st.score.red);
  await D(() => soccerDebug.setClock(599.85));
  for (let i = 0; i < 40 && st.phase !== 'win'; i++) st = await D(() => soccerDebug.step(0.25));
  await sleep(1300);
  st = await D(() => soccerDebug.state());
  ok(st.phase === 'win' && st.winner === 'blue' && st.clock >= 599 && st.screens.includes('winScreen'), 'full time result screen: ' + st.score.blue + '-' + st.score.red + ' clock ' + st.clock + ' winner ' + st.winner);
  const winText = await page.textContent('#winTitle');
  ok(/win!/.test(winText) && !/first to/i.test(await page.textContent('#winScreen')), 'result names the winner: ' + winText);
  console.log('     stats', JSON.stringify(st.stats));
  // a friendly draw stays a draw
  st = await D(() => soccerDebug.start({ blue: 'fra', red: 'esp' }));
  await D(() => soccerDebug.step(1));
  for (let i = 0; i < 15 && (await D(() => soccerDebug.state())).phase !== 'play'; i++) await D(() => soccerDebug.step(0.25));
  await D(() => soccerDebug.setScore(2, 2));
  st = await D(() => soccerDebug.setClock(599.85));
  for (let i = 0; i < 40 && st.phase !== 'win'; i++) st = await D(() => soccerDebug.step(0.25));
  await sleep(1300);
  st = await D(() => soccerDebug.state());
  ok(st.phase === 'win' && st.winner === null && /draw/i.test(await page.textContent('#winTitle')), 'friendly draw stays a draw: ' + await page.textContent('#winTitle'));
  // --- penalty from a foul in the box ---
  st = await D(() => soccerDebug.start({ blue: 'ned', red: 'por' }));
  await D(() => soccerDebug.step(2));
  await D(() => soccerDebug.foul('blue', true));
  st = await D(() => soccerDebug.step(2.6));
  ok(st.setpiece === 'penalty' && st.penalty && st.penalty.team === 'blue', 'foul in box -> penalty for blue (human)');
  await page.keyboard.down('KeyW'); await sleep(350); await page.keyboard.up('KeyW');
  await sleep(100);
  await page.screenshot({ path: SHOTS + '03_penalty.png' });
  const aim = (await D(() => soccerDebug.state())).penalty.aimY;
  await page.keyboard.down('Space'); await sleep(450); await page.keyboard.up('Space');
  await sleep(1500);
  st = await D(() => soccerDebug.state());
  ok(!st.penalty && st.stats.penalty === 1, 'human took the penalty (aim ' + Math.round(aim) + ') -> ' + st.phase + ' ' + st.score.blue + '-' + st.score.red);
  // --- cards: yellow, second yellow -> red, team a player down ---
  st = await D(() => soccerDebug.start({}));
  await D(() => soccerDebug.step(2));
  const idx = (await D(() => soccerDebug.roster())).find((p) => p.team === 'red' && p.role === 'DEF').i;
  await D((i) => soccerDebug.card(i, 'yellow'), idx);
  st = await D(() => soccerDebug.step(0.5));
  ok(st.cardPopup === 'yellow' && st.cards.length === 1 && st.cards[0].yellow === 1, 'yellow card shown');
  await D((i) => soccerDebug.card(i, 'yellow'), idx);
  st = await D(() => soccerDebug.step(0.6));
  ok(st.cardPopup === 'second' && st.onPitch.red === 10 && st.cards[0].sentOff, 'second yellow -> red, red down to ' + st.onPitch.red);
  await page.screenshot({ path: SHOTS + '04_red_card_popup.png' });
  st = await D(() => soccerDebug.step(3));
  await page.screenshot({ path: SHOTS + '05_gameplay_cards_hud.png' });
  // a real foul from behind gives a card
  await D(() => soccerDebug.foul('blue', false, true));
  st = await D(() => soccerDebug.step(0.2));
  ok(st.cardPopup && st.stats.fouls >= 1, 'slide from behind -> ' + st.cardPopup + ' card');
  // --- offside ---
  st = await D(() => soccerDebug.start({}));
  await D(() => soccerDebug.step(2));
  const os = await D(() => soccerDebug.offside('blue'));
  let flagged = false;
  for (let i = 0; i < 20 && !flagged; i++) { st = await D(() => soccerDebug.step(0.1)); flagged = st.flag; }
  ok(os.offside.length === 1 && flagged, 'offside flagged');
  await page.screenshot({ path: SHOTS + '06_offside_flag.png' });
  st = await D(() => soccerDebug.step(2));
  ok(st.setpiece === 'free' && st.indirect, 'indirect free kick after offside');
  // offside switched off in settings
  await D(() => { document.getElementById('pauseMenuBtn').click(); });
  await page.uncheck('#ruleOffside');
  st = await D(() => soccerDebug.start({}));
  await D(() => soccerDebug.step(1));
  ok((await D(() => soccerDebug.offside('blue'))).offside.length === 0, 'offside toggle off works');
  await D(() => { document.getElementById('pauseMenuBtn').click(); });
  await page.check('#ruleOffside');
  // --- skill moves ---
  st = await D(() => soccerDebug.start({}));
  await D(() => soccerDebug.step(2));
  const sk = [];
  for (const t of ['stepover', 'spin', 'flick', 'burst']) { const r = await D((t) => soccerDebug.skill('blue', t), t); sk.push(t + ':' + r.ok); await D(() => soccerDebug.step(0.12)); if (t === 'spin') await page.screenshot({ path: SHOTS + '07_skill_spin.png' }); await D(() => soccerDebug.step(1)); }
  ok(sk.every((s) => s.endsWith('true')), 'skills: ' + sk.join(' '));
  // R key does a skill when you have the ball
  st = await D(() => soccerDebug.start({}));
  let skilled = false;
  for (let i = 0; i < 5 && !skilled; i++) {
    await D(() => soccerDebug.giveBall('p1'));
    await page.keyboard.press('KeyR'); await sleep(30);
    await D(() => soccerDebug.step(0.02));
    skilled = (await D(() => soccerDebug.state())).stats.skills > 0;
  }
  ok(skilled, 'R key triggers a skill move');
  // --- celebration plays and can be skipped ---
  st = await D(() => soccerDebug.start({ blue: 'bra', red: 'ger' }));
  await D(() => soccerDebug.step(1));
  await D(() => soccerDebug.forceGoal('blue'));
  st = await D(() => soccerDebug.step(2.2));
  ok(st.phase === 'goal' && st.celebration, 'celebration playing: ' + (st.celebration && st.celebration.type));
  await D(() => { for (let i = 0; i < 30; i++) { /* let the camera zoom */ } });
  await sleep(600);
  await page.screenshot({ path: SHOTS + '08_celebration.png' });
  await page.keyboard.press('KeyX');
  st = await D(() => soccerDebug.step(1.05));
  ok(st.phase === 'setpiece' && st.setpiece === 'kickoff', 'celebration skipped with a key');
  // --- shootout mode incl. sudden death ---
  let sudden = false, okShoot = 0;
  for (let k = 0; k < 25 && !(sudden && okShoot >= 2); k++) {
    await D(() => { document.getElementById('pauseMenuBtn').click(); });
    st = await D(() => soccerDebug.start({ kind: 'shootout', blue: 'eng', red: 'ita' }));
    await D(() => soccerDebug.setAutoplay(true));
    let shotTaken = false;
    for (let i = 0; i < 300 && st.phase !== 'win'; i++) {
      st = await D(() => soccerDebug.step(0.5));
      if (!shotTaken && st.shootout && st.shootout.blue.length + st.shootout.red.length === 3) { shotTaken = true; if (k === 0) await page.screenshot({ path: SHOTS + '09_shootout.png' }); }
      if (st.shootout && st.shootout.sudden && !sudden) { sudden = true; await page.screenshot({ path: SHOTS + '10_shootout_sudden_death.png' }); }
    }
    if (st.phase === 'win') okShoot++;
    console.log('     shootout', st.shootout.blue.join(''), st.shootout.red.join(''), 'sudden', st.shootout.sudden, 'winner', st.winner);
  }
  ok(okShoot >= 2 && sudden, 'shootouts finish (' + okShoot + ') and sudden death seen: ' + sudden);
  await sleep(1300);
  ok((await D(() => soccerDebug.state())).screens.includes('winScreen'), 'shootout win screen');
  // human shootout: shoot with Space, then dive as keeper
  await D(() => { document.getElementById('menuBtn').click(); });
  st = await D(() => soccerDebug.start({ kind: 'shootout' }));
  for (let i = 0; i < 20; i++) { st = await D(() => soccerDebug.step(0.25)); if (st.penalty) break; }
  ok(!!st.penalty, 'human shootout: a kick is ready (' + (st.penalty && st.penalty.team) + ')');
  if (st.penalty && st.penalty.team === 'red') { await page.keyboard.down('KeyS'); await sleep(150); await D(() => soccerDebug.step(0.2)); await page.keyboard.up('KeyS'); st = await D(() => soccerDebug.state()); ok(st.penalty.gkChoice === 1, 'human keeper picks a side (down)'); }
  else { await page.keyboard.down('Space'); await sleep(300); await D(() => soccerDebug.step(0.3)); await page.keyboard.up('Space'); await D(() => soccerDebug.step(0.1)); st = await D(() => soccerDebug.state()); ok(st.phase === 'pkflight' || st.phase === 'shootout', 'human shootout kick taken: ' + st.phase); }
  // --- cup: full run to the trophy ---
  await D(() => { document.getElementById('pauseMenuBtn').click(); localStorage.removeItem('soccerCup'); });
  await D(() => { document.getElementById('menuBtn') && 0; });
  await page.evaluate(() => { const m = document.getElementById('menu'); });
  await D(() => soccerDebug.start({ kind: 'cup', blue: 'jpn' }));
  await sleep(200);
  st = await D(() => soccerDebug.state());
  ok(st.screens.includes('cupScreen'), 'cup bracket shown');
  ok(/10 minutes/.test(await page.textContent('#cupFormat')) && !/first to/i.test(await page.textContent('#cupFormat')), 'cup screen: ' + await page.textContent('#cupFormat'));
  await page.screenshot({ path: SHOTS + '11_cup_bracket.png' });
  for (let r = 0; r < 3; r++) {
    await page.click('#cupPlayBtn'); await sleep(200);
    st = await D(() => soccerDebug.state());
    if (r === 0) { ok(st.kind === 'cup' && st.phase !== 'win', 'cup quarter-final started'); await D(() => soccerDebug.step(3)); await page.screenshot({ path: SHOTS + '12_cup_match.png' }); }
    await D(() => soccerDebug.finishMatch('blue', [3, 1]));
    await sleep(1400);
    st = await D(() => soccerDebug.state());
    ok(st.screens.includes('winScreen'), 'cup match ' + r + ' win screen');
    await page.click('#cupContinueBtn'); await sleep(300);
    st = await D(() => soccerDebug.state());
    if (r < 2) { ok(st.screens.includes('cupScreen') && st.cup.round === r + 1, 'advanced to round ' + (r + 1)); if (r === 0) await page.screenshot({ path: SHOTS + '13_cup_bracket_semis.png' }); }
  }
  ok(st.screens.includes('trophyScreen') && st.cup.over && st.cup.champion === 0, 'trophy screen after winning the final');
  await sleep(1500);
  await page.screenshot({ path: SHOTS + '14_trophy.png' });
  // cup progress is saved
  const saved = await D(() => JSON.parse(localStorage.getItem('soccerCup')));
  ok(saved && saved.over && saved.rounds[2][0].winner === 0, 'cup saved in localStorage');
  // timed cup match: a draw at full time -> penalties
  await D(() => { document.getElementById('trophyMenuBtn').click(); localStorage.removeItem('soccerCup'); });
  await D(() => soccerDebug.start({ kind: 'cup', blue: 'usa' }));
  await page.click('#cupPlayBtn'); await sleep(200);
  await D(() => soccerDebug.setAutoplay(true));
  st = await D(() => soccerDebug.step(1));
  for (let i = 0; i < 20 && st.phase !== 'play'; i++) st = await D(() => soccerDebug.step(0.25));
  ok(st.timeLimit === 600 && st.knockout, 'cup match is 10:00 and a draw goes to penalties');
  await D(() => soccerDebug.setScore(1, 1));
  await D(() => soccerDebug.setClock(599.85));
  let sawPens = false;
  for (let i = 0; i < 400; i++) { st = await D(() => soccerDebug.step(0.5)); if (st.shootout) sawPens = true; if (st.phase === 'win') break; }
  ok(st.phase === 'win' && sawPens && st.clock >= 599, 'cup draw at 10:00 goes to penalties, clock ' + st.clock + ': ' + st.score.blue + '-' + st.score.red);
  // --- no console errors ---
  ok(errors.length === 0, 'no console errors ' + JSON.stringify(errors.slice(0, 5)));
  // --- mobile layout (iPhone landscape) ---
  const ctx2 = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await ctx2.newPage();
  mp.on('pageerror', (e) => errors.push(String(e)));
  await mp.goto(FILE); await sleep(400);
  await mp.screenshot({ path: SHOTS + '15_mobile_menu.png' });
  const fits = await mp.evaluate(() => { const p = document.querySelector('#menu .panel').getBoundingClientRect(); return p.width <= innerWidth && p.height <= innerHeight; });
  ok(fits, 'mobile menu fits the screen');
  await mp.evaluate(() => soccerDebug.start({}));
  await mp.evaluate(() => soccerDebug.step(2));
  const btns = await mp.evaluate(() => ['shootBtn', 'passBtn', 'sprintBtn', 'skillBtn'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, x: r.left, y: r.top, w: r.width, h: r.height, vis: r.width > 0 }; }));
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  let anyOverlap = false; for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) if (overlap(btns[i], btns[j])) anyOverlap = true;
  ok(btns.every((b) => b.vis && b.x >= 0 && b.y >= 0 && b.x + b.w <= 844 && b.y + b.h <= 390) && !anyOverlap, 'touch buttons on screen, no overlap ' + JSON.stringify(btns.map((b) => b.id + '@' + Math.round(b.x) + ',' + Math.round(b.y))));
  // SKILL button works on touch
  let tSkill = false;
  for (let i = 0; i < 5 && !tSkill; i++) {
    await mp.evaluate(() => soccerDebug.giveBall('p1'));
    await mp.tap('#skillBtn'); await mp.evaluate(() => soccerDebug.step(0.02));
    tSkill = (await mp.evaluate(() => soccerDebug.state())).stats.skills > 0;
  }
  ok(tSkill, 'SKILL touch button triggers a skill');
  await mp.screenshot({ path: SHOTS + '16_mobile_gameplay.png' });
  await mp.evaluate(() => { localStorage.removeItem('soccerCup'); soccerDebug.start({ kind: 'cup', blue: 'kor' }); });
  await sleep(200);
  await mp.screenshot({ path: SHOTS + '17_mobile_cup_bracket.png' });
  const fits2 = await mp.evaluate(() => { const p = document.querySelector('#cupScreen .panel').getBoundingClientRect(); return { w: p.width, h: p.height, sh: document.querySelector('#cupScreen .panel').scrollHeight }; });
  ok(fits2.w <= 844 && fits2.h <= 390, 'mobile bracket fits ' + JSON.stringify(fits2));
  ok(errors.length === 0, 'no console errors (mobile) ' + JSON.stringify(errors.slice(0, 5)));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL OFFLINE TESTS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
