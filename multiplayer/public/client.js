/* =====================================================================
   SOCCER SHOWDOWN 2 - ONLINE  :  client.js  (runs in each browser)
   ---------------------------------------------------------------------
   One device decides what happens in the match (the "host"):
     * the Node server, if a grown-up runs multiplayer/server.js, OR
     * the host player's phone or computer, on the GitHub Pages site.
   Every browser:
     1. shows the lobby (host / join a room, pick a team)
     2. sends its buttons (move, sprint, shoot, pass)
     3. receives snapshots ~30 times a second and draws them smoothly
        (it draws a little "in the past" and blends between two snapshots,
        this is called INTERPOLATION)
     4. plays the sounds and shows the commentary
   Settings, team colours and helpers come from game.js (loaded first).

   Sections:
     A. CLIENT STATE      E. INPUT (keyboard + touch)
     B. SOUND             F. CAMERA
     C. NETWORK           G. DRAWING (same look as the offline game)
     D. SNAPSHOTS         H. SCREENS (lobby, win, menu) + MAIN LOOP
   ===================================================================== */
"use strict";

// =====================================================================
// A. CLIENT STATE
// =====================================================================
// "game" holds what we need to DRAW (filled in from server snapshots)
const game = {
  phase: "lobby", mode: "1v1", difficulty: "normal",
  score: { blue: 0, red: 0 }, clock: 0, timer: 0, time: 0,
  comment: { text: "", timer: 0, color: "#fff" },
  setpiece: null, lastScorer: null, winner: null, stats: null,
  camera: { x: 0, y: 0, cx: PITCH.cx, cy: PITCH.cy, zoom: 1 },
  // match info (sent when a match starts)
  teams: null, rules: { ...DEFAULT_RULES }, winScore: WIN_SCORE, timeLimit: 0, matchType: "match",
  // decoded from snapshots
  penalty: null, shootout: null, celebration: null, cardPopup: null, flag: null,
  muted: false,
};
let players = [];          // drawn players (static look + interpolated position)
const ball = { x: PITCH.cx, y: PITCH.cy, z: 0, vx: 0, vy: 0, spin: 0, owner: -1 };
let controllers = [];      // humans in the match: {id, active (player), charging, held, cpu}
let room = null;           // latest room info from the server
let myId = null;
let pingMs = 0;

const myController = () => controllers.find((c) => c.id === myId) || null;
const myActive = () => { const c = myController(); return c && !c.cpu ? c.active : null; };
const controllerOf = (p) => controllers.find((c) => !c.cpu && c.active === p) || null;
const isHumanControlled = (p) => !!controllerOf(p);
const inMatch = () => ["setpiece", "play", "dead", "goal", "shootout", "pkflight"].includes(game.phase);
const memberName = (id) => { const m = room && room.members.find((x) => x.id === id); return m ? m.name : "?"; };
const isTouchDevice = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && matchMedia("(pointer: coarse)").matches);
const isPortrait = () => {
  const vv = window.visualViewport;
  const w = (vv && vv.width) || window.innerWidth;
  const h = (vv && vv.height) || window.innerHeight;
  return h > w;
};
const touchActive = () => isTouchDevice;
const $ = (id) => document.getElementById(id);

// ---- Hooks the shared drawing code asks for ----
const isLocal = (c) => c.id === myId;
const labelFor = (c) => memberName(c.id);
const showHud = () => !!(room && room.state !== "lobby" && players.length);
const localActives = () => { const a = myActive(); return a ? [a] : []; };
const rosterList = () => players;
function hudSubtitle() {
  const fmt = game.matchType === "shootout" ? "Penalty shootout" : "First to " + game.winScore + " wins!";
  return fmt + "  \u2022  Room " + (room ? room.code : "") + "  \u2022  " + game.mode + " (CPU: " + game.difficulty + ")";
}
function keysHint(kind) {
  const t = touchActive();
  if (kind === "skip") return t ? "Tap to skip" : "Press any key to skip";
  if (kind === "setpiece") return t ? "aim with the joystick, tap PASS or SHOOT" : "aim, then E = pass (hold to lob), Space = shoot";
  if (kind === "penTaker") return t ? "joystick up/down = aim, hold SHOOT = power" : "W/S or \u2191/\u2193 = aim, hold Space = power (too much = over the bar!)";
  if (kind === "penKeeper") return t ? "push the joystick up or down to pick a side" : "press up or down to pick your dive (left/right = stay)";
  return "";
}



// =====================================================================
// SOUND (made in code, no sound files) - shared by offline + online
// =====================================================================

const Sound = {
  ctx: null, master: null, noise: null, crowdGain: null,

  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      // 2 seconds of random "white noise" - the crowd is made from this
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // Background crowd murmur that loops forever
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const band = this.ctx.createBiquadFilter();
      band.type = "bandpass"; band.frequency.value = 500; band.Q.value = 0.6;
      this.crowdGain = this.ctx.createGain();
      this.crowdGain.gain.value = 0.05;
      src.connect(band).connect(this.crowdGain).connect(this.master);
      src.start();
    } catch (e) { this.ctx = null; }
  },
  muted: false,
  setMuted(m) { this.muted = !!m; if (this.master) this.master.gain.value = m ? 0 : 1; },

  // a burst of filtered noise with a volume envelope
  noiseBurst(freq, q, peak, attack, decay) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + attack + decay + 0.05);
  },
  tone(type, f1, f2, vol, dur) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  kick(power) {
    const v = clamp(power / 1000, 0.25, 1);
    this.tone("sine", 160, 50, 0.35 * v, 0.12);     // the "thump"
    this.noiseBurst(2500, 1.5, 0.08 * v, 0.003, 0.04); // the "click"
  },
  whistle(long = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, dur = long ? 0.9 : 0.3;
    const o = this.ctx.createOscillator(), lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain(), g = this.ctx.createGain();
    o.type = "sine"; o.frequency.value = 2900;
    lfo.frequency.value = 28; lfoGain.gain.value = 140; // the "trill"
    lfo.connect(lfoGain).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    g.gain.setValueAtTime(0.09, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); lfo.start(t); o.stop(t + dur); lfo.stop(t + dur);
  },
  cheer() {
    this.noiseBurst(900, 0.5, 0.55, 0.3, 3.2);
    this.noiseBurst(2200, 0.7, 0.25, 0.4, 2.6);
  },
  ooh() { this.noiseBurst(420, 0.8, 0.3, 0.25, 1.2); },
  post() { this.tone("triangle", 1400, 900, 0.15, 0.25); },
  // referee shows a card: two sharp blasts + the crowd reacts
  card(kind) {
    this.whistle(); setTimeout(() => this.whistle(), 220);
    if (kind === 2) this.noiseBurst(300, 0.6, 0.35, 0.2, 1.4); else this.ooh();
  },
  // assistant referee's flag: a short whistle and a groan
  flag() { this.whistle(); this.noiseBurst(350, 0.7, 0.18, 0.15, 0.8); },
  // skill move: a quick "whoosh"
  skill() { this.noiseBurst(1600, 1.2, 0.12, 0.02, 0.25); },
  // big celebration (trophy): long cheer + fanfare
  fanfare() {
    this.cheer();
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone("square", f, f, 0.06, 0.35), i * 160));
  },
};

// Play a sound event that the game logic sent (["kick", 800], ["cheer"] ...)
function playEvent([name, arg]) {
  if (name === "kick") Sound.kick(arg || 600);
  else if (name === "whistleLong") Sound.whistle(true);
  else if (name === "card") Sound.card(arg);
  else if (Sound[name]) Sound[name]();
}


// =====================================================================
// NETWORK TRANSPORT  -  WebSocket to multiplayer/server.js
// The GitHub Pages game uses src/p2p_net.js instead of this file.
// =====================================================================
let ws = null;
let retryMs = 1500, retryTimer = null;
// Shown on the home screen when the online server can't be reached.
const NO_SERVER_MSG = "Can't reach the online server right now - you can still play Offline vs Computer!";

function netLinkUp() { return !!(ws && ws.readyState === 1); }
function netIsHost() { return false; }
function netReset() { /* the socket stays open so you can join another room */ }
function netMarkLeaving() {}
function netDebug() { return { type: "ws", link: netLinkUp() }; }

function connect() {
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  ws = new WebSocket(proto + location.host + "/ws");
  ws.onopen = () => {
    hideNotice();
    retryMs = 1500;
    if ($("homeMsg").textContent === NO_SERVER_MSG) $("homeMsg").textContent = "";
    if (pendingAction) { sendMsg(pendingAction); pendingAction = null; }
    else if (wantRoom && wantRoom.token) sendMsg({ t: "join", code: wantRoom.code, name: wantRoom.name, token: wantRoom.token });
  };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMessage(m); };
  ws.onclose = () => {
    ws = null;
    if (wantRoom) showNotice("Connection lost. Trying again...", false);
    else if (!$("homeMsg").textContent) $("homeMsg").textContent = NO_SERVER_MSG;
    retryTimer = setTimeout(connect, wantRoom || pendingAction ? 1500 : retryMs);
    retryMs = Math.min(retryMs * 1.5, 8000);
  };
  ws.onerror = () => { /* onclose will handle it */ };
}
function sendMsg(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function sendOrQueue(m) {
  if (ws && ws.readyState === 1) { sendMsg(m); return; }
  pendingAction = m;
  if (!ws) { clearTimeout(retryTimer); connect(); }
}

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
  players = info.map(([team, role, num, skin, hair]) => ({
    team, role, num, skin, hair, x: 0, y: 0, vx: 0, vy: 0, fx: 1, fy: 0,
    state: "run", fallDir: 1, stamina: 1, sprinting: false, anim: Math.random() * 6,
    yellow: 0, sentOff: false, skill: null, skillT: 0,
  }));
}
// Teams, kits and rules of the match that is starting
function applyMatchInfo(info) {
  if (!info) return;
  game.teams = info.teams; game.rules = info.rules || game.rules;
  game.winScore = info.winScore || WIN_SCORE; game.timeLimit = info.timeLimit || 0; game.matchType = info.matchType || "match";
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
  controllers = L.c.map(([id, ai, charging, held, cpu]) => ({ id, active: players[ai] || null, charging: charging || null, held, cpu: !!cpu }));
  game.setpiece = L.sp ? { type: L.sp[0], team: L.sp[1], taker: players[L.sp[2]] || null, indirect: !!L.sp[3] } : null;
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
    if (game.phase === "goal") sendMsg({ t: "press", a: "skip" });
    else if (action !== "sprint") sendMsg({ t: "press", a: action });
    sendInput(true);
  });
  const up = () => { touch[action] = false; el.classList.remove("pressed"); sendInput(true); };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

// Send our buttons to the server when they change (and 10x a second anyway)
let lastInput = "", lastInputAt = 0;
function sendInput(force) {
  let mx = 0, my = 0;
  if (held("left")) mx -= 1;
  if (held("right")) mx += 1;
  if (held("up")) my -= 1;
  if (held("down")) my += 1;
  if (!mx && !my && (touch.x || touch.y)) { mx = touch.x; my = touch.y; }
  const msg = { t: "input", mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, sprint: held("sprint"), shoot: held("shoot"), pass: held("pass") };
  const str = JSON.stringify(msg);
  const now = performance.now();
  if (str !== lastInput || now - lastInputAt > 100 || force) {
    if (str === lastInput && force && now - lastInputAt < 15) return;
    sendMsg(msg); lastInput = str; lastInputAt = now;
  }
}


/* =====================================================================
   DRAWING - shared by the offline game and the online client
   ---------------------------------------------------------------------
   Uses the globals game, players, ball, controllers (+ the helpers
   controllerOf, isHumanControlled) and these functions that each
   "shell" (offline / online) provides:
     isLocal(c)       - is this controller a human on THIS device?
     labelFor(c)      - name shown above a human's player
     hudSubtitle()    - the small line under the scoreboard
     showHud()        - draw scoreboard, minimap etc. right now?
     localActives()   - players controlled on this device
     keysHint(kind)   - "how to" text: setpiece | penTaker | penKeeper | skip
     rosterList()     - all players including any sent off
     inMatch(), touchActive()
   ===================================================================== */

// =====================================================================
// CAMERA (follows the ball; zooms in on the goal scorer)
// =====================================================================
let VIEW_W = 1000, VIEW_H = 640; // size of the visible area in world pixels (set by resize)

function updateCamera(dt, snap = false) {
  const c = game.camera;
  if (c.zoom === undefined) c.zoom = 1;
  let tx = ball.x + ball.vx * 0.25, ty = ball.y - ball.z * 0.5 + ball.vy * 0.2;
  let zoom = 1;
  const ce = game.celebration;
  if (game.phase === "goal" && ce && ce.scorer && ce.t > 0.9) { tx = ce.scorer.x; ty = ce.scorer.y - 20; zoom = 1.35; }
  if (game.penalty && (game.phase === "setpiece" || game.phase === "shootout")) {
    // penalty: show the taker and the goal
    const A = TEAMS[game.penalty.team];
    tx = A.targetGoalX - A.dir * 120; ty = PITCH.cy; zoom = 1.15;
  }
  if (game.phase === "pkflight") { zoom = 1.15; }
  if (game.phase === "lobby") { tx = PITCH.cx; ty = PITCH.cy; }
  const k = snap ? 1 : Math.min(1, dt * 3);
  c.zoom += (zoom - c.zoom) * (snap ? 1 : Math.min(1, dt * 2.2));
  c.cx += (tx - c.cx) * k;
  c.cy += (ty - c.cy) * k;
  const vw = VIEW_W / c.zoom, vh = VIEW_H / c.zoom;
  c.x = vw >= WORLD_W ? (WORLD_W - vw) / 2 : clamp(c.cx - vw / 2, 0, WORLD_W - vw);
  c.y = vh >= WORLD_H ? (WORLD_H - vh) / 2 : clamp(c.cy - vh / 2, 0, WORLD_H - vh);
}

// =====================================================================
// THE STADIUM, PLAYERS AND BALL
// =====================================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Pseudo-3D projection: things higher up (z) are drawn further up the
// screen and slightly to the right. Used for the ball and the goals.
const proj = (x, y, z) => ({ x: x + z * 0.3, y: y - z * 0.85 });

// ---- The stadium + pitch never change, so we paint them ONCE into a
// hidden canvas and copy it every frame (much faster). ----
const BG_SCALE = 1.5;
const bg = document.createElement("canvas");

function renderBackground() {
  bg.width = WORLD_W * BG_SCALE; bg.height = WORLD_H * BG_SCALE;
  const g = bg.getContext("2d");
  g.scale(BG_SCALE, BG_SCALE);
  const rnd = mulberry32(7);

  // Stands (concrete steps)
  g.fillStyle = "#23272e"; g.fillRect(0, 0, WORLD_W, WORLD_H);
  for (let i = 0; i < STANDS; i += 7) {
    g.strokeStyle = (i / 7) % 2 ? "#2d323a" : "#1c2026"; g.lineWidth = 7;
    g.strokeRect(i + 3.5, i + 3.5, WORLD_W - 2 * i - 7, WORLD_H - 2 * i - 7);
  }
  // Crowd: thousands of tiny fans (blue fans on the left, red on the right)
  const colors = ["#ffffff", "#ffd33d", "#222222", "#2ecc40", "#999999", "#ff8c00"];
  const skins = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
  for (let y = 3; y < WORLD_H - 6; y += 7) {
    for (let x = 3; x < WORLD_W - 6; x += 7) {
      const inStand = x < STANDS - 6 || x > WORLD_W - STANDS || y < STANDS - 6 || y > WORLD_H - STANDS;
      if (!inStand || rnd() < 0.12) continue;
      const teamColor = x < WORLD_W / 2 ? TEAMS.blue.kit.shirt : TEAMS.red.kit.shirt;  // home fans on each side
      g.fillStyle = rnd() < 0.6 ? teamColor : colors[Math.floor(rnd() * colors.length)];
      const jx = x + rnd() * 2 - 1;
      g.fillRect(jx, y + 2.5, 5, 3.5);
      g.fillStyle = skins[Math.floor(rnd() * skins.length)];
      g.beginPath(); g.arc(jx + 2.5, y + 1.2, 1.8, 0, Math.PI * 2); g.fill();
    }
  }
  // Advertising boards
  const ads = [["SOCCER SHOWDOWN", "#0d47a1"], ["FIRST TO 5", "#b71c1c"], ["GOAL!", "#1b5e20"], ["FAIR PLAY", "#4a148c"], ["SUPER CUP", "#e65100"]];
  const b0 = STANDS, b1 = STANDS + 10;
  g.font = "bold 8px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  let k = 0;
  for (let x = b0; x < WORLD_W - b0; x += 160, k++) {
    for (const yy of [b0, WORLD_H - b1]) {
      const [txt, col] = ads[k % ads.length];
      g.fillStyle = col; g.fillRect(x, yy, 160, 10);
      g.fillStyle = "#fff"; g.fillText(txt, x + 80, yy + 5.5);
    }
  }
  for (let y = b1; y < WORLD_H - b1; y += 160, k++) {
    for (const xx of [b0, WORLD_W - b1]) {
      const [txt, col] = ads[k % ads.length];
      g.fillStyle = col; g.fillRect(xx, y, 10, Math.min(160, WORLD_H - b1 - y));
      g.save(); g.translate(xx + 5, y + 80); g.rotate(Math.PI / 2); g.fillStyle = "#fff"; g.fillText(txt, 0, 0.5); g.restore();
    }
  }

  // Grass with mowed stripes (vertical) + faint cross-cut (horizontal)
  const gx = b1, gy = b1, gw = WORLD_W - 2 * b1, gh = WORLD_H - 2 * b1;
  g.save();
  g.beginPath(); g.rect(gx, gy, gw, gh); g.clip();
  const sw = PITCH.w / 14;
  for (let i = -3; i < 17; i++) {
    g.fillStyle = i % 2 ? "#2f8f3f" : "#287f37";
    g.fillRect(PITCH.left + i * sw, gy, sw + 1, gh);
  }
  g.fillStyle = "rgba(0,0,0,0.05)";
  const sh = PITCH.h / 8;
  for (let j = -2; j < 10; j += 2) g.fillRect(gx, PITCH.top + j * sh, gw, sh);
  // tiny dark specks so the grass doesn't look flat
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.04)";
    g.fillRect(gx + rnd() * gw, gy + rnd() * gh, 2, 1);
  }
  g.restore();

  // Pitch markings
  g.strokeStyle = "rgba(255,255,255,0.92)"; g.fillStyle = "rgba(255,255,255,0.92)"; g.lineWidth = 3;
  g.strokeRect(PITCH.left, PITCH.top, PITCH.w, PITCH.h);
  g.beginPath(); g.moveTo(PITCH.cx, PITCH.top); g.lineTo(PITCH.cx, PITCH.bottom); g.stroke();
  g.beginPath(); g.arc(PITCH.cx, PITCH.cy, CIRCLE_R, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(PITCH.cx, PITCH.cy, 4, 0, Math.PI * 2); g.fill();
  for (const s of [1, -1]) {
    const L = s === 1 ? PITCH.left : PITCH.right;
    g.strokeRect(s === 1 ? L : L - BOX.depth, PITCH.cy - BOX.width / 2, BOX.depth, BOX.width);
    g.strokeRect(s === 1 ? L : L - SIX.depth, PITCH.cy - SIX.width / 2, SIX.depth, SIX.width);
    const spotX = L + s * PEN_SPOT;
    g.beginPath(); g.arc(spotX, PITCH.cy, 3.5, 0, Math.PI * 2); g.fill();
    // the "D": only the part of the circle outside the box
    const a = Math.acos((BOX.depth - PEN_SPOT) / CIRCLE_R);
    g.beginPath();
    if (s === 1) g.arc(spotX, PITCH.cy, CIRCLE_R, -a, a);
    else g.arc(spotX, PITCH.cy, CIRCLE_R, Math.PI - a, Math.PI + a);
    g.stroke();
  }
  // Corner arcs and flags
  const corners = [[PITCH.left, PITCH.top, 0], [PITCH.right, PITCH.top, Math.PI / 2], [PITCH.right, PITCH.bottom, Math.PI], [PITCH.left, PITCH.bottom, -Math.PI / 2]];
  for (const [cx, cy, a] of corners) {
    g.beginPath(); g.arc(cx, cy, 18, a, a + Math.PI / 2); g.stroke();
    g.strokeStyle = "#eee"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - 20); g.stroke();
    g.fillStyle = "#ffd33d";
    g.beginPath(); g.moveTo(cx, cy - 20); g.lineTo(cx + 10, cy - 16); g.lineTo(cx, cy - 12); g.closePath(); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.92)"; g.fillStyle = "rgba(255,255,255,0.92)"; g.lineWidth = 3;
  }
}

// Draw a net panel: a 4-corner shape filled see-through, with mesh lines
function netQuad(a, b, c, d, nu, nv) {
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.38)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= nu; i++) {
    const t = i / nu;
    ctx.moveTo(lerp(a.x, b.x, t), lerp(a.y, b.y, t)); ctx.lineTo(lerp(d.x, c.x, t), lerp(d.y, c.y, t));
  }
  for (let j = 0; j <= nv; j++) {
    const t = j / nv;
    ctx.moveTo(lerp(a.x, d.x, t), lerp(a.y, d.y, t)); ctx.lineTo(lerp(b.x, c.x, t), lerp(b.y, c.y, t));
  }
  ctx.stroke();
}

// Parts of the goal BEHIND the players (back net, far side net, roof)
function drawGoalBack(side) {
  const L = side === "left" ? PITCH.left : PITCH.right;
  const bx = L + (side === "left" ? -GOAL_DEPTH : GOAL_DEPTH);
  const bh = CROSSBAR * 0.6;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(Math.min(L, bx), GOAL_TOP, GOAL_DEPTH, GOAL_W);
  netQuad(proj(bx, GOAL_TOP, 0), proj(bx, GOAL_TOP, bh), proj(bx, GOAL_BOTTOM, bh), proj(bx, GOAL_BOTTOM, 0), 3, 16); // back
  netQuad(proj(L, GOAL_TOP, 0), proj(L, GOAL_TOP, CROSSBAR), proj(bx, GOAL_TOP, bh), proj(bx, GOAL_TOP, 0), 4, 4); // far side
  netQuad(proj(L, GOAL_TOP, CROSSBAR), proj(L, GOAL_BOTTOM, CROSSBAR), proj(bx, GOAL_BOTTOM, bh), proj(bx, GOAL_TOP, bh), 16, 4); // roof
}
// Parts IN FRONT of the players (near side net, posts, crossbar)
function drawGoalFront(side) {
  const L = side === "left" ? PITCH.left : PITCH.right;
  const bx = L + (side === "left" ? -GOAL_DEPTH : GOAL_DEPTH);
  const bh = CROSSBAR * 0.6;
  netQuad(proj(L, GOAL_BOTTOM, 0), proj(L, GOAL_BOTTOM, CROSSBAR), proj(bx, GOAL_BOTTOM, bh), proj(bx, GOAL_BOTTOM, 0), 4, 4);
  const p1 = proj(L, GOAL_TOP, 0), p2 = proj(L, GOAL_TOP, CROSSBAR), p3 = proj(L, GOAL_BOTTOM, CROSSBAR), p4 = proj(L, GOAL_BOTTOM, 0);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(p1.x + 2, p1.y + 2); ctx.lineTo(p2.x + 2, p2.y + 2); ctx.lineTo(p3.x + 2, p3.y + 2); ctx.lineTo(p4.x + 2, p4.y + 2); ctx.stroke();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.stroke();
  ctx.lineCap = "butt";
}

// What a player is doing after a goal: null, "slide", "spin", "plane", "arms"
function celebrationPose(p) {
  const ce = game.celebration;
  if (game.phase !== "goal" || !ce || !ce.scorer) return null;
  if (p === ce.scorer) {
    const arrived = Math.hypot(p.vx, p.vy) < 60 || ce.t > 2.6;
    if (ce.type === "plane") return "plane";
    if (!arrived || ce.t < 0.6) return "arms";
    return ce.type === "pile" ? "arms" : ce.type;
  }
  return p.team === ce.scorer.team && p.role !== "GK" ? "arms" : null;
}

function drawPlayer(p) {
  const T = TEAMS[p.team];
  const kit = p.role === "GK" ? T.gk : T.kit;
  const speed = Math.hypot(p.vx, p.vy);
  let run = speed > 15 ? Math.sin(p.anim) : 0;
  const lying = p.state !== "run";
  const pose = celebrationPose(p);
  const ce = game.celebration;

  ctx.save();
  ctx.translate(p.x, p.y);
  // skill move effects on the grass
  if (p.skill === "spin") { ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -14, 18, game.time * 14, game.time * 14 + 4); ctx.stroke(); }
  if (p.skill === "burst" || p.burst > 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = -1; i <= 1; i++) { ctx.moveTo(-p.fx * 14 + i * p.fy * 6, -12 - p.fx * i * 6); ctx.lineTo(-p.fx * 34 + i * p.fy * 6, -12 - p.fx * i * 6 - p.fy * 20); }
    ctx.stroke();
  }
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ctx.ellipse(lying ? p.fallDir * 8 : 2, 1, lying ? 16 : 10, 4.5, 0, 0, Math.PI * 2); ctx.fill();

  // Controlled-player ring on the grass
  const hc = controllerOf(p);
  if (hc) {
    const mine = isLocal(hc);
    ctx.strokeStyle = mine ? "#ffd33d" : "rgba(255,255,255,0.85)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, 1, 15, 6.5, 0, 0, Math.PI * 2); ctx.stroke();
    // facing arrow on the ground
    ctx.fillStyle = mine ? "#ffd33d" : "rgba(255,255,255,0.85)";
    const ax = p.fx * 22, ay = p.fy * 10;
    ctx.beginPath();
    ctx.moveTo(ax + p.fx * 7, ay + p.fy * 3.5);
    ctx.lineTo(ax - p.fy * 5, ay + p.fx * 2.5);
    ctx.lineTo(ax + p.fy * 5, ay - p.fx * 2.5);
    ctx.closePath(); ctx.fill();
  }

  if (lying) ctx.rotate(p.fallDir * (p.state === "slide" ? 1.2 : 1.45)); // sliding / diving / fallen
  const S = 1.15; ctx.scale(S, S);
  const fx = Math.abs(p.fx) > 0.3 ? Math.sign(p.fx) : 0;
  // celebrations: knee slide = sink down; "backflip" = flip over in the air
  let kneel = false;
  if (pose === "slide") { kneel = true; ctx.translate(0, 7); ctx.rotate(-fx * 0.15); run = 0; }
  if (pose === "spin") {
    const a = (ce.t * 5) % (Math.PI * 2);
    ctx.translate(0, -Math.abs(Math.sin(a / 2)) * 22 - 14); ctx.rotate(a); ctx.translate(0, 14); run = 0;
  }
  if (p.skill === "spin") ctx.scale(Math.cos(game.time * 18), 1);               // roulette: turn around
  if (p.skill === "stepover") run = Math.sin(game.time * 30) * 1.2;             // feet dancing over the ball

  // legs (socks + boots) swinging while running
  const sw = run * 5;
  ctx.strokeStyle = kit.socks; ctx.lineWidth = 3.6; ctx.lineCap = "round";
  if (kneel) {
    // on his knees: legs folded back
    ctx.beginPath(); ctx.moveTo(-3, -11); ctx.lineTo(-3 - fx * 7, -7); ctx.moveTo(3, -11); ctx.lineTo(3 - fx * 7, -7); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-3, -11); ctx.lineTo(-3 + sw * (fx || 0.4), -1 + (fx ? 0 : sw * 0.3));
    ctx.moveTo(3, -11); ctx.lineTo(3 - sw * (fx || 0.4), -1 - (fx ? 0 : sw * 0.3));
    ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.arc(-3 + sw * (fx || 0.4), -0.5, 2, 0, Math.PI * 2); ctx.arc(3 - sw * (fx || 0.4), -0.5, 2, 0, Math.PI * 2); ctx.fill();
  }
  // shorts
  ctx.fillStyle = kit.shorts;
  ctx.fillRect(-6, -16, 12, 6);
  // arms
  ctx.strokeStyle = p.skin; ctx.lineWidth = 2.8;
  ctx.beginPath();
  if (pose === "plane") {           // airplane: arms out wide
    ctx.moveTo(-7, -25); ctx.lineTo(-20, -24 + Math.sin(game.time * 6) * 3);
    ctx.moveTo(7, -25); ctx.lineTo(20, -24 - Math.sin(game.time * 6) * 3);
  } else if (pose) {                // arms up in the air
    const w = Math.sin(game.time * 10 + p.num) * 2;
    ctx.moveTo(-7, -25); ctx.lineTo(-11, -37 + w);
    ctx.moveTo(7, -25); ctx.lineTo(11, -37 - w);
  } else {
    ctx.moveTo(-7, -25); ctx.lineTo(-9 - sw * 0.5 * (fx || 0.3), -17);
    ctx.moveTo(7, -25); ctx.lineTo(9 + sw * 0.5 * (fx || 0.3), -17);
  }
  ctx.stroke();
  if (p.role === "GK" && !pose) { // gloves
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(-9 - sw * 0.5 * (fx || 0.3), -17, 2.3, 0, Math.PI * 2); ctx.arc(9 + sw * 0.5 * (fx || 0.3), -17, 2.3, 0, Math.PI * 2); ctx.fill();
  }
  // shirt
  ctx.fillStyle = kit.shirt;
  roundRect(ctx, -7.5, -28, 15, 13, 3.5); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1; ctx.stroke();
  // number
  ctx.fillStyle = kit.number; ctx.font = "bold 8px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(String(p.num), 0, -21);
  // head + hair
  ctx.fillStyle = p.skin;
  ctx.beginPath(); ctx.arc(0, -33, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.hair;
  ctx.beginPath();
  if (p.fy < -0.5) ctx.arc(0, -33, 5.2, 0, Math.PI * 2);              // seen from behind
  else ctx.arc(fx * -0.8, -34, 5.2, Math.PI * 1.05, Math.PI * 1.95);  // seen from front / side
  ctx.fill();
  ctx.restore();
  // booked players carry a little yellow card above their head
  if (p.yellow > 0 && !p.sentOff && !lying) {
    ctx.fillStyle = "#ffd33d"; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1;
    ctx.fillRect(p.x + 8, p.y - 47, 5, 7); ctx.strokeRect(p.x + 8, p.y - 47, 5, 7);
  }
}

// Name label, stamina and power bar above a human-controlled player
function drawPlayerHud(p, c) {
  const mine = isLocal(c);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold 11px Arial";
  const label = labelFor(c);
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.strokeText(label, p.x, p.y - 50);
  ctx.fillStyle = mine ? "#ffd33d" : TEAMS[p.team].ui;
  ctx.fillText(label, p.x, p.y - 50);
  if (mine) {
    // stamina bar under the feet (only for you)
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(p.x - 15, p.y + 9, 30, 4);
    ctx.fillStyle = p.stamina > 0.3 ? "#2ecc40" : "#ff5a36";
    ctx.fillRect(p.x - 15, p.y + 9, 30 * p.stamina, 4);
  }
  // power bar while charging a kick (everyone can see it)
  if (c.charging) {
    const ch = clamp(c.held / CHARGE_TIME, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(p.x - 22, p.y - 64, 44, 7);
    ctx.fillStyle = ch < 0.5 ? "#ffd33d" : ch < 0.85 ? "#ff9f1c" : "#ff3b3b";
    ctx.fillRect(p.x - 21, p.y - 63, 42 * ch, 5);
    // penalty: the end of the bar is the danger zone (it can fly over the bar!)
    if (game.penalty && game.penalty.taker === p) {
      ctx.fillStyle = "rgba(255,59,59,0.45)"; ctx.fillRect(p.x - 21 + 42 * PEN_RISKY, p.y - 63, 42 * (1 - PEN_RISKY), 5);
    }
    if (c.charging === "pass" && c.held >= TAP_TIME) { ctx.fillStyle = "#fff"; ctx.font = "bold 9px Arial"; ctx.fillText("LOB", p.x, p.y - 71); }
  }
}

function drawBall() {
  const z = ball.z;
  // shadow on the grass (smaller + fainter when the ball is high)
  ctx.fillStyle = "rgba(0,0,0," + clamp(0.35 - z / 300, 0.08, 0.35) + ")";
  const sr = BALL_R * clamp(1 - z / 250, 0.5, 1);
  ctx.beginPath(); ctx.ellipse(ball.x + 2, ball.y + 2, sr * 1.2, sr * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  const s = proj(ball.x, ball.y, z + BALL_R * 0.6);
  const r = BALL_R * (1 + z / 400);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.save(); ctx.clip();
  // black patches that rotate as the ball rolls
  ctx.rotate(ball.spin);
  ctx.fillStyle = "#222";
  polygon(0, 0, r * 0.38, 5);
  for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; polygon(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.35, 5); }
  ctx.restore();
  // shading + highlight to look round
  const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  grad.addColorStop(0, "rgba(255,255,255,0.5)"); grad.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.restore();
}

function polygon(x, y, r, n) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / n; ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath(); ctx.fill();
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// Celebrating fans waving flags in the stands after a goal
function drawCrowdCelebration() {
  if (game.phase !== "goal") return;
  ctx.fillStyle = TEAMS[game.lastScorer].kit.shirt;
  for (let i = 0; i < 160; i++) {
    const edge = Math.floor(Math.random() * 4);
    const a = Math.random(), b = Math.random() * (STANDS - 8) + 2;
    const x = edge < 2 ? a * WORLD_W : (edge === 2 ? b : WORLD_W - b);
    const y = edge < 2 ? (edge === 0 ? b : WORLD_H - b) : a * WORLD_H;
    ctx.fillRect(x, y, 6, 4);
  }
}


function drawScoreboard() {
  const w = 330, x = VIEW_W / 2 - w / 2, y = 8 + screenPad().top;
  ctx.fillStyle = "rgba(10,14,20,0.82)";
  roundRect(ctx, x, y, w, 40, 8); ctx.fill();
  ctx.fillStyle = TEAMS.blue.kit.shirt; ctx.fillRect(x + 8, y + 8, 8, 24);
  ctx.fillStyle = TEAMS.red.kit.shirt; ctx.fillRect(x + 232, y + 8, 8, 24);
  ctx.textBaseline = "middle"; ctx.font = "bold 20px Arial";
  ctx.textAlign = "left"; ctx.fillStyle = "#fff";
  ctx.fillText(TEAMS.blue.short || "BLU", x + 22, y + 21);
  ctx.textAlign = "right"; ctx.fillText(TEAMS.red.short || "RED", x + 226, y + 21);
  ctx.textAlign = "center"; ctx.font = "bold 24px Arial"; ctx.fillStyle = "#ffd33d";
  ctx.fillText(game.score.blue + " - " + game.score.red, x + 125, y + 21);
  // clock (cup matches count DOWN)
  ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(x + 250, y + 6, 72, 28);
  ctx.fillStyle = "#fff"; ctx.font = "bold 17px monospace";
  const left = game.timeLimit ? Math.max(0, game.timeLimit - game.clock) : 0;
  if (game.timeLimit && left < 30) ctx.fillStyle = "#ff9f1c";
  ctx.fillText(game.matchType === "shootout" || game.shootout ? "PENS" : formatClock(game.timeLimit ? Math.ceil(left) : game.clock), x + 286, y + 21);
  // cards: little yellow / red cards next to each team code
  ctx.font = "bold 20px Arial";
  drawTeamCards("blue", x + 22 + ctx.measureText(TEAMS.blue.short || "BLU").width + 5, y + 14, 1);
  drawTeamCards("red", x + 226 - ctx.measureText(TEAMS.red.short || "RED").width - 5, y + 14, -1);
  ctx.font = "bold 12px Arial"; ctx.textAlign = "center";
  const sub = hudSubtitle();
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.strokeText(sub, VIEW_W / 2, y + 52);
  ctx.fillStyle = "#fff"; ctx.fillText(sub, VIEW_W / 2, y + 52);
  if (game.shootout) drawShootoutDots(VIEW_W / 2, y + 72);
}
// Card counts for one team: one small card per booking / sending-off
function drawTeamCards(team, x, y, dir) {
  let i = 0;
  for (const p of rosterList()) {
    if (p.team !== team) continue;
    const cards = p.sentOff ? ["#ff3b3b"] : p.yellow ? ["#ffd33d"] : [];
    for (const col of cards) {
      const cx = x + dir * i * 9 - (dir < 0 ? 7 : 0);
      ctx.fillStyle = col; ctx.fillRect(cx, y, 7, 11);
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.strokeRect(cx, y, 7, 11);
      i++;
    }
  }
}
// Penalty shootout scoreboard: a dot per kick (green = scored, red = missed)
function drawShootoutDots(cx, y) {
  const so = game.shootout;
  const n = Math.max(SHOOTOUT_KICKS, so.kicks.blue.length, so.kicks.red.length);
  const w = 120 + n * 18;
  ctx.fillStyle = "rgba(10,14,20,0.82)"; roundRect(ctx, cx - w / 2, y - 4, w, 46, 8); ctx.fill();
  ctx.font = "bold 13px Arial"; ctx.textBaseline = "middle";
  ["blue", "red"].forEach((t, row) => {
    const yy = y + 9 + row * 20;
    ctx.textAlign = "left"; ctx.fillStyle = TEAMS[t].ui; ctx.fillText(TEAMS[t].short, cx - w / 2 + 10, yy);
    for (let i = 0; i < n; i++) {
      const k = so.kicks[t][i];
      ctx.beginPath(); ctx.arc(cx - w / 2 + 62 + i * 18, yy, 6, 0, Math.PI * 2);
      if (k === undefined) { ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.5; ctx.stroke(); }
      else { ctx.fillStyle = k ? "#2ecc40" : "#ff3b3b"; ctx.fill(); }
    }
    ctx.textAlign = "right"; ctx.fillStyle = "#fff";
    ctx.fillText(String(so.kicks[t].reduce((a, b) => a + b, 0)), cx + w / 2 - 10, yy);
  });
  if (so.sudden) {
    ctx.textAlign = "center"; ctx.fillStyle = "#ff9f1c"; ctx.font = "bold 12px Arial";
    ctx.fillText("SUDDEN DEATH", cx, y + 52);
  }
}

function drawCommentary() {
  const c = game.comment;
  if (c.timer > 0 && c.text) {
    const alpha = clamp(c.timer / 0.4, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.font = "bold 24px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(c.text).width + 30;
    const cy = (game.shootout ? 150 : 68) + screenPad().top;     // below the shootout dots, clear of the notch
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, VIEW_W / 2 - w / 2, cy, w, 34, 8); ctx.fill();
    ctx.fillStyle = c.color; ctx.fillText(c.text, VIEW_W / 2, cy + 18);
    ctx.globalAlpha = 1;
  }
  if (game.phase === "goal") {
    const t = game.celebration ? game.celebration.t : GOAL_CELEBRATION_TIME - game.timer;
    if (t < 2.2) {
      const size = Math.round(110 * (1 + Math.max(0, 0.35 - t) * 1.5));
      ctx.globalAlpha = clamp((2.2 - t) / 0.4, 0, 1);
      ctx.font = "bold " + size + "px Arial"; ctx.textAlign = "center";
      ctx.lineWidth = 10; ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText("GOAL!", VIEW_W / 2, VIEW_H / 2 - 20);
      ctx.fillStyle = "#ffd33d"; ctx.fillText("GOAL!", VIEW_W / 2, VIEW_H / 2 - 20);
      ctx.globalAlpha = 1;
    }
    if (game.timer > 1) hintBox(keysHint("skip"), VIEW_H - 190, 13);
  }
  // Tell a human what to do at their set piece / penalty
  const mine = localActives();
  const pen = game.penalty;
  if (pen && (game.phase === "setpiece" || game.phase === "shootout")) {
    if (mine.includes(pen.taker)) hintBox("PENALTY: " + keysHint("penTaker"), VIEW_H - 190);
    else if (mine.includes(pen.keeper)) hintBox("YOU'RE IN GOAL: " + keysHint("penKeeper"), VIEW_H - 190);
  } else if (game.phase === "setpiece") {
    const sp = game.setpiece;
    if (sp && sp.taker && mine.includes(sp.taker)) {
      const names = { kickoff: "Kick off", throw: "Throw-in", corner: "Corner", goalkick: "Goal kick", free: sp.indirect ? "Indirect free kick (pass first!)" : "Free kick" };
      hintBox(names[sp.type] + ": " + keysHint("setpiece"), VIEW_H - 190);
    }
  }
}
function hintBox(txt, y, size = 15) {
  if (!txt) return;
  ctx.font = "bold " + size + "px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(txt).width + 24;
  ctx.fillStyle = "rgba(0,0,0,0.6)"; roundRect(ctx, VIEW_W / 2 - w / 2, y, w, size + 11, 6); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.fillText(txt, VIEW_W / 2, y + (size + 11) / 2);
}

// ---- The referee shows a card / the assistant raises his flag ----
function drawRefPopups() {
  const cp = game.cardPopup;
  if (cp) {
    const p = rosterList()[cp.idx];
    const k = clamp((3 - cp.timer) / 0.25, 0, 1);       // pop in
    const cx = VIEW_W / 2, cy = VIEW_H / 2 - 40;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k);
    ctx.fillStyle = "rgba(0,0,0,0.6)"; roundRect(ctx, -150, -70, 300, 140, 14); ctx.fill();
    // the card itself, held up and tilted
    ctx.save(); ctx.translate(-80, 0); ctx.rotate(-0.15);
    ctx.fillStyle = cp.kind === "yellow" ? "#ffd33d" : "#ff2d2d";
    roundRect(ctx, -26, -42, 52, 76, 6); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 2; ctx.stroke();
    if (cp.kind === "second") { ctx.fillStyle = "#ffd33d"; roundRect(ctx, -34, -36, 52, 76, 6); ctx.fill(); ctx.fillStyle = "#ff2d2d"; roundRect(ctx, -20, -48, 52, 76, 6); ctx.fill(); }
    ctx.restore();
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff";
    ctx.font = "bold 24px Arial";
    ctx.fillText(cp.kind === "yellow" ? "YELLOW CARD" : "RED CARD", -40, -26);
    ctx.font = "bold 16px Arial"; ctx.fillStyle = TEAMS[cp.team].ui;
    ctx.fillText("#" + (p ? p.num : "?") + "  " + TEAMS[cp.team].short, -40, 4);
    ctx.font = "13px Arial"; ctx.fillStyle = "#ddd";
    ctx.fillText(cp.kind === "yellow" ? "Booked! Careful now..." : cp.kind === "second" ? "Second yellow - sent off!" : "Sent off! A player down.", -40, 30);
    ctx.restore();
  }
  const fl = game.flag;
  if (fl) {
    const p = rosterList()[fl.idx];
    const x = VIEW_W - 300, y = 110;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; roundRect(ctx, x, y, 280, 64, 10); ctx.fill();
    // linesman's flag waving
    const wave = Math.sin(game.time * 12) * 4;
    ctx.strokeStyle = "#ddd"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 22, y + 56); ctx.lineTo(x + 22, y + 10); ctx.stroke();
    ctx.fillStyle = "#ffd33d"; ctx.fillRect(x + 22, y + 10, 24, 16 + wave * 0.3);
    ctx.fillStyle = "#ff3b3b"; ctx.fillRect(x + 22, y + 10, 12, 8 + wave * 0.15); ctx.fillRect(x + 34, y + 18 + wave * 0.15, 12, 8);
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "bold 20px Arial"; ctx.fillStyle = "#fff"; ctx.fillText("OFFSIDE!", x + 60, y + 22);
    ctx.font = "13px Arial"; ctx.fillStyle = TEAMS[fl.team].ui;
    ctx.fillText("#" + (p ? p.num : "?") + " " + TEAMS[fl.team].short + " - indirect free kick", x + 60, y + 44);
  }
}

// ---- Penalty helpers drawn on the pitch: aim marker + goalie's choice ----
function drawPenaltyWorld() {
  const pen = game.penalty;
  if (!pen || !(game.phase === "setpiece" || game.phase === "shootout")) return;
  const mine = localActives();
  const A = TEAMS[pen.team];
  const gx = A.targetGoalX;
  // Only the taker sees where he is aiming (unless both humans share this screen)
  if (mine.includes(pen.taker) && !mine.includes(pen.keeper)) {
    const s = proj(gx, pen.aimY, CROSSBAR * 0.4);
    ctx.strokeStyle = "#ffd33d"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.moveTo(s.x - 14, s.y); ctx.lineTo(s.x + 14, s.y); ctx.moveTo(s.x, s.y - 14); ctx.lineTo(s.x, s.y + 14); ctx.stroke();
    ctx.setLineDash([5, 6]); ctx.strokeStyle = "rgba(255,211,61,0.5)";
    ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(gx, pen.aimY); ctx.stroke(); ctx.setLineDash([]);
  }
  // The goalie sees which way he will dive
  if (mine.includes(pen.keeper) && !mine.includes(pen.taker)) {
    const k = pen.keeper;
    ctx.fillStyle = "rgba(90,200,255,0.9)";
    const d = pen.gkChoice;
    ctx.save(); ctx.translate(k.x, k.y - 14);
    if (d === 0) { ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(0, d * 40); ctx.lineTo(-9, d * 22); ctx.lineTo(9, d * 22); ctx.closePath(); ctx.fill(); ctx.fillRect(-3, d > 0 ? 6 : -22, 6, 16); }
    ctx.restore();
  }
}

// ---- Confetti (goals + shootout winner) ----
const confetti = [];
let lastConfettiTime = 0, confettiFor = null;
function updateConfetti() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - (lastConfettiTime || now));
  lastConfettiTime = now;
  const key = game.phase === "goal" && game.celebration ? "goal" + game.score.blue + "-" + game.score.red
            : game.phase === "win" && game.winner ? "win" : null;
  if (key && key !== confettiFor) {
    confettiFor = key;
    const team = key === "win" ? game.winner : game.lastScorer;
    const cols = [TEAMS[team].kit.shirt, TEAMS[team].kit.shorts, "#ffd33d", "#ffffff"];
    for (let i = 0; i < 160; i++) {
      confetti.push({ x: Math.random() * VIEW_W, y: -20 - Math.random() * VIEW_H * 0.6, vx: (Math.random() - 0.5) * 60, vy: 80 + Math.random() * 120,
                      r: Math.random() * 6, vr: (Math.random() - 0.5) * 10, c: cols[i % cols.length], w: 5 + Math.random() * 5 });
    }
  }
  if (!key) confettiFor = null;
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.x += c.vx * dt + Math.sin(now * 3 + i) * 0.6; c.y += c.vy * dt; c.r += c.vr * dt;
    if (c.y > VIEW_H + 20) confetti.splice(i, 1);
  }
}
function drawConfetti() {
  for (const c of confetti) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.scale(1, Math.abs(Math.cos(c.r * 2)) + 0.2);
    ctx.fillStyle = c.c; ctx.fillRect(-c.w / 2, -2, c.w, 4); ctx.restore();
  }
}

function drawMinimap() {
  const mw = 190, mh = mw * PITCH.h / PITCH.w;
  const mx = VIEW_W / 2 - mw / 2, my = VIEW_H - mh - 10 - screenPad().bottom;
  const sx = (x) => mx + (x - PITCH.left) / PITCH.w * mw;
  const sy = (y) => my + (y - PITCH.top) / PITCH.h * mh;
  ctx.fillStyle = "rgba(0,40,10,0.6)"; ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
  ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1;
  ctx.strokeRect(mx, my, mw, mh);
  ctx.beginPath(); ctx.moveTo(mx + mw / 2, my); ctx.lineTo(mx + mw / 2, my + mh); ctx.stroke();
  ctx.beginPath(); ctx.arc(mx + mw / 2, my + mh / 2, CIRCLE_R / PITCH.w * mw, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(mx, sy(PITCH.cy - BOX.width / 2), BOX.depth / PITCH.w * mw, BOX.width / PITCH.h * mh);
  ctx.strokeRect(mx + mw - BOX.depth / PITCH.w * mw, sy(PITCH.cy - BOX.width / 2), BOX.depth / PITCH.w * mw, BOX.width / PITCH.h * mh);
  for (const p of onPitch()) {
    ctx.fillStyle = p.role === "GK" ? TEAMS[p.team].gk.shirt : TEAMS[p.team].kit.shirt;
    ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 3, 0, Math.PI * 2); ctx.fill();
    if (isHumanControlled(p)) { ctx.strokeStyle = "#ffd33d"; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(sx(ball.x), sy(ball.y), 2.5, 0, Math.PI * 2); ctx.fill();
  // what the camera currently shows
  const c = game.camera;
  ctx.strokeStyle = "rgba(255,211,61,0.7)"; ctx.lineWidth = 1;
  const z = c.zoom || 1;
  const x0 = clamp(sx(c.x), mx, mx + mw), x1 = clamp(sx(c.x + VIEW_W / z), mx, mx + mw);
  const y0 = clamp(sy(c.y), my, my + mh), y1 = clamp(sy(c.y + VIEW_H / z), my, my + mh);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

let viewScale = 1, dpr = 1;
let safeCss = { top: 0, right: 0, bottom: 0, left: 0 };
function readSafeArea() {
  safeCss = { top: 0, right: 0, bottom: 0, left: 0 };
  const el = document.getElementById("safeProbe");
  if (!el) return;
  const cs = getComputedStyle(el);
  safeCss.top = parseFloat(cs.borderTopWidth) || 0;
  safeCss.right = parseFloat(cs.borderRightWidth) || 0;
  safeCss.bottom = parseFloat(cs.borderBottomWidth) || 0;
  safeCss.left = parseFloat(cs.borderLeftWidth) || 0;
}
function screenPad() {
  const s = Math.max(viewScale, 0.001);
  return { top: safeCss.top / s, bottom: safeCss.bottom / s, left: safeCss.left / s, right: safeCss.right / s };
}
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#111"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);

  // ---- world (moves with the camera) ----
  ctx.save();
  ctx.scale(game.camera.zoom || 1, game.camera.zoom || 1);
  ctx.translate(-game.camera.x, -game.camera.y);
  ctx.drawImage(bg, 0, 0, WORLD_W, WORLD_H);
  drawCrowdCelebration();
  drawGoalBack("left"); drawGoalBack("right");
  drawPenaltyWorld();
  // draw players and ball from back (top) to front (bottom)
  const things = onPitch().map((p) => ({ y: p.y, p }));
  things.push({ y: ball.y + 0.5, ball: true });
  things.sort((a, b) => a.y - b.y);
  for (const t of things) { if (t.ball) drawBall(); else drawPlayer(t.p); }
  drawGoalFront("left"); drawGoalFront("right");
  if (ball.z > CROSSBAR) drawBall(); // a high ball flies OVER the crossbar
  for (const c of controllers) {
    if (!c.cpu && c.active && !c.active.sentOff && (inMatch() || game.phase === "win")) drawPlayerHud(c.active, c);
  }
  ctx.restore();

  // ---- HUD (fixed on screen) ----
  updateConfetti();
  if (showHud()) {
    drawScoreboard();
    drawCommentary();
    drawRefPopups();
    if (!game.shootout && game.phase !== "goal") drawMinimap();
  }
  drawConfetti();
}
// Players on the pitch (not the ones sent off)
const onPitch = () => players.filter((p) => !p.sentOff);

// =====================================================================
// Screen size
// =====================================================================
// The canvas always fills the window; we show more or less of the
// stadium depending on the window shape.
function viewportBox() {
  const vv = window.visualViewport;
  return {
    w: Math.max(1, Math.round((vv && vv.width) || window.innerWidth || 1)),
    h: Math.max(1, Math.round((vv && vv.height) || window.innerHeight || 1)),
    x: (vv && vv.offsetLeft) || 0,
    y: (vv && vv.offsetTop) || 0,
  };
}
function resize() {
  if (!canvas) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const box = viewportBox();
  const w = box.w, h = box.h, aspect = w / h;
  VIEW_H = 640; VIEW_W = VIEW_H * aspect;
  if (VIEW_W < 900) { VIEW_W = 900; VIEW_H = VIEW_W / aspect; }
  viewScale = w / VIEW_W;
  readSafeArea();
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  canvas.style.left = box.x + "px"; canvas.style.top = box.y + "px";
  if (typeof game !== "undefined" && game) updateCamera(0, true);
  if (typeof updateScreens === "function") updateScreens();
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 80));
if (window.visualViewport) {
  visualViewport.addEventListener("resize", resize);
  visualViewport.addEventListener("scroll", resize);
}


// =====================================================================
// H. SCREENS (home, lobby, win, menu) + MAIN LOOP
// =====================================================================
let menuOpen = false;
const show = (id, on) => $(id).classList.toggle("hidden", !on);

function updateScreens() {
  const inRoom = !!room && !!myId;
  const state = inRoom ? room.state : null;
  show("home", !inRoom);
  show("lobby", state === "lobby");
  show("winScreen", inRoom && (state === "win" || game.phase === "win"));
  show("menuScreen", inRoom && state === "playing" && menuOpen && game.phase !== "win");
  const me = room && room.members.find((m) => m.id === myId);
  const playing = inRoom && state === "playing" && game.phase !== "win";
  show("touchControls", playing && isTouchDevice && !!(me && me.team) && !menuOpen);
  show("menuBtn", playing);
  show("pingBox", inRoom);
  show("rotateHint", isTouchDevice && isPortrait());
  if (state === "lobby") renderLobby();
  if (inRoom && (state === "win" || game.phase === "win")) renderWin();
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function memberLine(m) {
  const tags = [];
  if (m.id === myId) tags.push("you");
  if (m.id === room.hostId) tags.push("host");
  const status = m.connected ? (m.ping ? m.ping + " ms" : "") : "left \u2013 computer plays";
  return "<div class='slot" + (m.id === myId ? " me" : "") + (m.connected ? "" : " off") + "'><b>" + esc(m.name) + "</b>" +
    (tags.length ? " <span class='tag'>" + tags.join(", ") + "</span>" : "") +
    (status ? " <span class='ping'>" + status + "</span>" : "") + "</div>";
}

function renderLobby() {
  const host = room.hostId === myId;
  $("roomCode").textContent = room.code;
  const link = new URL(location.href);
  link.search = "?room=" + room.code;
  link.hash = "";
  $("shareUrl").textContent = link.href;
  document.querySelectorAll("[data-lmode]").forEach((b) => { b.classList.toggle("selected", b.dataset.lmode === room.mode); b.disabled = !host; });
  document.querySelectorAll("[data-ldiff]").forEach((b) => { b.classList.toggle("selected", b.dataset.ldiff === room.difficulty); b.disabled = !host; });
  document.querySelectorAll("[data-lmatch]").forEach((b) => { b.classList.toggle("selected", b.dataset.lmatch === (room.matchType || "match")); b.disabled = !host; });
  const rules = room.rules || DEFAULT_RULES;
  $("lobbyOffside").checked = !!rules.offside; $("lobbyOffside").disabled = !host;
  $("lobbyCards").checked = !!rules.cards; $("lobbyCards").disabled = !host;
  // team pickers (the host chooses; kits swap to away if they clash)
  const kits = buildTeamKits(findTeam(room.blueTeam) || TEAM_LIST[0], findTeam(room.redTeam) || TEAM_LIST[1]);
  for (const side of ["blue", "red"]) {
    const sel = $(side + "TeamSel");
    if (!sel.options.length) sel.innerHTML = TEAM_LIST.map((t) => "<option value='" + t.id + "'>" + esc(t.name) + " (" + t.short + ") " + "\u2605".repeat(t.rating) + "</option>").join("");
    sel.value = side === "blue" ? room.blueTeam || "blue" : room.redTeam || "red";
    sel.disabled = !host;
    const k = kits[side];
    $(side + "Title").innerHTML = "<span class='kitDot' style='background:" + k.kit.shirt + "'></span>" + esc(k.name) + (k.away ? " <span class='tag'>away kit</span>" : "");
  }
  const me = room.members.find((m) => m.id === myId);
  for (const team of ["blue", "red"]) {
    const list = room.members.filter((m) => m.team === team);
    let html = list.map(memberLine).join("");
    for (let i = list.length; i < room.perTeam; i++) html += "<div class='slot empty'>empty &ndash; computer plays</div>";
    $(team + "Slots").innerHTML = html;
    $(team + "Join").disabled = (me && me.team === team) || list.length >= room.perTeam;
  }
  const specs = room.members.filter((m) => !m.team);
  $("specList").innerHTML = specs.length ? "Watching: " + specs.map((m) => esc(m.name)).join(", ") : "";
  $("specJoin").disabled = !me || !me.team;
  const humans = room.members.filter((m) => m.team).length;
  show("startBtn", host);
  $("startBtn").textContent = humans < room.perTeam * 2 ? "Start (computer fills the empty spots)" : "Start match";
  show("waitHost", !host);
}

function renderWin() {
  const w = game.winner;
  const title = $("winTitle");
  title.textContent = w ? TEAMS[w].name + " win!" : "Full time!";
  title.style.color = w ? TEAMS[w].ui : "#fff";
  const me = room && room.members.find((m) => m.id === myId);
  $("winSub").textContent = me && me.team ? (me.team === w ? "Great game - you won!" : "Good effort - try again!") : "";
  let score = TEAMS.blue.short + " " + game.score.blue + "  -  " + game.score.red + " " + TEAMS.red.short;
  const so = game.shootout;
  if (so) {
    const pb = so.kicks.blue.reduce((a, b) => a + b, 0), pr = so.kicks.red.reduce((a, b) => a + b, 0);
    score = game.matchType === "shootout" ? TEAMS.blue.short + " " + pb + " - " + pr + " " + TEAMS.red.short + " (penalties)" : score + " (" + pb + "-" + pr + " pens)";
  }
  $("winScore").textContent = score;
  const s = game.stats;
  $("winStats").textContent = !s ? "" : game.matchType === "shootout" ? "Penalties scored: " + s.pens.scored + "  \u2022  missed / saved: " + s.pens.missed :
    "Shots: " + s.shots.blue + " - " + s.shots.red + "  \u2022  Saves: " + s.saves + "  \u2022  Corners: " + s.corner +
    "  \u2022  Cards: " + (s.yellow.blue + s.yellow.red) + " yellow, " + (s.red.blue + s.red.red) + " red  \u2022  Offside: " + s.offside + "  \u2022  Time: " + formatClock(game.clock);
  const host = room && room.hostId === myId;
  show("rematchBtn", host); show("lobbyBtn", host); show("waitHost2", !host);
}

function toggleMenu() { menuOpen = !menuOpen; updateScreens(); }
function toggleSound() {
  game.muted = !game.muted; Sound.setMuted(game.muted);
  $("soundBtn").textContent = game.muted ? "Sound: OFF" : "Sound: ON";
}
let noticeTimer = null;
function showNotice(text, soft) {
  const el = $("connBanner");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("soft", !!soft);
  el.classList.remove("hidden");
  clearTimeout(noticeTimer);
  if (soft) noticeTimer = setTimeout(() => el.classList.add("hidden"), 7000);
}
function hideNotice() {
  const el = $("connBanner");
  if (!el) return;
  clearTimeout(noticeTimer);
  el.classList.add("hidden");
}
function clearRoom() {
  room = null; myId = null; wantRoom = null; menuOpen = false;
  game.phase = "lobby"; snaps.length = 0; controllers = [];
  try { sessionStorage.removeItem("soccerRoom"); } catch (e) { /* ignore */ }
  history.replaceState(null, "", location.pathname);
  updateScreens();
}
function leaveRoom() {
  if (typeof netMarkLeaving === "function") netMarkLeaving();
  try { sendMsg({ t: "leave" }); } catch (e) { /* already gone */ }
  if (typeof netReset === "function") netReset();
  clearRoom();
}


// ---- Buttons ----
let createMode = "1v1", createDiff = "normal";
document.querySelectorAll("[data-cmode]").forEach((b) => b.addEventListener("click", () => {
  createMode = b.dataset.cmode;
  document.querySelectorAll("[data-cmode]").forEach((x) => x.classList.toggle("selected", x === b));
}));
document.querySelectorAll("[data-cdiff]").forEach((b) => b.addEventListener("click", () => {
  createDiff = b.dataset.cdiff;
  document.querySelectorAll("[data-cdiff]").forEach((x) => x.classList.toggle("selected", x === b));
}));
function myName() {
  const n = $("nameInput").value.trim();
  if (!n) { $("homeMsg").textContent = "Type your name first!"; $("nameInput").focus(); return null; }
  try { localStorage.setItem("soccerName", n); } catch (e) { /* ignore */ }
  return n;
}
$("createBtn").addEventListener("click", () => {
  const name = myName(); if (!name) return;
  Sound.init(); $("homeMsg").textContent = "";
  sendOrQueue({ t: "create", name, mode: createMode, difficulty: createDiff });
});
function joinByCode() {
  const name = myName(); if (!name) return;
  const code = $("codeInput").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 4) { $("homeMsg").textContent = "The room code is 4 letters or numbers."; return; }
  Sound.init(); $("homeMsg").textContent = "";
  sendOrQueue({ t: "join", code, name });
}
$("joinBtn").addEventListener("click", joinByCode);
$("codeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") joinByCode(); });
document.querySelectorAll("[data-lmode]").forEach((b) => b.addEventListener("click", () => sendMsg({ t: "settings", mode: b.dataset.lmode })));
document.querySelectorAll("[data-ldiff]").forEach((b) => b.addEventListener("click", () => sendMsg({ t: "settings", difficulty: b.dataset.ldiff })));
document.querySelectorAll("[data-lmatch]").forEach((b) => b.addEventListener("click", () => sendMsg({ t: "settings", matchType: b.dataset.lmatch })));
$("blueTeamSel").addEventListener("change", (e) => sendMsg({ t: "settings", blueTeam: e.target.value }));
$("redTeamSel").addEventListener("change", (e) => sendMsg({ t: "settings", redTeam: e.target.value }));
$("lobbyOffside").addEventListener("change", (e) => sendMsg({ t: "settings", rules: { offside: e.target.checked } }));
$("lobbyCards").addEventListener("change", (e) => sendMsg({ t: "settings", rules: { cards: e.target.checked } }));
$("blueJoin").addEventListener("click", () => sendMsg({ t: "team", team: "blue" }));
$("redJoin").addEventListener("click", () => sendMsg({ t: "team", team: "red" }));
$("specJoin").addEventListener("click", () => sendMsg({ t: "team", team: null }));
$("startBtn").addEventListener("click", () => { Sound.init(); sendMsg({ t: "start" }); });
$("rematchBtn").addEventListener("click", () => sendMsg({ t: "rematch" }));
$("lobbyBtn").addEventListener("click", () => sendMsg({ t: "lobby" }));
$("leaveBtn").addEventListener("click", leaveRoom);
$("winLeaveBtn").addEventListener("click", leaveRoom);
$("menuLeaveBtn").addEventListener("click", leaveRoom);
$("menuBtn").addEventListener("click", toggleMenu);
$("menuCloseBtn").addEventListener("click", toggleMenu);
$("soundBtn").addEventListener("click", toggleSound);
$("copyBtn").addEventListener("click", () => {
  const url = $("shareUrl").textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => { $("copyBtn").textContent = "Copied!"; }, () => {});
});
// Sound can only start after a tap / key press (browser rule)
window.addEventListener("pointerdown", () => Sound.init());
if (isTouchDevice && $("matchHelp")) {
  $("matchHelp").innerHTML = "Left thumb moves. <b>SHOOT</b> kicks (hold for a bigger kick). <b>PASS</b> passes (hold to lob). <b>RUN</b> sprints. <b>SKILL</b> does a trick.<br>Penalty: slide up or down, then hold SHOOT. In goal: slide up or down. Tap the picture to skip a celebration.";
}

// ---- Start up ----
(function boot() {
  try { $("nameInput").value = localStorage.getItem("soccerName") || ""; } catch (e) { /* ignore */ }
  const code = new URLSearchParams(location.search).get("room");
  if (code) $("codeInput").value = code.toUpperCase();
  // Reloaded the page in the middle of a game? Rejoin automatically.
  try {
    const saved = JSON.parse(sessionStorage.getItem("soccerRoom") || "null");
    if (saved && saved.code && saved.token) wantRoom = saved;
  } catch (e) { /* ignore */ }
  renderBackground();
  resize();
  connect();
  updateScreens();
  requestAnimationFrame(frame);
})();

let lastFrame = performance.now();
function frame(now) {
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 0.1) dt = 0.1;
  game.time += dt;
  if (room && room.state !== "lobby") applyInterpolation(dt);
  if (inMatch()) sendInput(false);
  updateCamera(dt);
  draw();
  const pb = $("pingBox");
  pb.textContent = (netLinkUp() ? "\u25CF " : "\u25CB ") + pingMs + " ms";
  pb.style.color = pingMs < 80 ? "#7CFC8A" : pingMs < 200 ? "#ffd33d" : "#ff6b6b";
  requestAnimationFrame(frame);
}

// ---- Helpers for automated tests (and curious players: try mpDebug.state() in the console) ----
window.mpDebug = {
  state() {
    const last = snaps.length ? snaps[snaps.length - 1].s : null;
    const a = myActive();
    return {
      myId, room: room && { code: room.code, state: room.state, mode: room.mode, hostId: room.hostId, members: room.members },
      phase: game.phase, score: { ...game.score }, winner: game.winner,
      ball: last ? { x: last.b[0], y: last.b[1] } : null, drawnBall: { x: ball.x, y: ball.y },
      me: a ? { index: players.indexOf(a), x: a.x, y: a.y, vx: a.vx, vy: a.vy } : null,
      myRaw: a && last ? (() => { const r = last.p[players.indexOf(a)]; return { x: r[0], y: r[1], vx: r[2], vy: r[3] }; })() : null,
      controllers: controllers.map((c) => ({ id: c.id, active: players.indexOf(c.active), cpu: c.cpu })),
      ping: pingMs, link: netLinkUp(), host: netIsHost(),
      net: typeof netDebug === "function" ? netDebug() : null,
      snapshots: snaps.length, winVisible: !$("winScreen").classList.contains("hidden"),
      teams: { blue: TEAMS.blue.short, red: TEAMS.red.short, blueShirt: TEAMS.blue.kit.shirt, redShirt: TEAMS.red.kit.shirt },
      setpiece: game.setpiece && game.setpiece.type, indirect: !!(game.setpiece && game.setpiece.indirect),
      penalty: game.penalty ? { team: game.penalty.team, aimY: game.penalty.aimY, gkChoice: game.penalty.gkChoice, iAmTaker: game.penalty.taker === a, iAmKeeper: game.penalty.keeper === a } : null,
      shootout: game.shootout, celebration: game.celebration ? game.celebration.type : null,
      cardPopup: game.cardPopup ? game.cardPopup.kind : null, flag: !!game.flag,
      sentOff: players.filter((p) => p.sentOff).length, yellows: players.reduce((n, p) => n + (p.yellow || 0), 0),
      skills: players.filter((p) => p.skill).map((p) => p.skill), matchType: game.matchType, rules: game.rules,
    };
  },
  send(m) { sendMsg(m); },
};

