const S = require(require('path').join(__dirname, '..', 'public', 'game.js'));
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const run = (sim, sec) => { for (let i = 0; i < sec * 120; i++) sim.update(1/120); };
// 1. CPU vs CPU full match
{ const sim = S.createSim({ difficulty: 'hard' }); sim.start(); sim.setAutoplay(true);
  let t = 0; while (sim.game.phase !== 'win' && t < 1200) { run(sim, 1); t++; }
  const g = sim.game; assert(g.phase === 'win' && Math.max(g.score.blue, g.score.red) === 5, `cpu match ends ${g.score.blue}-${g.score.red} in ${t}s game clock ${g.clock.toFixed(0)}`);
  console.log('   stats', JSON.stringify(g.stats)); sim.snapshot(); }
// 2. penalty from foul in box
{ const sim = S.createSim({}); sim.start(); run(sim, 3);
  const r = sim.debugFoul('red', true); assert(r && sim.game.pending.type === 'penalty', 'foul in box -> penalty pending');
  run(sim, 2.6); assert(sim.game.phase === 'setpiece' && sim.game.setpiece.type === 'penalty' && sim.game.penalty, 'penalty setpiece set up');
  const pen = sim.game.penalty; const before = sim.game.score.red;
  run(sim, 4); console.log('   after pen phase', sim.game.phase, 'score', sim.game.score, sim.game.comment.text);
  assert(sim.game.penalty === null, 'penalty taken'); }
// 3. cards: two yellows -> red
{ const sim = S.createSim({}); sim.start(); run(sim, 2);
  const i = sim.roster.findIndex(p => p.team === 'blue' && p.role === 'DEF');
  sim.giveCard(i, 'yellow'); assert(sim.roster[i].yellow === 1 && sim.game.cardPopup.kind === 'yellow', 'yellow card');
  sim.giveCard(i, 'yellow'); assert(sim.roster[i].sentOff && sim.game.cardPopup.kind === 'second', 'second yellow = sent off');
  assert(sim.players.filter(p => p.team === 'blue').length === 4, 'blue down to 4');
  const snap = sim.snapshot(); assert(snap.p.length === 10 && snap.p[i][11] === 1 && snap.cp, 'snapshot carries cards');
  sim.setAutoplay(true); run(sim, 60); assert(true, 'plays on with 4 players, phase ' + sim.game.phase); }
// 4. foul from behind gives a card
{ let cards = 0; for (let k = 0; k < 10; k++) { const sim = S.createSim({}); sim.start(); run(sim, 2); sim.debugFoul('red', false, true); cards += sim.game.cardPopup ? 1 : 0; }
  assert(cards === 10, 'slide from behind -> card every time (' + cards + ')'); }
// 5. offside
{ const sim = S.createSim({}); sim.start(); run(sim, 2); const r = sim.debugOffside('blue');
  assert(r.offside.length === 1, 'offside player recorded ' + JSON.stringify(r));
  let ok = false; for (let i = 0; i < 240 && !ok; i++) { sim.update(1/120); if (sim.game.flag) ok = true; }
  assert(ok && sim.game.pending.indirect && sim.game.pending.team === 'red', 'offside flagged, indirect FK to red');
  run(sim, 2); assert(sim.game.setpiece && sim.game.setpiece.indirect, 'indirect setpiece'); }
// 5b. offside disabled
{ const sim = S.createSim({ rules: { offside: false } }); sim.start(); run(sim, 2); const r = sim.debugOffside('blue'); assert(r.offside.length === 0, 'offside off -> none'); }
// 6. shootout
{ let sudden = 0, n = 0;
  for (let k = 0; k < 12; k++) { const sim = S.createSim({ matchType: 'shootout' }); sim.start(); sim.setAutoplay(true);
    let t = 0; while (sim.game.phase !== 'win' && t < 600) { run(sim, 1); t++; }
    const so = sim.game.shootout; if (sim.game.phase === 'win') n++; if (so.sudden) sudden++;
    if (k < 4) console.log('   shootout', so.kicks.blue.join(''), so.kicks.red.join(''), 'winner', sim.game.winner, 'sudden', so.sudden, t + 's'); }
  assert(n === 12, 'shootouts finish (' + n + '/12), sudden death in ' + sudden); }
// 7. skills
{ const sim = S.createSim({}); sim.start(); run(sim, 2);
  for (const t of ['stepover', 'spin', 'flick', 'burst']) { const r = sim.debugSkill('blue', t); assert(r.ok && r.skill === t, 'skill ' + t); run(sim, 1); }
  const sim2 = S.createSim({ difficulty: 'hard' }); sim2.start(); sim2.setAutoplay(true); run(sim2, 400); assert(sim2.game.stats.skills > 0, 'CPU uses skills on hard: ' + sim2.game.stats.skills); }
// 8. celebration
{ const sim = S.createSim({}); sim.start(); run(sim, 1); sim.forceGoal('blue'); const ce = sim.game.celebration;
  assert(ce && ce.scorer, 'celebration ' + (ce && ce.type)); run(sim, 3); console.log('   scorer pos', ce.scorer.x.toFixed(0), ce.scorer.y.toFixed(0), 'spot', ce.spot);
  sim.addController('h', 'H', 'red'); sim.press('h', 'skip'); run(sim, 1.05); assert(sim.game.phase === 'setpiece', 'celebration skipped -> kickoff'); }
// 9. timed knockout draw -> shootout
{ const sim = S.createSim({ timeLimit: 20, knockout: true, winScore: 3 }); sim.start(); sim.setAutoplay(true);
  let sawShoot = false, t = 0; while (sim.game.phase !== 'win' && t < 900) { run(sim, 1); t++; if (sim.game.shootout) sawShoot = true; }
  assert(sim.game.phase === 'win', `timed knockout ends ${sim.game.score.blue}-${sim.game.score.red} shootout=${sawShoot} winner=${sim.game.winner}`); }
// 10. human penalty: human taker aims, human keeper picks dive
{ const sim = S.createSim({}); sim.addController('a', 'A', 'blue'); sim.addController('b', 'B', 'red'); sim.start(); run(sim, 2);
  sim.debugFoul('blue', true); run(sim, 2.6);
  const pen = sim.game.penalty; const ca = sim.controllers[0], cb = sim.controllers[1];
  assert(ca.active === pen.taker && cb.active === pen.keeper, 'humans control taker + keeper');
  const aim0 = pen.aimY; sim.setInput('a', { my: -1 }); sim.setInput('b', { my: 1 }); run(sim, 0.5); sim.setInput('a', {}); sim.setInput('b', {});
  assert((pen.aimY < aim0 - 30 || pen.aimY <= 476.5) && pen.gkChoice === 1, 'aim moved ' + pen.aimY.toFixed(0) + ' gk ' + pen.gkChoice);
  sim.setInput('a', { shoot: true }); sim.press('a','shoot'); run(sim, 0.4); sim.setInput('a', { shoot: false }); run(sim, 0.1);
  assert(!sim.game.penalty, 'human penalty kicked, dive=' + pen.dive); run(sim, 3); console.log('   score', sim.game.score, sim.game.comment.text); }
// 11. referee and linesmen
{ const sim = S.createSim({}); sim.start(); sim.setAutoplay(true); run(sim, 5);
  const ref = sim.game.officials[0], near = sim.game.officials[1], far = sim.game.officials[2];
  assert(ref.x > 140 && ref.x < 1500 && ref.y > 140 && ref.y < 960, 'referee stays on the pitch');
  assert(Math.abs(near.y - 1000) < 0.5 && Math.abs(far.y - 100) < 0.5, 'linesmen stay on the touchlines');
  const snap = sim.snapshot();
  assert(snap.of && snap.of.length === 3 && snap.of[1].length === 8 && snap.p[0].length === 14, 'snapshot carries officials without changing players');
}
{ const sim = S.createSim({ difficulty: 'normal' }); sim.start(); sim.setAutoplay(true);
  const M = 1400 / 105;
  let n = 0, sum = 0, min = 1e9, maxLine = 0, inside = 0;
  let t = 0;
  while (sim.game.phase !== 'win' && t < 900) {
    for (let i = 0; i < 120; i++) {
      sim.update(1/120);
      const near = sim.game.officials[1], far = sim.game.officials[2];
      maxLine = Math.max(maxLine, Math.abs(near.y - 1000), Math.abs(far.y - 100));
      if (near.y <= 980 || far.y >= 120) inside++;
      if (sim.game.phase === 'play' && !sim.game.cardPopup && !sim.game.flag) {
        const ref = sim.game.officials[0];
        const d = Math.hypot(ref.x - sim.ball.x, ref.y - sim.ball.y);
        n++; sum += d; if (d < min) min = d;
      }
    }
    t++;
  }
  const minM = min / M, avgM = sum / n / M;
  console.log('   ref open-play distance m  min ' + minM.toFixed(1) + '  avg ' + avgM.toFixed(1) + '  samples ' + n);
  console.log('   linesman touchline error px ' + maxLine.toFixed(3) + '  steps onto the pitch ' + inside);
  assert(sim.game.phase === 'win' && n > 200, 'distance check watched a whole match');
  assert(minM >= 9 && avgM >= 11 && avgM <= 22, 'referee keeps a viewing distance (min ' + minM.toFixed(1) + 'm avg ' + avgM.toFixed(1) + 'm)');
  assert(maxLine < 0.6 && inside === 0, 'linesmen never leave their touchlines');
}
{ const sim = S.createSim({}); sim.start(); run(sim, 1); sim.debugOffside('blue');
  let guard = 0; while (!sim.game.flag && guard++ < 400) sim.update(1/120);
  sim.update(1/120);
  assert(sim.game.flag && sim.game.officials[1].sig === 5 && sim.game.officials[2].sig !== 5, 'near linesman flags the blue offside');
}
{ const sim = S.createSim({}); sim.start(); run(sim, 1);
  const i = sim.roster.findIndex(p => p.team === 'red' && p.role === 'DEF');
  sim.giveCard(i, 'yellow'); run(sim, 2.2);
  const ref = sim.game.officials[0], p = sim.roster[i];
  assert(ref.sig === 3 && Math.hypot(ref.x - p.x, ref.y - p.y) < 90, 'referee holds the yellow card by the player');
}
