const S = require(require('path').join(__dirname, '..', 'public', 'game.js'));
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const run = (sim, sec) => { for (let i = 0; i < sec * 120; i++) sim.update(1/120); };
// 1. Every match is 10:00. Goals never end it. Most goals wins. A draw stays a draw.
{ const sim = S.createSim({ difficulty: 'hard', winScore: 1, timeLimit: 20 }); sim.start();
  assert(sim.game.timeLimit === S.MATCH_LENGTH && sim.game.timeLimit === 600, 'a match is 10:00 even if old options are passed');
  assert(S.createSim({ matchType: 'shootout' }).game.timeLimit === 0, 'a penalty shootout has no clock');
  sim.game.phase = 'play'; sim.game.setpiece = null;
  sim.game.score.blue = 8; sim.game.score.red = 3; sim.game.clock = 120;
  sim.update(1/120);
  assert(sim.game.phase !== 'win', 'a big lead does not end the match');
  Object.assign(sim.ball, { x: 700, y: 550, z: 0, vx: 0, vy: 0, vz: 0, owner: null });
  sim.game.phase = 'play'; sim.game.setpiece = null;
  sim.game.score.blue = 8; sim.game.score.red = 3; sim.game.clock = 599.95;
  run(sim, 0.2);
  const g = sim.game;
  assert(g.phase === 'win' && g.winner === 'blue' && g.clock >= 600, `full time ${g.score.blue}-${g.score.red} winner ${g.winner} clock ${g.clock.toFixed(2)}`);
  const info = sim.matchInfo();
  assert(info.timeLimit === 600 && info.winScore === undefined, 'host tells the guest the match is 10:00');
}
{ const sim = S.createSim({}); sim.start();
  sim.game.phase = 'play'; sim.game.score.blue = 4; sim.game.score.red = 4; sim.game.clock = 599.9;
  run(sim, 0.25);
  assert(sim.game.phase === 'win' && sim.game.winner === null, 'a friendly draw stays a draw');
}
{ const sim = S.createSim({}); sim.start();
  sim.game.phase = 'play'; sim.game.clock = 599.5;
  sim.forceGoal('red');
  assert(sim.game.phase === 'goal' && sim.game.score.red === 1, 'a goal in the last seconds still counts');
  run(sim, 6);
  assert(sim.game.phase !== 'win', 'the last fraction of the 10:00 is still played after the celebration');
  sim.game.phase = 'play';
  run(sim, 0.7);
  assert(sim.game.phase === 'win' && sim.game.winner === 'red' && sim.game.score.red === 1, 'then full time, and that goal wins it');
}
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
// 9. cup: level at 10:00 -> penalty shootout
{ const sim = S.createSim({ knockout: true, winScore: 3, timeLimit: 20 }); sim.start(); sim.setAutoplay(true);
  assert(sim.game.timeLimit === 600 && sim.game.knockout, 'a cup match is still 10:00');
  sim.game.phase = 'play'; sim.game.score.blue = 2; sim.game.score.red = 2; sim.game.clock = 599.9;
  let sawShoot = false, t = 0; while (sim.game.phase !== 'win' && t < 400) { run(sim, 1); t++; if (sim.game.shootout) sawShoot = true; }
  assert(sim.game.phase === 'win' && sawShoot, `cup draw goes to penalties ${sim.game.score.blue}-${sim.game.score.red} winner=${sim.game.winner}`); }
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
  while (sim.game.phase !== 'win' && t < 2000) {
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
  assert(sim.game.phase === 'win' && n > 200 && sim.game.clock >= 599 && sim.game.clock < 630, 'distance check watched a whole 10:00 (clock ' + sim.game.clock.toFixed(1) + ')');
  const sc = sim.game.score;
  const leader = sc.blue === sc.red ? null : (sc.blue > sc.red ? 'blue' : 'red');
  assert(sim.game.winner === leader, 'winner is whoever has more goals (' + sc.blue + '-' + sc.red + ' -> ' + sim.game.winner + ')');
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
