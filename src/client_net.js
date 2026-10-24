// =====================================================================
// C. MESSAGES FROM THE HOST
// The transport (WebSocket or peer-to-peer) lives in another file.
// It calls onMessage() and provides sendMsg / connect.
// =====================================================================
let wantRoom = null;   // {code, token, name} - used to rejoin after a refresh
let pendingAction = null;

function onMessage(m) {
  switch (m.t) {
    case "joined":
      myId = m.you;
      wantRoom = { code: m.code, token: m.token, name: $("nameInput").value.trim() || (wantRoom && wantRoom.name) || "Player" };
      try { sessionStorage.setItem("soccerRoom", JSON.stringify(wantRoom)); } catch (e) { /* ignore */ }
      history.replaceState(null, "", "?room=" + m.code);
      break;
    case "room":
      // A late message after we already left should not pull us back in.
      if (!myId) break;
      // The host's device is gone (peer-to-peer). The WebSocket server picks a new host instead.
      if (typeof netHostGone === "function" && !netIsHost() && m.hostId && Array.isArray(m.members) && !m.members.some((x) => x.id === m.hostId)) {
        netHostGone();
        break;
      }
      room = m;
      game.mode = m.mode; game.difficulty = m.difficulty;
      if (m.state === "lobby") { game.phase = "lobby"; snaps.length = 0; }
      if (m.note) showNotice(m.note, true);
      updateScreens();
      break;
    case "match":
      if (!myId) break;
      setupPlayers(m.players);
      applyMatchInfo(m.info);
      snaps.length = 0;
      confetti.length = 0;
      break;
    case "s":
      if (!myId) break;
      onSnapshot(m);
      break;
    case "pong":
      pingMs = Math.round(performance.now() - m.ts);
      break;
    case "error":
      $("homeMsg").textContent = m.msg;
      if (!myId) {
        wantRoom = null;
        try { sessionStorage.removeItem("soccerRoom"); } catch (e) { /* ignore */ }
        if (typeof netFailJoin === "function") netFailJoin();
      }
      break;
  }
}

// Ping every 2 seconds (also tells the server our ping so others see it)
setInterval(() => sendMsg({ t: "ping", ts: performance.now(), rtt: pingMs }), 2000);

// =====================================================================
// D. SNAPSHOTS  (what the server sends ~30 times per second)
// =====================================================================
const snaps = [];               // recent snapshots: {at: local time, s: data}
const INTERP_DELAY = 100;       // draw 100 ms in the past so we can blend

function setupPlayers(info) {
  players = info.map((row) => ({
    team: row[0], role: row[1], num: row[2], skin: row[3], hair: row[4],
    name: row[5] || "", trait: row[6] || "", tall: row[7] || 1, boots: row[8] || "#111111",
    cut: row[9] || "short", captain: !!row[10], star: !!row[11], pos: row[12] || row[1],
    x: 0, y: 0, vx: 0, vy: 0, fx: 1, fy: 0,
    state: "run", fallDir: 1, stamina: 1, sprinting: false, anim: Math.random() * 6,
    yellow: 0, sentOff: false, skill: null, skillT: 0,
  }));
}
// Teams, kits and rules of the match that is starting
function applyMatchInfo(info) {
  if (!info) return;
  game.teams = info.teams; game.rules = info.rules || game.rules;
  game.matchType = info.matchType === "shootout" ? "shootout" : "match";
  game.knockout = !!info.knockout;
  // The host's match is 5:00. A shootout has no clock. 0 must not fall back to 5:00.
  game.timeLimit = game.matchType === "shootout" ? 0 : (Number(info.timeLimit) > 0 ? Number(info.timeLimit) : MATCH_LENGTH);
  if (info.teams) { applyTeamKits(info.teams); renderBackground(); }
}

function onSnapshot(s) {
  const now = performance.now();
  snaps.push({ at: now, s });
  while (snaps.length > 30) snaps.shift();
  // Things that don't need blending: use the newest values
  game.phase = s.ph;
  game.score.blue = s.sc[0]; game.score.red = s.sc[1];
  game.clock = s.cl; game.timer = s.tm;
  game.lastScorer = s.ls; game.winner = s.w;
  if (s.cm) game.comment = { text: s.cm[0], color: s.cm[1], timer: s.cm[2] };
  else game.comment.timer = 0;
  if (s.st) game.stats = s.st;
  // penalty, shootout, celebration, referee popups
  const P = (i) => players[i] || null;
  game.penalty = s.pe ? { team: s.pe[0], taker: P(s.pe[1]), keeper: P(s.pe[2]), aimY: s.pe[3], gkChoice: s.pe[4], dive: s.pe[5] } : null;
  const kicks = (str) => (str ? str.split("").map(Number) : []);
  game.shootout = s.so ? { first: s.so[0], kicks: { blue: kicks(s.so[1]), red: kicks(s.so[2]) }, sudden: !!s.so[3], done: !!s.so[4], winner: s.so[5] } : null;
  game.celebration = s.ce ? { scorer: P(s.ce[0]), type: s.ce[1], t: s.ce[2] } : null;
  game.cardPopup = s.cp ? { team: s.cp[0], idx: s.cp[1], kind: s.cp[2], timer: s.cp[3] } : null;
  game.flag = s.fl ? { team: s.fl[0], idx: s.fl[1], timer: s.fl[2] } : null;
  for (const ev of s.ev || []) playEvent(ev);
  if (s.ph === "win") updateScreens();
}

// Blend between the two snapshots around (now - INTERP_DELAY)
function applyInterpolation(dt) {
  if (!snaps.length || !players.length) return;
  // The host already has the newest picture, so they only wait a tiny bit.
  const target = performance.now() - (netIsHost() ? 45 : INTERP_DELAY);
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) {
    if (snaps[i].at <= target && snaps[i + 1].at >= target) { a = snaps[i]; b = snaps[i + 1]; break; }
  }
  if (target >= b.at) a = b;                 // no newer data yet: hold the newest
  const t = a === b ? 1 : clamp((target - a.at) / (b.at - a.at), 0, 1);
  const A = a.s, B = b.s;

  players.forEach((p, i) => {
    const pa = A.p[i], pb = B.p[i];
    if (!pa || !pb) return;
    const jump = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 60; // teleport (restart)
    p.x = jump ? pb[0] : lerp(pa[0], pb[0], t);
    p.y = jump ? pb[1] : lerp(pa[1], pb[1], t);
    p.vx = pb[2]; p.vy = pb[3];
    const f = normalize(lerp(pa[4], pb[4], t), lerp(pa[5], pb[5], t));
    p.fx = f.x; p.fy = f.y;
    p.state = STATE_NAMES[pb[6]] || "run"; p.fallDir = pb[7];
    p.stamina = pb[8]; p.sprinting = !!pb[9];
    p.yellow = pb[10] || 0; p.sentOff = !!pb[11]; p.skill = SKILL_LIST[pb[12]] || null; p.skillT = pb[13] || 0;
    p.throwT = pb[14] || 0;
    p.anim += Math.hypot(p.vx, p.vy) * dt * 0.09;  // running animation
  });
  const ba = A.b, bb = B.b;
  const jump = Math.hypot(bb[0] - ba[0], bb[1] - ba[1]) > 120;
  ball.x = jump ? bb[0] : lerp(ba[0], bb[0], t);
  ball.y = jump ? bb[1] : lerp(ba[1], bb[1], t);
  ball.z = jump ? bb[2] : lerp(ba[2], bb[2], t);
  ball.vx = bb[3]; ball.vy = bb[4]; ball.owner = bb[5];
  ball.spin += Math.hypot(ball.vx, ball.vy) * dt / BALL_R;

  // Humans + set piece come from the NEWEST snapshot
  const L = snaps[snaps.length - 1].s;

  // Referee and linesmen. The host decides where they are; we blend like the players.
  const Lof = L.of;
  const oa = A.of, ob = B.of;
  if (Lof && oa && ob && Lof.length === 3) {
    if (!game.officials || game.officials.length !== 3) {
      game.officials = [
        { role: "ref", side: "", skin: "#e0ac69", hair: "#111" },
        { role: "ar", side: "near", skin: "#c68642", hair: "#1a1a1a" },
        { role: "ar", side: "far", skin: "#f1c27d", hair: "#2b1b0e" },
      ];
    }
    for (let i = 0; i < 3; i++) {
      const pa = oa[i], pb = ob[i], pl = Lof[i];
      if (!pa || !pb) continue;
      const o = game.officials[i];
      const jump = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 90;
      o.x = jump ? pb[0] : lerp(pa[0], pb[0], t);
      o.y = jump ? pb[1] : lerp(pa[1], pb[1], t);
      o.vx = pb[2]; o.vy = pb[3];
      const f = normalize(lerp(pa[4], pb[4], t), lerp(pa[5], pb[5], t));
      o.fx = f.x; o.fy = f.y;
      o.sig = pl ? pl[6] : pb[6];
      o.anim = pb[7] || 0;
    }
  }

  controllers = L.c.map(([id, ai, charging, held, cpu]) => ({ id, active: players[ai] || null, charging: charging || null, held, cpu: !!cpu }));
  game.setpiece = L.sp ? { type: L.sp[0], team: L.sp[1], taker: players[L.sp[2]] || null, indirect: !!L.sp[3], throwT: L.sp[4] || 0 } : null;
  // the comment countdown keeps running between snapshots
  if (game.comment.timer > 0) game.comment.timer -= dt;
}

// =====================================================================
// E. INPUT  (every device uses the same 1-player keys)
// =====================================================================
const keys = {};
const KEYMAP = {
  up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
  sprint: ["ShiftLeft", "ShiftRight"], shoot: ["Space"], pass: ["KeyE"], swap: ["KeyQ"],
  skill: ["KeyR"], flick: ["KeyF"],
};
const held = (a) => KEYMAP[a].some((k) => keys[k]) || !!touch[a];

window.addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") return;   // typing a name / code
  if (inMatch() && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
  const first = !keys[e.code];
  keys[e.code] = true;
  if (!first || !inMatch()) return;
  if (e.code === "KeyM") { toggleSound(); return; }
  if (e.code === "Escape" || e.code === "KeyP") { toggleMenu(); return; }
  if (e.code === "KeyC" || e.code === "KeyV") { toggleCamera(); return; }
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space", "KeyE", "KeyQ", "KeyR", "KeyF"].includes(e.code)) noteFpFollow(myId);
  if (game.phase === "goal") { sendMsg({ t: "press", a: "skip" }); return; }   // skip the celebration
  for (const a of ["shoot", "pass", "swap", "skill", "flick"]) if (KEYMAP[a].includes(e.code)) sendMsg({ t: "press", a });
  sendInput(true);
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; if (inMatch()) sendInput(true); });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; sendInput(true); });

// Touch joystick + buttons (same as the offline game)
const touch = { x: 0, y: 0, pointerId: null, baseX: 0, baseY: 0, shoot: false, pass: false, sprint: false, skill: false };
const joyZone = $("joyZone"), joyBase = $("joyBase"), joyKnob = $("joyKnob");
const JOY_MAX = 50;
joyZone.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  noteFpFollow(myId);
  if (game.phase === "goal") sendMsg({ t: "press", a: "skip" });
  touch.pointerId = e.pointerId; touch.baseX = e.clientX; touch.baseY = e.clientY;
  joyBase.style.left = (e.clientX - 65) + "px"; joyBase.style.top = (e.clientY - 65) + "px"; joyBase.style.bottom = "auto";
  try { joyZone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  updateJoystick(e);
});
joyZone.addEventListener("pointermove", (e) => { if (e.pointerId === touch.pointerId) updateJoystick(e); });
function releaseJoystick(e) {
  if (e.pointerId !== touch.pointerId) return;
  touch.pointerId = null; touch.x = 0; touch.y = 0; joyKnob.style.transform = "";
  joyBase.style.left = ""; joyBase.style.top = ""; joyBase.style.right = ""; joyBase.style.bottom = "";
  sendInput(true);
}
joyZone.addEventListener("pointerup", releaseJoystick);
joyZone.addEventListener("pointercancel", releaseJoystick);
function updateJoystick(e) {
  let dx = e.clientX - touch.baseX, dy = e.clientY - touch.baseY;
  const len = Math.hypot(dx, dy);
  if (len > JOY_MAX) { dx = dx / len * JOY_MAX; dy = dy / len * JOY_MAX; }
  touch.x = dx / JOY_MAX; touch.y = dy / JOY_MAX;
  if (Math.hypot(touch.x, touch.y) < 0.15) { touch.x = 0; touch.y = 0; }
  joyKnob.style.transform = "translate(" + dx + "px," + dy + "px)";
}
for (const [id, action] of [["shootBtn", "shoot"], ["passBtn", "pass"], ["sprintBtn", "sprint"], ["skillBtn", "skill"]]) {
  const el = $(id);
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    touch[action] = true; el.classList.add("pressed");
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    noteFpFollow(myId);
    if (game.phase === "goal") sendMsg({ t: "press", a: "skip" });
    else if (action !== "sprint") sendMsg({ t: "press", a: action });
    sendInput(true);
  });
  const up = () => { touch[action] = false; el.classList.remove("pressed"); sendInput(true); };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

// Tap one of your teammates to control him. The stick and buttons are
// on top of the picture, so they never count as a tap.
(function bindPitchTap() {
  const el = $("game");
  if (!el) return;
  let down = null;
  el.addEventListener("pointerdown", (e) => {
    if (inMatch() && game.phase === "goal") sendMsg({ t: "press", a: "skip" });
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  });
  el.addEventListener("pointerup", (e) => {
    if (!down || e.pointerId !== down.id) return;
    const start = down;
    down = null;
    if (!touchActive() || !inMatch() || menuOpen || game.phase !== "play") return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 18) return;
    if (performance.now() - start.t > 400) return;
    const me = room && room.members.find((m) => m.id === myId);
    if (!me || !me.team) return;
    const p = playerAtScreen(start.x, start.y, me.team);
    if (!p) return;
    const i = players.indexOf(p);
    if (i < 0) return;
    noteFpFollow(myId);
    sendMsg({ t: "switch", i });
  });
  el.addEventListener("pointercancel", () => { down = null; });
})();

// Send our buttons to the server when they change (and 10x a second anyway)
let lastInput = "", lastInputAt = 0;
function sendInput(force) {
  let mx = 0, my = 0;
  if (held("left")) mx -= 1;
  if (held("right")) mx += 1;
  if (held("up")) my -= 1;
  if (held("down")) my += 1;
  if (!mx && !my && (touch.x || touch.y)) { mx = touch.x; my = touch.y; }
  const stick = cameraStick(mx, my);
  mx = stick.mx; my = stick.my;
  const msg = { t: "input", mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, sprint: held("sprint"), shoot: held("shoot"), pass: held("pass") };
  const str = JSON.stringify(msg);
  const now = performance.now();
  if (str !== lastInput || now - lastInputAt > 100 || force) {
    if (str === lastInput && force && now - lastInputAt < 15) return;
    sendMsg(msg); lastInput = str; lastInputAt = now;
  }
}

