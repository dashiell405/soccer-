/* =====================================================================
   FLOODLIGHT KICKOFF - ONLINE  :  client.js  (runs in each browser)
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
  teams: null, rules: { ...DEFAULT_RULES }, timeLimit: MATCH_LENGTH, knockout: false, matchType: "match",
  // decoded from snapshots
  penalty: null, shootout: null, celebration: null, cardPopup: null, flag: null,
  officials: null,       // referee + two linesmen, filled in from snapshots
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
  const info = describeMatchLength((game.timeLimit || MATCH_LENGTH) / 60);
  const half = game.timeLimit && game.clock >= game.timeLimit / 2 ? "2nd half" : "1st half";
  const fmt = game.matchType === "shootout" ? "Penalty shootout" : info.minutes + " min \u2022 " + half;
  return fmt + "  \u2022  Room " + (room ? room.code : "") + "  \u2022  " + game.mode + " (CPU: " + game.difficulty + ")";
}
function keysHint(kind) {
  const t = touchActive();
  if (kind === "skip") return t ? "Tap to skip" : "Press any key to skip";
  if (kind === "throw") return t ? "aim with the joystick, tap PASS to throw" : "aim, then E to throw";
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
    // resume() returns a promise. On a phone with no audio device it rejects,
    // and that must not become a red error that stops the game.
    const wake = () => { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); };
    if (this.ctx) { wake(); return; }
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
      wake();
    } catch (e) { this.ctx = null; }
  },
  muted: false,
  sfx: 1,
  whistleVol: 1,
  setMuted(m) { this.muted = !!m; if (this.master && this.muted) this.master.gain.value = 0; },
  applyMix(g) {
    if (!g) return;
    this.muted = !!g.mute;
    this.sfx = g.sfx == null ? 1 : g.sfx;
    this.whistleVol = g.whistle == null ? 1 : g.whistle;
    const master = g.mute ? 0 : (g.master == null ? 1 : g.master);
    if (this.master) this.master.gain.value = master;
    if (this.crowdGain) this.crowdGain.gain.value = 0.05 * (g.crowd == null ? 1 : g.crowd) * (g.mute ? 0 : 1);
  },

  // a burst of filtered noise with a volume envelope
  noiseBurst(freq, q, peak, attack, decay) {
    if (!this.ctx) return;
    peak *= (this.sfx == null ? 1 : this.sfx);
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
    const v = clamp(power / 1000, 0.25, 1) * (this.sfx == null ? 1 : this.sfx);
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
    const wv = 0.09 * (this.whistleVol == null ? 1 : this.whistleVol);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, wv), t + 0.02);
    g.gain.setValueAtTime(Math.max(0.0002, wv), t + dur - 0.05);
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
  if (typeof haptic === "function") {
    if (name === "kick") haptic(12);
    else if (name === "whistleLong" || name === "cheer" || name === "card") haptic(28);
  }
}


// =====================================================================
// ONLINE PLAY WITHOUT A SERVER OF OUR OWN
// ---------------------------------------------------------------------
// Friends open the same website. One person taps "Host a game" and gets a
// short room code. The others tap "Join" and type it.
//
// The host's browser runs the real match (the same sim as the offline game)
// and sends a picture of it about 30 times a second. Guests only send which
// buttons they are holding. This is "host authoritative": one device decides
// what happened, so everybody sees the same goals.
//
// How the devices find each other:
//   * PeerJS, loaded from a CDN (with a copy saved in vendor/ just in case)
//   * PeerJS's free public broker (0.peerjs.com) introduces the browsers
//   * Public STUN and PeerJS's free TURN servers help them talk through Wi-Fi
// The match itself is sent directly between the devices (WebRTC).
// =====================================================================

const PAGE_QUERY = new URLSearchParams(location.search);
const DEBUG_NET = PAGE_QUERY.get("debug") === "1";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const PEER_PREFIX = "SOCCER";
const SIM_HZ = 60;
const SIM_STEP = 1 / 120;
const SEND_EVERY = 2;          // snapshot every 2 sim ticks = 30 per second
const JOIN_WAIT_MS = 9000;

const MSG = {
  noLib: "Online play couldn't load. Check your internet and refresh the page. You can still play on this device.",
  noNet: "Couldn't start online play. Check your internet and try again.",
  timeout: "That took too long. Check your internet and try again. Some Wi-Fi blocks games between friends.",
  badCode: "No game uses that code. Ask your friend to read it again.",
  noRoom: "We couldn't find that room. Ask your friend to check the code. If the code is right, this Wi-Fi might be blocking the game. Try again, or play on one device.",
  full: "That room is full.",
  ice: "We couldn't connect to each other. Some Wi-Fi (like at school or a shop) blocks this. Try another network, or play on one device.",
  hostLeft: "The host left the game. Ask a friend to host a new one.",
  browser: "This browser can't play online. Try Safari or Chrome.",
  starting: "Starting your room\u2026",
  looking: "Looking for that room\u2026",
  again: "Joining your game again\u2026",
  gone: "Lost the connection. If the host's screen closed, the game stops. You can try joining again.",
};

let netRole = null;          // "host" | "guest" | null
let activePeer = null;
let hostConn = null;         // guest's link to the host
let hosted = null;           // the room, only on the host's device
let pendingLength = { minutes: 5, custom: false };
let localMember = null;
let generation = 0;          // ignores events from an old Peer after a retry
let leaving = false;
let simTimer = null;
let roomTimer = null;
let watchdogTimer = null;
let joinTimer = null;
let lastHeard = 0;
const connMember = new Map();

function netLinkUp() {
  if (netRole === "host") return !!(activePeer && activePeer.open);
  if (netRole === "guest") return !!(hostConn && hostConn.open);
  return false;
}
function netIsHost() { return netRole === "host" && !!hosted; }
function netMarkLeaving() { leaving = true; }
function netDebug() {
  const opt = peerOptions();
  const ice = (opt.config && opt.config.iceServers) || [];
  return {
    type: "p2p", role: netRole, link: netLinkUp(), host: netIsHost(),
    code: hosted ? hosted.code : (wantRoom && wantRoom.code) || null,
    broker: opt.host || "0.peerjs.com", cloud: !opt.host,
    ice: ice.length,
    turn: ice.some((s) => JSON.stringify(s.urls).indexOf("turn:") >= 0),
    peerFrom: window.soccerPeerFrom || null,
  };
}

// Public STUN, plus the free TURN servers that ship with PeerJS.
// TURN helps phones on mobile data, where a plain STUN connection often fails.
function peerOptions() {
  const ice = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
  ];
  const opt = { debug: PAGE_QUERY.get("peerdebug") === "1" ? 2 : 0 };
  if (PAGE_QUERY.get("icemode") === "host") opt.config = { iceServers: [], sdpSemantics: "unified-plan" };
  else opt.config = { iceServers: ice, sdpSemantics: "unified-plan" };
  const host = PAGE_QUERY.get("peerhost");
  if (host) {
    opt.host = host;
    opt.port = Number(PAGE_QUERY.get("peerport") || "9000");
    opt.path = "/";
    opt.secure = PAGE_QUERY.get("peersecure") === "1";
    opt.key = "peerjs";
  }
  return opt;
}

function peerIdFor(code) { return PEER_PREFIX + code; }
function normCode(code) { return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4); }

function randomId(bytes) {
  const a = new Uint8Array(bytes);
  if (crypto && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
function makeCode() {
  let s = "";
  const a = new Uint8Array(4);
  if (crypto && crypto.getRandomValues) crypto.getRandomValues(a);
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[(a[i] || Math.floor(Math.random() * 256)) % CODE_ALPHABET.length];
  return s;
}
function cleanName(n) {
  const s = String(n || "").replace(/[^\p{L}\p{N} _.\-!?]/gu, "").trim().slice(0, 14);
  return s || "Player";
}
function asMsg(data) {
  if (typeof data === "string") {
    if (data.length > 20000) return null;
    try { return JSON.parse(data); } catch (e) { return null; }
  }
  if (!data || typeof data !== "object") return null;
  return data;
}
function setBusy(on) {
  const c = $("createBtn"), j = $("joinBtn");
  if (c) c.disabled = on;
  if (j) j.disabled = on;
}
function ensurePeer() {
  if (window.Peer) return Promise.resolve(true);
  const p = window.soccerPeerReady;
  if (p && typeof p.then === "function") return p.then(() => !!window.Peer);
  return Promise.resolve(false);
}

function friendlyError(type) {
  if (type === "peer-unavailable" || type === "unavailable-id") return MSG.badCode;
  if (type === "browser-incompatible") return MSG.browser;
  if (type === "network" || type === "negotiation-failed" || type === "webrtc" || type === "server-error" || type === "socket-error" || type === "socket-closed" || type === "disconnected") return MSG.ice;
  return MSG.noNet;
}

function stopLoops() {
  clearInterval(simTimer); simTimer = null;
  clearInterval(roomTimer); roomTimer = null;
  clearInterval(watchdogTimer); watchdogTimer = null;
  clearTimeout(joinTimer); joinTimer = null;
}

function destroyPeerSoon(peer, conn, delay) {
  setTimeout(() => {
    try { if (conn) conn.close(); } catch (e) { /* already closed */ }
    try { if (peer && !peer.destroyed) peer.destroy(); } catch (e) { /* already gone */ }
  }, delay);
}

function netReset() {
  const role = netRole;
  const peer = activePeer;
  const conn = hostConn;
  generation++;
  netRole = null;
  activePeer = null;
  hostConn = null;
  hosted = null;
  localMember = null;
  connMember.clear();
  stopLoops();
  setBusy(false);
  destroyPeerSoon(peer, conn, role === "guest" ? 150 : 40);
}

function netFailJoin() {
  if (myId) return;
  netReset();
  leaving = false;
  setBusy(false);
}

function netHostGone() {
  if (leaving || !myId) return;
  const text = MSG.hostLeft;
  leaving = true;
  netReset();
  clearRoom();
  if ($("homeMsg")) $("homeMsg").textContent = text;
  showNotice(text, false);
}

function connect() {
  ensurePeer().then((ok) => {
    if (!ok || !window.Peer) {
      if ($("homeMsg") && !$("homeMsg").textContent) $("homeMsg").textContent = MSG.noLib;
      return;
    }
    if (wantRoom && wantRoom.code && wantRoom.token && !netRole) {
      $("homeMsg").textContent = MSG.again;
      startGuest(wantRoom.code, wantRoom.name || "Player", wantRoom.token);
    }
  });
}

function sendMsg(m) {
  if (!m) return;
  if (netRole === "host") {
    if (localMember && hosted) handleFrom(localMember, m);
    return;
  }
  if (hostConn && hostConn.open) {
    try { hostConn.send(m); } catch (e) { /* link is closing */ }
  }
}
function sendOrQueue(m) {
  if (!m) return;
  if (m.t === "create") { startHost(m); return; }
  if (m.t === "join") { startGuest(m.code, m.name, m.token || null); return; }
  sendMsg(m);
}

// ---------------------------------------------------------------------
// Host: one room, living in this browser
// ---------------------------------------------------------------------
const perTeam = (room) => (room.mode === "2v2" ? 2 : 1);
const teamCount = (room, team) => [...room.members.values()].filter((m) => m.team === team).length;

function autoTeam(room) {
  const b = teamCount(room, "blue"), r = teamCount(room, "red"), max = perTeam(room);
  if (b <= r && b < max) return "blue";
  if (r < max) return "red";
  if (b < max) return "blue";
  return null;
}

function roomInfo(room) {
  return {
    t: "room", code: room.code, mode: room.mode, difficulty: room.difficulty,
    blueTeam: room.blueTeam, redTeam: room.redTeam, rules: room.rules, matchType: room.matchType,
    minutes: clampMatchMinutes(room.minutes), lengthCustom: !!room.lengthCustom,
    hostId: room.hostId, state: room.state, perTeam: perTeam(room), debug: !!room.debug,
    members: [...room.members.values()].map((m) => ({ id: m.id, name: m.name, team: m.team, connected: m.connected, ping: m.ping })),
  };
}

function deliver(member, msg) {
  if (!member || !member.connected) return;
  let copy = msg;
  try { copy = JSON.parse(JSON.stringify(msg)); } catch (e) { /* send the original */ }
  if (member.local) {
    try { onMessage(copy); } catch (err) { console.warn(err); }
    return;
  }
  if (member.conn && member.conn.open) {
    try { member.conn.send(copy); } catch (e) { /* guest is gone */ }
  }
}
function broadcast(room, msg) {
  for (const m of room.members.values()) deliver(m, msg);
}
function broadcastRoom(room, note) {
  const info = roomInfo(room);
  if (note) info.note = note;
  broadcast(room, info);
}

function addMember(room, name) {
  const m = {
    id: randomId(6), token: randomId(12), name, team: autoTeam(room),
    conn: null, local: false, connected: true, ping: 0, lastHeard: Date.now(),
  };
  room.members.set(m.id, m);
  if (!room.hostId) room.hostId = m.id;
  return m;
}

function attachReturning(room, name, token) {
  let m = null;
  if (token) m = [...room.members.values()].find((x) => x.token === token);
  if (!m) m = [...room.members.values()].find((x) => !x.connected && x.name.toLowerCase() === name.toLowerCase());
  return m;
}

function sendJoined(room, m) {
  deliver(m, { t: "joined", you: m.id, token: m.token, code: room.code });
  if (room.sim) deliver(m, { t: "match", players: room.sim.staticInfo(), info: room.sim.matchInfo() });
  broadcastRoom(room);
}

function startMatch(room) {
  room.sim = createSim({
    mode: room.mode, difficulty: room.difficulty, rules: room.rules, matchType: room.matchType,
    minutes: room.minutes,
    teams: buildTeamKits(findTeam(room.blueTeam), findTeam(room.redTeam)),
  });
  for (const m of room.members.values()) {
    if (!m.team) continue;
    room.sim.addController(m.id, m.name, m.team);
    if (!m.connected) room.sim.setConnected(m.id, false);
  }
  room.sim.start();
  room.state = "playing";
  room.tick = 0; room.acc = 0; room.sentWin = false;
  broadcast(room, { t: "match", players: room.sim.staticInfo(), info: room.sim.matchInfo() });
  broadcastRoom(room);
  hideNotice();
}

function simTick() {
  if (!hosted || !hosted.sim || hosted.state === "lobby") return;
  const now = Date.now();
  const dt = Math.min(0.1, (now - (hosted.lastTickAt || now)) / 1000);
  hosted.lastTickAt = now;
  if (hosted.state === "playing") {
    const slow = hosted.sim.game.admin && hosted.sim.game.admin.slow ? 0.35 : 1;
    hosted.acc += dt * (hosted.speed || 1) * slow;
    let steps = 0;
    while (hosted.acc >= SIM_STEP && steps < 2000) { hosted.sim.update(SIM_STEP); hosted.acc -= SIM_STEP; steps++; }
    if (hosted.sim.game.phase === "win") { hosted.state = "win"; broadcastRoom(hosted); }
  }
  hosted.tick = (hosted.tick || 0) + 1;
  if (hosted.tick % SEND_EVERY === 0 || hosted.state === "win") {
    if (hosted.state === "win" && hosted.sentWin) return;
    const snap = hosted.sim.snapshot();
    snap.t = "s";
    snap.now = now;
    broadcast(hosted, snap);
    if (hosted.state === "win") hosted.sentWin = true;
  }
}

function startLoops() {
  if (simTimer) return;
  if (hosted) hosted.lastTickAt = Date.now();
  simTimer = setInterval(simTick, 1000 / SIM_HZ);
  roomTimer = setInterval(() => { if (hosted && netRole === "host") broadcastRoom(hosted); }, 3000);
  watchdogTimer = setInterval(watchConnections, 2000);
}

function watchConnections() {
  const now = Date.now();
  if (netRole === "guest" && myId && lastHeard && now - lastHeard > 8000) {
    showNotice(MSG.gone, false);
    netHostGone();
    return;
  }
  if (netRole !== "host" || !hosted) return;
  for (const m of hosted.members.values()) {
    if (m.local || !m.connected) continue;
    if (m.lastHeard && now - m.lastHeard > 8000) onGuestClose(m.conn);
  }
}

function hearFrom(m) { if (m) m.lastHeard = Date.now(); lastHeard = Date.now(); }

function handleFrom(member, msg) {
  if (!hosted || !member || !msg || typeof msg.t !== "string") return;
  const room = hosted;
  switch (msg.t) {
    case "ping":
      member.ping = clamp(Math.round(Number(msg.rtt) || 0), 0, 9999);
      deliver(member, { t: "pong", ts: msg.ts });
      break;
    case "input":
      if (room.sim && member.team) room.sim.setInput(member.id, msg);
      break;
    case "press":
      if (room.sim && member.team) room.sim.press(member.id, msg.a);
      break;
    case "switch":
      if (room.sim && member.team) room.sim.switchTo(member.id, msg.i | 0);
      break;
    case "team": {
      if (room.state !== "lobby") return;
      const t = msg.team === "blue" || msg.team === "red" ? msg.team : null;
      if (t && t !== member.team && teamCount(room, t) >= perTeam(room)) return;
      member.team = t;
      broadcastRoom(room);
      break;
    }
    case "settings": {
      if (room.state !== "lobby" || member.id !== room.hostId) return;
      if (msg.mode === "1v1" || msg.mode === "2v2") {
        room.mode = msg.mode;
        for (const team of ["blue", "red"]) {
          const list = [...room.members.values()].filter((m) => m.team === team);
          list.slice(perTeam(room)).forEach((m) => { m.team = null; });
        }
        for (const m of room.members.values()) if (!m.team) m.team = autoTeam(room);
      }
      if (["easy", "normal", "hard"].includes(msg.difficulty)) room.difficulty = msg.difficulty;
      if (findTeam(msg.blueTeam)) room.blueTeam = msg.blueTeam;
      if (findTeam(msg.redTeam)) room.redTeam = msg.redTeam;
      if (msg.matchType === "match" || msg.matchType === "shootout") room.matchType = msg.matchType;
      if (msg.minutes != null && msg.minutes !== "") {
        room.minutes = clampMatchMinutes(msg.minutes);
        if (typeof msg.lengthCustom === "boolean") room.lengthCustom = msg.lengthCustom;
      }
      if (msg.rules && typeof msg.rules === "object") {
        for (const k of ["offside", "cards"]) if (typeof msg.rules[k] === "boolean") room.rules[k] = msg.rules[k];
      }
      broadcastRoom(room);
      break;
    }
    case "start":
    case "rematch":
      if (member.id === room.hostId && room.state !== "playing") { room.sentWin = false; startMatch(room); }
      break;
    case "lobby":
      if (member.id === room.hostId) { room.state = "lobby"; room.sim = null; room.sentWin = false; broadcastRoom(room); }
      break;
    case "leave": {
      const wasLocal = member.local;
      room.members.delete(member.id);
      if (room.sim) room.sim.removeController(member.id);
      if (!wasLocal && member.conn) {
        connMember.delete(member.conn);
        try { member.conn.close(); } catch (e) { /* ignore */ }
      }
      const note = wasLocal ? null : (room.state === "playing"
        ? member.name + " left the game. The computer will play for them."
        : member.name + " left the room.");
      broadcastRoom(room, note);
      if (note) showNotice(note, true);
      break;
    }
    case "debug":
      if (!room.debug || !room.sim) return;
      if (msg.cmd === "autoplay") room.sim.setAutoplay(!!msg.on);
      if (msg.cmd === "speed") room.speed = clamp(Number(msg.value) || 1, 0.1, 40);
      if (msg.cmd === "goal") room.sim.forceGoal(msg.team === "red" ? "red" : "blue");
      if (msg.cmd === "foul") room.sim.debugFoul(msg.team === "red" ? "red" : "blue", msg.inBox !== false, !!msg.behind);
      if (msg.cmd === "offside") room.sim.debugOffside(msg.team === "red" ? "red" : "blue");
      if (msg.cmd === "skill") room.sim.debugSkill(msg.team === "red" ? "red" : "blue", String(msg.type || "stepover"));
      if (msg.cmd === "card") room.sim.giveCard(Number(msg.index) || 0, msg.kind === "red" ? "red" : "yellow");
      if (msg.cmd === "shootout") room.sim.startShootout();
      if (msg.cmd === "clock") room.sim.game.clock = Math.max(0, Number(msg.value) || 0);
      if (msg.cmd === "out") {
        const g = room.sim.game, b = room.sim.ball;
        g.phase = "play"; g.setpiece = null; b.owner = null;
        b.lastTeam = msg.team === "blue" ? "blue" : "red";
        b.x = 860; b.y = msg.side === "far" ? 80 : 1040; b.z = 0; b.vx = 0; b.vy = 0; b.vz = 0;
      }
      if (msg.cmd === "throwNow" && room.sim.game.setpiece && room.sim.game.setpiece.type === "throw") room.sim.game.setpiece.timer = 0.05;
      if (msg.cmd === "score") { room.sim.game.score.blue = Math.max(0, msg.blue | 0); room.sim.game.score.red = Math.max(0, msg.red | 0); }
      break;
    default:
      break;
  }
}

function onGuestClose(conn) {
  if (!hosted || !conn) return;
  const m = connMember.get(conn);
  if (!m || m.conn !== conn || !hosted.members.has(m.id) || !m.connected) return;
  m.connected = false;
  if (hosted.sim && m.team) hosted.sim.setConnected(m.id, false);
  const note = hosted.state === "playing"
    ? m.name + " left the game. The computer will play for them."
    : m.name + " left the room.";
  broadcastRoom(hosted, note);
  showNotice(note, true);
}

function onIncoming(conn) {
  const gen = generation;
  const take = (raw) => {
    if (gen !== generation || !hosted) return;
    const msg = asMsg(raw);
    if (!msg || typeof msg.t !== "string") return;
    const known = connMember.get(conn);
    if (known) { hearFrom(known); handleFrom(known, msg); return; }
    if (msg.t !== "join") return;
    if (hosted.members.size >= 8) {
      try { conn.send({ t: "error", msg: MSG.full }); } catch (e) { /* ignore */ }
      try { conn.close(); } catch (e) { /* ignore */ }
      return;
    }
    const code = normCode(msg.code);
    if (code && code !== hosted.code) {
      try { conn.send({ t: "error", msg: MSG.badCode }); } catch (e) { /* ignore */ }
      return;
    }
    const name = cleanName(msg.name);
    let m = attachReturning(hosted, name, typeof msg.token === "string" ? msg.token : null);
    if (m) {
      if (m.conn && m.conn !== conn) {
        connMember.delete(m.conn);
        try { m.conn.close(); } catch (e) { /* old link */ }
      }
      m.conn = conn; m.connected = true; m.local = false;
    } else {
      m = addMember(hosted, name);
      m.conn = conn;
    }
    connMember.set(conn, m);
    hearFrom(m);
    if (hosted.sim && m.team) {
      hosted.sim.addController(m.id, m.name, m.team);
      hosted.sim.setConnected(m.id, true);
    }
    sendJoined(hosted, m);
    showNotice(m.name + " joined the room.", true);
  };
  conn.on("data", take);
  conn.on("close", () => { if (gen === generation) onGuestClose(conn); });
  conn.on("error", () => { if (gen === generation) onGuestClose(conn); });
}

function failStart(text) {
  netReset();
  leaving = false;
  if ($("homeMsg")) $("homeMsg").textContent = text;
  showNotice(text, false);
  setBusy(false);
}

function hostReady(peer, code, name, mode, difficulty) {
  hosted = {
    code,
    mode: mode === "2v2" ? "2v2" : "1v1",
    difficulty: ["easy", "normal", "hard"].includes(difficulty) ? difficulty : "normal",
    blueTeam: "blue", redTeam: "red",
    rules: { ...DEFAULT_RULES },
    matchType: "match",
    minutes: clampMatchMinutes(pendingLength.minutes),
    lengthCustom: !!pendingLength.custom,
    hostId: null,
    members: new Map(),
    state: "lobby",
    sim: null, tick: 0, speed: 1, acc: 0, sentWin: false,
    debug: DEBUG_NET,
    lastTickAt: Date.now(),
  };
  const me = addMember(hosted, name);
  me.local = true;
  me.connected = true;
  hosted.hostId = me.id;
  localMember = me;
  activePeer = peer;
  hideNotice();
  if ($("homeMsg")) $("homeMsg").textContent = "";
  setBusy(false);
  sendJoined(hosted, me);
  startLoops();
  if (!hostReady.hooked) {
    hostReady.hooked = true;
    document.addEventListener("visibilitychange", onHide);
  }
}

function onHide() {
  if (document.hidden && netIsHost() && hosted && hosted.state === "playing") {
    showNotice("Keep this screen open. Your device is running the game for everyone.", true);
  }
}

function openHost(name, mode, difficulty, attempt) {
  const gen = ++generation;
  const code = makeCode();
  let peer;
  try { peer = new Peer(peerIdFor(code), peerOptions()); }
  catch (e) { failStart(MSG.browser); return; }
  activePeer = peer;
  let opened = false;
  const giveUp = (text) => { if (gen !== generation || opened) return; failStart(text); };
  const timer = setTimeout(() => giveUp(MSG.timeout), JOIN_WAIT_MS);
  peer.on("open", () => {
    if (gen !== generation) { try { peer.destroy(); } catch (e) { /* ignore */ } return; }
    opened = true;
    clearTimeout(timer);
    hostReady(peer, code, name, mode, difficulty);
  });
  peer.on("connection", (conn) => { if (gen === generation) onIncoming(conn); });
  peer.on("disconnected", () => {
    if (gen !== generation || !opened) return;
    try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* broker went away */ }
  });
  peer.on("error", (err) => {
    if (gen !== generation) return;
    const type = err && err.type;
    console.warn("Room could not start:", type || err);
    if (type === "unavailable-id" && attempt < 6 && !opened) {
      clearTimeout(timer);
      generation++; // ignore this peer, including the error from destroy()
      try { peer.destroy(); } catch (e) { /* ignore */ }
      openHost(name, mode, difficulty, attempt + 1);
      return;
    }
    if (!opened) { clearTimeout(timer); giveUp(type === "browser-incompatible" ? MSG.browser : (attempt ? MSG.noNet : friendlyError(type))); }
    else showNotice(MSG.ice, false);
  });
}

function startHost(msg) {
  if (netRole) return;
  const name = cleanName(msg.name);
  pendingLength = msg && msg.minutes != null
    ? { minutes: clampMatchMinutes(msg.minutes), custom: !!msg.lengthCustom }
    : loadSavedMinutes();
  netRole = "host";
  leaving = false;
  setBusy(true);
  if ($("homeMsg")) $("homeMsg").textContent = MSG.starting;
  ensurePeer().then((ok) => {
    if (netRole !== "host") return;
    if (!ok || !window.Peer) { failStart(MSG.noLib); return; }
    openHost(name, msg.mode, msg.difficulty, 0);
  });
}

// ---------------------------------------------------------------------
// Guest: connect to the host's room code
// ---------------------------------------------------------------------
function failGuest(text) {
  if (myId) { showNotice(text, false); return; }
  netReset();
  leaving = false;
  if ($("homeMsg")) $("homeMsg").textContent = text;
  showNotice(text, false);
  setBusy(false);
}

function startGuest(code, name, token) {
  const clean = normCode(code);
  if (clean.length !== 4) {
    if ($("homeMsg")) $("homeMsg").textContent = "The room code is 4 letters or numbers.";
    return;
  }
  if (netRole === "host") return;
  if (netRole === "guest" && hostConn && hostConn.open) return;
  netRole = "guest";
  leaving = false;
  setBusy(true);
  if ($("homeMsg")) $("homeMsg").textContent = token ? MSG.again : MSG.looking;
  ensurePeer().then((ok) => {
    if (netRole !== "guest") return;
    if (!ok || !window.Peer) { failGuest(MSG.noLib); return; }
    openGuest(clean, cleanName(name), token, 0);
  });
}

function retryGuest(code, name, token, attempt, peer) {
  if (peer && peer._soccerRetry) return;
  if (peer) peer._soccerRetry = true;
  clearTimeout(joinTimer);
  generation++; // ignore events from this Peer while we wait to try again
  try { if (peer && !peer.destroyed) peer.destroy(); } catch (e) { /* ignore */ }
  setTimeout(() => {
    if (netRole === "guest" && !myId) openGuest(code, name, token, attempt + 1);
  }, 700);
}

function openGuest(code, name, token, attempt) {
  const gen = ++generation;
  let peer;
  try { peer = new Peer(undefined, peerOptions()); }
  catch (e) { failGuest(MSG.browser); return; }
  activePeer = peer;
  const giveUp = (text) => {
    if (gen !== generation || myId) return;
    clearTimeout(joinTimer);
    failGuest(text);
  };
  joinTimer = setTimeout(() => giveUp(MSG.noRoom), JOIN_WAIT_MS);
  peer.on("open", () => {
    if (gen !== generation) { try { peer.destroy(); } catch (e) { /* ignore */ } return; }
    const conn = peer.connect(peerIdFor(code), { reliable: true, serialization: "json", metadata: { game: "stadium-soccer" } });
    hostConn = conn;
    if (!conn) { giveUp(MSG.badCode); return; }
    conn.on("open", () => {
      if (gen !== generation) return;
      lastHeard = Date.now();
      try { conn.send({ t: "join", code, name, token: token || undefined }); } catch (e) { giveUp(MSG.ice); }
    });
    conn.on("data", (raw) => {
      if (gen !== generation) return;
      lastHeard = Date.now();
      const msg = asMsg(raw);
      if (!msg || typeof msg.t !== "string") return;
      if (msg.t === "joined") { clearTimeout(joinTimer); hideNotice(); if ($("homeMsg")) $("homeMsg").textContent = ""; setBusy(false); }
      try { onMessage(msg); } catch (err) { console.warn(err); }
    });
    conn.on("close", () => { if (gen === generation) netHostGone(); });
    conn.on("error", (err) => {
      if (gen !== generation || myId) return;
      const type = err && err.type;
      console.warn("Could not join:", type || err);
      if ((type === "peer-unavailable" || type === "unavailable-id") && attempt < 2) {
        retryGuest(code, name, token, attempt, peer);
        return;
      }
      giveUp(type === "peer-unavailable" || type === "unavailable-id" ? MSG.noRoom : friendlyError(type));
    });
  });
  peer.on("error", (err) => {
    if (gen !== generation || myId) return;
    const type = err && err.type;
    console.warn("Could not join:", type || err);
    if ((type === "peer-unavailable" || type === "unavailable-id") && attempt < 2) {
      retryGuest(code, name, token, attempt, peer);
      return;
    }
    giveUp(type === "peer-unavailable" ? MSG.noRoom : friendlyError(type));
  });
  if (!watchdogTimer) watchdogTimer = setInterval(watchConnections, 2000);
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
  // The host's chosen length. A shootout has no clock. 0 must not fall back to 5:00.
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
  touch.pointerId = e.pointerId;
  const fixed = typeof opt === "function" && opt("joyMode") === "fixed";
  if (fixed) {
    const r = joyBase.getBoundingClientRect();
    touch.baseX = r.left + r.width / 2; touch.baseY = r.top + r.height / 2;
  } else {
    touch.baseX = e.clientX; touch.baseY = e.clientY;
    joyBase.style.left = (e.clientX - 65) + "px"; joyBase.style.top = (e.clientY - 65) + "px"; joyBase.style.bottom = "auto";
  }
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
  const filtered = typeof joyFiltered === "function" ? joyFiltered(dx, dy, JOY_MAX) : { x: dx / JOY_MAX, y: dy / JOY_MAX };
  touch.x = filtered.x; touch.y = filtered.y;
  joyKnob.style.transform = "translate(" + dx + "px," + dy + "px)";
}
for (const [id, action] of [["shootBtn", "shoot"], ["passBtn", "pass"], ["sprintBtn", "sprint"], ["skillBtn", "skill"]]) {
  const el = $(id);
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (action === "sprint" && typeof opt === "function" && opt("sprintMode") === "toggle") {
      touch.sprintLatch = !touch.sprintLatch;
      el.classList.toggle("pressed", !!touch.sprintLatch);
      sendInput(true);
      return;
    }
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
  const sprint = (typeof opt === "function" && opt("sprintMode") === "toggle") ? !!touch.sprintLatch : held("sprint");
  const msg = { t: "input", mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, sprint: sprint, shoot: held("shoot"), pass: held("pass") };
  const str = JSON.stringify(msg);
  const now = performance.now();
  if (str !== lastInput || now - lastInputAt > 100 || force) {
    if (str === lastInput && force && now - lastInputAt < 15) return;
    sendMsg(msg); lastInput = str; lastInputAt = now;
  }
}


/* =====================================================================
   TEAM FLAGS
   Drawn here in code (no image files). National flags use their real
   colours and shapes. Blue Stars and Red Rockets are made-up teams, so
   their flags are original. Nothing here is a federation crest or a
   club / publisher logo.
   ===================================================================== */

// Width divided by height. These are the usual official proportions.
const FLAG_RATIO = {
  blue: 3 / 2, red: 3 / 2, custom: 3 / 2,
  bra: 10 / 7, arg: 14 / 9, fra: 3 / 2, eng: 5 / 3, ger: 5 / 3,
  esp: 3 / 2, por: 3 / 2, ned: 3 / 2, ita: 3 / 2, jpn: 3 / 2,
  usa: 19 / 10, mex: 7 / 4, nga: 2, kor: 3 / 2,
};
function flagRatio(id) { return FLAG_RATIO[id] || 3 / 2; }

function starPath(g, cx, cy, outer, inner, n, rot) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / n;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}
function shieldPath(g, cx, cy, w, h) {
  g.beginPath();
  g.moveTo(cx - w / 2, cy - h / 2);
  g.lineTo(cx + w / 2, cy - h / 2);
  g.lineTo(cx + w / 2, cy + h * 0.05);
  g.quadraticCurveTo(cx + w / 2, cy + h * 0.42, cx, cy + h / 2);
  g.quadraticCurveTo(cx - w / 2, cy + h * 0.42, cx - w / 2, cy + h * 0.05);
  g.closePath();
}

function paintFlag(g, id, w, h, colors) {
  const c = colors || ["#8e44ad", "#ffffff", "#8e44ad"];
  if (id === "custom") {
    const band = h / 3;
    g.fillStyle = c[0]; g.fillRect(0, 0, w, band + 0.5);
    g.fillStyle = c[1]; g.fillRect(0, band, w, band + 0.5);
    g.fillStyle = c[2]; g.fillRect(0, band * 2, w, h - band * 2);
    return;
  }
  if (id === "blue") {
    g.fillStyle = "#0b2a6b"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#f4f7fb";
    starPath(g, w * 0.5, h * 0.48, h * 0.28, h * 0.12, 5, -Math.PI / 2);
    g.fill();
    g.fillStyle = "#ffd33d";
    [[0.18, 0.22], [0.82, 0.22], [0.18, 0.78], [0.82, 0.78]].forEach((p) => {
      starPath(g, w * p[0], h * p[1], h * 0.07, h * 0.03, 5, -Math.PI / 2);
      g.fill();
    });
    return;
  }
  if (id === "red") {
    g.fillStyle = "#9d1024"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#5c0a16"; g.fillRect(0, 0, w * 0.28, h);
    g.fillStyle = "#f4f4f4";
    g.beginPath();
    g.moveTo(w * 0.46, h * 0.18);
    g.lineTo(w * 0.62, h * 0.38);
    g.lineTo(w * 0.54, h * 0.38);
    g.lineTo(w * 0.54, h * 0.78);
    g.lineTo(w * 0.38, h * 0.78);
    g.lineTo(w * 0.38, h * 0.38);
    g.lineTo(w * 0.30, h * 0.38);
    g.closePath();
    g.fill();
    g.fillStyle = "#ffd33d";
    g.beginPath();
    g.moveTo(w * 0.46, h * 0.18);
    g.lineTo(w * 0.54, h * 0.34);
    g.lineTo(w * 0.38, h * 0.34);
    g.closePath();
    g.fill();
    return;
  }
  if (id === "bra") return paintBrazil(g, w, h);
  if (id === "arg") return paintArgentina(g, w, h);
  if (id === "fra") return stripesV(g, w, h, ["#002395", "#ffffff", "#ED2939"]);
  if (id === "ita") return stripesV(g, w, h, ["#009246", "#ffffff", "#CE2B37"]);
  if (id === "nga") return stripesV(g, w, h, ["#008751", "#ffffff", "#008751"]);
  if (id === "eng") return paintEngland(g, w, h);
  if (id === "ger") return stripesH(g, w, h, ["#000000", "#DD0000", "#FFCE00"]);
  if (id === "ned") return stripesH(g, w, h, ["#AE1C28", "#ffffff", "#21468B"]);
  if (id === "esp") return paintSpain(g, w, h);
  if (id === "por") return paintPortugal(g, w, h);
  if (id === "jpn") return paintJapan(g, w, h);
  if (id === "usa") return paintUSA(g, w, h);
  if (id === "mex") return paintMexico(g, w, h);
  if (id === "kor") return paintKorea(g, w, h);
  stripesH(g, w, h, c);
}
function stripesV(g, w, h, cols) {
  const bw = w / cols.length;
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * bw, 0, bw + 0.5, h); });
}
function stripesH(g, w, h, cols) {
  const bh = h / cols.length;
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * bh, w, bh + 0.5); });
}
function paintEngland(g, w, h) {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#CF142B";
  const t = h / 5;
  g.fillRect(0, (h - t) / 2, w, t);
  g.fillRect((w - t) / 2, 0, t, h);
}
function paintJapan(g, w, h) {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#BC002D";
  g.beginPath();
  g.arc(w / 2, h / 2, h * 0.3, 0, Math.PI * 2);
  g.fill();
}
function paintBrazil(g, w, h) {
  g.fillStyle = "#009B3A"; g.fillRect(0, 0, w, h);
  const m = h * 0.07;
  g.fillStyle = "#FEDD00";
  g.beginPath();
  g.moveTo(w / 2, m);
  g.lineTo(w - m * 1.2, h / 2);
  g.lineTo(w / 2, h - m);
  g.lineTo(m * 1.2, h / 2);
  g.closePath();
  g.fill();
  const cx = w / 2, cy = h / 2, r = h * 0.175;
  g.fillStyle = "#002776";
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.strokeStyle = "#ffffff";
  g.lineWidth = Math.max(1, r * 0.16);
  g.beginPath();
  g.arc(cx, cy + r * 0.72, r * 1.05, Math.PI * 1.18, Math.PI * 1.82);
  g.stroke();
  g.fillStyle = "#ffffff";
  const stars = [
    [0.02, -0.42, 0.16], [-0.34, -0.12, 0.09], [0.30, -0.2, 0.08],
    [-0.16, 0.08, 0.07], [0.12, 0.22, 0.1], [-0.02, 0.38, 0.06], [0.28, 0.08, 0.06],
  ];
  for (const s of stars) {
    starPath(g, cx + s[0] * r * 1.7, cy + s[1] * r * 1.5, r * s[2], r * s[2] * 0.4, 5, -Math.PI / 2);
    g.fill();
  }
  g.restore();
}
function paintSun(g, cx, cy, R) {
  g.fillStyle = "#F6B40E";
  g.beginPath();
  g.arc(cx, cy, R * 0.58, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const len = i % 2 === 0 ? R : R * 0.78;
    const spread = 0.055;
    g.beginPath();
    g.moveTo(cx + Math.cos(a - spread) * R * 0.5, cy + Math.sin(a - spread) * R * 0.5);
    g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    g.lineTo(cx + Math.cos(a + spread) * R * 0.5, cy + Math.sin(a + spread) * R * 0.5);
    g.closePath();
    g.fill();
  }
  if (R > 8) {
    g.fillStyle = "#C9840A";
    g.beginPath();
    g.arc(cx - R * 0.16, cy - R * 0.06, R * 0.055, 0, Math.PI * 2);
    g.arc(cx + R * 0.16, cy - R * 0.06, R * 0.055, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#C9840A";
    g.lineWidth = Math.max(0.8, R * 0.05);
    g.beginPath();
    g.arc(cx, cy + R * 0.06, R * 0.2, 0.25, Math.PI - 0.25);
    g.stroke();
  }
}
function paintArgentina(g, w, h) {
  stripesH(g, w, h, ["#74ACDF", "#ffffff", "#74ACDF"]);
  paintSun(g, w / 2, h / 2, h * 0.2);
}
function paintSpain(g, w, h) {
  g.fillStyle = "#AA151B"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#F1BF00"; g.fillRect(0, h / 4, w, h / 2);
  const cx = w * 0.3, cy = h / 2, sw = h * 0.3, sh = h * 0.46;
  shieldPath(g, cx, cy, sw, sh);
  g.fillStyle = "#F1BF00"; g.fill();
  g.save();
  shieldPath(g, cx, cy, sw, sh); g.clip();
  g.fillStyle = "#AA151B";
  g.fillRect(cx - sw / 2, cy - sh / 2, sw / 2, sh * 0.62);
  g.fillStyle = "#F1BF00";
  // A simple castle shape on the red half, and a small lion-coloured block on the yellow half.
  const bw = sw * 0.12, bh = sh * 0.22;
  g.fillRect(cx - sw * 0.38, cy - sh * 0.08, bw, bh);
  g.fillRect(cx - sw * 0.2, cy - sh * 0.16, bw, bh + sh * 0.08);
  g.fillRect(cx - sw * 0.02, cy - sh * 0.08, bw * 0.7, bh);
  g.fillStyle = "#C45C26";
  g.fillRect(cx + sw * 0.08, cy - sh * 0.18, sw * 0.28, sh * 0.36);
  g.fillStyle = "#003399";
  g.beginPath();
  g.arc(cx, cy + sh * 0.12, sw * 0.12, 0, Math.PI * 2);
  g.fill();
  g.restore();
  shieldPath(g, cx, cy, sw, sh);
  g.strokeStyle = "#7A5A10";
  g.lineWidth = Math.max(1, h * 0.015);
  g.stroke();
}
function paintPortugal(g, w, h) {
  g.fillStyle = "#006600"; g.fillRect(0, 0, w * 0.4, h);
  g.fillStyle = "#FF0000"; g.fillRect(w * 0.4, 0, w * 0.6, h);
  const cx = w * 0.4, cy = h * 0.5, R = h * 0.27;
  g.strokeStyle = "#FFD700";
  g.lineWidth = Math.max(1, R * 0.1);
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(cx, cy, R * 0.62, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  g.moveTo(cx - R, cy); g.lineTo(cx + R, cy);
  g.moveTo(cx, cy - R); g.lineTo(cx, cy + R);
  g.stroke();
  const sw = R * 0.72, sh = R * 0.95;
  shieldPath(g, cx, cy, sw, sh);
  g.fillStyle = "#ffffff"; g.fill();
  g.save();
  shieldPath(g, cx, cy, sw, sh); g.clip();
  g.fillStyle = "#003399";
  [[0, -0.22], [-0.22, 0], [0.22, 0], [0, 0.2], [0, 0]].forEach((p) => {
    g.beginPath();
    g.arc(cx + p[0] * sw, cy + p[1] * sh, sw * 0.075, 0, Math.PI * 2);
    g.fill();
  });
  g.restore();
  shieldPath(g, cx, cy, sw, sh);
  g.strokeStyle = "#CC0000";
  g.lineWidth = Math.max(1, sw * 0.08);
  g.stroke();
}
function paintUSA(g, w, h) {
  const stripe = h / 13;
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 === 0 ? "#B22234" : "#FFFFFF";
    g.fillRect(0, i * stripe, w, stripe + 0.6);
  }
  const cw = w * 0.4, ch = stripe * 7;
  g.fillStyle = "#3C3B6E";
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = "#FFFFFF";
  const sr = Math.min(cw / 14, ch / 18);
  for (let row = 0; row < 9; row++) {
    const n = row % 2 === 0 ? 6 : 5;
    for (let col = 0; col < n; col++) {
      const x = row % 2 === 0 ? cw * (col + 0.5) / 6 : cw * (col + 1) / 6;
      const y = ch * (row + 0.5) / 9;
      if (sr < 1.15) g.fillRect(x - 0.55, y - 0.55, 1.1, 1.1);
      else { starPath(g, x, y, sr, sr * 0.4, 5, -Math.PI / 2); g.fill(); }
    }
  }
}
function paintMexico(g, w, h) {
  stripesV(g, w, h, ["#006847", "#ffffff", "#CE1126"]);
  const s = h * 0.34, cx = w / 2, cy = h / 2;
  g.strokeStyle = "#1B7A32";
  g.lineWidth = Math.max(1, s * 0.08);
  g.beginPath();
  g.arc(cx - s * 0.12, cy + s * 0.08, s * 0.42, Math.PI * 0.55, Math.PI * 1.65);
  g.stroke();
  g.beginPath();
  g.arc(cx + s * 0.12, cy + s * 0.08, s * 0.42, Math.PI * 1.35, Math.PI * 0.45);
  g.stroke();
  g.fillStyle = "#5C8A1A";
  g.fillRect(cx - s * 0.05, cy - s * 0.2, s * 0.1, s * 0.5);
  g.beginPath();
  g.arc(cx - s * 0.16, cy, s * 0.09, 0, Math.PI * 2);
  g.arc(cx + s * 0.16, cy + s * 0.04, s * 0.09, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#3A2A1A";
  g.beginPath();
  g.ellipse(cx + s * 0.02, cy - s * 0.16, s * 0.16, s * 0.09, -0.5, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(cx - s * 0.12, cy - s * 0.24, s * 0.055, 0, Math.PI * 2);
  g.fill();
}
function trigram(g, x, y, angle, bits, size) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = "#111111";
  const gap = size * 0.42, th = size * 0.16, bw = size;
  for (let i = 0; i < 3; i++) {
    const yy = (i - 1) * gap;
    if (bits[i]) g.fillRect(-bw / 2, yy - th / 2, bw, th);
    else {
      const seg = bw * 0.38;
      g.fillRect(-bw / 2, yy - th / 2, seg, th);
      g.fillRect(bw / 2 - seg, yy - th / 2, seg, th);
    }
  }
  g.restore();
}
function paintKorea(g, w, h) {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = h * 0.25;
  // Red on top, blue underneath, split in the taegeuk S.
  g.save();
  g.translate(cx, cy);
  g.fillStyle = "#CD2E3A";
  g.beginPath();
  g.arc(0, 0, r, Math.PI, 0, false);
  g.arc(r / 2, 0, r / 2, 0, Math.PI, false);
  g.arc(-r / 2, 0, r / 2, Math.PI, 0, true);
  g.fill();
  g.fillStyle = "#0047A0";
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI, false);
  g.arc(-r / 2, 0, r / 2, Math.PI, 0, false);
  g.arc(r / 2, 0, r / 2, 0, Math.PI, true);
  g.fill();
  g.restore();
  const s = h * 0.16;
  trigram(g, w * 0.25, h * 0.2, -Math.PI / 4, [1, 1, 1], s);
  trigram(g, w * 0.75, h * 0.2, Math.PI / 4, [0, 1, 0], s);
  trigram(g, w * 0.25, h * 0.8, -Math.PI * 0.75, [1, 0, 1], s);
  trigram(g, w * 0.75, h * 0.8, Math.PI * 0.75, [0, 0, 0], s);
}

const FLAG_CACHE = new Map();
function flagCanvas(id, cssH, scale, colors) {
  const key = id + "@" + cssH + "x" + scale + "|" + (colors ? colors.join(",") : "");
  const hit = FLAG_CACHE.get(key);
  if (hit) return hit;
  const ratio = flagRatio(id);
  const h = Math.max(8, Math.round(cssH * scale));
  const w = Math.max(8, Math.round(h * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  paintFlag(canvas.getContext("2d"), id, w, h, colors);
  const entry = { canvas, ratio, url: "" };
  FLAG_CACHE.set(key, entry);
  if (FLAG_CACHE.size > 96) FLAG_CACHE.delete(FLAG_CACHE.keys().next().value);
  return entry;
}
function flagDataUrl(id, cssH, colors) {
  const art = flagCanvas(id, cssH, 3, colors);
  if (!art.url) art.url = art.canvas.toDataURL("image/png");
  return art.url;
}
function flagColorsOf(team) {
  if (!team) return null;
  if (team.home) return team.home;
  if (team.kit) return [team.kit.shirt, team.kit.shorts, team.kit.socks];
  return null;
}
// HTML badge. Bigger ones get a slow wave and a shine. The picture is
// drawn at 3x so it stays sharp on a phone screen.
function flagHtml(team, height, opts) {
  opts = opts || {};
  const id = (team && team.id) || (typeof team === "string" ? team : "blue");
  const colors = flagColorsOf(team);
  const src = flagDataUrl(id, height, colors);
  const w = Math.round(height * flagRatio(id));
  const wave = opts.wave && height >= 30;
  return "<span class='flagBadge" + (wave ? " wave" : "") + "' style='height:" + height + "px;width:" + w + "px'>" +
    "<img alt='' width='" + w + "' height='" + height + "' src='" + src + "'>" +
    (height >= 22 ? "<i class='shine'></i>" : "") + "</span>";
}

function flagRound(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
// Canvas badge for the scoreboard and the stands. The flag picture is
// cached; only the shine moves.
function drawFlagBadge(ctx, id, x, y, cssH, opts) {
  opts = opts || {};
  const dpr = Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const art = flagCanvas(id, cssH, Math.max(2, dpr), opts.colors);
  const w = cssH * art.ratio;
  const h = cssH;
  const rad = Math.max(2, h * 0.14);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = Math.max(2, h * 0.18);
  ctx.shadowOffsetY = Math.max(1, h * 0.06);
  flagRound(ctx, x, y, w, h, rad);
  ctx.fillStyle = "#0c1218";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();
  ctx.drawImage(art.canvas, x, y, w, h);
  if (opts.t == null) {
    const grd = ctx.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, "rgba(255,255,255,0.28)");
    grd.addColorStop(0.42, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x, y, w, h * 0.55);
  } else {
    const gx = x + (opts.t * 1.8 - 0.4) * w;
    const grd = ctx.createLinearGradient(gx, y, gx + w * 0.28, y + h);
    grd.addColorStop(0, "rgba(255,255,255,0)");
    grd.addColorStop(0.5, "rgba(255,255,255,0.32)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  ctx.save();
  flagRound(ctx, x + 0.5, y + 0.5, w - 1, h - 1, rad);
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  return w;
}

/* =====================================================================
   SETTINGS - one list of options, saved on this device
   ---------------------------------------------------------------------
   Add a setting by putting a field in SETTINGS_TABS. The menu, the
   save file and Reset to defaults all come from that list.
   Gameplay rules here are for matches on this device. Online, the
   host's room choices are the ones that count.
   ===================================================================== */
const SETTINGS_KEY = "soccerOptions";

const SETTINGS_TABS = [
  {
    id: "controls", title: "Controls",
    fields: [
      { id: "lookTouch", label: "Look sensitivity (touch)", type: "range", min: 0.4, max: 2, step: 0.1, def: 1 },
      { id: "lookMouse", label: "Look sensitivity (mouse)", type: "range", min: 0.4, max: 2, step: 0.1, def: 1 },
      { id: "joySens", label: "Joystick sensitivity", type: "range", min: 0.5, max: 1.8, step: 0.1, def: 1 },
      { id: "joyDead", label: "Joystick dead zone", type: "range", min: 0, max: 0.4, step: 0.05, def: 0.15 },
      { id: "invertY", label: "Invert look up and down", type: "toggle", def: false },
      { id: "joyMode", label: "Joystick", type: "select", def: "float", options: [
        { v: "float", label: "Floating" }, { v: "fixed", label: "Fixed" } ] },
      { id: "btnSize", label: "Touch button size", type: "range", min: 0.7, max: 1.4, step: 0.05, def: 1 },
      { id: "btnOpacity", label: "Touch button opacity", type: "range", min: 0.35, max: 1, step: 0.05, def: 0.85 },
      { id: "leftHand", label: "Left-handed layout", type: "toggle", def: false },
      { id: "haptics", label: "Vibration", type: "toggle", def: false, help: "Only on phones that support it." },
      { id: "autoSwitch", label: "Auto-switch player", type: "select", def: "assisted", options: [
        { v: "off", label: "Off" }, { v: "assisted", label: "Assisted" }, { v: "auto", label: "Auto" } ] },
      { id: "assist", label: "Pass and shot help", type: "select", def: "medium", options: [
        { v: "low", label: "Low" }, { v: "medium", label: "Medium" }, { v: "high", label: "High" } ] },
      { id: "sprintMode", label: "Sprint", type: "select", def: "hold", options: [
        { v: "hold", label: "Hold to sprint" }, { v: "toggle", label: "Tap to sprint" } ] },
      { id: "hints", label: "Show control hints", type: "toggle", def: true },
    ],
  },
  {
    id: "camera", title: "Camera",
    fields: [
      { id: "camDefault", label: "Default camera", type: "select", def: "tv", options: [
        { v: "tv", label: "Broadcast" }, { v: "close", label: "Close" }, { v: "fp", label: "First person" } ] },
      { id: "camZoom", label: "Camera zoom", type: "range", min: 0.8, max: 1.4, step: 0.05, def: 1 },
      { id: "camHeight", label: "Camera height", type: "range", min: 0.7, max: 1.3, step: 0.05, def: 1 },
      { id: "fpFov", label: "First-person view angle", type: "range", min: 75, max: 90, step: 1, def: 84, suffix: "°" },
      { id: "headBob", label: "Head bob", type: "toggle", def: true },
      { id: "shake", label: "Screen shake", type: "toggle", def: true },
      { id: "replays", label: "Goal replays", type: "toggle", def: true },
    ],
  },
  {
    id: "game", title: "Gameplay",
    note: "These apply to matches on this device. In an online game, the host's rules are used.",
    fields: [
      { id: "difficulty", label: "Computer difficulty", type: "select", def: "normal", options: [
        { v: "easy", label: "Easy" }, { v: "normal", label: "Normal" }, { v: "hard", label: "Hard" }, { v: "legendary", label: "Legendary" } ] },
      { id: "matchLength", label: "Default match length", type: "select", def: 5, options: [
        { v: 1, label: "1 minute" }, { v: 2, label: "2 minutes" }, { v: 3, label: "3 minutes" },
        { v: 5, label: "5 minutes" }, { v: 10, label: "10 minutes" }, { v: 15, label: "15 minutes" }, { v: 20, label: "20 minutes" } ] },
      { id: "offside", label: "Offside", type: "toggle", def: true },
      { id: "cards", label: "Fouls and cards", type: "toggle", def: true },
      { id: "stoppage", label: "Injury and stoppage time", type: "toggle", def: false },
      { id: "ballSpeed", label: "Ball speed", type: "range", min: 0.85, max: 1.25, step: 0.05, def: 1 },
      { id: "gameSpeed", label: "Game speed", type: "range", min: 0.7, max: 1.3, step: 0.05, def: 1 },
    ],
  },
  {
    id: "display", title: "Display",
    fields: [
      { id: "quality", label: "Graphics", type: "select", def: "auto", options: [
        { v: "auto", label: "Auto" }, { v: "low", label: "Low" }, { v: "medium", label: "Medium" }, { v: "high", label: "High" } ] },
      { id: "fpsCap", label: "Frame rate", type: "select", def: 60, options: [
        { v: 30, label: "30 fps" }, { v: 60, label: "60 fps" } ] },
      { id: "showRadar", label: "Radar", type: "toggle", def: true },
      { id: "showNames", label: "Player names", type: "toggle", def: true },
      { id: "showStamina", label: "Stamina bars", type: "toggle", def: true },
      { id: "showFps", label: "FPS counter", type: "toggle", def: false },
      { id: "hudSize", label: "HUD size", type: "range", min: 0.8, max: 1.5, step: 0.05, def: 1 },
      { id: "colorblind", label: "Colorblind-friendly colors", type: "toggle", def: false },
    ],
  },
  {
    id: "audio", title: "Audio",
    fields: [
      { id: "master", label: "Master volume", type: "range", min: 0, max: 1, step: 0.05, def: 1 },
      { id: "crowd", label: "Crowd", type: "range", min: 0, max: 1, step: 0.05, def: 1 },
      { id: "sfx", label: "Sound effects", type: "range", min: 0, max: 1, step: 0.05, def: 1 },
      { id: "whistle", label: "Whistle", type: "range", min: 0, max: 1, step: 0.05, def: 1 },
      { id: "mute", label: "Mute", type: "toggle", def: false },
    ],
  },
  {
    id: "access", title: "Accessibility",
    fields: [
      { id: "bigText", label: "Bigger text", type: "toggle", def: false },
      { id: "reduceMotion", label: "Reduce motion", type: "toggle", def: false, help: "Turns off shake, head bob and speed blur." },
      { id: "contrast", label: "High contrast outlines", type: "toggle", def: false },
    ],
  },
];

function settingsFields() {
  const all = [];
  for (const tab of SETTINGS_TABS) for (const f of tab.fields) all.push(f);
  return all;
}
function settingsField(id) {
  return settingsFields().find((f) => f.id === id) || null;
}
function coerceSetting(field, value) {
  if (!field) return value;
  if (field.type === "toggle") return !!value;
  if (field.type === "range") return clamp(Number(value), field.min, field.max);
  if (field.type === "select") {
    const ok = field.options.some((o) => String(o.v) === String(value));
    return ok ? (typeof field.def === "number" ? Number(value) : value) : field.def;
  }
  return value;
}

const GameSettings = {
  values: {},
  tab: "controls",
  load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; } catch (e) { saved = {}; }
    for (const f of settingsFields()) {
      this.values[f.id] = saved[f.id] == null ? f.def : coerceSetting(f, saved[f.id]);
    }
    if (saved.matchLength == null && typeof loadSavedMinutes === "function") {
      this.values.matchLength = loadSavedMinutes().minutes;
    }
  },
  save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.values)); } catch (e) { /* private mode */ }
  },
  get(id) {
    if (this.values[id] == null) {
      const f = settingsField(id);
      return f ? f.def : undefined;
    }
    return this.values[id];
  },
  set(id, value, quiet) {
    const f = settingsField(id);
    if (!f) return;
    this.values[id] = coerceSetting(f, value);
    this.save();
    if (!quiet) {
      applySettings();
      const label = document.querySelector("[data-val='" + id + "']");
      if (label && f.type === "range") {
        label.textContent = f.suffix ? Math.round(this.values[id]) + f.suffix : (Math.round(this.values[id] * 100) / 100);
      } else this.paint();
    }
  },
  resetTab(tabId) {
    const tab = SETTINGS_TABS.find((t) => t.id === tabId);
    if (!tab) return;
    for (const f of tab.fields) this.values[f.id] = f.def;
    this.save();
    applySettings();
    this.paint();
  },
  open(tabId) {
    if (tabId) this.tab = tabId;
    const root = document.getElementById("settingsScreen");
    if (root) root.classList.remove("hidden");
    this.paint();
  },
  close() {
    const root = document.getElementById("settingsScreen");
    if (root) root.classList.add("hidden");
  },
  paint() { paintSettings(); },
};

function opt(id) { return GameSettings.get(id); }
function onlineMatch() { return typeof netRole === "string" && !!netRole; }
function frameGate(now) {
  const cap = Number(opt("fpsCap")) === 30 ? 30 : 60;
  if (cap >= 60) return true;
  if (!frameGate.t) frameGate.t = now;
  if (now - frameGate.t < 32) return false;
  frameGate.t = now;
  return true;
}
function hudScale() {
  let s = Number(opt("hudSize")) || 1;
  if (opt("bigText")) s *= 1.15;
  return clamp(s, 0.8, 1.6);
}
function joyFiltered(dx, dy, max) {
  const sens = Number(opt("joySens")) || 1;
  const dead = Number(opt("joyDead"));
  let x = (dx / max) * sens, y = (dy / max) * sens;
  const len = Math.hypot(x, y);
  if (len < (isFinite(dead) ? dead : 0.15)) return { x: 0, y: 0 };
  if (len > 1) { x /= len; y /= len; }
  return { x: x, y: y };
}
function haptic(ms) {
  if (!opt("haptics") || !navigator.vibrate) return;
  try { navigator.vibrate(ms); } catch (e) { /* not allowed */ }
}

function applySettings() {
  const g = GameSettings.values;
  const root = document.documentElement;
  root.style.setProperty("--touch-scale", String(g.btnSize || 1));
  root.style.setProperty("--touch-opacity", String(g.btnOpacity == null ? 0.85 : g.btnOpacity));
  root.classList.toggle("left-hand", !!g.leftHand);
  root.classList.toggle("big-text", !!g.bigText);
  root.classList.toggle("reduce-motion", !!g.reduceMotion);
  root.classList.toggle("high-contrast", !!g.contrast);
  root.classList.toggle("colorblind", !!g.colorblind);
  root.classList.toggle("hide-hints", !g.hints);

  if (typeof setCameraFP === "function") {
    if (g.camDefault === "fp") setCameraFP(true);
    else setCameraFP(false);
  }
  if (typeof fpShakeOn !== "undefined") fpShakeOn = !g.reduceMotion && !!g.shake;
  if (typeof quality !== "undefined" && g.quality && g.quality !== "auto") {
    if (quality !== g.quality) quality = g.quality;
  }

  if (typeof Sound !== "undefined" && Sound.applyMix) Sound.applyMix(g);

  if (!onlineMatch() && typeof settings !== "undefined" && settings) {
    settings.difficulty = g.difficulty || settings.difficulty;
    if (settings.rules) {
      settings.rules.offside = !!g.offside;
      settings.rules.cards = !!g.cards;
    }
    const off = document.getElementById("ruleOffside");
    const cards = document.getElementById("ruleCards");
    if (off) off.checked = !!g.offside;
    if (cards) cards.checked = !!g.cards;
    if (typeof chooseMatchLength === "function" && settings.minutes !== g.matchLength) {
      chooseMatchLength(g.matchLength, false);
    } else if (typeof renderMenu === "function") renderMenu();
    if (typeof sim !== "undefined" && sim && sim.game) pushMatchTune();
  }
  if (typeof createDiff !== "undefined") {
    const d = g.difficulty === "legendary" ? "hard" : g.difficulty;
    if (d === "easy" || d === "normal" || d === "hard") createDiff = d;
  }
}

function pushMatchTune() {
  if (onlineMatch() || typeof sim === "undefined" || !sim || !sim.game) return;
  const g = GameSettings.values;
  sim.game.difficulty = g.difficulty || sim.game.difficulty;
  if (sim.game.rules) {
    sim.game.rules.offside = !!g.offside;
    sim.game.rules.cards = !!g.cards;
  }
  sim.game.tune = {
    assist: g.assist || "medium",
    autoSwitch: g.autoSwitch || "assisted",
    ball: Number(g.ballSpeed) || 1,
    stoppage: !!g.stoppage,
  };
}

function paintSettings() {
  const tabs = document.getElementById("settingsTabs");
  const body = document.getElementById("settingsBody");
  if (!tabs || !body) return;
  tabs.innerHTML = SETTINGS_TABS.map((t) =>
    "<button type='button' data-stab='" + t.id + "'" + (t.id === GameSettings.tab ? " class='on'" : "") + ">" + t.title + "</button>"
  ).join("");
  const tab = SETTINGS_TABS.find((t) => t.id === GameSettings.tab) || SETTINGS_TABS[0];
  let html = tab.note ? "<p class='setNote'>" + tab.note + "</p>" : "";
  for (const f of tab.fields) {
    const v = GameSettings.values[f.id];
    html += "<label class='setRow'><span>" + f.label + "</span>";
    if (f.type === "toggle") {
      html += "<input type='checkbox' data-set='" + f.id + "'" + (v ? " checked" : "") + ">";
    } else if (f.type === "range") {
      const shown = f.suffix ? Math.round(v) + f.suffix : (Math.round(v * 100) / 100);
      html += "<span class='setRange'><input type='range' data-set='" + f.id + "' min='" + f.min + "' max='" + f.max + "' step='" + f.step + "' value='" + v + "'><b data-val='" + f.id + "'>" + shown + "</b></span>";
    } else if (f.type === "select") {
      html += "<select data-set='" + f.id + "'>" + f.options.map((o) =>
        "<option value='" + o.v + "'" + (String(o.v) === String(v) ? " selected" : "") + ">" + o.label + "</option>"
      ).join("") + "</select>";
    }
    html += "</label>";
    if (f.help) html += "<p class='setHelp'>" + f.help + "</p>";
  }
  html += "<div class='setReset'><button type='button' id='settingsReset'>Reset to defaults</button></div>";
  body.innerHTML = html;
  tabs.querySelectorAll("[data-stab]").forEach((b) => b.addEventListener("click", () => {
    GameSettings.tab = b.dataset.stab;
    GameSettings.paint();
  }));
  body.querySelectorAll("[data-set]").forEach((el) => {
    const id = el.dataset.set;
    const go = () => {
      let value = el.type === "checkbox" ? el.checked : el.value;
      GameSettings.set(id, value);
    };
    el.addEventListener("input", go);
    el.addEventListener("change", go);
  });
  const reset = document.getElementById("settingsReset");
  if (reset) reset.addEventListener("click", () => GameSettings.resetTab(tab.id));
}

function mountSettings() {
  if (document.getElementById("settingsScreen")) return;
  const style = document.createElement("style");
  style.textContent = `
    #settingsScreen.hidden { display: none !important; }
    #settingsScreen {
      position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
      background: rgba(4, 8, 16, .72); padding: 12px;
      padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
    }
    #settingsCard {
      width: min(860px, 100%); max-height: min(92dvh, 760px); display: flex; flex-direction: column;
      background: linear-gradient(180deg, #121a2b, #0c121c); color: #fff;
      border: 1px solid rgba(232, 197, 71, .45); border-radius: 18px; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0,0,0,.5); font-family: "Trebuchet MS", Arial, sans-serif;
    }
    #settingsHead { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #0e1626; border-bottom: 1px solid rgba(255,255,255,.08); }
    #settingsHead h2 { margin: 0; flex: 1; font-size: 22px; letter-spacing: .4px; }
    #settingsHead h2 span { color: #e8c547; margin-right: 8px; }
    #settingsClose { min-width: 44px; min-height: 44px; border-radius: 10px; border: 1px solid rgba(255,255,255,.3); background: #1d4e34; color: #fff; font: inherit; font-weight: 700; }
    #settingsTabs { display: flex; gap: 6px; padding: 8px 10px; overflow-x: auto; background: #101826; }
    #settingsTabs button { flex: 0 0 auto; min-height: 44px; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.2); background: transparent; color: #d5dbe6; font: inherit; font-weight: 700; }
    #settingsTabs button.on { background: #e8c547; color: #1a1404; border-color: #e8c547; }
    #settingsBody { overflow: auto; padding: 8px 16px 18px; -webkit-overflow-scrolling: touch; }
    .setNote, .setHelp { margin: 4px 0 10px; color: #ffd27a; font-size: 14px; line-height: 1.4; }
    .setRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; border-bottom: 1px solid rgba(255,255,255,.06); font-size: 16px; }
    .setRow span { flex: 1; }
    .setRow select, .setRange { font: inherit; }
    .setRow select { min-height: 44px; min-width: 140px; border-radius: 10px; border: 1px solid rgba(255,255,255,.3); background: #0d2818; color: #fff; padding: 0 8px; }
    .setRow input[type=checkbox] { width: 28px; height: 28px; accent-color: #e8c547; }
    .setRange { display: flex; align-items: center; gap: 8px; min-width: min(240px, 46vw); }
    .setRange input { flex: 1; min-height: 44px; }
    .setRange b { min-width: 42px; text-align: right; color: #e8c547; }
    .setReset { text-align: center; margin-top: 14px; }
    #settingsReset { min-height: 44px; padding: 8px 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,.3); background: #243044; color: #fff; font: inherit; font-weight: 700; }
    .gearBtn { min-height: 44px; }
    html.big-text, html.big-text button, html.big-text select { font-size: 18px; }
    html.hide-hints #keysHint, html.hide-hints #controlsHelp, html.hide-hints #pauseHelp, html.hide-hints #matchHelp { display: none !important; }
    .tbtn { opacity: var(--touch-opacity, .85); }
    html.left-hand #touchControls { transform: scaleX(-1); }
    html.left-hand #touchControls .tbtn { transform: scale(var(--touch-scale, 1)) scaleX(-1); }
    html:not(.left-hand) #touchControls .tbtn { transform: scale(var(--touch-scale, 1)); }
    #joyBase, #joyBase2 { transform: scale(var(--touch-scale, 1)); }
  `;
  document.head.appendChild(style);
  const screen = document.createElement("div");
  screen.id = "settingsScreen";
  screen.className = "hidden";
  screen.innerHTML = "<div id='settingsCard'><div id='settingsHead'><h2><span>⚙</span>Settings</h2><button type='button' id='settingsClose' aria-label='Close'>Close</button></div><div id='settingsTabs'></div><div id='settingsBody'></div></div>";
  document.body.appendChild(screen);
  document.getElementById("settingsClose").addEventListener("click", () => GameSettings.close());
  screen.addEventListener("pointerdown", (e) => { if (e.target === screen) GameSettings.close(); });
  ["settingsBtn", "pauseSettingsBtn", "onlineSettingsBtn", "menuSettingsBtn"].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      GameSettings.open();
    });
  });
  window.addEventListener("keydown", (e) => {
    const open = screen && !screen.classList.contains("hidden");
    if (!open) return;
    if (e.key === "Escape") GameSettings.close();
  });
}

function bootSettings() {
  GameSettings.load();
  mountSettings();
  applySettings();
}
setTimeout(bootSettings, 0);

/* =====================================================================
   DRAWING - shared by the offline game and the online client
   ---------------------------------------------------------------------
   Broadcast camera: the pitch is seen from the sideline, up in the
   stands, the way a television match is shown. World x runs goal to
   goal (left/right on screen). World y runs from the far touchline to
   the near one (up/down, with perspective). World z is height.

   Uses the globals game, players, ball, controllers and the helpers
   each shell provides: isLocal, labelFor, hudSubtitle, showHud,
   localActives, keysHint, rosterList, inMatch, touchActive,
   controllerOf, isHumanControlled.
   ===================================================================== */

// =====================================================================
// CAMERA
// =====================================================================
let VIEW_W = 1000, VIEW_H = 640;
const ZMUL = 1.35; // how tall a world-unit of height is, compared with the ground scale

let viewTime = 0;
let lastDt = 0.016;

function depthT(y) {
  const grow = typeof FIELD === "number" ? FIELD : 1;
  const y0 = PITCH.top - 220 * grow;
  const y1 = PITCH.bottom + 180 * grow;
  return clamp((y - y0) / (y1 - y0), 0, 1);
}
function smooth01(t) { return t * t * (3 - 2 * t); }
// A phone touch screen. Desktop keeps the original TV framing.
function phonePlay() {
  return typeof touchActive === "function" && touchActive();
}
function camShape() {
  const land = VIEW_W / Math.max(1, VIEW_H) > 1.15;
  // On a phone the buttons sit in the bottom corners. Pull the near
  // touchline up so the ball is not hidden under them, and keep the
  // players big enough to see.
  if (phonePlay()) {
    return land
      ? { far: 0.10, near: 0.70, sFar: 0.62, sNear: 1.05 }
      : { far: 0.12, near: 0.56, sFar: 0.64, sNear: 0.98 };
  }
  return land
    ? { far: 0.11, near: 0.90, sFar: 0.66, sNear: 1.16 }
    : { far: 0.20, near: 0.76, sFar: 0.70, sNear: 1.04 };
}
function scaleAtT(t, zoom) {
  const L = camShape();
  return lerp(L.sFar, L.sNear, smooth01(t)) * (zoom || 1);
}
function groundYAt(t) {
  const L = camShape();
  return lerp(L.far, L.near, smooth01(t)) * VIEW_H;
}
// ---- First person (local only: it is never sent online) ----
// "tv" is the sideline broadcast camera. "fp" is the view from just
// behind the player you control, looking the way he faces.
let cameraFP = false;
let fpFollowId = null;
function loadCameraMode() {
  try { cameraFP = localStorage.getItem("soccerCamera") === "fp"; } catch (e) { /* ignore */ }
  syncViewBtn();
}
function setCameraFP(on) {
  cameraFP = !!on;
  try { localStorage.setItem("soccerCamera", cameraFP ? "fp" : "tv"); } catch (e) { /* ignore */ }
  syncViewBtn();
}
function toggleCamera() { setCameraFP(!cameraFP); }
function syncViewBtn() {
  const btn = document.getElementById("viewBtn");
  if (!btn) return;
  btn.textContent = cameraFP ? "1ST" : "TV";
  btn.classList.toggle("on", cameraFP);
  btn.title = cameraFP ? "First person (C)" : "TV camera (C)";
}
function noteFpFollow(id) { if (id) fpFollowId = id; }
// Penalties stay on the TV camera: up and down on the stick aim the kick.
function fpAllowed() {
  if (!cameraFP || !game) return false;
  if (typeof isReplaying === "function" && isReplaying()) return false;
  if (game.penalty && (game.phase === "setpiece" || game.phase === "shootout" || game.phase === "pkflight")) return false;
  return game.phase === "play" || game.phase === "setpiece" || game.phase === "dead";
}
function fpSubject() {
  if (!fpAllowed()) return null;
  if (typeof isLocal !== "function" || !controllers) return null;
  const mine = controllers.filter((c) => c && !c.cpu && c.active && !c.active.sentOff && isLocal(c));
  if (!mine.length) return null;
  return (mine.find((c) => c.id === fpFollowId) || mine[0]).active;
}
// Stick / keys match the picture. Up moves the way the camera looks.
// The match still hears ordinary world directions, so online stays the same.
function cameraStick(mx, my) {
  const sub = fpSubject();
  if (!sub || !fpView) return { mx, my };
  const fx = fpView.flatX, fy = fpView.flatY;
  const rx = -fy, ry = fx;
  return { mx: rx * mx - fx * my, my: ry * mx - fy * my };
}
// First-person camera. Local only: nothing here is sent online.
// Eyes at 1.75 m, a wide natural view, with the turn lagging a little
// behind the body so it does not snap.
let fpShakeOn = true;
try { fpShakeOn = localStorage.getItem("soccerFpShake") !== "off"; } catch (e) { /* ignore */ }
const fpCam = {
  yaw: 0, pitch: 0.12, bob: 0, amp: 0, dip: 0,
  fovExtra: 0, shake: 0, sprint: 0,
  inited: false, prevState: "", kickSeen: false, prevSpeed: 0,
};
let fpView = null;
let fpShakeRect = null;
function fpMetre() { return (typeof METRE === "number" && METRE) || (PITCH.w / 105); }
function wrapAng(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function updateFpCamera(dt) {
  const sub = fpSubject();
  if (!sub) { fpView = null; fpCam.inited = false; return; }
  dt = Math.min(0.05, dt || 0.016);
  const m = fpMetre();
  const bodyYaw = Math.atan2(sub.fy || 0, sub.fx || 1);
  if (!fpCam.inited) {
    fpCam.yaw = bodyYaw;
    fpCam.pitch = 0.12;
    fpCam.inited = true;
  }
  fpCam.userYaw = (fpCam.userYaw || 0) * Math.exp(-dt * 0.45);
  fpCam.userPitch = (fpCam.userPitch || 0) * Math.exp(-dt * 0.85);
  let targetYaw = bodyYaw + (fpCam.userYaw || 0);
  const heightBias = typeof opt === "function" ? ((Number(opt("camHeight")) || 1) - 1) * 0.12 : 0;
  let targetPitch = 0.11 + heightBias;
  if (ball) {
    const dx = ball.x - sub.x, dy = ball.y - sub.y;
    const dist = Math.hypot(dx, dy) || 1;
    const err = wrapAng(Math.atan2(dy, dx) - bodyYaw);
    if (Math.abs(err) < 1.15) {
      const w = clamp(0.42 * (1 - dist / (16 * m)), 0, 0.42);
      targetYaw = bodyYaw + err * w;
      const toBall = Math.atan2((ball.z || 0) - 1.75 * m, dist);
      targetPitch = 0.11 + heightBias + clamp(toBall - 0.11, -0.2, 0.22) * (Math.abs(err) < 0.85 ? 0.4 : 0.12);
    }
  }
  const yawK = 1 - Math.exp(-dt * 7.2);
  const pitchK = 1 - Math.exp(-dt * 5.5);
  fpCam.yaw += wrapAng(targetYaw - fpCam.yaw) * yawK;
  fpCam.pitch += (targetPitch + (fpCam.userPitch || 0) - fpCam.pitch) * pitchK;

  const speed = Math.hypot(sub.vx || 0, sub.vy || 0);
  const top = (typeof RUN_SPEED === "number" ? RUN_SPEED : 220) * (typeof SPRINT_MULT === "number" ? SPRINT_MULT : 1.35);
  const pace = clamp(speed / Math.max(80, top), 0, 1);
  const sprinting = !!(sub.sprinting || pace > 0.72) && sub.state === "run";
  fpCam.sprint += ((sprinting ? pace : 0) - fpCam.sprint) * (1 - Math.exp(-dt * 4));
  const bobOn = typeof opt !== "function" || (opt("headBob") && !opt("reduceMotion"));
  const wantAmp = bobOn && sub.state === "run" && speed > 36 ? m * (0.025 + pace * 0.055) : 0;
  fpCam.amp += (wantAmp - fpCam.amp) * (1 - Math.exp(-dt * 6));
  if (wantAmp > 0.2) fpCam.bob += dt * (7.5 + pace * 6.5) * Math.PI * 2;
  if (sub.state === "slide" || sub.state === "down" || sub.state === "dive") fpCam.dip = Math.max(fpCam.dip, 0.16 * m);
  if (fpCam.prevSpeed > 160 && speed < fpCam.prevSpeed - 80) fpCam.dip = Math.max(fpCam.dip, 0.07 * m);
  fpCam.dip += (0 - fpCam.dip) * (1 - Math.exp(-dt * 5));
  const fovWant = (sprinting && (typeof opt !== "function" || !opt("reduceMotion"))) ? pace * 8 * Math.PI / 180 : 0;
  fpCam.fovExtra += (fovWant - fpCam.fovExtra) * (1 - Math.exp(-dt * 3.5));

  const kicking = kickLeft(sub) > 0.2;
  if (kicking && !fpCam.kickSeen) {
    const shot = Math.hypot(ball.vx || 0, ball.vy || 0);
    if (shot > 480) bumpFpShake(shot > 700 ? 0.85 : 0.45);
    fpCam.dip = Math.max(fpCam.dip, shot > 480 ? 0.05 * m : 0.02 * m);
  }
  fpCam.kickSeen = kicking;
  if (sub.state !== fpCam.prevState && (sub.state === "slide" || sub.state === "down")) bumpFpShake(0.7);
  fpCam.prevState = sub.state || "";
  fpCam.prevSpeed = speed;
  fpCam.shake *= Math.exp(-dt * 7.5);

  const fx = Math.cos(fpCam.yaw), fy = Math.sin(fpCam.yaw);
  const pitch = fpCam.pitch;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const lx = fx * cp, ly = fy * cp, lz = -sp;
  const rx = -fy, ry = fx;
  const ux = -lz * fx, uy = -lz * fy, uz = cp;
  const sway = Math.cos(fpCam.bob * 0.5) * fpCam.amp * 0.55;
  const bob = Math.sin(fpCam.bob) * fpCam.amp;
  const eye = 1.75 * m;
  const shakeOn = typeof opt !== "function" ? fpShakeOn : (!opt("reduceMotion") && !!opt("shake"));
  const jx = shakeOn ? (Math.sin(viewTime * 47) * fpCam.shake * 9) : 0;
  const jy = shakeOn ? (Math.cos(viewTime * 53) * fpCam.shake * 6) : 0;
  let baseDeg = VIEW_W < VIEW_H ? 76 : 84;
  if (typeof opt === "function") baseDeg = Number(opt("fpFov")) || baseDeg;
  const baseFov = baseDeg * Math.PI / 180;
  const hfov = clamp(baseFov + fpCam.fovExtra, 75 * Math.PI / 180, 90 * Math.PI / 180);
  fpView = {
    ox: sub.x + fx * 0.12 * m + rx * sway,
    oy: sub.y + fy * 0.12 * m + ry * sway,
    oz: eye + bob - fpCam.dip,
    lx: lx, ly: ly, lz: lz,
    rx: rx, ry: ry, rz: 0,
    ux: ux, uy: uy, uz: uz,
    flatX: fx, flatY: fy,
    focal: (VIEW_W * 0.5) / Math.tan(hfov * 0.5),
    near: 0.28 * m,
    jx: jx, jy: jy,
    hfov: hfov,
  };
}
function bumpFpShake(amt) {
  const on = typeof opt !== "function" ? fpShakeOn : (!opt("reduceMotion") && !!opt("shake"));
  if (on) fpCam.shake = Math.min(1, fpCam.shake + amt);
}
function camPoint(x, y, z) {
  const v = fpView;
  const dx = x - v.ox, dy = y - v.oy, dz = (z || 0) - v.oz;
  return {
    depth: dx * v.lx + dy * v.ly + dz * v.lz,
    right: dx * v.rx + dy * v.ry,
    up: dx * v.ux + dy * v.uy + dz * v.uz,
  };
}
function mixCam(a, b, t) {
  return {
    depth: a.depth + (b.depth - a.depth) * t,
    right: a.right + (b.right - a.right) * t,
    up: a.up + (b.up - a.up) * t,
  };
}
function projectCam(p) {
  const v = fpView;
  const d = Math.max(p.depth, v.near);
  const s = v.focal / d * 0.58;
  return {
    x: VIEW_W * 0.5 + (p.right / d) * v.focal + v.jx,
    y: VIEW_H * 0.5 - (p.up / d) * v.focal + v.jy,
    s: s,
    depth: p.depth,
  };
}
// Keep the part of a polygon that is in front of the eyes.
function clipCamPoly(pts) {
  const v = fpView;
  const src = pts.map((p) => camPoint(p.x, p.y, p.z || 0));
  const out = [];
  const n = v.near;
  for (let i = 0; i < src.length; i++) {
    const a = src[i], b = src[(i + 1) % src.length];
    const ain = a.depth >= n, bin = b.depth >= n;
    if (ain && bin) out.push(b);
    else if (ain !== bin) {
      const t = (n - a.depth) / ((b.depth - a.depth) || 0.0001);
      const m = mixCam(a, b, clamp(t, 0, 1));
      out.push(m);
      if (bin) out.push(b);
    }
  }
  return out;
}
function fillWorldPoly(pts, color) {
  if (!fpView) return;
  const poly = clipCamPoly(pts);
  if (poly.length < 3) return;
  ctx.beginPath();
  const p0 = projectCam(poly[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < poly.length; i++) {
    const p = projectCam(poly[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function w2sEyes(x, y, z) {
  if (!fpView) return { x: 0, y: 0, s: 1, t: 0, behind: true, depth: 0 };
  const p = camPoint(x, y, z || 0);
  const behind = p.depth < fpView.near;
  const s = projectCam(p);
  return {
    x: s.x, y: s.y,
    s: clamp(s.s, 0.04, 8),
    t: clamp(p.depth / (50 * fpMetre()), 0, 1),
    behind: behind,
    depth: p.depth,
  };
}
// A finger tap lands on a teammate if it is close to him on screen.
function playerAtScreen(clientX, clientY, team) {
  if (!players || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const vx = (clientX - rect.left) / Math.max(0.35, viewScale);
  const vy = (clientY - rect.top) / Math.max(0.35, viewScale);
  const reach = 46 / Math.max(0.35, viewScale);
  let best = null, bd = reach;
  for (const p of players) {
    if (!p || p.sentOff || p.role === "GK") continue;
    if (team && p.team !== team) continue;
    const s = w2s(p.x, p.y, 18);
    if (s.behind) continue;
    const d = Math.hypot(s.x - vx, s.y - vy);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function bindViewButton() {
  const btn = document.getElementById("viewBtn");
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCamera();
  });
}
loadCameraMode();
bindViewButton();

// Project a point on the pitch (z = height) into view pixels.
function w2s(x, y, z) {
  const sub = fpSubject();
  if (sub) return w2sEyes(x, y, z || 0, sub);
  const t = depthT(y);
  const zoom = (game && game.camera && game.camera.zoom) || 1;
  const cx = (game && game.camera && game.camera.cx) || PITCH.cx;
  const s = scaleAtT(t, zoom);
  return {
    x: VIEW_W * 0.5 + (x - cx) * s,
    y: groundYAt(t) - (z || 0) * s * ZMUL,
    s: s,
    t: t,
    depth: 0,
  };
}
function proj(x, y, z) { return w2s(x, y, z || 0); }

function updateCamera(dt, snap = false) {
  lastDt = dt && dt > 0 ? dt : 0.016;
  viewTime += lastDt;
  if (!game || !game.camera || !ball) return;
  noteKicks();
  recordTrail();
  syncReplay();

  const c = game.camera;
  if (c.zoom === undefined) c.zoom = 1;
  const replayOn = isReplaying();
  const sample = replayOn ? replaySample() : null;
  const bx = sample ? sample.ball.x : ball.x;
  const by = sample ? sample.ball.y : ball.y;
  const bvx = sample ? sample.ball.vx || 0 : ball.vx || 0;

  const grow = typeof FIELD === "number" ? FIELD : 1;
  let tx = bx + clamp(bvx, -420 * grow, 420 * grow) * 0.3;
  let ty = by;
  const phone = phonePlay();
  let zoom = (phone ? 1.0 : 1.04) / grow;
  if (typeof opt === "function") {
    zoom *= Number(opt("camZoom")) || 1;
    if (opt("camDefault") === "close") zoom *= 1.28;
  }

  if (game.phase === "menu" || game.phase === "lobby") {
    tx = PITCH.cx + Math.sin(viewTime * 0.18) * 90;
    ty = PITCH.cy;
    zoom = 0.94;
  }
  if (game.phase === "goal") {
    zoom = (replayOn ? (phone ? 1.16 : 1.42) : (phone ? 1.08 : 1.24)) / grow;
    if (!replayOn && game.celebration && game.celebration.scorer) {
      tx = game.celebration.scorer.x;
      ty = game.celebration.scorer.y;
    }
  }
  const pen = game.penalty;
  if (pen && (game.phase === "setpiece" || game.phase === "shootout" || game.phase === "pkflight")) {
    const A = TEAMS[pen.team];
    tx = A.targetGoalX - A.dir * 110;
    ty = PITCH.cy;
    zoom = (phone ? 1.18 : 1.46) / grow;
  } else if (game.phase === "setpiece" && game.setpiece) {
    if (game.setpiece.type === "kickoff") {
      const base = scaleAtT(depthT(PITCH.cy), 1);
      zoom = clamp((VIEW_W * 0.94) / Math.max(1, PITCH.w) / base, 0.48, 1.08);
      tx = PITCH.cx;
      ty = PITCH.cy;
    } else {
      zoom = (game.setpiece.type === "throw" ? (phone ? 1.14 : 1.42) : (phone ? 1.1 : 1.28)) / grow;
    }
  }
  if (game.phase === "win") { zoom = 0.98 / grow; tx = PITCH.cx; }

  const midS = scaleAtT(depthT(PITCH.cy), zoom);
  const half = (VIEW_W * 0.5) / Math.max(0.25, midS);
  if (half > PITCH.w * 0.46) tx = PITCH.cx;
  else tx = clamp(tx, PITCH.left + half * 0.25, PITCH.right - half * 0.25);

  const follow = replayOn ? 7 : 3.2;
  const jumping = snap || (replayOn && viewTime - replayT0 < 0.04);
  const k = jumping ? 1 : 1 - Math.exp(-lastDt * follow);
  const kz = jumping ? 1 : 1 - Math.exp(-lastDt * 2.6);
  if (c.cx === undefined) c.cx = tx;
  if (c.cy === undefined) c.cy = ty;
  c.cx += (tx - c.cx) * k;
  c.cy += (ty - c.cy) * k;
  c.zoom += (zoom - c.zoom) * kz;

  const s = scaleAtT(depthT(PITCH.cy), c.zoom);
  c.x = c.cx - VIEW_W / 2 / Math.max(0.25, s);
  c.y = PITCH.top;
  updateFpCamera(lastDt);
}

// =====================================================================
// GOAL REPLAY  (a short action replay, drawn from pictures we already took)
// =====================================================================
const trail = [];
let replay = null;       // array of frames, or "skip"
let replayT0 = 0;
let replayDur = 0;

function copyOfficial(o) {
  return {
    role: o.role, side: o.side, x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0,
    fx: o.fx || 1, fy: o.fy || 0, sig: o.sig || 0, anim: o.anim || 0,
    skin: o.skin, hair: o.hair,
  };
}
function captureFrame(list) {
  return {
    t: viewTime,
    ball: { x: ball.x, y: ball.y, z: ball.z || 0, spin: ball.spin || 0, vx: ball.vx || 0, vy: ball.vy || 0 },
    offs: (game.officials || []).map(copyOfficial),
    ps: list.map((p) => ({
      x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0, fx: p.fx || 1, fy: p.fy || 0,
      state: p.state || "run", fallDir: p.fallDir || 1, anim: p.anim || 0,
      team: p.team, role: p.role, num: p.num, skin: p.skin, hair: p.hair,
      name: p.name || "", tall: p.tall || 1, boots: p.boots || "#111111", cut: p.cut || "short", captain: !!p.captain,
      skill: p.skill || null, sentOff: !!p.sentOff, yellow: p.yellow || 0,
    })),
  };
}
function recordTrail() {
  if (replay) return;
  if (typeof rosterList !== "function" || !ball) return;
  const list = rosterList();
  if (!list || !list.length) return;
  if (trail.length && viewTime - trail[trail.length - 1].t < 0.05) return;
  const snap = captureFrame(list);
  const prev = trail[trail.length - 1];
  if (prev && Math.hypot(snap.ball.x - prev.ball.x, snap.ball.y - prev.ball.y) > 220) trail.length = 0;
  trail.push(snap);
  while (trail.length && viewTime - trail[0].t > 3.2) trail.shift();
}
function syncReplay() {
  const goal = game.phase === "goal";
  if (goal && !replay) {
    if (typeof opt === "function" && opt("replays") === false) { replay = "skip"; return; }
    const span = trail.length ? trail[trail.length - 1].t - trail[0].t : 0;
    if (trail.length >= 12 && span > 0.75) {
      replay = trail.slice();
      replayT0 = viewTime;
      replayDur = Math.min(2.35, span);
    } else replay = "skip";
  }
  if (!goal) replay = null;
}
function isReplaying() {
  return !!(replay && replay !== "skip" && viewTime - replayT0 < replayDur);
}
function lerpActor(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  const f = normalize(lerp(a.fx, b.fx, t), lerp(a.fy, b.fy, t));
  return {
    _replay: true,
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t),
    vx: lerp(a.vx, b.vx, t), vy: lerp(a.vy, b.vy, t),
    fx: f.x, fy: f.y,
    state: t < 0.5 ? a.state : b.state,
    fallDir: b.fallDir, anim: lerp(a.anim || 0, b.anim || 0, t),
    team: a.team, role: a.role, num: a.num, skin: a.skin, hair: a.hair,
    name: a.name || "", tall: a.tall || 1, boots: a.boots || "#111111", cut: a.cut || "short", captain: !!a.captain,
    skill: t < 0.5 ? a.skill : b.skill,
    sentOff: !!(a.sentOff || b.sentOff), yellow: b.yellow || 0,
  };
}
function lerpOff(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  const f = normalize(lerp(a.fx, b.fx, t), lerp(a.fy, b.fy, t));
  return {
    role: a.role, side: a.side, skin: a.skin, hair: a.hair,
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t),
    vx: lerp(a.vx, b.vx, t), vy: lerp(a.vy, b.vy, t),
    fx: f.x, fy: f.y, sig: b.sig, anim: lerp(a.anim || 0, b.anim || 0, t),
  };
}
function replaySample() {
  const span = replay[replay.length - 1].t - replay[0].t || 1;
  const u = clamp((viewTime - replayT0) / Math.max(0.2, replayDur), 0, 1);
  const target = replay[0].t + span * u;
  let i = 1;
  while (i < replay.length - 1 && replay[i].t < target) i++;
  const a = replay[i - 1], b = replay[i];
  const t = a.t === b.t ? 1 : clamp((target - a.t) / (b.t - a.t), 0, 1);
  const n = Math.max(a.ps.length, b.ps.length);
  const ps = [];
  for (let k = 0; k < n; k++) ps.push(lerpActor(a.ps[k] || b.ps[k], b.ps[k] || a.ps[k], t));
  const offs = [];
  const na = (a.offs || []).length, nb = (b.offs || []).length;
  for (let k = 0; k < Math.max(na, nb); k++) offs.push(lerpOff((a.offs || [])[k], (b.offs || [])[k], t));
  return {
    ball: {
      x: lerp(a.ball.x, b.ball.x, t), y: lerp(a.ball.y, b.ball.y, t),
      z: lerp(a.ball.z, b.ball.z, t), spin: lerp(a.ball.spin, b.ball.spin, t),
      vx: lerp(a.ball.vx, b.ball.vx, t), vy: lerp(a.ball.vy, b.ball.vy, t),
    },
    ps: ps,
    offs: offs.filter(Boolean),
  };
}

// A short kick swing when someone lets go of the ball. Visual only.
const kickAnims = new Map();
let prevOwner = undefined;
function ownerObject() {
  if (!ball) return null;
  if (ball.owner && typeof ball.owner === "object") return ball.owner;
  if (typeof ball.owner === "number" && ball.owner >= 0 && players[ball.owner]) return players[ball.owner];
  return null;
}
function noteKicks() {
  const o = ownerObject();
  if (prevOwner && prevOwner !== o) kickAnims.set(prevOwner, 0.28);
  prevOwner = o;
  for (const [p, t] of kickAnims) {
    const n = t - lastDt;
    if (n <= 0) kickAnims.delete(p);
    else kickAnims.set(p, n);
  }
}
function kickLeft(p) { return kickAnims.get(p) || 0; }

// =====================================================================
// CROWD PICTURE  (painted once, stamped onto the stands every frame)
// =====================================================================
let crowdSheet = null;

function renderBackground() {
  crowdSheet = document.createElement("canvas");
  crowdSheet.width = 512;
  crowdSheet.height = 72;
  const g = crowdSheet.getContext("2d");
  const rnd = mulberry32(11);
  const shirts = [
    TEAMS.blue.kit.shirt, TEAMS.red.kit.shirt, TEAMS.blue.kit.shirt,
    "#f2f2f2", "#1a1a1a", "#ffd33d", TEAMS.red.kit.shirt, "#2e86ab",
  ];
  const skins = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
  const hairs = ["#2b1b0e", "#111", "#6b3e1e", "#d9b25f"];
  for (let row = 0; row < 3; row++) {
    const y = row * 24;
    g.fillStyle = row % 2 ? "#1a212b" : "#242b36";
    g.fillRect(0, y, 512, 24);
    for (let x = 0; x < 512; x += 16) {
      const jx = x + rnd() * 3;
      g.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      g.fillRect(jx + 2, y + 12, 12, 9);
      g.fillStyle = skins[Math.floor(rnd() * skins.length)];
      g.beginPath();
      g.arc(jx + 8, y + 9, 4.1, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hairs[Math.floor(rnd() * hairs.length)];
      g.beginPath();
      g.arc(jx + 8, y + 7.2, 4.1, Math.PI * 1.05, Math.PI * 1.95);
      g.fill();
    }
  }
}

// =====================================================================
// STADIUM
// =====================================================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let ballSrc = null; // which ball to draw (live, or a replay frame)
let shownOfficials = null; // referee and linesmen for this frame
let quality = "high";

function quad(a, b, c, d, color) {
  if (!a || !b || !c || !d || a.behind || b.behind || c.behind || d.behind) return;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function pitchPath() {
  const a = w2s(PITCH.left, PITCH.top, 0);
  const b = w2s(PITCH.right, PITCH.top, 0);
  const c = w2s(PITCH.right, PITCH.bottom, 0);
  const d = w2s(PITCH.left, PITCH.bottom, 0);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.closePath();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, "#070b14");
  g.addColorStop(0.28, "#14233b");
  g.addColorStop(0.55, "#1c3354");
  g.addColorStop(1, "#101810");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawTower(x, y, glow) {
  const base = w2s(x, y, 0);
  const top = w2s(x, y, 108);
  if (base.behind || top.behind) return;
  const lamp = w2s(x, y, 102);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#9aa6b5";
  ctx.lineWidth = Math.max(1.5, base.s * 2.4);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
  // cross bar + lamp heads
  const w = Math.max(8, lamp.s * 18);
  const h = Math.max(3, lamp.s * 5);
  ctx.fillStyle = "#d5dbe3";
  ctx.fillRect(lamp.x - w / 2, lamp.y - h / 2, w, h);
  ctx.fillStyle = "#fff8e0";
  for (let i = -1; i <= 1; i++) ctx.fillRect(lamp.x + i * w * 0.28 - 1.5, lamp.y - h / 2, 3, h);
  if (glow && quality === "high") {
    const rad = 80 * Math.max(0.6, lamp.s);
    const grd = ctx.createRadialGradient(lamp.x, lamp.y, 2, lamp.x, lamp.y, rad);
    grd.addColorStop(0, "rgba(255, 236, 190, 0.55)");
    grd.addColorStop(1, "rgba(255, 236, 190, 0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStandFace(x0, x1, y, z0, z1, row) {
  if (!crowdSheet) return;
  const bl = w2s(x0, y, z0), br = w2s(x1, y, z0);
  const tl = w2s(x0, y, z1), tr = w2s(x1, y, z1);
  if (bl.behind || br.behind || tl.behind || tr.behind) return;
  quad(bl, br, tr, tl, row % 2 ? "#1c232e" : "#2a3340");
  const left = Math.min(bl.x, tl.x), right = Math.max(br.x, tr.x);
  const top = Math.min(tl.y, tr.y), bot = Math.max(bl.y, br.y);
  if (right - left < 6 || bot - top < 2) return;
  if (right < -20 || left > VIEW_W + 20 || bot < -20 || top > VIEW_H + 20) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(tl.x, tl.y);
  ctx.closePath();
  ctx.clip();
  const still = typeof opt === "function" && opt("reduceMotion");
  const bob = still ? 0 : (game.phase === "goal" ? Math.sin(viewTime * 9 + row) * 2.2 : Math.sin(viewTime * 1.4 + row) * 0.4);
  const srcY = (row % 3) * 24;
  ctx.drawImage(crowdSheet, 0, srcY, 512, 24, left, top + bob, right - left, Math.max(2, bot - top - bob));
  ctx.restore();
  // lip of the tier
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
  ctx.stroke();
}

function drawFarStands() {
  const rows = quality === "low"
    ? [{ y: PITCH.top - 48 * FIELD, z0: 16, z1: 48 }]
    : [
        { y: PITCH.top - 86 * FIELD, z0: 52, z1: 86 },
        { y: PITCH.top - 64 * FIELD, z0: 30, z1: 60 },
        { y: PITCH.top - 44 * FIELD, z0: 12, z1: 40 },
      ];
  rows.forEach((r, i) => drawStandFace(30, WORLD_W - 30, r.y, r.z0, r.z1, i));
  drawStandBanners();
}
// A flag for each team, hung on the far stand. A few slices make the
// cloth ripple. Low quality draws them flat so phones stay smooth.
function drawStandBanners() {
  if (!TEAMS.blue || !TEAMS.blue.kit) return;
  const spots = [
    { team: "blue", x: PITCH.cx - 340 * FIELD },
    { team: "red", x: PITCH.cx + 220 * FIELD },
  ];
  for (const s of spots) {
    const base = w2s(s.x, PITCH.top - 8, 34);
    const top = w2s(s.x, PITCH.top - 8, 62);
    let fh = Math.abs(base.y - top.y);
    if (fh < 8 || fh > 70) continue;
    const id = teamFlagId(s.team);
    const art = flagCanvas(id, fh, 2, teamFlagColors(s.team));
    const fw = fh * art.ratio;
    const x = base.x, y = Math.min(base.y, top.y);
    ctx.save();
    ctx.strokeStyle = "rgba(230,230,230,0.9)";
    ctx.lineWidth = Math.max(1.2, fh * 0.06);
    ctx.beginPath();
    ctx.moveTo(x, y + fh);
    ctx.lineTo(x, y - fh * 0.15);
    ctx.stroke();
    const slices = quality === "low" ? 1 : 6;
    const sh = art.canvas.height / slices;
    const dh = fh / slices;
    for (let i = 0; i < slices; i++) {
      const wave = slices === 1 ? 0 : Math.sin(viewTime * 2.1 + i * 0.65 + s.x * 0.01) * fh * 0.05 * (i / slices);
      ctx.drawImage(art.canvas, 0, i * sh, art.canvas.width, sh + 1, x + 2 + wave, y + i * dh, fw, dh + 0.6);
    }
    ctx.restore();
  }
}
function drawNearStands() {
  // A short lip of fans along the bottom. Tall tiers here would climb
  // over the near touchline when the camera zooms in.
  const rows = quality === "low"
    ? [{ y: PITCH.bottom + 36 * FIELD, z0: 0, z1: 9 }]
    : [
        { y: PITCH.bottom + 30 * FIELD, z0: 0, z1: 8 },
        { y: PITCH.bottom + 48 * FIELD, z0: 3, z1: 12 },
      ];
  rows.forEach((r, i) => drawStandFace(30, WORLD_W - 30, r.y, r.z0, r.z1, i + 1));
}
function drawEndStands() {
  // Behind each goal, a block of fans seen from the side.
  for (const x of [PITCH.left - 78, PITCH.right + 78]) {
    const a = w2s(x, PITCH.top + 10, 8);
    const b = w2s(x, PITCH.bottom - 10, 8);
    const c = w2s(x, PITCH.bottom - 10, 62);
    const d = w2s(x, PITCH.top + 10, 62);
    quad(a, b, c, d, "#222833");
    if (!crowdSheet || quality === "low") continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.clip();
    const left = Math.min(a.x, b.x, c.x, d.x);
    const right = Math.max(a.x, b.x, c.x, d.x);
    const top = Math.min(a.y, b.y, c.y, d.y);
    const bot = Math.max(a.y, b.y, c.y, d.y);
    ctx.drawImage(crowdSheet, 0, x < PITCH.cx ? 0 : 24, 512, 24, left, top, Math.max(8, right - left), Math.max(8, bot - top));
    ctx.restore();
  }
}

const ADS = [
  ["NIGHT MATCH", "#102448"],
  ["FAIR PLAY", "#0e3d28"],
  ["FIVE GOALS", "#6d1c1c"],
  ["SUPER CUP", "#5c3d08"],
  ["KICK OFF", "#3a1a4e"],
  ["HOME END", "#16324a"],
];
function drawBoard(x0, y0, x1, y1, label, color, z1) {
  z1 = z1 || 13;
  const a = w2s(x0, y0, 0), b = w2s(x1, y1, 0), c = w2s(x1, y1, z1), d = w2s(x0, y0, z1);
  if (a.behind || b.behind || c.behind || d.behind) return;
  quad(a, b, c, d, color);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();
  const mx = (a.x + b.x + c.x + d.x) / 4;
  const my = (a.y + b.y + c.y + d.y) / 4;
  const sc = Math.max(0.45, (a.s + b.s) * 0.5);
  if (mx < -40 || mx > VIEW_W + 40 || my < -20 || my > VIEW_H + 20) return;
  ctx.save();
  ctx.translate(mx, my);
  ctx.font = "bold " + Math.max(7, Math.round(9 * sc)) + "px Arial";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}
function drawBoards(near) {
  const yFar = PITCH.top - 8;
  const yNear = PITCH.bottom + 8;
  const y = near ? yNear : yFar;
  const z = near ? 8 : 13;
  const span = PITCH.w / ADS.length;
  for (let i = 0; i < ADS.length; i++) {
    const x0 = PITCH.left + i * span;
    drawBoard(x0 + 4, y, x0 + span - 4, y, ADS[i][0], ADS[i][1], z);
  }
  if (near) return;
  // Boards beside and behind the goals (far side of the screen only gets the side run).
  drawBoard(PITCH.left - 6, PITCH.top + 8, PITCH.left - 6, GOAL_TOP - 8, "GOAL", "#102448");
  drawBoard(PITCH.left - 6, GOAL_BOTTOM + 8, PITCH.left - 6, PITCH.bottom - 8, "CUP", "#5c3d08");
  drawBoard(PITCH.right + 6, PITCH.top + 8, PITCH.right + 6, GOAL_TOP - 8, "GOAL", "#6d1c1c");
  drawBoard(PITCH.right + 6, GOAL_BOTTOM + 8, PITCH.right + 6, PITCH.bottom - 8, "CUP", "#0e3d28");
}

function drawFpHorizon() {
  if (!fpView) return;
  const far = w2s(fpView.ox + fpView.lx * 8000, fpView.oy + fpView.ly * 8000, 0);
  const hy = clamp(far.behind ? VIEW_H * 0.42 : far.y, VIEW_H * 0.16, VIEW_H * 0.78);
  ctx.fillStyle = "#141b26";
  ctx.fillRect(0, hy - VIEW_H * 0.22, VIEW_W, VIEW_H * 0.22);
  if (crowdSheet && quality !== "low") {
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(crowdSheet, 0, 0, 512, 72, 0, hy - VIEW_H * 0.2, VIEW_W, VIEW_H * 0.16);
    ctx.restore();
  } else {
    ctx.fillStyle = "#2a3342";
    for (let i = 0; i < 28; i++) {
      const x = (i + 0.5) * VIEW_W / 28;
      ctx.fillRect(x - 4, hy - VIEW_H * 0.12, 8, VIEW_H * 0.08);
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, hy - 1, VIEW_W, 2);
  const g = ctx.createLinearGradient(0, hy, 0, VIEW_H);
  g.addColorStop(0, "#124e22");
  g.addColorStop(1, "#1c7634");
  ctx.fillStyle = g;
  ctx.fillRect(0, hy, VIEW_W, VIEW_H - hy + 2);
}
function drawPitchEyes() {
  if (!fpView) return;
  const phone = phonePlay();
  const step = PITCH.w / (quality === "low" ? 7 : phone ? 9 : 13);
  const reach = (quality === "low" ? 55 : 75) * fpMetre();
  for (let x = PITCH.left; x < PITCH.right; x += step) {
    for (let y = PITCH.top; y < PITCH.bottom; y += step) {
      const ix = x + step * 0.5, iy = y + step * 0.5;
      const dx = ix - fpView.ox, dy = iy - fpView.oy;
      const ahead = dx * fpView.flatX + dy * fpView.flatY;
      if (ahead < -step * 0.4) continue;
      if (dx * dx + dy * dy > reach * reach) continue;
      const stripe = Math.floor((ix - PITCH.left) / step);
      const col = stripe % 2 ? "#17692c" : "#1e7c36";
      fillWorldPoly([
        { x: x, y: y }, { x: x + step, y: y },
        { x: x + step, y: y + step }, { x: x, y: y + step },
      ], col);
    }
  }
}
function drawPitch() {
  if (fpSubject()) { drawPitchEyes(); return; }
  // Apron around the grass.
  quad(
    w2s(PITCH.left - 36, PITCH.top - 16, 0),
    w2s(PITCH.right + 36, PITCH.top - 16, 0),
    w2s(PITCH.right + 36, PITCH.bottom + 16, 0),
    w2s(PITCH.left - 36, PITCH.bottom + 16, 0),
    "#145226"
  );
  const n = 14;
  const sw = PITCH.w / n;
  for (let i = 0; i < n; i++) {
    const x0 = PITCH.left + i * sw;
    const x1 = x0 + sw;
    quad(
      w2s(x0, PITCH.top, 0), w2s(x1, PITCH.top, 0),
      w2s(x1, PITCH.bottom, 0), w2s(x0, PITCH.bottom, 0),
      i % 2 ? "#17692c" : "#1e7c36"
    );
  }
  if (quality === "high") {
    ctx.save();
    pitchPath();
    ctx.clip();
    const yFar = w2s(PITCH.cx, PITCH.top, 0).y;
    const yNear = w2s(PITCH.cx, PITCH.bottom, 0).y;
    const g = ctx.createLinearGradient(0, yFar, 0, yNear);
    g.addColorStop(0, "rgba(0,0,0,0.30)");
    g.addColorStop(0.42, "rgba(0,0,0,0.05)");
    g.addColorStop(1, "rgba(255,255,255,0.06)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // Floodlight pools.
    for (const x of [PITCH.left + PITCH.w * 0.3, PITCH.right - PITCH.w * 0.3]) {
      const mid = w2s(x, PITCH.cy, 0);
      const rx = Math.abs(w2s(x + 200, PITCH.cy, 0).x - w2s(x - 200, PITCH.cy, 0).x) / 2;
      const ry = Math.abs(w2s(x, PITCH.bottom, 0).y - w2s(x, PITCH.top, 0).y) * 0.42;
      const pool = ctx.createRadialGradient(mid.x, mid.y, 8, mid.x, mid.y, Math.max(rx, ry, 12));
      pool.addColorStop(0, "rgba(255, 244, 214, 0.16)");
      pool.addColorStop(1, "rgba(255, 244, 214, 0)");
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.ellipse(mid.x, mid.y, Math.max(8, rx), Math.max(8, ry), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function worldPolyline(pts, width, color) {
  if (!pts.length) return;
  if (fpSubject() && fpView && pts.length >= 2) {
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < pts.length - 1; i++) {
      const poly = clipCamPoly([pts[i], pts[i + 1]]);
      if (poly.length < 2) continue;
      const a = projectCam(poly[0]), b = projectCam(poly[poly.length - 1]);
      const depth = Math.max(fpView.near, (poly[0].depth + poly[poly.length - 1].depth) * 0.5);
      ctx.lineWidth = clamp(fpView.focal / depth * 0.09, 1.15, 7);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    return;
  }
  ctx.beginPath();
  let open = false;
  for (const p of pts) {
    const s = w2s(p.x, p.y, p.z || 0);
    if (s.behind) { open = false; continue; }
    if (open) ctx.lineTo(s.x, s.y);
    else { ctx.moveTo(s.x, s.y); open = true; }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function drawMarkings() {
  const col = "rgba(255,255,255,0.92)";
  const lw = Math.max(1.25, scaleAtT(depthT(PITCH.cy), (game.camera && game.camera.zoom) || 1) * 2.1);
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";
  worldPolyline([
    { x: PITCH.left, y: PITCH.top }, { x: PITCH.right, y: PITCH.top },
    { x: PITCH.right, y: PITCH.bottom }, { x: PITCH.left, y: PITCH.bottom }, { x: PITCH.left, y: PITCH.top },
  ], lw, col);
  worldPolyline([{ x: PITCH.cx, y: PITCH.top }, { x: PITCH.cx, y: PITCH.bottom }], lw, col);
  const circle = [];
  for (let i = 0; i <= 28; i++) {
    const a = i / 28 * Math.PI * 2;
    circle.push({ x: PITCH.cx + Math.cos(a) * CIRCLE_R, y: PITCH.cy + Math.sin(a) * CIRCLE_R });
  }
  worldPolyline(circle, lw, col);
  const spot = w2s(PITCH.cx, PITCH.cy, 0);
  ctx.fillStyle = col;
  if (!spot.behind) {
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, Math.max(2, spot.s * 3.5), 0, Math.PI * 2);
    ctx.fill();
  }

  for (const s of [1, -1]) {
    const L = s === 1 ? PITCH.left : PITCH.right;
    const boxL = s === 1 ? L : L - BOX.depth;
    const sixL = s === 1 ? L : L - SIX.depth;
    worldPolyline([
      { x: boxL, y: PITCH.cy - BOX.width / 2 }, { x: boxL + BOX.depth, y: PITCH.cy - BOX.width / 2 },
      { x: boxL + BOX.depth, y: PITCH.cy + BOX.width / 2 }, { x: boxL, y: PITCH.cy + BOX.width / 2 },
      { x: boxL, y: PITCH.cy - BOX.width / 2 },
    ], lw, col);
    worldPolyline([
      { x: sixL, y: PITCH.cy - SIX.width / 2 }, { x: sixL + SIX.depth, y: PITCH.cy - SIX.width / 2 },
      { x: sixL + SIX.depth, y: PITCH.cy + SIX.width / 2 }, { x: sixL, y: PITCH.cy + SIX.width / 2 },
      { x: sixL, y: PITCH.cy - SIX.width / 2 },
    ], lw, col);
    const spotX = L + s * PEN_SPOT;
    const ps = w2s(spotX, PITCH.cy, 0);
    if (!ps.behind) {
      ctx.beginPath();
      ctx.arc(ps.x, ps.y, Math.max(1.6, ps.s * 2.6), 0, Math.PI * 2);
      ctx.fill();
    }
    const ang = Math.acos(clamp((BOX.depth - PEN_SPOT) / CIRCLE_R, -1, 1));
    const arc = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const a = s === 1 ? -ang + (2 * ang * i) / steps : Math.PI - ang + (2 * ang * i) / steps;
      arc.push({ x: spotX + Math.cos(a) * CIRCLE_R, y: PITCH.cy + Math.sin(a) * CIRCLE_R });
    }
    worldPolyline(arc, lw, col);
  }
  const corners = [[PITCH.left, PITCH.top, 0], [PITCH.right, PITCH.top, Math.PI / 2], [PITCH.right, PITCH.bottom, Math.PI], [PITCH.left, PITCH.bottom, -Math.PI / 2]];
  for (const [cx, cy, a0] of corners) {
    const arc = [];
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (Math.PI / 2) * i / 8;
      arc.push({ x: cx + Math.cos(a) * 16, y: cy + Math.sin(a) * 16 });
    }
    worldPolyline(arc, lw, col);
    drawFlag(cx, cy);
  }
}
function drawFlag(x, y) {
  const b = w2s(x, y, 0);
  const t = w2s(x, y, 20);
  if (b.behind || t.behind) return;
  ctx.strokeStyle = "#eee";
  ctx.lineWidth = Math.max(1, b.s * 1.4);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(t.x, t.y);
  ctx.stroke();
  const wave = Math.sin(viewTime * 5 + x * 0.01) * 3 * b.s;
  ctx.fillStyle = y < PITCH.cy ? "#ffd33d" : "#f0f0f0";
  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(t.x + 12 * b.s, t.y + 2 * b.s + wave);
  ctx.lineTo(t.x, t.y + 6 * b.s);
  ctx.closePath();
  ctx.fill();
}

function postLine(x1, y1, z1, x2, y2, z2) {
  const a = w2s(x1, y1, z1), b = w2s(x2, y2, z2);
  if (a.behind || b.behind) return;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = Math.max(2.5, a.s * 5);
  ctx.beginPath();
  ctx.moveTo(a.x + 1, a.y + 1);
  ctx.lineTo(b.x + 1, b.y + 1);
  ctx.stroke();
  ctx.strokeStyle = "#f4f6f8";
  ctx.lineWidth = Math.max(1.7, a.s * 3.3);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
function netPoint(x, y, z, u, v) {
  const s = w2s(x, y, z);
  let rip = Math.sin(viewTime * 6.5 + u * 5.2 + v * 3.1) * (quality === "low" ? 0.4 : 0.9);
  const src = ballSrc || ball;
  if (src && game.phase === "goal") {
    const d = Math.hypot(x - src.x, y - src.y, z - (src.z || 0));
    if (d < 80) rip += (1 - d / 80) * 5.5 * Math.sin(viewTime * 16 + u * 8);
  }
  return { x: s.x + rip, y: s.y + rip * 0.35 };
}
function netPanel(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, nu, nv) {
  if ([w2s(x1, y1, z1), w2s(x2, y2, z2), w2s(x3, y3, z3), w2s(x4, y4, z4)].some((c) => c.behind)) return;
  function at(u, v) {
    const x = lerp(lerp(x1, x2, u), lerp(x4, x3, u), v);
    const y = lerp(lerp(y1, y2, u), lerp(y4, y3, u), v);
    const z = lerp(lerp(z1, z2, u), lerp(z4, z3, u), v);
    return netPoint(x, y, z, u, v);
  }
  const c1 = at(0, 0), c2 = at(1, 0), c3 = at(1, 1), c4 = at(0, 1);
  ctx.beginPath();
  ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y);
  ctx.closePath();
  ctx.fillStyle = "rgba(236,242,246,0.07)";
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i <= nu; i++) {
    const a = at(i / nu, 0), b = at(i / nu, 1);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  for (let j = 0; j <= nv; j++) {
    const a = at(0, j / nv), b = at(1, j / nv);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
function drawGoal(side) {
  const left = side === "left";
  const L = left ? PITCH.left : PITCH.right;
  const bx = L + (left ? -GOAL_DEPTH : GOAL_DEPTH);
  const bh = CROSSBAR * 0.7;
  quad(w2s(L, GOAL_TOP, 0), w2s(L, GOAL_BOTTOM, 0), w2s(bx, GOAL_BOTTOM, 0), w2s(bx, GOAL_TOP, 0), "rgba(0,0,0,0.22)");
  const nu = quality === "low" ? 3 : 7;
  const nv = quality === "low" ? 4 : 9;
  netPanel(bx, GOAL_TOP, 0, bx, GOAL_BOTTOM, 0, bx, GOAL_BOTTOM, bh, bx, GOAL_TOP, bh, 3, nv);
  netPanel(L, GOAL_TOP, CROSSBAR, L, GOAL_BOTTOM, CROSSBAR, bx, GOAL_BOTTOM, bh, bx, GOAL_TOP, bh, nv, 3);
  netPanel(L, GOAL_TOP, 0, bx, GOAL_TOP, 0, bx, GOAL_TOP, bh, L, GOAL_TOP, CROSSBAR, 4, 4);
  netPanel(L, GOAL_BOTTOM, 0, bx, GOAL_BOTTOM, 0, bx, GOAL_BOTTOM, bh, L, GOAL_BOTTOM, CROSSBAR, 4, 4);
  postLine(L, GOAL_TOP, 0, L, GOAL_TOP, CROSSBAR);
  postLine(L, GOAL_BOTTOM, 0, L, GOAL_BOTTOM, CROSSBAR);
  postLine(L, GOAL_TOP, CROSSBAR, L, GOAL_BOTTOM, CROSSBAR);
  ctx.globalAlpha = 0.75;
  postLine(bx, GOAL_TOP, 0, bx, GOAL_TOP, bh);
  postLine(bx, GOAL_BOTTOM, 0, bx, GOAL_BOTTOM, bh);
  ctx.globalAlpha = 1;
}
function drawGoals() { drawGoal("left"); drawGoal("right"); }

// =====================================================================
// PLAYERS AND BALL
// =====================================================================
function celebrationPose(p) {
  if (p._replay) return null;
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

function limb(x1, y1, x2, y2, x3, y3, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  if (x3 !== undefined) ctx.lineTo(x3, y3);
  ctx.stroke();
}

// The referee (on the grass) and the two linesmen (on the touchlines).
// Same body as a player, in a yellow kit that is not either team.
function drawOfficial(o) {
  if (!o) return;
  const foot = w2s(o.x, o.y, 0);
  if (foot.behind) return;
  const S = foot.s;
  const H = 34 * ZMUL * S;
  if (H < 6) return;
  if (foot.x < -90 || foot.x > VIEW_W + 90 || foot.y < -130 || foot.y > VIEW_H + 80) return;

  const speed = Math.hypot(o.vx || 0, o.vy || 0);
  const sig = o.sig || 0;
  const face = (o.fx || 1) >= 0 ? 1 : -1;
  const posing = sig >= 1;
  const run = !posing && speed > 22 ? Math.sin(o.anim || 0) : 0;
  const skin = o.skin || "#e0ac69";

  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(foot.x + 2 * S, foot.y + S, 8.2 * S, 3 * S, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(foot.x, foot.y);
  const sideOn = clamp(Math.abs(o.fx || 1) * 1.25, 0.7, 1);
  ctx.scale(face * sideOn, 1);
  if (run) ctx.rotate(run * 0.05);

  const hip = -H * 0.46;
  const sw = run * H * 0.2;
  const kneeY = hip + H * 0.24;
  limb(-H * 0.07, hip, -H * 0.05 - sw * 0.45, kneeY, -H * 0.02 - sw, -H * 0.015, "#161616", H * 0.07);
  limb(H * 0.08, hip, H * 0.06 + sw * 0.35, kneeY, H * 0.03 + sw, -H * 0.015, "#161616", H * 0.078);
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.ellipse(-H * 0.02 - sw, -H * 0.01, H * 0.06, H * 0.028, 0, 0, Math.PI * 2);
  ctx.ellipse(H * 0.03 + sw, -H * 0.01, H * 0.065, H * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#141414";
  roundRect(ctx, -H * 0.15, hip - H * 0.01, H * 0.3, H * 0.15, H * 0.04);
  ctx.fill();
  ctx.fillStyle = "#ffe14a";
  roundRect(ctx, -H * 0.17, -H * 0.8, H * 0.34, H * 0.36, H * 0.08);
  ctx.fill();
  ctx.fillStyle = "#161616";
  ctx.fillRect(-H * 0.17, -H * 0.8, H * 0.34, H * 0.06);
  ctx.fillRect(-H * 0.05, -H * 0.74, H * 0.1, H * 0.16);

  const armW = H * 0.052;
  if (sig === 3 || sig === 4) {
    limb(-H * 0.15, -H * 0.68, -H * 0.22, -H * 0.42, undefined, undefined, skin, armW);
    limb(H * 0.14, -H * 0.7, H * 0.2, -H * 1.14, undefined, undefined, skin, armW);
  } else if (sig === 5 || sig === 6) {
    limb(-H * 0.15, -H * 0.68, -H * 0.24, -H * 0.44, undefined, undefined, skin, armW);
    const lean = sig === 6 ? H * 0.34 : H * 0.04;
    limb(H * 0.12, -H * 0.7, H * 0.16 + lean, -H * 1.16, undefined, undefined, skin, armW);
  } else if (sig === 1) {
    limb(H * 0.12, -H * 0.68, H * 0.04, -H * 0.96, undefined, undefined, skin, armW);
    limb(-H * 0.14, -H * 0.68, -H * 0.42, -H * 0.58, undefined, undefined, skin, armW);
  } else if (sig === 2) {
    limb(-H * 0.14, -H * 0.68, -H * 0.22, -H * 0.42, undefined, undefined, skin, armW);
    limb(H * 0.14, -H * 0.66, H * 0.5, -H * 0.6, undefined, undefined, skin, armW);
  } else {
    const as = -run * H * 0.16;
    limb(-H * 0.16, -H * 0.68, -H * 0.26 + as, -H * 0.4, undefined, undefined, skin, armW);
    limb(H * 0.16, -H * 0.68, H * 0.26 - as, -H * 0.4, undefined, undefined, skin, armW);
  }

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, -H * 0.9, H * 0.112, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = o.hair || "#111";
  ctx.beginPath();
  ctx.arc(0, -H * 0.93, H * 0.115, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  ctx.restore();

  // Card held up over the booked player. Red covers a second yellow.
  if ((sig === 3 || sig === 4) && game.cardPopup && typeof rosterList === "function") {
    const booked = rosterList()[game.cardPopup.idx];
    const head = booked ? w2s(booked.x, booked.y, 0) : foot;
    const hh = booked ? 34 * ZMUL * head.s : H;
    const cx = head.x;
    const cy = head.y - hh - 8 * S;
    const cw = Math.max(7, hh * 0.22), ch = Math.max(11, hh * 0.34);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.08);
    if (game.cardPopup.kind === "second") {
      ctx.fillStyle = "#ffd33d";
      ctx.fillRect(-cw * 0.2, -ch * 0.15, cw, ch);
    }
    ctx.fillStyle = sig === 3 ? "#ffd33d" : "#e10600";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.fillRect(0, -ch, cw, ch);
    ctx.strokeRect(0, -ch, cw, ch);
    ctx.restore();
  }
  if (sig === 1) {
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(foot.x + face * H * 0.02, foot.y - H * 0.92, Math.max(1.4, H * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
  if (sig === 5 || sig === 6) {
    const wave = Math.sin(viewTime * 16) * H * 0.04;
    const lean = sig === 6 ? face * H * 0.32 : face * H * 0.04;
    const x0 = foot.x + face * H * 0.1;
    const y0 = foot.y - H * 0.72;
    const x1 = foot.x + lean;
    const y1 = foot.y - H * 1.18;
    ctx.strokeStyle = "#f4f4f4";
    ctx.lineWidth = Math.max(1.4, H * 0.04);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.fillStyle = "#ff2a2a";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + face * H * 0.22, y1 + H * 0.1 + wave);
    ctx.lineTo(x1 + face * H * 0.02, y1 + H * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffe14a";
    ctx.fillRect(x1 - H * 0.02, y1, Math.max(2, H * 0.06), Math.max(2, H * 0.06));
  }
}

// Overhead throw: both arms reach the ball while it is in the hands,
// then swing forward as it is released.
function isThrowing(p) {
  if (!p) return false;
  const sp = game.setpiece;
  if (sp && sp.type === "throw" && sp.taker === p) return true;
  return (p.throwT || 0) > 0;
}
function drawThrowArms(foot, H, p) {
  const skin = p.skin || "#e0ac69";
  // A bit thicker than a running arm so the throw reads, but still the same size as the body.
  const armW = Math.max(2.2, H * 0.058);
  const t = p.throwT || (game.setpiece && game.setpiece.throwT) || 0;
  const into = p.y < PITCH.cy ? 1 : -1;          // screen y grows toward the near line
  const sp = game.setpiece;
  const inHands = sp && sp.type === "throw" && sp.taker === p && t < THROW_RELEASE;
  let hx, hy;
  if (inHands && ball) {
    const b = w2s(ball.x, ball.y, ball.z || 0);
    hx = b.x; hy = b.y;
  } else {
    const u = clamp((t - THROW_RELEASE) / Math.max(0.05, THROW_DONE - THROW_RELEASE), 0, 1);
    hx = foot.x + (p.fx || 0) * H * 0.14;
    hy = foot.y - H * 0.96 + into * H * (0.05 + u * 0.4);
  }
  // Short arms: shoulders stay near the shirt, elbows only bow out a little, hands meet the ball.
  const sy = foot.y - H * 0.72;
  const slx = foot.x - H * 0.15, srx = foot.x + H * 0.15;
  const elx = foot.x - H * 0.3, erx = foot.x + H * 0.3;
  const ey = Math.min(sy, hy) + Math.abs(sy - hy) * 0.28;
  const lx = hx - H * 0.045, rx = hx + H * 0.045, hy2 = hy + H * 0.03;
  limb(slx, sy, elx, ey, lx, hy2, "rgba(0,0,0,0.45)", armW + 1.15);
  limb(srx, sy, erx, ey, rx, hy2, "rgba(0,0,0,0.45)", armW + 1.15);
  limb(slx, sy, elx, ey, lx, hy2, skin, armW);
  limb(srx, sy, erx, ey, rx, hy2, skin, armW);
  ctx.fillStyle = skin;
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(lx, hy2, H * 0.04, 0, Math.PI * 2);
  ctx.arc(rx, hy2, H * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
function drawThrowArmsOnTop(cast) {
  if (!cast) return;
  for (const p of cast) {
    if (!p || p.sentOff || !isThrowing(p)) continue;
    const foot = w2s(p.x, p.y, 0);
    const H = 34 * ZMUL * foot.s * (p.tall || 1);
    if (H < 7) continue;
    drawThrowArms(foot, H, p);
  }
}

function drawPlayer(p) {
  if (!p || p.sentOff) return;
  const eyes = fpSubject();
  if (eyes && p === eyes) return;
  const T = TEAMS[p.team];
  if (!T) return;
  const foot = w2s(p.x, p.y, 0);
  if (foot.behind) return;
  const S = foot.s;
  const H = 34 * ZMUL * S * (p.tall || 1);
  if (H < 7) return;
  if (foot.x < -90 || foot.x > VIEW_W + 90 || foot.y < -110 || foot.y > VIEW_H + 70) return;

  const kit = p.role === "GK" ? T.gk : T.kit;
  const speed = Math.hypot(p.vx || 0, p.vy || 0);
  const lying = p.state && p.state !== "run";
  const pose = celebrationPose(p);
  let run = speed > 22 && !lying ? Math.sin(p.anim || 0) : 0;
  if (p.skill === "stepover") run = Math.sin(viewTime * 26) * 1.15;
  const kick = kickLeft(p);
  const kickAmp = kick > 0 ? Math.sin(clamp(1 - kick / 0.28, 0, 1) * Math.PI) : 0;
  const face = (p.fx || 1) >= 0 ? 1 : -1;

  // Shadow and the ring under a human player. These stay on the grass.
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(foot.x + 2.2 * S, foot.y + S, (lying ? 13 : 8.5) * S, (lying ? 4.6 : 3.1) * S, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!p._replay) {
    const hc = controllerOf(p);
    if (hc) {
      const mine = isLocal(hc);
      ctx.strokeStyle = mine ? "#ffd33d" : "rgba(255,255,255,0.88)";
      ctx.lineWidth = Math.max(1.4, 2.1 * S);
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, 13 * S, 4.6 * S, 0, 0, Math.PI * 2);
      ctx.stroke();
      const ahead = w2s(p.x + (p.fx || 0) * 20, p.y + (p.fy || 0) * 20, 0);
      const dx = ahead.x - foot.x, dy = ahead.y - foot.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, px = -uy, py = ux;
      ctx.fillStyle = mine ? "#ffd33d" : "rgba(255,255,255,0.88)";
      ctx.beginPath();
      ctx.moveTo(foot.x + ux * 16 * S, foot.y + uy * 16 * S);
      ctx.lineTo(foot.x + ux * 9 * S + px * 4.5 * S, foot.y + uy * 9 * S + py * 4.5 * S);
      ctx.lineTo(foot.x + ux * 9 * S - px * 4.5 * S, foot.y + uy * 9 * S - py * 4.5 * S);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (p.skill === "spin") {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(foot.x, foot.y - 4, 12 * S, viewTime * 14, viewTime * 14 + 4);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(foot.x, foot.y);
  const sideOn = clamp(Math.abs(p.fx || 1) * 1.25, 0.7, 1);
  ctx.scale(face * sideOn, 1);
  if (lying) ctx.rotate((p.fallDir > 0 ? 1 : -1) * (p.state === "down" ? 1.4 : 1.08));
  if (pose === "slide") ctx.translate(0, H * 0.1);
  if (pose === "spin" && game.celebration) {
    const a = (game.celebration.t * 5) % (Math.PI * 2);
    ctx.translate(0, -Math.abs(Math.sin(a / 2)) * H * 0.4 - H * 0.15);
    ctx.rotate(a);
    ctx.translate(0, H * 0.15);
  }
  if (!lying && speed > 22) ctx.rotate(run * 0.05);

  const hip = -H * 0.46;
  const sw = run * H * 0.2;
  const kneeY = hip + H * 0.24;
  const sock = kit.socks || "#222";
  const skin = p.skin || "#e0ac69";
  // Legs, back one first. A kick swings the front boot through.
  limb(-H * 0.07, hip, -H * 0.05 - sw * 0.45, kneeY, -H * 0.02 - sw, -H * 0.015, sock, H * 0.07);
  ctx.fillStyle = p.boots || "#121212";
  ctx.beginPath();
  ctx.ellipse(-H * 0.02 - sw, -H * 0.01, H * 0.065, H * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();

  const fs = -sw + kickAmp * H * 0.42;
  const kneeX = H * 0.06 + fs * (kickAmp > 0.15 ? 0.15 : 0.35);
  limb(H * 0.08, hip, kneeX, kickAmp > 0.2 ? hip + H * 0.16 : kneeY, H * 0.03 + fs, -H * 0.015, sock, H * 0.078);
  ctx.fillStyle = p.boots || "#121212";
  ctx.beginPath();
  ctx.ellipse(H * 0.03 + fs, -H * 0.01, H * 0.07, H * 0.032, 0, 0, Math.PI * 2);
  ctx.fill();

  // Shorts and shirt.
  ctx.fillStyle = kit.shorts;
  roundRect(ctx, -H * 0.155, hip - H * 0.01, H * 0.31, H * 0.15, H * 0.04);
  ctx.fill();
  ctx.fillStyle = kit.shirt;
  roundRect(ctx, -H * 0.175, -H * 0.8, H * 0.35, H * 0.36, H * 0.08);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(-H * 0.175, -H * 0.62, H * 0.35, H * 0.035);

  // Arms. A throw-in draws both arms in screen space so they hold the ball.
  const throwing = isThrowing(p);
  const as = -run * H * 0.16;
  const armW = H * 0.055;
  if (throwing) {
    // arms are drawn after the body, reaching up to the ball
  } else if (pose === "plane" || (p.role === "GK" && p.state === "dive")) {
    limb(-H * 0.16, -H * 0.7, -H * 0.46, -H * 0.64 + Math.sin(viewTime * 8) * H * 0.03, undefined, undefined, skin, armW);
    limb(H * 0.16, -H * 0.7, H * 0.46, -H * 0.64 - Math.sin(viewTime * 8) * H * 0.03, undefined, undefined, skin, armW);
  } else if (pose) {
    const w = Math.sin(viewTime * 10 + (p.num || 0)) * H * 0.03;
    limb(-H * 0.14, -H * 0.68, -H * 0.24, -H * 0.98 + w, undefined, undefined, skin, armW);
    limb(H * 0.14, -H * 0.68, H * 0.24, -H * 0.98 - w, undefined, undefined, skin, armW);
  } else {
    limb(-H * 0.16, -H * 0.68, -H * 0.26 + as, -H * 0.4, undefined, undefined, skin, armW);
    limb(H * 0.16, -H * 0.68, H * 0.26 - as, -H * 0.4, undefined, undefined, skin, armW);
  }
  if (p.captain && !throwing) {
    const ax = -H * 0.24 + as * 0.35;
    const ay = -H * 0.58;
    ctx.fillStyle = "#ffd33d";
    ctx.fillRect(ax - H * 0.045, ay - H * 0.028, H * 0.09, H * 0.056);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.strokeRect(ax - H * 0.045, ay - H * 0.028, H * 0.09, H * 0.056);
    ctx.fillStyle = "#1a1404";
    ctx.font = "bold " + Math.max(7, Math.round(H * 0.055)) + "px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("C", ax, ay);
  }
  if (p.role === "GK" && !pose) {
    ctx.fillStyle = "#f7f7f7";
    ctx.beginPath();
    ctx.arc(-H * 0.26 + as, -H * 0.4, H * 0.045, 0, Math.PI * 2);
    ctx.arc(H * 0.26 - as, -H * 0.4, H * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

  // Number. The body is mirrored for players facing left, so flip it back.
  ctx.save();
  ctx.scale(face / sideOn, 1);
  ctx.fillStyle = kit.number || "#fff";
  ctx.font = "bold " + Math.max(8, Math.round(H * 0.16)) + "px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(p.num), 0, -H * 0.62);
  ctx.restore();

  // Head, hair, and a face when he is turned toward the camera.
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, -H * 0.9, H * 0.115, 0, Math.PI * 2);
  ctx.fill();
  drawHair(p, H);
  if ((p.fy || 0) > 0.25 && quality === "high") {
    ctx.fillStyle = "#1b1b1b";
    ctx.beginPath();
    ctx.arc(-H * 0.04, -H * 0.9, H * 0.016, 0, Math.PI * 2);
    ctx.arc(H * 0.04, -H * 0.9, H * 0.016, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (typeof opt === "function" && opt("colorblind")) {
    ctx.fillStyle = p.team === "red" ? "#ff9f1c" : "#7eb6ff";
    if (p.team === "red") ctx.fillRect(foot.x - H * 0.12, foot.y - H * 0.62, H * 0.24, Math.max(3, H * 0.06));
    else { ctx.beginPath(); ctx.arc(foot.x, foot.y - H * 0.72, Math.max(3, H * 0.07), 0, Math.PI * 2); ctx.fill(); }
  }
  if (typeof opt === "function" && opt("contrast")) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, H * 0.04);
    ctx.beginPath();
    ctx.arc(foot.x, foot.y - H * 0.5, H * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (p.yellow > 0 && !p.sentOff && !lying) {
    ctx.fillStyle = "#ffd33d";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1;
    ctx.fillRect(foot.x + H * 0.22, foot.y - H - 2, 5, 7);
    ctx.strokeRect(foot.x + H * 0.22, foot.y - H - 2, 5, 7);
  }
}

function drawHair(p, H) {
  const cut = p.cut || "short";
  if (cut === "bald") return;
  ctx.fillStyle = p.hair || "#2b1b0e";
  ctx.beginPath();
  if (cut === "afro") ctx.arc(0, -H * 0.96, H * 0.16, 0, Math.PI * 2);
  else if (cut === "curly") {
    ctx.arc(-H * 0.05, -H * 0.98, H * 0.07, 0, Math.PI * 2);
    ctx.arc(H * 0.05, -H * 1.0, H * 0.065, 0, Math.PI * 2);
    ctx.arc(0, -H * 0.93, H * 0.08, Math.PI * 1.05, Math.PI * 1.95);
  } else if (cut === "buzz") ctx.arc(0, -H * 0.96, H * 0.09, Math.PI, Math.PI * 2);
  else if (cut === "long") {
    ctx.arc(0, -H * 0.93, H * 0.12, Math.PI * 1.02, Math.PI * 1.98);
    ctx.fill();
    ctx.fillRect(-H * 0.09, -H * 0.9, H * 0.18, H * 0.16);
    return;
  } else if (cut === "mohawk") {
    ctx.fillRect(-H * 0.028, -H * 1.14, H * 0.056, H * 0.24);
    return;
  } else if ((p.fy || 0) < -0.45) ctx.arc(0, -H * 0.9, H * 0.12, 0, Math.PI * 2);
  else ctx.arc(0, -H * 0.93, H * 0.12, Math.PI * 1.02, Math.PI * 1.98);
  ctx.fill();
}

function drawPlayerHud(p, c) {
  if (fpSubject() === p) return;
  const showNames = typeof opt !== "function" || opt("showNames") !== false;
  const showStamina = typeof opt !== "function" || opt("showStamina") !== false;
  if (!showNames && !showStamina && !c.charging) return;
  const foot = w2s(p.x, p.y, 0);
  if (foot.behind) return;
  const H = 34 * ZMUL * foot.s * (p.tall || 1);
  const mine = isLocal(c);
  const nm0 = typeof shownName === "function" ? shownName(p) : (p.name || "");
  const nm = nm0 ? nm0 + (p.captain ? " C" : "") : "";
  const label = (labelFor(c) || "") + "  #" + p.num + (p.captain ? " C" : "");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold " + Math.max(11, Math.round(12 + foot.s * 2)) + "px Arial";
  const y = foot.y - H - 12;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  if (showNames) {
  ctx.strokeText(label, foot.x, y);
  ctx.fillStyle = mine ? "#ffd33d" : (typeof opt === "function" && opt("colorblind") ? (p.team === "red" ? "#ff9f1c" : "#7eb6ff") : TEAMS[p.team].ui);
  ctx.fillText(label, foot.x, y);
  if (nm) {
    ctx.font = "bold " + Math.max(10, Math.round(11 + foot.s * 1.5)) + "px Arial";
    ctx.strokeText(nm, foot.x, y - 14);
    ctx.fillText(nm, foot.x, y - 14);
  }
  // Little marker bouncing over the name.
  const bob = Math.sin(viewTime * 5 + p.num) * 2;
  const tip = y - (nm ? 28 : 10);
  ctx.fillStyle = mine ? "#ffd33d" : "#fff";
  ctx.beginPath();
  ctx.moveTo(foot.x, tip + bob);
  ctx.lineTo(foot.x - 4, tip - 6 + bob);
  ctx.lineTo(foot.x + 4, tip - 6 + bob);
  ctx.closePath();
  ctx.fill();
  }
  if (showStamina && mine) {
    const bw = Math.max(28, 34 * foot.s);
    const by = foot.y + Math.max(5, 6 * foot.s);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, foot.x - bw / 2, by, bw, 4, 2);
    ctx.fill();
    const st = clamp(p.stamina == null ? 1 : p.stamina, 0, 1);
    ctx.fillStyle = st > 0.55 ? "#3dde5a" : st > 0.28 ? "#ffd33d" : "#ff4d3a";
    ctx.fillRect(foot.x - bw / 2 + 1, by + 1, (bw - 2) * st, 2);
  }
  if (c.charging) {
    const ch = clamp(c.held / CHARGE_TIME, 0, 1);
    const bw = Math.max(40, 52 * foot.s);
    const py = y - 14;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    roundRect(ctx, foot.x - bw / 2, py, bw, 7, 2);
    ctx.fill();
    ctx.fillStyle = ch < 0.5 ? "#ffd33d" : ch < 0.85 ? "#ff9f1c" : "#ff3b3b";
    ctx.fillRect(foot.x - bw / 2 + 1, py + 1, (bw - 2) * ch, 5);
    if (game.penalty && game.penalty.taker === p) {
      ctx.fillStyle = "rgba(255,59,59,0.45)";
      ctx.fillRect(foot.x - bw / 2 + 1 + (bw - 2) * PEN_RISKY, py + 1, (bw - 2) * (1 - PEN_RISKY), 5);
    }
    if (c.charging === "pass" && c.held >= TAP_TIME) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px Arial";
      ctx.fillText("LOB", foot.x, py - 8);
    }
  }
}

function drawBall() {
  const b = ballSrc || ball;
  if (!b) return;
  const z = b.z || 0;
  const gnd = w2s(b.x, b.y, 0);
  if (gnd.behind) return;
  const sh = clamp(1 - z / 170, 0.32, 1);
  ctx.fillStyle = "rgba(0,0,0," + clamp(0.45 - z / 210, 0.07, 0.45).toFixed(3) + ")";
  ctx.beginPath();
  ctx.ellipse(
    gnd.x + (4 + z * 0.22) * gnd.s,
    gnd.y + 1.6 * gnd.s,
    BALL_R * gnd.s * 1.45 * sh,
    BALL_R * gnd.s * 0.55 * sh,
    0, 0, Math.PI * 2
  );
  ctx.fill();
  const p = w2s(b.x, b.y, z);
  const r = Math.max(3.2, BALL_R * p.s * (1 + z / 340));
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(b.spin || 0);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = "#f7f7f7";
  ctx.fill();
  if (typeof opt === "function" && opt("contrast")) {
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.strokeStyle = "#111";
    ctx.stroke();
  }
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#1c1c1c";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (quality === "high") {
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.08, 0, 0, r);
    grad.addColorStop(0, "rgba(255,255,255,0.75)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPenaltyAids() {
  const pen = game.penalty;
  if (!pen || !(game.phase === "setpiece" || game.phase === "shootout")) return;
  const mine = localActives();
  const A = TEAMS[pen.team];
  const src = ballSrc || ball;
  if (mine.includes(pen.taker) && !mine.includes(pen.keeper)) {
    const s = w2s(A.targetGoalX, pen.aimY, CROSSBAR * 0.42);
    ctx.strokeStyle = "#ffd33d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.moveTo(s.x - 14, s.y); ctx.lineTo(s.x + 14, s.y);
    ctx.moveTo(s.x, s.y - 14); ctx.lineTo(s.x, s.y + 14);
    ctx.stroke();
    const b = w2s(src.x, src.y, src.z || 0);
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = "rgba(255,211,61,0.55)";
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (mine.includes(pen.keeper) && !mine.includes(pen.taker)) {
    const k = pen.keeper;
    const f = w2s(k.x, k.y, 18);
    ctx.fillStyle = "rgba(120,220,255,0.95)";
    const d = pen.gkChoice;
    ctx.beginPath();
    if (!d) ctx.arc(f.x, f.y, 6, 0, Math.PI * 2);
    else {
      ctx.moveTo(f.x, f.y + d * 26);
      ctx.lineTo(f.x - 8, f.y + d * 12);
      ctx.lineTo(f.x + 8, f.y + d * 12);
      ctx.closePath();
    }
    ctx.fill();
  }
}

// =====================================================================
// HUD
// =====================================================================
function teamFlagId(side) { return (TEAMS[side] && TEAMS[side].id) || side; }
function teamFlagColors(side) {
  const k = TEAMS[side] && TEAMS[side].kit;
  return k ? [k.shirt, k.shorts, k.socks] : null;
}
function drawScoreboard() {
  const hs = typeof hudScale === "function" ? hudScale() : 1;
  ctx.save();
  ctx.scale(hs, hs);
  const pad = screenPad();
  const x = 12 + pad.left;
  const y = 10 + pad.top;
  const h = 54;
  ctx.font = "bold 16px Arial";
  const bName = TEAMS.blue.short || "BLU";
  const rName = TEAMS.red.short || "RED";
  const bNameW = ctx.measureText(bName).width;
  const rNameW = ctx.measureText(rName).width;
  let fh = 30;
  const bRatio = flagRatio(teamFlagId("blue"));
  const rRatio = flagRatio(teamFlagId("red"));
  const shootoutHud = game.matchType === "shootout" || !!game.shootout;
  const clockW = shootoutHud ? 74 : 86;
  const scoreGap = 108;
  const fit = () => 8 + fh * bRatio + 8 + bNameW + 10 + scoreGap + 10 + rNameW + 8 + fh * rRatio + 8;
  let midW = fit();
  const maxW = Math.max(240, VIEW_W - x - pad.right - 58);
  if (midW + clockW > maxW) {
    fh = Math.max(16, fh * (maxW - clockW) / midW);
    midW = fit();
  }
  const w = midW + clockW;
  ctx.fillStyle = "rgba(8,12,20,0.88)";
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  const shine = quality === "low" ? null : (viewTime % 3.4) / 3.4;
  const flagY = y + (h - fh) / 2;
  const bFlagW = drawFlagBadge(ctx, teamFlagId("blue"), x + 8, flagY, fh, { colors: teamFlagColors("blue"), t: shine });
  const rFlagX = x + midW - 8 - fh * rRatio;
  drawFlagBadge(ctx, teamFlagId("red"), rFlagX, flagY, fh, { colors: teamFlagColors("red"), t: shine });

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px Arial";
  const bTextX = x + 8 + bFlagW + 8;
  ctx.fillText(bName, bTextX, y + h * 0.46);
  ctx.textAlign = "right";
  const rTextX = rFlagX - 8;
  ctx.fillText(rName, rTextX, y + h * 0.46);
  ctx.textAlign = "center";
  ctx.font = "bold 26px Arial";
  ctx.fillStyle = "#ffe14a";
  ctx.fillText(game.score.blue + "  -  " + game.score.red, x + midW / 2, y + h * 0.48);

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x + midW, y, clockW, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = x + midW + clockW / 2;
  if (shootoutHud) {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px monospace";
    ctx.fillText("PENS", cx, y + h * 0.5);
  } else if (game.timeLimit) {
    const left = Math.max(0, game.timeLimit - game.clock);
    ctx.fillStyle = left < 30 ? "#ff9f1c" : "#fff";
    ctx.font = "bold 16px monospace";
    ctx.fillText(formatClock(Math.ceil(left)), cx, y + h * 0.36);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "bold 11px monospace";
    ctx.fillText("/ " + formatClock(game.timeLimit), cx, y + h * 0.72);
  } else {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px monospace";
    ctx.fillText(formatClock(game.clock), cx, y + h * 0.5);
  }

  ctx.font = "bold 16px Arial";
  drawTeamCards("blue", bTextX + bNameW + 6, y + 14, 1);
  ctx.font = "bold 16px Arial";
  drawTeamCards("red", rTextX - rNameW - 6, y + 14, -1);

  ctx.font = "bold 12px Arial";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  let sub = hudSubtitle() || "";
  if (sub.length > 72) sub = sub.slice(0, 70) + "…";
  ctx.fillText(sub, x + 2, y + h + 12);
  if (typeof localActives === "function") {
    const mine = localActives().filter(Boolean);
    if (mine.length) {
      const bits = mine.map((p) => {
        const nm = typeof shownName === "function" ? shownName(p) : (p.name || "");
        return (nm || "You") + " #" + p.num;
      });
      ctx.fillStyle = "#ffd33d";
      ctx.fillText(bits.join("   "), x + 2, y + h + 26);
    }
  }
  if (game.shootout) drawShootoutDots(x, y + h + 40);
  ctx.restore();
}

function drawTeamCards(team, x, y, dir) {
  let i = 0;
  for (const p of rosterList()) {
    if (p.team !== team) continue;
    const cards = p.sentOff ? ["#ff3b3b"] : p.yellow ? ["#ffd33d"] : [];
    for (const col of cards) {
      const cx = x + dir * i * 8 - (dir < 0 ? 6 : 0);
      ctx.fillStyle = col;
      ctx.fillRect(cx, y, 6, 9);
      i++;
    }
  }
}
function drawShootoutDots(x, y) {
  const so = game.shootout;
  const n = Math.max(SHOOTOUT_KICKS, so.kicks.blue.length, so.kicks.red.length);
  const w = 168 + n * 16;
  ctx.fillStyle = "rgba(8,12,20,0.88)";
  roundRect(ctx, x, y, w, 44, 8);
  ctx.fill();
  ctx.font = "bold 12px Arial";
  ctx.textBaseline = "middle";
  ["blue", "red"].forEach((t, row) => {
    const yy = y + 12 + row * 20;
    ctx.textAlign = "left";
    ctx.fillStyle = TEAMS[t].ui;
    const fh = 14;
    const fw = drawFlagBadge(ctx, teamFlagId(t), x + 8, yy - fh / 2, fh, { colors: teamFlagColors(t), t: null });
    ctx.fillText(TEAMS[t].short, x + 12 + fw, yy);
    for (let i = 0; i < n; i++) {
      const k = so.kicks[t][i];
      ctx.beginPath();
      ctx.arc(x + 78 + fw + i * 16, yy, 5, 0, Math.PI * 2);
      if (k === undefined) { ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1.4; ctx.stroke(); }
      else { ctx.fillStyle = k ? "#2ecc40" : "#ff3b3b"; ctx.fill(); }
    }
  });
  if (so.sudden) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#ff9f1c";
    ctx.font = "bold 11px Arial";
    ctx.fillText("SUDDEN DEATH", x, y + 52);
  }
}

function drawCommentary() {
  const c = game.comment;
  const pad = screenPad();
  if (c && c.timer > 0 && c.text) {
    const alpha = clamp(c.timer / 0.35, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.font = "bold 15px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const text = c.text;
    const w = Math.min(VIEW_W * 0.7, ctx.measureText(text).width + 26);
    const x = 12 + pad.left;
    const y = (game.shootout ? 132 : 78) + pad.top;
    ctx.fillStyle = "rgba(8,12,20,0.8)";
    roundRect(ctx, x, y, w, 26, 4);
    ctx.fill();
    ctx.fillStyle = "#ffe14a";
    ctx.fillRect(x, y, 4, 26);
    ctx.fillStyle = c.color || "#fff";
    ctx.fillText(text, x + 12, y + 13);
    ctx.globalAlpha = 1;
  }
  if (game.phase === "goal") {
    const t = game.celebration ? game.celebration.t : 0;
    if (t < 2.5 || isReplaying()) {
      const age = isReplaying() ? (viewTime - replayT0) : t;
      const size = Math.round(Math.min(VIEW_W, VIEW_H) * 0.16 * (1 + Math.max(0, 0.25 - age) * 1.2));
      ctx.globalAlpha = clamp(isReplaying() ? 1 : (2.5 - t) / 0.35, 0, 1);
      ctx.font = "bold " + size + "px Impact, Arial Black, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "rgba(0,0,0,0.72)";
      ctx.strokeText("GOAL", VIEW_W / 2, VIEW_H * 0.4);
      ctx.fillStyle = "#ffe14a";
      ctx.fillText("GOAL", VIEW_W / 2, VIEW_H * 0.4);
      const sc = game.celebration && game.celebration.scorer;
      if (sc) {
        ctx.font = "bold 20px Arial";
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 4;
        const nm = typeof shownName === "function" ? shownName(sc) : (sc.name || "");
        const who = (nm || "Goal") + "  #" + sc.num;
        const ty = VIEW_H * 0.4 + size * 0.55;
        ctx.strokeText(who, VIEW_W / 2, ty);
        ctx.fillText(who, VIEW_W / 2, ty);
        const fw = ctx.measureText(who).width;
        const fh = 22;
        drawFlagBadge(ctx, teamFlagId(sc.team), VIEW_W / 2 - fw / 2 - fh * flagRatio(teamFlagId(sc.team)) - 10, ty - fh / 2, fh, { colors: teamFlagColors(sc.team), t: quality === "low" ? null : (viewTime % 3.4) / 3.4 });
      }
      ctx.globalAlpha = 1;
    }
    if (game.timer > 1 && !isReplaying()) hintBox(keysHint("skip"), VIEW_H * 0.72, 13);
  }
  const mine = localActives();
  const pen = game.penalty;
  if (pen && (game.phase === "setpiece" || game.phase === "shootout")) {
    if (mine.includes(pen.taker)) hintBox("PENALTY: " + keysHint("penTaker"), VIEW_H * 0.72);
    else if (mine.includes(pen.keeper)) hintBox("YOU'RE IN GOAL: " + keysHint("penKeeper"), VIEW_H * 0.72);
  } else if (game.phase === "setpiece") {
    const sp = game.setpiece;
    if (sp && sp.taker && mine.includes(sp.taker)) {
      const names = { kickoff: "Kick off", throw: "Throw-in", corner: "Corner", goalkick: "Goal kick", free: sp.indirect ? "Indirect free kick (pass first!)" : "Free kick" };
      const hint = sp.type === "throw" ? keysHint("throw") : keysHint("setpiece");
      hintBox(names[sp.type] + ": " + hint, VIEW_H * 0.72);
    }
  }
}
function hintBox(txt, y, size) {
  if (!txt) return;
  size = size || 15;
  ctx.font = "bold " + size + "px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = Math.min(VIEW_W - 16, ctx.measureText(txt).width + 24);
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  roundRect(ctx, VIEW_W / 2 - w / 2, y, w, size + 12, 6);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(txt, VIEW_W / 2, y + (size + 12) / 2);
}

let bugId = "";
let bugUntil = 0;
function drawMatchBugs(replayOn) {
  const ko = game.phase === "setpiece" && game.setpiece && game.setpiece.type === "kickoff";
  if (ko) {
    if (bugId !== "ko") { bugId = "ko"; bugUntil = viewTime + 1.6; }
    if (viewTime < bugUntil) centerTitle("KICK OFF");
  } else if (bugId === "ko") bugId = "";
  const call = game.comment && game.comment.timer > 0.25 ? game.comment.text : "";
  if (call === "FOUL" || call === "FREE KICK" || call === "PENALTY!") centerTitle(call);
  if (game.phase === "win") centerTitle("FULL TIME");
  else if (game.phase === "shootout" && game.shootout && game.shootout.kicks.blue.length + game.shootout.kicks.red.length === 0 && game.timer > 0.6) centerTitle("PENALTIES");
  else if (game.timeLimit && game.phase === "play" && game.clock >= game.timeLimit / 2 && game.clock < game.timeLimit / 2 + 2.1) centerTitle("SECOND HALF");
  if (replayOn) {
    const pad = screenPad();
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    // Keep clear of the pause button in the top-right corner.
    const x = VIEW_W - 108 - pad.right;
    const y = 22 + pad.top;
    ctx.fillStyle = "rgba(180, 24, 24, 0.92)";
    roundRect(ctx, x, y - 12, 78, 24, 4);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText("REPLAY", x + 70, y);
  }
}
function centerTitle(text) {
  ctx.save();
  ctx.font = "bold " + Math.round(Math.min(VIEW_W * 0.12, VIEW_H * 0.14)) + "px Impact, Arial Black, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.62)";
  ctx.strokeText(text, VIEW_W / 2, VIEW_H * 0.34);
  ctx.fillStyle = "#f4f7fb";
  ctx.fillText(text, VIEW_W / 2, VIEW_H * 0.34);
  ctx.restore();
}

function drawRefPopups() {
  const cp = game.cardPopup;
  if (cp) {
    const p = rosterList()[cp.idx];
    const k = clamp((3 - cp.timer) / 0.25, 0, 1);
    const cx = VIEW_W / 2, cy = VIEW_H / 2 - 30;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.fillStyle = "rgba(6,10,16,0.78)";
    roundRect(ctx, -160, -74, 320, 148, 12);
    ctx.fill();
    ctx.save();
    ctx.translate(-90, 0);
    ctx.rotate(-0.12);
    ctx.fillStyle = cp.kind === "yellow" ? "#ffd33d" : "#ff2d2d";
    roundRect(ctx, -26, -42, 52, 76, 6);
    ctx.fill();
    if (cp.kind === "second") {
      ctx.fillStyle = "#ffd33d";
      roundRect(ctx, -34, -36, 52, 76, 6);
      ctx.fill();
      ctx.fillStyle = "#ff2d2d";
      roundRect(ctx, -20, -48, 52, 76, 6);
      ctx.fill();
    }
    ctx.restore();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 24px Arial";
    ctx.fillText(cp.kind === "yellow" ? "YELLOW CARD" : "RED CARD", -48, -24);
    ctx.font = "bold 16px Arial";
    ctx.fillStyle = TEAMS[cp.team].ui;
    const fh = 18;
    drawFlagBadge(ctx, teamFlagId(cp.team), -48, 6 - fh / 2, fh, { colors: teamFlagColors(cp.team), t: null });
    ctx.fillText("#" + (p ? p.num : "?") + "  " + TEAMS[cp.team].short, -48 + fh * flagRatio(teamFlagId(cp.team)) + 8, 6);
    ctx.font = "13px Arial";
    ctx.fillStyle = "#ddd";
    ctx.fillText(cp.kind === "yellow" ? "Booked. One more and he is off." : cp.kind === "second" ? "Second yellow. Sent off." : "Sent off. Play a player down.", -48, 32);
    ctx.restore();
  }
  const fl = game.flag;
  if (fl) {
    const p = rosterList()[fl.idx];
    const x = 12 + screenPad().left, y = VIEW_H * 0.5;
    ctx.fillStyle = "rgba(6,10,16,0.78)";
    roundRect(ctx, x, y, 320, 58, 8);
    ctx.fill();
    const wave = Math.sin(viewTime * 12) * 3;
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 18, y + 50);
    ctx.lineTo(x + 18, y + 8);
    ctx.stroke();
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.moveTo(x + 18, y + 8);
    ctx.lineTo(x + 40, y + 14 + wave);
    ctx.lineTo(x + 18, y + 22);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText("OFFSIDE", x + 48, y + 20);
    ctx.font = "12px Arial";
    ctx.fillStyle = TEAMS[fl.team].ui;
    const ofh = 16;
    const ofw = drawFlagBadge(ctx, teamFlagId(fl.team), x + 48, y + 40 - ofh / 2, ofh, { colors: teamFlagColors(fl.team), t: null });
    ctx.fillText("#" + (p ? p.num : "?") + " " + TEAMS[fl.team].short + "  ·  indirect free kick", x + 54 + ofw, y + 40);
  }
}

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
    const n = quality === "low" ? 60 : 130;
    for (let i = 0; i < n; i++) {
      confetti.push({
        x: Math.random() * VIEW_W, y: -20 - Math.random() * VIEW_H * 0.5,
        vx: (Math.random() - 0.5) * 70, vy: 70 + Math.random() * 130,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 8,
        c: cols[i % cols.length], w: 5 + Math.random() * 5,
      });
    }
  }
  if (!key) confettiFor = null;
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.x += c.vx * dt + Math.sin(now * 3 + i) * 0.5;
    c.y += c.vy * dt;
    c.r += c.vr * dt;
    if (c.y > VIEW_H + 20) confetti.splice(i, 1);
  }
}
function drawConfetti() {
  for (const c of confetti) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.r);
    ctx.scale(1, Math.abs(Math.cos(c.r * 2)) + 0.2);
    ctx.fillStyle = c.c;
    ctx.fillRect(-c.w / 2, -2, c.w, 4);
    ctx.restore();
  }
}

function drawMinimap() {
  if (typeof opt === "function" && opt("showRadar") === false) return;
  const mw = 150, mh = mw * PITCH.h / PITCH.w;
  const mx = VIEW_W / 2 - mw / 2;
  const my = VIEW_H - mh - 12 - screenPad().bottom;
  const sx = (x) => mx + (x - PITCH.left) / PITCH.w * mw;
  const sy = (y) => my + (y - PITCH.top) / PITCH.h * mh;
  ctx.fillStyle = "rgba(6,16,10,0.72)";
  roundRect(ctx, mx - 5, my - 5, mw + 10, mh + 10, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(mx, my, mw, mh);
  ctx.beginPath();
  ctx.moveTo(mx + mw / 2, my);
  ctx.lineTo(mx + mw / 2, my + mh);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(mx + mw / 2, my + mh / 2, CIRCLE_R / PITCH.w * mw, 0, Math.PI * 2);
  ctx.stroke();
  const dots = shownOfficials || game.officials || [];
  for (const o of dots) {
    ctx.fillStyle = o.role === "ref" ? "#ffe14a" : "#f0d060";
    const py = clamp(o.y, PITCH.top, PITCH.bottom);
    ctx.fillRect(sx(o.x) - 1.6, sy(py) - 1.6, 3.2, 3.2);
  }
  for (const p of onPitch()) {
    ctx.fillStyle = p.role === "GK" ? TEAMS[p.team].gk.shirt : TEAMS[p.team].kit.shirt;
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y), 2.6, 0, Math.PI * 2);
    ctx.fill();
    if (isHumanControlled(p)) { ctx.strokeStyle = "#ffd33d"; ctx.lineWidth = 1; ctx.stroke(); }
  }
  const src = ballSrc || ball;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(sx(src.x), sy(src.y), 2.4, 0, Math.PI * 2);
  ctx.fill();
  const cam = game.camera;
  const s = scaleAtT(depthT(PITCH.cy), cam.zoom || 1);
  const half = VIEW_W / 2 / Math.max(0.25, s);
  ctx.strokeStyle = "rgba(255,211,61,0.85)";
  ctx.lineWidth = 1;
  const x0 = clamp(sx(cam.cx - half), mx, mx + mw);
  const x1 = clamp(sx(cam.cx + half), mx, mx + mw);
  ctx.strokeRect(x0, my, Math.max(2, x1 - x0), mh);
}

let vignette = null, vignetteKey = "";
function drawVignette() {
  if (quality === "low") return;
  const key = VIEW_W + "x" + VIEW_H;
  if (key !== vignetteKey || !vignette) {
    vignetteKey = key;
    vignette = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.46, VIEW_H * 0.28, VIEW_W / 2, VIEW_H * 0.5, VIEW_H * 0.78);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.42)");
  }
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

const onPitch = () => players.filter((p) => !p.sentOff);

let qCool = 0;
const qSamples = [];
function considerQuality() {
  const now = performance.now();
  if (!considerQuality.prev) { considerQuality.prev = now; return; }
  const ms = now - considerQuality.prev;
  considerQuality.prev = now;
  if (ms > 80) return;
  qCool--;
  qSamples.push(ms);
  if (qSamples.length > 36) qSamples.shift();
  if (qSamples.length < 28 || qCool > 0) return;
  const avg = qSamples.reduce((a, b) => a + b, 0) / qSamples.length;
  const mode = typeof opt === "function" ? opt("quality") : "auto";
  if (mode === "low" || mode === "medium" || mode === "high") {
    if (quality !== mode) { quality = mode; qSamples.length = 0; resize(); }
    return;
  }
  if (quality === "high" && avg > 26) { quality = "low"; qCool = 150; qSamples.length = 0; resize(); }
  else if (quality === "low" && avg < 13) { quality = "high"; qCool = 150; qSamples.length = 0; resize(); }
}

function draw() {
  if (!ctx) return;
  if (!crowdSheet) renderBackground();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#07090d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);

  const replayOn = isReplaying();
  const sample = replayOn ? replaySample() : null;
  ballSrc = sample ? sample.ball : ball;
  const eyes = fpSubject();
  let cast = sample ? sample.ps.filter((p) => p && !p.sentOff) : onPitch();
  if (eyes) cast = cast.filter((p) => p !== eyes);
  shownOfficials = (sample && sample.offs && sample.offs.length) ? sample.offs : (game.officials || []);

  drawSky();
  if (eyes) drawFpHorizon();
  drawTower(PITCH.left + 36, PITCH.top - 4, true);
  drawTower(PITCH.right - 36, PITCH.top - 4, true);
  drawFarStands();
  drawEndStands();
  drawPitch();
  drawMarkings();
  drawBoards(false);
  drawGoals();

  const crew = shownOfficials || [];
  const things = cast.map((p) => ({ y: p.y, p: p }));
  for (const o of crew) if (o.side !== "near") things.push({ y: o.y, o: o });
  const bz = (ballSrc && ballSrc.z) || 0;
  if (bz <= 14) things.push({ y: ballSrc.y + 0.2, ball: true });
  if (eyes) {
    for (const t of things) {
      const pos = t.ball ? ballSrc : (t.p || t.o);
      t.depth = w2s(pos.x, pos.y, t.ball ? bz : 0).depth || 0;
    }
    things.sort((a, b) => b.depth - a.depth);
  } else things.sort((a, b) => a.y - b.y);
  for (const t of things) { if (t.ball) drawBall(); else if (t.o) drawOfficial(t.o); else drawPlayer(t.p); }
  if (eyes) drawCrosshair();
  if (bz > 14) drawBall();

  if (!eyes) {
    drawBoards(true);
    drawNearStands();
  }
  for (const o of crew) if (o.side === "near" && !eyes) drawOfficial(o);
  // Both arms are drawn last, so the hands stay on the ball above the head.
  if (!replayOn) drawThrowArmsOnTop(cast);
  if (!eyes) {
    drawTower(PITCH.left + 48, PITCH.bottom + 14, false);
    drawTower(PITCH.right - 48, PITCH.bottom + 14, false);
  }
  drawPenaltyAids();
  if (eyes && !replayOn) {
    drawOwnBody(eyes);
    const close = ballSrc && w2s(ballSrc.x, ballSrc.y, ballSrc.z || 0);
    if (close && !close.behind && close.depth < 9 * fpMetre()) drawBall();
    drawFpRush();
  }

  if (!replayOn && controllers) {
    for (const c of controllers) {
      if (!c.cpu && c.active && !c.active.sentOff && (inMatch() || game.phase === "win")) drawPlayerHud(c.active, c);
    }
  }

  drawVignette();
  updateConfetti();
  if (showHud()) {
    if (eyes) drawFpHud(eyes);
    else drawScoreboard();
    drawCommentary();
    drawRefPopups();
    drawMatchBugs(replayOn);
    if (!eyes && !game.shootout && game.phase !== "goal") drawMinimap();
  }
  drawConfetti();
  ballSrc = ball;
  considerQuality();
}

function drawCrosshair() {
  const x = VIEW_W * 0.5 + (fpView ? fpView.jx : 0);
  const y = VIEW_H * 0.5 + (fpView ? fpView.jy : 0);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.arc(x, y, 2.1, 0, Math.PI * 2);
  ctx.fill();
}
function drawOwnBody(p) {
  if (!p || !TEAMS[p.team]) return;
  const kit = p.role === "GK" ? TEAMS[p.team].gk : TEAMS[p.team].kit;
  const speed = Math.hypot(p.vx || 0, p.vy || 0);
  const moving = speed > 36 && p.state === "run";
  const swing = moving ? Math.sin(p.anim || fpCam.bob) : 0;
  const kick = kickLeft(p);
  const k = kick > 0 ? Math.sin(clamp(1 - kick / 0.28, 0, 1) * Math.PI) : 0;
  const shot = k > 0 && Math.hypot((ball && ball.vx) || 0, (ball && ball.vy) || 0) > 460;
  const phone = phonePlay();
  const cx = VIEW_W * 0.5;
  const footY = VIEW_H - (phone ? 6 : 4);
  const hipY = VIEW_H * (phone && VIEW_H > VIEW_W ? 0.62 : 0.74);
  const spread = Math.min(64, VIEW_W * 0.055);
  const thick = phone ? 18 : 20;
  ctx.fillStyle = kit.shorts || "#222";
  roundRect(ctx, cx - spread * 1.15, hipY - 18, spread * 2.3, 28, 8);
  ctx.fill();
  function leg(side, sw, kickAmp) {
    const hx = cx + side * spread * 0.72;
    const kneeX = hx + side * 4 + sw * 42;
    const kneeY = (hipY + footY) * 0.52 - Math.abs(sw) * 18 - kickAmp * (shot ? 80 : 34);
    const fx = hx + sw * 52 + side * 6 + kickAmp * (shot ? 110 : 48);
    const fy = footY - 6 - kickAmp * (shot ? 48 : 16);
    limb(hx, hipY, kneeX, kneeY, fx, fy, kit.socks || "#222", thick);
    ctx.fillStyle = p.boots || "#111";
    ctx.beginPath();
    ctx.ellipse(fx + 14, fy - 1, shot ? 22 : 18, 8, side * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(fx + 6, fy - 5, 10, 3);
  }
  leg(-1, swing, 0);
  leg(1, -swing, k);
  if (isThrowing(p)) {
    const skin = p.skin || "#e0ac69";
    const t = p.throwT || (game.setpiece && game.setpiece.throwT) || 0;
    const lift = t < (typeof THROW_RELEASE === "number" ? THROW_RELEASE : 0.7) ? 0.28 : 0.42;
    limb(cx - spread * 1.4, hipY - 10, cx - 36, VIEW_H * lift, cx - 6, VIEW_H * lift - 16, skin, 13);
    limb(cx + spread * 1.4, hipY - 10, cx + 36, VIEW_H * lift, cx + 6, VIEW_H * lift - 16, skin, 13);
  }
}
function drawFpRush() {
  if (!fpView || fpCam.sprint < 0.4 || quality === "low") return;
  if (typeof opt === "function" && opt("reduceMotion")) return;
  const a = fpCam.sprint * 0.16;
  ctx.strokeStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
  ctx.lineWidth = 2;
  const cx = VIEW_W * 0.5, cy = VIEW_H * 0.5;
  for (let i = 0; i < 7; i++) {
    const ang = fpCam.bob * 0.3 + i * 0.9;
    const r0 = Math.min(VIEW_W, VIEW_H) * 0.22;
    const r1 = r0 + 24 + fpCam.sprint * 36;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.55);
    ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.55);
    ctx.stroke();
  }
}
function drawFpHud(sub) {
  const pad = screenPad();
  const y = 8 + pad.top;
  const bName = (TEAMS.blue && TEAMS.blue.short) || "BLU";
  const rName = (TEAMS.red && TEAMS.red.short) || "RED";
  const clock = game.timeLimit ? formatClock(Math.ceil(Math.max(0, game.timeLimit - game.clock))) : formatClock(game.clock || 0);
  const label = bName + "  " + game.score.blue + " - " + game.score.red + "  " + rName + "   " + clock;
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(label).width + 22;
  const x = VIEW_W * 0.5 - tw / 2;
  ctx.fillStyle = "rgba(8,12,20,0.78)";
  roundRect(ctx, x, y, tw, 28, 8);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, VIEW_W * 0.5, y + 14);
  const showBar = typeof opt !== "function" || opt("showStamina") !== false;
  const st = clamp(sub.stamina == null ? 1 : sub.stamina, 0, 1);
  const bw = Math.min(180, tw);
  if (showBar) {
  const bx = VIEW_W * 0.5 - bw / 2;
  const by = y + 34;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, bx, by, bw, 8, 3);
  ctx.fill();
  ctx.fillStyle = st > 0.55 ? "#3dde5a" : st > 0.28 ? "#ffd33d" : "#ff4d3a";
  ctx.fillRect(bx + 1, by + 1, (bw - 2) * st, 6);
  }

  const showRadar = typeof opt !== "function" || opt("showRadar") !== false;
  const mw = phonePlay() ? 92 : 118;
  if (!showRadar) {
    fpShakeRect = null;
  } else {
  const mh = mw * PITCH.h / PITCH.w;
  const mx = VIEW_W - mw - 14 - pad.right;
  const my = y + (phonePlay() ? 56 : 40);
  const sx = (px) => mx + (px - PITCH.left) / PITCH.w * mw;
  const sy = (py) => my + (py - PITCH.top) / PITCH.h * mh;
  ctx.fillStyle = "rgba(6,16,10,0.72)";
  roundRect(ctx, mx - 4, my - 4, mw + 8, mh + 8, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 1;
  ctx.strokeRect(mx, my, mw, mh);
  ctx.beginPath();
  ctx.moveTo(mx + mw / 2, my);
  ctx.lineTo(mx + mw / 2, my + mh);
  ctx.stroke();
  for (const pl of onPitch()) {
    ctx.fillStyle = pl.role === "GK" ? TEAMS[pl.team].gk.shirt : TEAMS[pl.team].kit.shirt;
    ctx.beginPath();
    ctx.arc(sx(pl.x), sy(pl.y), pl === sub ? 3.4 : 2.2, 0, Math.PI * 2);
    ctx.fill();
    if (pl === sub) { ctx.strokeStyle = "#ffd33d"; ctx.stroke(); }
  }
  const src = ballSrc || ball;
  if (src) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(sx(src.x), sy(src.y), 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const shakeNow = typeof opt === "function" ? !!opt("shake") && !opt("reduceMotion") : fpShakeOn;
  const chip = shakeNow ? "Shake on" : "Shake off";
  ctx.font = "bold 13px Arial";
  const cw = ctx.measureText(chip).width + 16;
  const cx = mx;
  const cy = my + mh + 10;
  fpShakeRect = { x: cx, y: cy, w: cw, h: 28 };
  ctx.fillStyle = shakeNow ? "rgba(232,197,71,0.9)" : "rgba(8,12,20,0.78)";
  roundRect(ctx, cx, cy, cw, 28, 8);
  ctx.fill();
  ctx.fillStyle = shakeNow ? "#1a1404" : "#fff";
  ctx.textAlign = "center";
  ctx.fillText(chip, cx + cw / 2, cy + 14);
  }
  if (typeof opt === "function" && opt("showFps")) {
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.fillText((window.__fps || 0) + " fps", 12 + pad.left, VIEW_H - 18 - pad.bottom);
  }
}
function onFpHudPointer(e) {
  if (!fpShakeRect || !fpSubject() || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const vx = (e.clientX - rect.left) / Math.max(0.35, viewScale);
  const vy = (e.clientY - rect.top) / Math.max(0.35, viewScale);
  const r = fpShakeRect;
  if (vx < r.x || vx > r.x + r.w || vy < r.y || vy > r.y + r.h) return;
  e.preventDefault();
  e.stopPropagation();
  if (typeof GameSettings !== "undefined") GameSettings.set("shake", !opt("shake"));
  else {
    fpShakeOn = !fpShakeOn;
    if (!fpShakeOn) fpCam.shake = 0;
  }
}
if (canvas) {
  canvas.addEventListener("pointerdown", onFpHudPointer, true);
  let lookDrag = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.target !== canvas || !fpSubject()) return;
    if (e.button != null && e.button !== 0) return;
    lookDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType || "mouse" };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!lookDrag || e.pointerId !== lookDrag.id) return;
    const dx = e.clientX - lookDrag.x, dy = e.clientY - lookDrag.y;
    lookDrag.x = e.clientX; lookDrag.y = e.clientY;
    if (!dx && !dy) return;
    const touch = lookDrag.type === "touch";
    const sens = typeof opt === "function" ? Number(opt(touch ? "lookTouch" : "lookMouse")) || 1 : 1;
    const inv = typeof opt === "function" && opt("invertY") ? -1 : 1;
    fpCam.userYaw = (fpCam.userYaw || 0) + dx * 0.0042 * sens;
    fpCam.userPitch = clamp((fpCam.userPitch || 0) + dy * 0.003 * sens * inv, -0.35, 0.35);
  });
  const endLook = (e) => { if (lookDrag && e.pointerId === lookDrag.id) lookDrag = null; };
  canvas.addEventListener("pointerup", endLook);
  canvas.addEventListener("pointercancel", endLook);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// =====================================================================
// Screen size
// =====================================================================
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
  const touch = typeof touchActive === "function" && touchActive();
  const cap = quality === "low" ? 1.25 : touch ? 1.5 : 2;
  dpr = Math.min(window.devicePixelRatio || 1, cap);
  const box = viewportBox();
  const w = box.w, h = box.h, aspect = w / Math.max(1, h);
  VIEW_H = 640;
  VIEW_W = VIEW_H * aspect;
  // A tall phone used to force a very wide picture, which made the
  // players tiny. Keep them about as big as in landscape.
  const minW = touch && aspect < 1 ? 640 : 900;
  if (VIEW_W < minW) { VIEW_W = minW; VIEW_H = VIEW_W / aspect; }
  viewScale = w / VIEW_W;
  readSafeArea();
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.style.left = box.x + "px";
  canvas.style.top = box.y + "px";
  vignette = null;
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
  show("viewBtn", playing && !menuOpen);
  syncViewBtn();
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
  const shootout = (room.matchType || "match") === "shootout";
  const len = describeMatchLength(room.minutes);
  const custom = !!room.lengthCustom;
  const lengthRow = $("lobbyLength");
  if (lengthRow) lengthRow.classList.toggle("hidden", shootout);
  document.querySelectorAll("[data-lmins]").forEach((b) => {
    const v = b.dataset.lmins;
    const on = v === "custom" ? custom : (!custom && Number(v) === len.minutes);
    b.classList.toggle("selected", on);
    b.disabled = !host;
  });
  const step = $("lobbyLenStep");
  if (step) step.classList.toggle("hidden", shootout || !custom);
  const minsInput = $("lobbyMins");
  if (minsInput) {
    if (document.activeElement !== minsInput) minsInput.value = String(len.minutes);
    minsInput.disabled = !host;
  }
  const down = $("lobbyMinsDown"), up = $("lobbyMinsUp");
  if (down) down.disabled = !host;
  if (up) up.disabled = !host;
  const line = $("lobbyLengthLine");
  if (line) {
    line.textContent = shootout ? "No clock in a penalty shootout."
      : len.sentence + (host ? "" : "  \u2022  set by the host");
  }
  // team pickers (the host chooses; kits swap to away if they clash)
  const kits = buildTeamKits(findTeam(room.blueTeam) || TEAM_LIST[0], findTeam(room.redTeam) || TEAM_LIST[1]);
  for (const side of ["blue", "red"]) {
    const sel = $(side + "TeamSel");
    if (!sel.options.length) sel.innerHTML = TEAM_LIST.map((t) => "<option value='" + t.id + "'>" + esc(t.name) + " (" + t.short + ") " + ((typeof teamShows100 === "function" && teamShows100(t.id)) ? "\u2605 100" : "\u2605".repeat(t.rating)) + "</option>").join("");
    sel.value = side === "blue" ? room.blueTeam || "blue" : room.redTeam || "red";
    sel.disabled = !host;
    const k = kits[side];
    $(side + "Title").innerHTML = flagHtml(k, 22, { wave: true }) + "<span class='teamName'>" + esc(k.name) + (k.away ? " <span class='tag'>away kit</span>" : "") + "</span>";
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
  const sideMark = (side) => flagHtml({ id: TEAMS[side].id, kit: TEAMS[side].kit }, 22) + "<span>" + esc(TEAMS[side].short) + "</span>";
  let score = sideMark("blue") + "<span>" + game.score.blue + " - " + game.score.red + "</span>" + sideMark("red");
  const so = game.shootout;
  if (so) {
    const pb = so.kicks.blue.reduce((a, b) => a + b, 0), pr = so.kicks.red.reduce((a, b) => a + b, 0);
    score = game.matchType === "shootout"
      ? sideMark("blue") + "<span>" + pb + " - " + pr + " (penalties)</span>" + sideMark("red")
      : score + "<span>(" + pb + "-" + pr + " pens)</span>";
  }
  $("winScore").innerHTML = score;
  const s = game.stats;
  $("winStats").textContent = !s ? "" : game.matchType === "shootout" ? "Penalties scored: " + s.pens.scored + "  \u2022  missed / saved: " + s.pens.missed :
    "Shots: " + s.shots.blue + " - " + s.shots.red + "  \u2022  Saves: " + s.saves + "  \u2022  Corners: " + s.corner +
    "  \u2022  Cards: " + (s.yellow.blue + s.yellow.red) + " yellow, " + (s.red.blue + s.red.red) + " red  \u2022  Offside: " + s.offside + "  \u2022  Time: " + formatClock(game.clock);
  const scorers = $("winScorers");
  if (scorers) scorers.innerHTML = !s || game.matchType === "shootout" ? "" : (typeof goalScorersHtml === "function" ? goalScorersHtml(s) : "");
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
  const saved = loadSavedMinutes();
  sendOrQueue({ t: "create", name, mode: createMode, difficulty: createDiff, minutes: saved.minutes, lengthCustom: saved.custom });
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
function sendLength(minutes, custom) {
  if (!room || room.hostId !== myId) return;
  const choice = saveSavedMinutes(minutes, custom);
  sendMsg({ t: "settings", minutes: choice.minutes, lengthCustom: choice.custom });
}
document.querySelectorAll("[data-lmins]").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.lmins === "custom") sendLength($("lobbyMins").value || (room && room.minutes), true);
  else sendLength(Number(b.dataset.lmins), false);
}));
function stepLobbyMinutes(delta) {
  sendLength(clampMatchMinutes(Number($("lobbyMins").value) + delta), true);
}
$("lobbyMinsDown").addEventListener("click", () => stepLobbyMinutes(-1));
$("lobbyMinsUp").addEventListener("click", () => stepLobbyMinutes(1));
$("lobbyMins").addEventListener("input", () => {
  const raw = $("lobbyMins").value;
  if (raw === "" || raw === "-") return;
  const n = Number(raw);
  if (!isFinite(n)) return;
  sendLength(n, true);
});
$("lobbyMins").addEventListener("change", () => sendLength($("lobbyMins").value, true));
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
  $("matchHelp").innerHTML = "Left thumb moves. <b>SHOOT</b> kicks (hold for a bigger kick). <b>PASS</b> passes (hold to lob). <b>RUN</b> sprints. <b>SKILL</b> does a trick.<br>Tap a teammate to control him. <b>TV</b> / <b>1ST</b> changes the camera.<br>Penalty: slide up or down, then hold SHOOT. In goal: slide up or down. Tap the picture to skip a celebration.";
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
  if (typeof frameGate === "function" && !frameGate(now)) { requestAnimationFrame(frame); return; }
  window.__fps = Math.round(1000 / Math.max(8, now - (frame.prev || now)));
  frame.prev = now;
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
      myId, room: room && { code: room.code, state: room.state, mode: room.mode, hostId: room.hostId, members: room.members, minutes: room.minutes, lengthCustom: !!room.lengthCustom, matchType: room.matchType },
      phase: game.phase, score: { ...game.score }, winner: game.winner, clock: game.clock, timeLimit: game.timeLimit,
      ball: last ? { x: last.b[0], y: last.b[1], z: last.b[2] } : null, drawnBall: { x: ball.x, y: ball.y, z: ball.z },
      me: a ? { index: players.indexOf(a), x: a.x, y: a.y, vx: a.vx, vy: a.vy } : null,
      myRaw: a && last ? (() => { const r = last.p[players.indexOf(a)]; return { x: r[0], y: r[1], vx: r[2], vy: r[3] }; })() : null,
      controllers: controllers.map((c) => ({ id: c.id, active: players.indexOf(c.active), cpu: c.cpu })),
      ping: pingMs, link: netLinkUp(), host: netIsHost(),
      net: typeof netDebug === "function" ? netDebug() : null,
      snapshots: snaps.length, winVisible: !$("winScreen").classList.contains("hidden"),
      teams: { blue: TEAMS.blue.short, red: TEAMS.red.short, blueShirt: TEAMS.blue.kit.shirt, redShirt: TEAMS.red.kit.shirt },
      setpiece: game.setpiece && game.setpiece.type, indirect: !!(game.setpiece && game.setpiece.indirect),
      throwT: (game.setpiece && game.setpiece.throwT) || 0,
      takerThrow: game.setpiece && game.setpiece.taker ? game.setpiece.taker.throwT || 0 : 0,
      penalty: game.penalty ? { team: game.penalty.team, aimY: game.penalty.aimY, gkChoice: game.penalty.gkChoice, iAmTaker: game.penalty.taker === a, iAmKeeper: game.penalty.keeper === a } : null,
      shootout: game.shootout, celebration: game.celebration ? game.celebration.type : null,
      cardPopup: game.cardPopup ? game.cardPopup.kind : null, flag: !!game.flag,
      sentOff: players.filter((p) => p.sentOff).length, yellows: players.reduce((n, p) => n + (p.yellow || 0), 0),
      skills: players.filter((p) => p.skill).map((p) => p.skill), matchType: game.matchType, rules: game.rules,
      clock: game.clock, timeLimit: game.timeLimit, knockout: !!game.knockout,
    };
  },
  send(m) { sendMsg(m); },
};


/* Hidden helpers for this device. The passcode is never stored.
   Only a PBKDF2 check lives here. A wrong guess waits a moment. */
(function () {
  const STORE = "soccerAdminUnlock";
  const SALT_HEX = "6cd0e2744c3aee0074e44c5a8076a173";
  const ITERATIONS = 310000;
  const KEY_HEX = "1cf7392fec330b8a7b071bf1793508f81b52ce4c54633cd934fc2f96aa40dedb";
  const EXPECT = hexToBytes(KEY_HEX);
  let taps = 0;
  let lastTap = 0;
  let coolUntil = 0;
  let checking = false;

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function timingEqual(got, expect) {
    const n = expect.length;
    let diff = got && got.length === n ? 0 : 1;
    for (let i = 0; i < n; i++) diff |= ((got && got[i]) || 0) ^ expect[i];
    return diff === 0;
  }
  function unlocked() {
    try { return localStorage.getItem(STORE) === "yes"; } catch (e) { return false; }
  }
  function setUnlocked(on) {
    try {
      if (on) localStorage.setItem(STORE, "yes");
      else localStorage.removeItem(STORE);
    } catch (e) { /* private mode */ }
  }
  async function derive(pass) {
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt: hexToBytes(SALT_HEX),
      iterations: ITERATIONS,
      hash: "SHA-256",
    }, material, EXPECT.length * 8);
    return new Uint8Array(bits);
  }

  function liveSim() {
    if (typeof netIsHost === "function" && netIsHost() && typeof hosted !== "undefined" && hosted && hosted.sim) return hosted.sim;
    if (typeof sim !== "undefined" && sim && sim.admin) return sim;
    return null;
  }
  function guestBlocked() {
    return typeof netRole === "string" && netRole === "guest";
  }
  function canUse() {
    if (guestBlocked()) return false;
    return !!liveSim();
  }

  function el(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    return wrap.firstElementChild;
  }

  const style = document.createElement("style");
  style.textContent = `
    #menu .coverBanner { pointer-events: auto; }
    #adminLock, #adminPanel, #adminPrompt, #adminDebug, #adminBubble {
      font-family: "Trebuchet MS", Arial, sans-serif; color: #fff;
    }
    #adminPrompt, #adminPanel {
      position: fixed; z-index: 90;
      background: rgba(8, 16, 28, .97); border: 2px solid #e8c547; border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0,0,0,.55); box-sizing: border-box;
    }
    #adminPrompt {
      left: 50%; top: 18vh; transform: translateX(-50%);
      width: min(440px, calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right)));
      padding: 16px; text-align: center;
    }
    #adminPrompt h2 { margin: 0 0 8px; font-size: 22px; }
    #adminPrompt input {
      font: inherit; font-size: 18px; width: 100%; box-sizing: border-box;
      padding: 10px; border-radius: 10px; border: 1px solid #fff; margin: 8px 0;
    }
    #adminPrompt .row, #adminPanel .row { margin: 8px 0; }
    #adminWrong { min-height: 1.2em; color: #ffb4b4; font-weight: 700; }
    #adminPanel {
      z-index: 80; left: 0; top: 0; margin: 0;
      width: 420px; height: 520px;
      display: flex; flex-direction: column; overflow: hidden; padding: 0;
      font-size: 15px;
    }
    #adminPanel[hidden], #adminBubble[hidden], #adminShield[hidden] { display: none !important; }
    #adminBar {
      display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
      padding: 6px 6px 6px 12px; margin: 0;
      background: rgba(232, 197, 71, .16);
      border-bottom: 1px solid rgba(232, 197, 71, .5);
      border-radius: 14px 14px 0 0;
      cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
    }
    #adminPanel.adminDragging #adminBar, #adminBubble.adminDragging { cursor: grabbing; }
    #adminBar h2 {
      flex: 1; margin: 0; min-width: 0; font-size: 1.15em; text-align: left; line-height: 1.2;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .adminSizes { display: flex; flex: 0 0 auto; gap: 2px; }
    .adminSizes button {
      min-width: 40px; min-height: 44px; margin: 0; padding: 0 6px;
      font-size: 15px; line-height: 1;
    }
    .adminSizes button.on { background: #e6b325; color: #1a1404; border-color: #ffe27a; }
    #adminPanel[data-fit="s"] #adminBar { flex-wrap: wrap; row-gap: 2px; }
    #adminPanel[data-fit="s"] #adminBar h2 { order: 1; }
    #adminPanel[data-fit="s"] #adminMin { order: 2; }
    #adminPanel[data-fit="s"] .adminSizes { order: 3; flex: 1 0 100%; justify-content: flex-end; }
    .adminGrip {
      width: 18px; height: 22px; display: grid; grid-template-columns: 4px 4px;
      grid-auto-rows: 4px; gap: 3px 4px; align-content: center; flex: 0 0 auto;
    }
    .adminGrip i { display: block; width: 4px; height: 4px; border-radius: 50%; background: #e8c547; }
    #adminMin {
      min-width: 44px; min-height: 44px; margin: 0; padding: 0;
      font-size: 26px; line-height: 1;
    }
    #adminScroll { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }
    #adminBody {
      flex: 1 1 auto; min-height: 0; width: 100%;
      overflow-x: hidden; overflow-y: scroll;
      -webkit-overflow-scrolling: touch; touch-action: pan-y;
      overscroll-behavior: contain;
      padding: 8px 18px 36px 12px;
      scrollbar-width: none;
    }
    #adminBody::-webkit-scrollbar { width: 0; height: 0; }
    #adminRail {
      position: absolute; right: 4px; top: 8px; bottom: 10px; width: 8px;
      border-radius: 8px; background: rgba(255,255,255,.16);
      pointer-events: none;
    }
    #adminThumb {
      display: block; width: 8px; min-height: 28px; border-radius: 8px;
      background: #e8c547; box-shadow: 0 0 0 1px rgba(0,0,0,.45);
    }
    #adminBody.can-up { box-shadow: inset 0 22px 16px -14px rgba(0,0,0,.88); }
    #adminBody.can-down { box-shadow: inset 0 -26px 18px -12px rgba(0,0,0,.9); }
    #adminBody.can-up.can-down { box-shadow: inset 0 22px 16px -14px rgba(0,0,0,.88), inset 0 -26px 18px -12px rgba(0,0,0,.9); }
    #adminPanel button, #adminPrompt button, #adminBubble {
      font: inherit; font-weight: 700; min-height: var(--admin-hit, 44px); margin: 3px; padding: 8px 10px;
      border-radius: 10px; border: 1px solid rgba(255,255,255,.35);
      background: #1d4e34; color: #fff; cursor: pointer; touch-action: manipulation;
    }
    #adminPanel button.on { background: #e6b325; color: #1a1404; border-color: #ffe27a; }
    #adminBody button, #adminBody label, #adminBody select, #adminBody input, #adminBody .hint {
      touch-action: pan-y;
    }
    #adminPanel .grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.4em), 1fr));
      gap: 6px; justify-content: stretch;
    }
    #adminPanel .grid button { margin: 0; width: 100%; }
    #adminPanel .row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px; }
    #adminPanel[data-fit="s"] .row label { font-size: 0.92em; }
    #adminPanel .team100 { align-items: stretch; }
    #adminPanel .team100 select { min-height: 44px; width: 100%; max-width: 100%; }
    #adminPanel .team100 .keep, #adminPanel .hint { font-size: 14px; line-height: 1.3; }
    #adminPanel .hint { opacity: .85; flex: 1 0 100%; text-align: center; }
    #adminCup { margin: 8px 0 4px; padding-top: 8px; border-top: 1px solid rgba(232, 197, 71, .45); }
    #adminCup[hidden] { display: none !important; }
    #adminCup h3 { margin: 0 0 4px; text-align: center; color: #e8c547; font-size: 1.05em; }
    #adminCupState { margin: 0 0 6px; text-align: center; font-size: 13px; line-height: 1.35; color: #ffd27a; }
    #adminCup select { min-height: 44px; max-width: 100%; }
    #adminCup input[type=number] { width: 58px; }
    #adminPanel[data-fit="s"] #adminCup .grid { grid-template-columns: 1fr; }
    #adminPanel #adminResize {
      position: absolute; right: 0; bottom: 0; z-index: 2;
      width: 44px; height: 44px; min-width: 44px; min-height: 44px; margin: 0; padding: 0;
      border: 0; border-radius: 0 0 14px 0; background: transparent; color: transparent;
      cursor: nwse-resize; touch-action: none;
    }
    #adminResize::after {
      content: ""; position: absolute; right: 7px; bottom: 7px; width: 16px; height: 16px;
      background:
        linear-gradient(135deg, transparent 0 45%, #e8c547 45% 58%, transparent 58% 68%, #e8c547 68% 80%, transparent 80%);
      pointer-events: none;
    }
    #adminPanel.adminResizing #adminResize { cursor: nwse-resize; }
    #adminPanel input[type=number] {
      font: inherit; font-size: 16px; width: 64px; padding: 8px; border-radius: 8px; border: 1px solid #fff;
    }
    #adminPanel select { font: inherit; font-size: 16px; max-width: 100%; padding: 8px; border-radius: 8px; }
    #adminNote { font-size: 14px; color: #ffd27a; }
    #adminBubble {
      position: fixed; z-index: 85; left: 0; top: 0; margin: 0;
      width: 56px; height: 56px; min-width: 56px; min-height: 56px; padding: 0;
      border-radius: 50%; border: 2px solid #e8c547;
      background: rgba(8, 16, 28, .96); box-shadow: 0 8px 24px rgba(0,0,0,.5);
      display: flex; align-items: center; justify-content: center;
      touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none;
    }
    #adminShield {
      position: fixed; inset: 0; z-index: 75; background: transparent;
      touch-action: none; cursor: grabbing;
    }
    #adminDebug {
      position: fixed; z-index: 70; left: 8px; top: 8px; padding: 6px 8px;
      background: rgba(0,0,0,.72); border-radius: 8px; font: 12px/1.35 ui-monospace, monospace;
      white-space: pre; pointer-events: none;
    }
    #adminBubble { box-sizing: border-box; margin: 0; padding: 0; }
    #adminMin { margin: 0; }
    #adminPanel .adminSizes button, #adminPanel #adminMin {
      min-width: 40px; min-height: 44px; margin: 0;
    }
  `;
  document.head.appendChild(style);

  const prompt = el(`<div id="adminPrompt" hidden>
    <h2>Helpers code</h2>
    <p>Type the secret code for this device.</p>
    <input id="adminCode" type="password" autocomplete="off" maxlength="64" aria-label="Secret code">
    <div id="adminWrong"></div>
    <div class="row">
      <button type="button" id="adminGo">Unlock</button>
      <button type="button" id="adminCancel">Cancel</button>
    </div>
  </div>`);
  const panel = el(`<div id="adminPanel" hidden>
    <div id="adminBar">
      <span class="adminGrip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <h2>Game helpers</h2>
      <div class="adminSizes" role="group" aria-label="Panel size">
        <button type="button" data-size="s" aria-label="Small">S</button>
        <button type="button" data-size="m" aria-label="Medium">M</button>
        <button type="button" data-size="l" aria-label="Large">L</button>
      </div>
      <button type="button" id="adminMin" aria-label="Collapse helpers">–</button>
    </div>
    <div id="adminScroll">
    <div id="adminBody">
    <p id="adminNote"></p>
    <div class="grid">
      <button type="button" data-act="goal" data-team="blue" data-n="1">Blue goal +</button>
      <button type="button" data-act="goal" data-team="blue" data-n="-1">Blue goal −</button>
      <button type="button" data-act="goal" data-team="red" data-n="1">Red goal +</button>
      <button type="button" data-act="goal" data-team="red" data-n="-1">Red goal −</button>
    </div>
    <div class="row">
      <label>Blue <input id="adminBlue" type="number" min="0" max="99" value="0"></label>
      <label>Red <input id="adminRed" type="number" min="0" max="99" value="0"></label>
      <button type="button" id="adminSetScore">Set score</button>
    </div>
    <div class="grid">
      <button type="button" data-act="time" data-n="-30">More time</button>
      <button type="button" data-act="time" data-n="30">Less time</button>
      <button type="button" id="adminClock">Pause clock</button>
      <button type="button" data-act="half">End this half</button>
      <button type="button" data-act="end">End match</button>
    </div>
    <div class="grid">
      <button type="button" data-flag="superSpeed">Super speed</button>
      <button type="button" data-flag="superShot">Super shot</button>
      <button type="button" data-flag="infiniteStamina">Endless energy</button>
      <button type="button" data-flag="perfect">Sticky ball</button>
      <button type="button" data-flag="slow">Slow motion</button>
      <button type="button" data-flag="debug">Show numbers</button>
    </div>
    <div class="grid">
      <button type="button" data-act="kickoff">Back to kick-off</button>
      <button type="button" data-act="switch">Switch player</button>
    </div>
    <div class="row">
      <select id="adminPlayer" aria-label="Which player"></select>
      <button type="button" id="adminRate">Make 100</button>
    </div>
    <div class="row team100">
      <label>Team <select id="adminTeam" aria-label="Which team"></select></label>
      <label class="keep"><input type="checkbox" id="adminTeamKeep"> Save on this device</label>
      <span class="hint">Leave unticked for this match only.</span>
      <button type="button" id="adminTeam100">Make whole team 100</button>
      <button type="button" id="adminTeamUndo">Undo team 100</button>
    </div>
    <div id="adminCup" hidden>
      <h3>Cup</h3>
      <p id="adminCupState"></p>
      <div class="row">
        <button type="button" id="adminCupStart">Start a new cup</button>
        <button type="button" id="adminCupRestart">Restart cup</button>
        <button type="button" id="adminCupUndo">Undo last cup change</button>
      </div>
      <div class="row">
        <label>I play as <select id="adminCupMe" aria-label="Team you play as in the cup"></select></label>
        <button type="button" id="adminCupMeGo">Play as this team</button>
      </div>
      <div class="row">
        <label>Send <select id="adminCupSend" aria-label="Team to send through the cup"></select></label>
      </div>
      <div class="grid">
        <button type="button" data-cup-send="0">Send to Quarterfinal</button>
        <button type="button" data-cup-send="1">Send to Semifinal</button>
        <button type="button" data-cup-send="2">Send to Final</button>
      </div>
      <div class="grid">
        <button type="button" id="adminCupWin">Win this match</button>
        <button type="button" id="adminCupSkip">Skip to next round</button>
      </div>
      <div class="row">
        <label>Match <select id="adminCupMatch" aria-label="Bracket match"></select></label>
        <label>Winner <select id="adminCupWinner" aria-label="Who wins this match"></select></label>
        <label>Score <input id="adminCupScoreA" type="number" min="0" max="30" aria-label="Goals for the first team"> - <input id="adminCupScoreB" type="number" min="0" max="30" aria-label="Goals for the second team"></label>
        <button type="button" id="adminCupResult">Set this result</button>
      </div>
      <div class="row">
        <label>Final <select id="adminCupFinalA" aria-label="First finalist"></select></label>
        <label>vs <select id="adminCupFinalB" aria-label="Second finalist"></select></label>
        <button type="button" id="adminCupFinal">Jump to Final</button>
      </div>
    </div>
    <div class="row">
      <button type="button" id="adminReset">Put everything back</button>
      <button type="button" id="adminPlace" title="Reset position and size">Reset position</button>
      <button type="button" id="adminLock">Lock</button>
    </div>
    </div>
    <div id="adminRail" aria-hidden="true"><i id="adminThumb"></i></div>
    </div>
    <button type="button" id="adminResize" aria-label="Resize helpers"></button>
  </div>`);
  const bubble = el(`<button type="button" id="adminBubble" hidden aria-label="Open game helpers"><span class="adminGrip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></button>`);
  const shield = el(`<div id="adminShield" hidden></div>`);
  const debug = el(`<div id="adminDebug" hidden></div>`);
  document.body.appendChild(shield);
  document.body.appendChild(prompt);
  document.body.appendChild(panel);
  document.body.appendChild(bubble);
  document.body.appendChild(debug);

  const PLACE_KEY = "soccerAdminPlace";
  const DRAG_SLOP = 8;
  let drag = null;
  let swallowClick = false;

  function safePads() {
    const probe = document.getElementById("safeProbe");
    if (!probe) return { left: 0, top: 0, right: 0, bottom: 0 };
    const s = getComputedStyle(probe);
    return {
      left: parseFloat(s.borderLeftWidth) || 0,
      top: parseFloat(s.borderTopWidth) || 0,
      right: parseFloat(s.borderRightWidth) || 0,
      bottom: parseFloat(s.borderBottomWidth) || 0,
    };
  }
  function viewportBox() {
    const vv = window.visualViewport;
    const width = vv ? vv.width : window.innerWidth;
    const height = vv ? vv.height : window.innerHeight;
    const ox = vv ? vv.offsetLeft : 0;
    const oy = vv ? vv.offsetTop : 0;
    const pad = safePads();
    return {
      left: ox + pad.left,
      top: oy + pad.top,
      right: ox + width - pad.right,
      bottom: oy + height - pad.bottom,
    };
  }
  function loadPlace() {
    try {
      const raw = JSON.parse(localStorage.getItem(PLACE_KEY) || "null");
      if (!raw || typeof raw !== "object") return null;
      if (!isFinite(raw.x) || !isFinite(raw.y)) return null;
      return {
        x: Number(raw.x), y: Number(raw.y), collapsed: !!raw.collapsed,
        w: isFinite(raw.w) ? Number(raw.w) : 0,
        h: isFinite(raw.h) ? Number(raw.h) : 0,
      };
    } catch (e) { return null; }
  }
  function place(el, x, y) {
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "none";
  }
  function clampPos(x, y, el) {
    const b = viewportBox();
    const w = el.offsetWidth || 56;
    const h = el.offsetHeight || 56;
    const maxX = Math.max(b.left, b.right - w);
    const maxY = Math.max(b.top, b.bottom - h);
    return {
      x: Math.min(Math.max(b.left, x), maxX),
      y: Math.min(Math.max(b.top, y), maxY),
    };
  }
  function defaultPos(el, kind) {
    const b = viewportBox();
    const w = el.offsetWidth || (kind === "bubble" ? 56 : 320);
    const h = el.offsetHeight || (kind === "bubble" ? 56 : 240);
    if (kind === "bubble") return clampPos(b.right - w - 8, b.top + 60, el);
    return clampPos(b.left + Math.max(0, (b.right - b.left - w) / 2), b.bottom - h - 8, el);
  }
  const MIN_W = 240;
  const MIN_H = 220;
  function isPhone() {
    const b = viewportBox();
    const vw = b.right - b.left;
    const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    return vw < 700 || (coarse && vw < 900);
  }
  function viewportMax() {
    const b = viewportBox();
    return {
      w: Math.max(MIN_W, b.right - b.left),
      h: Math.max(MIN_H, b.bottom - b.top),
    };
  }
  // fixed:true stops the size at the screen edge from the panel's current corner,
  // so dragging the grip never slides the panel.
  function clampSize(w, h, fixed) {
    const cap = viewportMax();
    let maxW = cap.w, maxH = cap.h;
    if (fixed) {
      const b = viewportBox();
      const left = parseFloat(panel.style.left);
      const top = parseFloat(panel.style.top);
      if (isFinite(left)) maxW = Math.max(MIN_W, b.right - left);
      if (isFinite(top)) maxH = Math.max(MIN_H, b.bottom - top);
    }
    return {
      w: Math.round(Math.min(Math.max(MIN_W, w), maxW)),
      h: Math.round(Math.min(Math.max(MIN_H, h), maxH)),
    };
  }
  function defaultSize() {
    const cap = viewportMax();
    if (isPhone()) return clampSize(Math.min(300, cap.w), Math.min(420, Math.round(cap.h * 0.62)));
    return clampSize(Math.min(440, cap.w), Math.min(560, Math.round(cap.h * 0.72)));
  }
  function presetSize(which) {
    const phone = isPhone();
    const table = phone
      ? { s: { w: 260, h: 340 }, m: { w: 320, h: 500 }, l: { w: 520, h: 700 } }
      : { s: { w: 300, h: 380 }, m: { w: 440, h: 560 }, l: { w: 700, h: 740 } };
    const t = table[which] || table.m;
    return clampSize(t.w, t.h);
  }
  function markPreset(w, h) {
    const buttons = panel.querySelectorAll(".adminSizes button");
    let best = null, bestD = 36;
    buttons.forEach((btn) => {
      const s = presetSize(btn.dataset.size);
      const d = Math.hypot(s.w - w, s.h - h);
      btn.classList.remove("on");
      if (d < bestD) { bestD = d; best = btn; }
    });
    if (best) best.classList.add("on");
  }
  function applySize(w, h, fixed) {
    const s = clampSize(w, h, fixed);
    panel.style.width = s.w + "px";
    panel.style.height = s.h + "px";
    const font = Math.round(Math.min(18, Math.max(13, 8 + s.w / 46)));
    panel.style.fontSize = font + "px";
    panel.style.setProperty("--admin-hit", (s.w < 320 ? 40 : 44) + "px");
    panel.dataset.fit = s.w < 340 ? "s" : (s.w >= 520 ? "l" : "m");
    markPreset(s.w, s.h);
    markAdminScroll();
    return s;
  }
  function savePlace() {
    const el = bubble.hidden ? panel : bubble;
    if (el.hidden) return;
    const prev = (() => { try { return JSON.parse(localStorage.getItem(PLACE_KEY) || "null") || {}; } catch (e) { return {}; } })();
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify({
        x: Math.round(parseFloat(el.style.left) || 0),
        y: Math.round(parseFloat(el.style.top) || 0),
        collapsed: !bubble.hidden,
        w: Math.round(parseFloat(panel.style.width) || prev.w || 0),
        h: Math.round(parseFloat(panel.style.height) || prev.h || 0),
      }));
    } catch (e) { /* private mode */ }
  }
  function put(el, x, y, kind) {
    const p = (x == null || y == null) ? defaultPos(el, kind) : clampPos(x, y, el);
    place(el, p.x, p.y);
  }
  function showPanelAt(x, y) {
    bubble.hidden = true;
    panel.hidden = false;
    const saved = loadPlace();
    if (saved && saved.w >= MIN_W && saved.h >= MIN_H) applySize(saved.w, saved.h);
    else { const d = defaultSize(); applySize(d.w, d.h); }
    put(panel, x, y, "panel");
    // Growing may have been clamped to the old corner. Pull it back on screen.
    const fitted = clampSize(panel.offsetWidth, panel.offsetHeight);
    applySize(fitted.w, fitted.h);
    const left = parseFloat(panel.style.left);
    const top = parseFloat(panel.style.top);
    put(panel, isFinite(left) ? left : x, isFinite(top) ? top : y, "panel");
    refreshPanel();
    requestAnimationFrame(markAdminScroll);
  }
  function showBubbleAt(x, y) {
    panel.hidden = true;
    bubble.hidden = false;
    put(bubble, x, y, "bubble");
  }
  function reveal() {
    const saved = loadPlace();
    if (saved && saved.collapsed) showBubbleAt(saved.x, saved.y);
    else if (saved) showPanelAt(saved.x, saved.y);
    else showPanelAt(null, null);
    savePlace();
  }
  function collapsePanel() {
    showBubbleAt(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0);
    savePlace();
  }
  function expandBubble() {
    showPanelAt(parseFloat(bubble.style.left) || 0, parseFloat(bubble.style.top) || 0);
    savePlace();
  }
  function resetPlace() {
    try { localStorage.removeItem(PLACE_KEY); } catch (e) { /* ignore */ }
    if (!bubble.hidden) showBubbleAt(null, null);
    else showPanelAt(null, null);
    savePlace();
  }
  function keepInside() {
    if (!panel.hidden) {
      const fitted = clampSize(panel.offsetWidth, panel.offsetHeight);
      applySize(fitted.w, fitted.h);
      put(panel, parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0, "panel");
      savePlace();
      return;
    }
    if (!bubble.hidden) {
      put(bubble, parseFloat(bubble.style.left) || 0, parseFloat(bubble.style.top) || 0, "bubble");
      savePlace();
    }
  }
  function applyPreset(which) {
    const s = presetSize(which);
    applySize(s.w, s.h);
    const p = clampPos(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0, panel);
    place(panel, p.x, p.y);
    savePlace();
  }
  function eatNextClick() {
    swallowClick = true;
    shield.hidden = false;
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    const finish = () => {
      swallowClick = false;
      if (!drag) shield.hidden = true;
      window.removeEventListener("click", stop, true);
    };
    window.addEventListener("click", stop, true);
    setTimeout(finish, 80);
  }
  function beginDrag(handle, e) {
    if (e.button != null && e.button !== 0) return;
    const target = handle.id === "adminBubble" ? bubble : panel;
    const rect = target.getBoundingClientRect();
    drag = {
      id: e.pointerId, handle: handle, target: target,
      ox: e.clientX - rect.left, oy: e.clientY - rect.top,
      x0: e.clientX, y0: e.clientY, moved: false,
      fromMin: !!(e.target && e.target.closest && e.target.closest("#adminMin")),
    };
    e.stopPropagation();
    shield.hidden = false;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopPropagation();
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) >= DRAG_SLOP) {
      drag.moved = true;
      drag.target.classList.add("adminDragging");
      shield.hidden = false;
    }
    if (!drag.moved) return;
    e.preventDefault();
    const p = clampPos(e.clientX - drag.ox, e.clientY - drag.oy, drag.target);
    place(drag.target, p.x, p.y);
  }
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const moved = drag.moved;
    const fromMin = drag.fromMin;
    const target = drag.target;
    drag = null;
    target.classList.remove("adminDragging");
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (moved) {
      // The click that follows this drag must not press a button. A later tap still does.
      eatNextClick();
      savePlace();
    } else if (fromMin) {
      eatNextClick();
      collapsePanel();
    } else shield.hidden = true;
  }
  let resizeDrag = null;
  const resizeBtn = document.getElementById("adminResize");
  function endResize(e) {
    if (!resizeDrag || (e && e.pointerId !== resizeDrag.id)) return;
    const moved = resizeDrag.moved;
    resizeDrag = null;
    panel.classList.remove("adminResizing");
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (moved) { eatNextClick(); savePlace(); }
    else shield.hidden = true;
  }
  resizeBtn.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = panel.getBoundingClientRect();
    resizeDrag = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false,
      w: rect.width, h: rect.height,
      left: parseFloat(panel.style.left) || rect.left,
      top: parseFloat(panel.style.top) || rect.top,
    };
    shield.hidden = false;
    panel.classList.add("adminResizing");
    try { resizeBtn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  resizeBtn.addEventListener("pointermove", (e) => {
    if (!resizeDrag || e.pointerId !== resizeDrag.id) return;
    e.preventDefault();
    e.stopPropagation();
    if (!resizeDrag.moved && Math.hypot(e.clientX - resizeDrag.x0, e.clientY - resizeDrag.y0) >= DRAG_SLOP) resizeDrag.moved = true;
    if (!resizeDrag.moved) return;
    const s = clampSize(resizeDrag.w + (e.clientX - resizeDrag.x0), resizeDrag.h + (e.clientY - resizeDrag.y0), true);
    applySize(s.w, s.h, true);
    place(panel, resizeDrag.left, resizeDrag.top);
  });
  resizeBtn.addEventListener("pointerup", endResize);
  resizeBtn.addEventListener("pointercancel", endResize);
  resizeBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  const bar = document.getElementById("adminBar");
  bar.addEventListener("pointerdown", (e) => {
    if (e.target && e.target.closest && e.target.closest(".adminSizes")) return;
    beginDrag(bar, e);
  });
  bar.addEventListener("pointermove", moveDrag);
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);
  bar.addEventListener("contextmenu", (e) => e.preventDefault());
  bubble.addEventListener("pointerdown", (e) => beginDrag(bubble, e));
  bubble.addEventListener("pointermove", moveDrag);
  bubble.addEventListener("pointerup", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.moved;
    endDrag(e);
    if (!moved) { eatNextClick(); expandBubble(); }
  });
  bubble.addEventListener("pointercancel", endDrag);
  bubble.addEventListener("contextmenu", (e) => e.preventDefault());
  shield.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); });
  shield.addEventListener("pointermove", (e) => { e.preventDefault(); e.stopPropagation(); });
  shield.addEventListener("pointerup", (e) => { e.preventDefault(); e.stopPropagation(); });
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());
  panel.addEventListener("pointerup", (e) => e.stopPropagation());
  const adminBody = document.getElementById("adminBody");
  function markAdminScroll() {
    if (!adminBody) return;
    const max = adminBody.scrollHeight - adminBody.clientHeight;
    adminBody.classList.toggle("can-up", adminBody.scrollTop > 6);
    adminBody.classList.toggle("can-down", max > 8 && adminBody.scrollTop < max - 6);
    const rail = document.getElementById("adminRail");
    const thumb = document.getElementById("adminThumb");
    if (!rail || !thumb) return;
    const room = max > 8;
    rail.style.opacity = room ? "1" : "0";
    const track = rail.clientHeight || 1;
    const ratio = adminBody.scrollHeight > 0 ? adminBody.clientHeight / adminBody.scrollHeight : 1;
    const h = Math.max(28, Math.round(track * Math.min(1, ratio)));
    const travel = Math.max(0, track - h);
    const top = max > 0 ? (adminBody.scrollTop / max) * travel : 0;
    thumb.style.height = h + "px";
    thumb.style.transform = "translateY(" + Math.round(top) + "px)";
  }
    if (adminBody) {
    adminBody.addEventListener("scroll", markAdminScroll, { passive: true });
    adminBody.addEventListener("wheel", (e) => {
      e.stopPropagation();
      const max = adminBody.scrollHeight - adminBody.clientHeight;
      const dy = e.deltaY || 0;
      const up = dy < 0 && adminBody.scrollTop <= 0;
      const down = dy > 0 && adminBody.scrollTop >= max - 1;
      if (up || down || max <= 1) e.preventDefault();
    }, { passive: false });
    adminBody.addEventListener("touchmove", (e) => {
      e.stopPropagation();
    }, { passive: true });
    let bodyGesture = null;
    adminBody.addEventListener("pointerdown", (e) => {
      if (e.target && e.target.closest && e.target.closest("#adminBar, #adminResize")) return;
      bodyGesture = { id: e.pointerId, y: e.clientY, moved: false };
    });
    adminBody.addEventListener("pointermove", (e) => {
      if (!bodyGesture || e.pointerId !== bodyGesture.id) return;
      if (Math.abs(e.clientY - bodyGesture.y) > 8) bodyGesture.moved = true;
      e.stopPropagation();
    });
    adminBody.addEventListener("pointerup", (e) => {
      if (bodyGesture && bodyGesture.id === e.pointerId && bodyGesture.moved) swallowClick = true;
      bodyGesture = null;
    });
    adminBody.addEventListener("pointercancel", () => { bodyGesture = null; });
  }
  window.addEventListener("resize", keepInside);
  window.addEventListener("orientationchange", keepInside);
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", keepInside);
    visualViewport.addEventListener("scroll", keepInside);
  }

  function showPrompt() {
    if (unlocked()) { hidePrompt(); reveal(); return; }
    prompt.hidden = false;
    const wrong = document.getElementById("adminWrong");
    if (wrong && Date.now() >= coolUntil) wrong.textContent = "";
    const input = document.getElementById("adminCode");
    if (input) { input.value = ""; input.focus(); }
  }
  function hidePrompt() { prompt.hidden = true; }
  function showPanel() { hidePrompt(); reveal(); }
  function hidePanel() {
    panel.hidden = true;
    bubble.hidden = true;
    shield.hidden = true;
  }

  function noteTitleTap() {
    const now = Date.now();
    if (now - lastTap > 2500) taps = 0;
    lastTap = now;
    taps++;
    if (taps >= 7) { taps = 0; showPrompt(); }
  }
  document.addEventListener("pointerup", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(".coverBanner") || t.closest("#menu h1") || t.closest("#home h1")) noteTitleTap();
  });
  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
    if (e.shiftKey && (e.code === "KeyA" || e.key === "A")) {
      e.preventDefault();
      showPrompt();
    }
  }, true);

  document.getElementById("adminCancel").addEventListener("click", hidePrompt);
  document.getElementById("adminGo").addEventListener("click", submitCode);
  document.getElementById("adminCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitCode(); }
  });

  async function submitCode() {
    const btn = document.getElementById("adminGo");
    const wrong = document.getElementById("adminWrong");
    const input = document.getElementById("adminCode");
    if (checking || Date.now() < coolUntil) return;
    checking = true;
    btn.disabled = true;
    wrong.textContent = "Checking…";
    let ok = false;
    try {
      const got = await derive(input.value || "");
      ok = timingEqual(got, EXPECT);
    } catch (e) { ok = false; }
    checking = false;
    btn.disabled = false;
    if (ok) {
      setUnlocked(true);
      wrong.textContent = "";
      showPanel();
    } else {
      coolUntil = Date.now() + 2500;
      wrong.textContent = "Wrong code";
      btn.disabled = true;
      setTimeout(() => { if (Date.now() >= coolUntil) btn.disabled = false; }, 2500);
    }
  }

  function run(action, arg) {
    const s = liveSim();
    if (!canUse() || !s) {
      const note = document.getElementById("adminNote");
      if (note) note.textContent = guestBlocked()
        ? "Only the host can use these in an online game."
        : "Start a match first.";
      return null;
    }
    const out = s.admin(action, arg);
    refreshPanel();
    if (action === "kickoff" && typeof showScreen === "function" && typeof atMenu !== "undefined" && !atMenu) {
      try { showScreen(null); } catch (e) { /* online has no menu screen */ }
    }
    return out;
  }
  function refreshPanel() {
    const s = liveSim();
    const note = document.getElementById("adminNote");
    fillTeamSelect();
    fillCupPanel();
    markAdminScroll();
    if (!s || !s.admin) {
      if (note) note.textContent = guestBlocked() ? "Only the host can use these in an online game." : "";
      return;
    }
    const a = s.admin("get");
    if (note) note.textContent = guestBlocked() ? "Only the host can use these in an online game." : "";
    document.getElementById("adminClock").textContent = a.clockPaused ? "Play clock" : "Pause clock";
    document.getElementById("adminClock").classList.toggle("on", !!a.clockPaused);
    panel.querySelectorAll("[data-flag]").forEach((btn) => {
      btn.classList.toggle("on", !!a[btn.getAttribute("data-flag")]);
    });
    const g = s.game;
    if (g && g.score) {
      document.getElementById("adminBlue").value = g.score.blue;
      document.getElementById("adminRed").value = g.score.red;
    }
    fillTeamSelect();
    const sel = document.getElementById("adminPlayer");
    const keep = sel.value;
    sel.innerHTML = "";
    (s.roster || []).forEach((p, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = (p.team === "blue" ? "Blue" : "Red") + " #" + p.num + " " + (p.name || "");
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
    fillCupPanel();
    markAdminScroll();
  }
  function fillTeamSelect() {
    const sel = document.getElementById("adminTeam");
    if (!sel) return;
    const s = liveSim();
    const mine = s && (s.controllers || []).find((c) => c && !c.cpu);
    const mySide = mine && mine.team;
    const opts = [];
    const seen = {};
    const mark = (id) => (typeof teamShows100 === "function" && teamShows100(id)) ? " \u2605 100" : "";
    const youId = (mySide && s && s.game && s.game.teams[mySide] && s.game.teams[mySide].id)
      || (typeof settings !== "undefined" && settings && settings.blue)
      || "";
    if (s && s.game && s.game.teams) {
      for (const side of ["blue", "red"]) {
        const t = s.game.teams[side];
        if (!t || !t.id || seen[t.id]) continue;
        seen[t.id] = true;
        const who = t.id === youId ? " (you)" : " (on the pitch)";
        opts.push({ v: t.id, label: (t.name || t.id) + who + mark(t.id) });
      }
    }
    if (typeof TEAM_LIST !== "undefined") {
      for (const t of TEAM_LIST) {
        if (seen[t.id]) continue;
        seen[t.id] = true;
        opts.push({ v: t.id, label: t.name + mark(t.id) });
      }
    }
    if (!seen.custom && typeof customTeam === "function" && typeof settings !== "undefined" && settings && settings.custom) {
      const C = customTeam(settings.custom);
      opts.push({ v: "custom", label: (C.name || "My Team") + " (custom)" + mark("custom") });
    }
    const keep = sel.value || youId;
    sel.innerHTML = opts.map((o) => "<option value='" + o.v + "'>" + String(o.label).replace(/</g, "") + "</option>").join("");
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }
  function clearSavedTeam100() {
    if (typeof loadTeam100 !== "function" || typeof setTeam100Saved !== "function") return;
    for (const id of Object.keys(loadTeam100())) setTeam100Saved(id, false);
  }
  function afterTeamChange() {
    if (typeof renderMenu === "function") renderMenu();
    if (typeof paintSquad === "function") paintSquad();
    const blue = document.getElementById("blueTeamSel");
    const red = document.getElementById("redTeamSel");
    if (blue) blue.innerHTML = "";
    if (red) red.innerHTML = "";
    if (typeof renderLobby === "function" && (blue || red)) {
      try { renderLobby(); } catch (e) { /* lobby is not open */ }
    }
  }
  function cupReady() {
    const note = document.getElementById("adminNote");
    if (!unlocked()) {
      if (note) note.textContent = "Unlock the helpers first.";
      return false;
    }
    if (guestBlocked()) {
      if (note) note.textContent = "Only the host can use these in an online game.";
      return false;
    }
    if (typeof cupAdmin !== "function") {
      if (note) note.textContent = "Cups stay on this device.";
      return false;
    }
    return true;
  }
  function optHtml(list, valueKey, labelKey) {
    return list.map((o) => "<option value='" + String(o[valueKey]).replace(/'/g, "") + "'>" + String(o[labelKey]).replace(/</g, "") + "</option>").join("");
  }
  function keepSelect(sel, html, prefer) {
    if (!sel) return;
    const prev = sel.value || prefer || "";
    sel.innerHTML = html;
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else if (sel.options.length) sel.selectedIndex = 0;
  }
  function fillCupWinners() {
    const match = document.getElementById("adminCupMatch");
    const winner = document.getElementById("adminCupWinner");
    if (!match || !winner) return;
    const opt = match.selectedOptions && match.selectedOptions[0];
    const aId = opt && opt.dataset.aId;
    const bId = opt && opt.dataset.bId;
    const aName = opt && opt.dataset.aName;
    const bName = opt && opt.dataset.bName;
    const prev = winner.value;
    if (!aId || !bId) { winner.innerHTML = ""; return; }
    winner.innerHTML = "<option value='" + aId + "'>" + String(aName).replace(/</g, "") + "</option><option value='" + bId + "'>" + String(bName).replace(/</g, "") + "</option>";
    if (prev === bId) winner.value = bId;
  }
  function fillCupPanel() {
    const box = document.getElementById("adminCup");
    if (!box) return;
    const offline = typeof cupAdmin === "function";
    box.hidden = !offline;
    if (!offline) return;
    let state = { active: false, teams: [], matches: [], status: "No cup yet.", youId: "", canUndo: false };
    try { state = cupAdmin("state") || state; } catch (e) { /* cup is offline only */ }
    const status = document.getElementById("adminCupState");
    if (status) status.textContent = state.status || "";
    const teams = state.teams || [];
    const teamHtml = optHtml(teams, "id", "name");
    keepSelect(document.getElementById("adminCupMe"), teamHtml, state.youId);
    keepSelect(document.getElementById("adminCupSend"), teamHtml, state.youId);
    keepSelect(document.getElementById("adminCupFinalA"), teamHtml, state.youId);
    const other = teams.find((t) => t.id !== (document.getElementById("adminCupFinalA") || {}).value);
    keepSelect(document.getElementById("adminCupFinalB"), teamHtml, other && other.id);
    const matchHtml = (state.matches || []).map((m) => "<option value='" + m.key + "' data-a-id='" + m.aId + "' data-b-id='" + m.bId + "' data-a-name='" + String(m.aName).replace(/'/g, "") + "' data-b-name='" + String(m.bName).replace(/'/g, "") + "'>" + String(m.label).replace(/</g, "") + "</option>").join("");
    keepSelect(document.getElementById("adminCupMatch"), matchHtml, "");
    fillCupWinners();
    const start = document.getElementById("adminCupStart");
    const restart = document.getElementById("adminCupRestart");
    if (start) start.hidden = !!state.active;
    if (restart) restart.hidden = !state.active;
    markAdminScroll();
  }
  function runCup(action, arg) {
    if (!cupReady()) return;
    let state = null;
    try { state = cupAdmin(action, arg || {}); } catch (e) { state = { note: "That cup change did not work." }; }
    const note = document.getElementById("adminNote");
    if (note && state && state.note) note.textContent = state.note;
    fillCupPanel();
    markAdminScroll();
  }
  function teamOnPitch(id) {
    const s = liveSim();
    if (!s || !s.roster || !s.game || !s.game.teams) return false;
    return s.roster.some((p) => s.game.teams[p.team] && s.game.teams[p.team].id === id);
  }

  panel.addEventListener("click", (e) => {
    if (swallowClick) {
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const btn = e.target.closest("button");
    if (!btn || !panel.contains(btn)) return;
    if (btn.id === "adminMin") { collapsePanel(); return; }
    if (btn.id === "adminResize") return;
    if (btn.dataset && btn.dataset.size) { applyPreset(btn.dataset.size); return; }
    if (btn.id === "adminPlace") { resetPlace(); return; }
    if (btn.id === "adminLock") {
      clearSavedTeam100();
      const s = liveSim();
      if (s && s.admin) s.admin("reset");
      afterTeamChange();
      setUnlocked(false);
      hidePanel();
      debug.hidden = true;
      return;
    }
    if (btn.id === "adminSetScore") {
      run("score", {
        blue: document.getElementById("adminBlue").value,
        red: document.getElementById("adminRed").value,
      });
      return;
    }
    if (btn.id === "adminClock") {
      const s = liveSim();
      const on = !(s && s.admin("get").clockPaused);
      run("clock", on);
      return;
    }
    if (btn.id === "adminRate") {
      run("rate", document.getElementById("adminPlayer").value);
      return;
    }
    if (btn.id === "adminTeam100" || btn.id === "adminTeamUndo") {
      const note = document.getElementById("adminNote");
      if (!unlocked() || guestBlocked()) {
        if (note) note.textContent = guestBlocked() ? "Only the host can use these in an online game." : "Unlock the helpers first.";
        return;
      }
      const id = document.getElementById("adminTeam").value;
      const save = document.getElementById("adminTeamKeep").checked;
      if (!id) return;
      if (btn.id === "adminTeam100") {
        const onPitch = teamOnPitch(id);
        if (!onPitch && !save) {
          if (note) note.textContent = "That team is not in this match. Tick Save on this device.";
          return;
        }
        if (save && typeof setTeam100Saved === "function") setTeam100Saved(id, true);
        if (onPitch) run("team100", { id: id });
        if (note) note.textContent = save
          ? (onPitch ? "Whole team is 100, saved on this device." : "Saved on this device. They are 100 next time you play them.")
          : "Whole team is 100 for this match.";
      } else {
        if (typeof setTeam100Saved === "function") setTeam100Saved(id, false);
        if (liveSim()) run("teamundo", { id: id });
        if (note) note.textContent = "That team is back to its own stats.";
      }
      afterTeamChange();
      fillTeamSelect();
      return;
    }
    if (btn.dataset && btn.dataset.cupSend != null) {
      runCup("send", { id: document.getElementById("adminCupSend").value, round: Number(btn.dataset.cupSend) });
      return;
    }
    if (btn.id === "adminCupStart") { runCup("start"); return; }
    if (btn.id === "adminCupRestart") { runCup("restart"); return; }
    if (btn.id === "adminCupUndo") { runCup("undo"); return; }
    if (btn.id === "adminCupMeGo") { runCup("me", { id: document.getElementById("adminCupMe").value }); return; }
    if (btn.id === "adminCupWin") { runCup("win"); return; }
    if (btn.id === "adminCupSkip") { runCup("skip"); return; }
    if (btn.id === "adminCupResult") {
      const parts = (document.getElementById("adminCupMatch").value || "").split(":");
      runCup("result", {
        round: Number(parts[0]), index: Number(parts[1]),
        winner: document.getElementById("adminCupWinner").value,
        sa: document.getElementById("adminCupScoreA").value,
        sb: document.getElementById("adminCupScoreB").value,
      });
      return;
    }
    if (btn.id === "adminCupFinal") {
      runCup("final", { a: document.getElementById("adminCupFinalA").value, b: document.getElementById("adminCupFinalB").value });
      return;
    }
    if (btn.id === "adminReset") {
      clearSavedTeam100();
      run("reset");
      afterTeamChange();
      const note = document.getElementById("adminNote");
      if (note && !guestBlocked()) note.textContent = "Everything is back, including team 100.";
      return;
    }
    const flag = btn.getAttribute("data-flag");
    if (flag) {
      const s = liveSim();
      const cur = s && s.admin("get");
      run("flag", { name: flag, on: !(cur && cur[flag]) });
      return;
    }
    const act = btn.getAttribute("data-act");
    if (act === "goal") run("goal", { team: btn.getAttribute("data-team"), n: Number(btn.getAttribute("data-n")) });
    else if (act === "time") run("time", Number(btn.getAttribute("data-n")));
    else if (act) run(act);
  });
  const cupMatchSel = document.getElementById("adminCupMatch");
  if (cupMatchSel) cupMatchSel.addEventListener("change", fillCupWinners);

  let frames = 0, fpsStamp = performance.now(), fps = 0;
  function debugTick() {
    frames++;
    const now = performance.now();
    if (now - fpsStamp > 500) {
      fps = Math.round(frames * 1000 / (now - fpsStamp));
      frames = 0;
      fpsStamp = now;
    }
    const s = liveSim();
    const on = s && s.game && s.game.admin && s.game.admin.debug && unlocked();
    if (!on) { debug.hidden = true; }
    else {
      const b = s.ball;
      const c = (s.controllers || []).find((k) => !k.cpu && k.active);
      const you = c && c.active;
      debug.hidden = false;
      debug.textContent = "FPS " + fps
        + "\nBall " + Math.round(b.x) + ", " + Math.round(b.y)
        + "\nYou " + (you ? you.name + " " + Math.round(you.x) + ", " + Math.round(you.y) : "—");
    }
    requestAnimationFrame(debugTick);
  }
  requestAnimationFrame(debugTick);
})();
