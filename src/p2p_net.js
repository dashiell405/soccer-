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
    hosted.acc += dt * (hosted.speed || 1);
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
