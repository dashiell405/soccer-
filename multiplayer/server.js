/* =====================================================================
   SOCCER SHOWDOWN 2 - ONLINE  :  server.js
   ---------------------------------------------------------------------
   Run it with:   npm install   (only once)   and then   npm start
   Then open the address it prints on every phone / computer that is on
   the same Wi-Fi.

   What the server does:
     1. Serves the game files (index.html, client.js, game.js) to browsers.
     2. Keeps "rooms". A room has a 4-letter code, up to 2 or 4 players.
     3. Runs the real match for each room (60 times per second) using
        game.js, and sends a snapshot of it to everyone ~30 times per
        second. Browsers only send their button presses.

   Debug mode (for testing):  npm run debug   (or DEBUG=1 npm start)
     - adds /debug/rooms (JSON) and lets browsers send debug commands
       (computer plays for everyone, fast-forward, force a goal).
   ===================================================================== */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const Soccer = require("./public/game.js");

const PORT = Number(process.env.PORT) || 3000;
const DEBUG = process.env.DEBUG === "1" || process.argv.includes("--debug");
const TICK_RATE = 60;          // server updates per second
const SIM_STEP = 1 / 120;      // physics step (same as the offline game)
const SEND_EVERY = 2;          // send a snapshot every 2 ticks = 30 per second
const ROOM_TIMEOUT_MS = 10 * 60 * 1000; // empty rooms are deleted after 10 min

// ---------------------------------------------------------------------
// 1. Serving the game files
// ---------------------------------------------------------------------
const PUBLIC = path.join(__dirname, "public");
const HTML = "text/html; charset=utf-8", JS = "text/javascript; charset=utf-8";
const FILES = {            // only these files can be downloaded
  "/": ["index.html", HTML],
  "/index.html": ["index.html", HTML],
  "/offline.html": ["offline.html", HTML],       // the single-device game (no server needed)
  "/client.js": ["client.js", JS],
  "/game.js": ["game.js", JS],
  "/pwa.js": ["pwa.js", JS],                      // installs the service worker etc.
  "/sw.js": ["sw.js", JS],                        // service worker: keeps the app working offline
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
};
// App icons: /icons/<name>.png (letters, numbers and dashes only, so nobody can
// sneak out of the icons folder with "../")
const ICON_RE = /^\/icons\/([a-z0-9-]+\.png)$/;
const ICON_ALIASES = { "/apple-touch-icon.png": "icons/apple-touch-icon.png", "/apple-touch-icon-precomposed.png": "icons/apple-touch-icon.png", "/favicon.ico": "icons/favicon-32.png" };

function lookup(pathname) {
  if (FILES[pathname]) return FILES[pathname];
  if (ICON_ALIASES[pathname]) return [ICON_ALIASES[pathname], "image/png", true];
  const m = ICON_RE.exec(pathname);
  if (m) return ["icons/" + m[1], "image/png", true];
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/healthz") {             // used by hosting sites to check we're alive
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (DEBUG && url.pathname === "/debug/rooms") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([...rooms.values()].map(debugRoom)));
    return;
  }
  const file = lookup(url.pathname);
  if (!file) { res.writeHead(404); res.end("Not found"); return; }
  fs.readFile(path.join(PUBLIC, file[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, {
      "Content-Type": file[1],
      // icons rarely change; everything else is re-checked so updates arrive quickly
      "Cache-Control": file[2] ? "public, max-age=86400" : "no-cache",
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------------
// 2. Rooms and members
// ---------------------------------------------------------------------
const rooms = new Map();   // code -> room
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O (look like 1 and 0)

function newCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}
const newId = () => crypto.randomBytes(6).toString("hex");
const cleanName = (n) => String(n || "").replace(/[^\p{L}\p{N} _.\-!?]/gu, "").trim().slice(0, 14) || "Player";
const perTeam = (room) => (room.mode === "2v2" ? 2 : 1);

function createRoom(mode, difficulty) {
  const room = {
    code: newCode(),
    mode: mode === "2v2" ? "2v2" : "1v1",
    difficulty: ["easy", "normal", "hard"].includes(difficulty) ? difficulty : "normal",
    blueTeam: "blue", redTeam: "red",          // team ids from Soccer.TEAM_LIST
    rules: { ...Soccer.DEFAULT_RULES },        // offside / cards on or off
    matchType: "match",                        // "match" or "shootout"
    hostId: null,
    members: new Map(),   // id -> member
    state: "lobby",       // "lobby" | "playing" | "win"
    sim: null, tick: 0, speed: 1, acc: 0,
    emptySince: null,
  };
  rooms.set(room.code, room);
  return room;
}

const teamCount = (room, team) => [...room.members.values()].filter((m) => m.team === team).length;

// Put a new player on the team with fewer players (or spectate if full)
function autoTeam(room) {
  const b = teamCount(room, "blue"), r = teamCount(room, "red"), max = perTeam(room);
  if (b <= r && b < max) return "blue";
  if (r < max) return "red";
  if (b < max) return "blue";
  return null; // spectator
}

function roomInfo(room) {
  return {
    t: "room", code: room.code, mode: room.mode, difficulty: room.difficulty,
    blueTeam: room.blueTeam, redTeam: room.redTeam, rules: room.rules, matchType: room.matchType,
    hostId: room.hostId, state: room.state, perTeam: perTeam(room), debug: DEBUG,
    members: [...room.members.values()].map((m) => ({ id: m.id, name: m.name, team: m.team, connected: m.connected, ping: m.ping })),
  };
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
}
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const m of room.members.values()) if (m.connected) send(m.ws, data);
}
const broadcastRoom = (room) => broadcast(room, roomInfo(room));

// The host leaves? Give the host role to someone still connected.
function fixHost(room) {
  const host = room.members.get(room.hostId);
  if (host && host.connected) return;
  const next = [...room.members.values()].find((m) => m.connected);
  if (next) room.hostId = next.id;
}

// ---------------------------------------------------------------------
// 3. Matches
// ---------------------------------------------------------------------
function startMatch(room) {
  room.sim = Soccer.createSim({
    mode: room.mode, difficulty: room.difficulty, rules: room.rules, matchType: room.matchType,
    teams: Soccer.buildTeamKits(Soccer.findTeam(room.blueTeam), Soccer.findTeam(room.redTeam)),
  });
  for (const m of room.members.values()) {
    if (!m.team) continue;
    room.sim.addController(m.id, m.name, m.team);
    if (!m.connected) room.sim.setConnected(m.id, false);
  }
  room.sim.start();
  room.state = "playing";
  room.tick = 0; room.acc = 0;
  broadcast(room, { t: "match", players: room.sim.staticInfo(), info: room.sim.matchInfo() });
  broadcastRoom(room);
}

// The heart of the server: every room's match moves forward 60 times a second
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  for (const room of rooms.values()) {
    if (!room.sim || room.state === "lobby") continue;
    if (room.state === "playing") {
      room.acc += dt * room.speed;
      let steps = 0;
      while (room.acc >= SIM_STEP && steps < 2000) { room.sim.update(SIM_STEP); room.acc -= SIM_STEP; steps++; }
      if (room.sim.game.phase === "win") { room.state = "win"; broadcastRoom(room); }
    }
    room.tick++;
    if (room.tick % SEND_EVERY === 0 || room.state === "win") {
      if (room.state === "win" && room.sentWin) continue;
      const snap = room.sim.snapshot();
      snap.t = "s";
      snap.now = now;
      broadcast(room, snap);
      if (room.state === "win") room.sentWin = true;
    }
  }
}, 1000 / TICK_RATE);

// Delete rooms nobody has been connected to for a while; refresh pings
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyone = [...room.members.values()].some((m) => m.connected);
    if (anyone) { room.emptySince = null; broadcastRoom(room); continue; }
    if (!room.emptySince) room.emptySince = now;
    if (now - room.emptySince > ROOM_TIMEOUT_MS) rooms.delete(room.code);
  }
}, 3000);

// ---------------------------------------------------------------------
// 4. Messages from browsers
// ---------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });

wss.on("connection", (ws) => {
  let room = null, me = null;

  // Join a room as a new member, or take back your old slot
  function enter(r, name, token) {
    let m = null;
    if (token) m = [...r.members.values()].find((x) => x.token === token);
    if (!m) m = [...r.members.values()].find((x) => !x.connected && x.name.toLowerCase() === name.toLowerCase());
    if (m) {
      if (m.connected && m.ws && m.ws !== ws) { try { m.ws.close(); } catch (e) { /* ignore */ } }
      m.ws = ws; m.connected = true;
    } else {
      m = { id: newId(), token: newId() + newId(), name, team: autoTeam(r), ws, connected: true, ping: 0 };
      r.members.set(m.id, m);
      if (!r.hostId) r.hostId = m.id;
      if (r.sim && m.team) r.sim.addController(m.id, m.name, m.team); // joined during a match
    }
    if (r.sim && m.team) r.sim.setConnected(m.id, true);
    room = r; me = m;
    fixHost(r);
    send(ws, { t: "joined", you: m.id, token: m.token, code: r.code });
    if (r.sim) send(ws, { t: "match", players: r.sim.staticInfo(), info: r.sim.matchInfo() });
    broadcastRoom(r);
  }

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== "string") return;

    switch (msg.t) {
      case "create": {
        if (room) return;
        enter(createRoom(msg.mode, msg.difficulty), cleanName(msg.name), null);
        break;
      }
      case "join": {
        if (room) return;
        const r = rooms.get(String(msg.code || "").toUpperCase().trim());
        if (!r) { send(ws, { t: "error", msg: "Room not found. Check the 4-letter code." }); return; }
        enter(r, cleanName(msg.name), typeof msg.token === "string" ? msg.token : null);
        break;
      }
      case "ping":
        if (me) me.ping = clampPing(msg.rtt);
        send(ws, { t: "pong", ts: msg.ts });
        break;
      case "input":
        if (room && room.sim && me && me.team) room.sim.setInput(me.id, msg);
        break;
      case "press":
        if (room && room.sim && me && me.team) room.sim.press(me.id, msg.a);
        break;
      case "team": {
        if (!room || room.state !== "lobby" || !me) return;
        const t = msg.team === "blue" || msg.team === "red" ? msg.team : null;
        if (t && t !== me.team && teamCount(room, t) >= perTeam(room)) return;
        me.team = t;
        broadcastRoom(room);
        break;
      }
      case "settings": {
        if (!room || room.state !== "lobby" || !me || me.id !== room.hostId) return;
        if (msg.mode === "1v1" || msg.mode === "2v2") {
          room.mode = msg.mode;
          // too many players for 1v1? extra players become spectators
          for (const team of ["blue", "red"]) {
            const list = [...room.members.values()].filter((m) => m.team === team);
            list.slice(perTeam(room)).forEach((m) => { m.team = null; });
          }
          for (const m of room.members.values()) if (!m.team) m.team = autoTeam(room);
        }
        if (["easy", "normal", "hard"].includes(msg.difficulty)) room.difficulty = msg.difficulty;
        if (Soccer.findTeam(msg.blueTeam)) room.blueTeam = msg.blueTeam;
        if (Soccer.findTeam(msg.redTeam)) room.redTeam = msg.redTeam;
        if (msg.matchType === "match" || msg.matchType === "shootout") room.matchType = msg.matchType;
        if (msg.rules && typeof msg.rules === "object") {
          for (const k of ["offside", "cards"]) if (typeof msg.rules[k] === "boolean") room.rules[k] = msg.rules[k];
        }
        broadcastRoom(room);
        break;
      }
      case "start":
      case "rematch":
        if (room && me && me.id === room.hostId && room.state !== "playing") startMatch(room);
        break;
      case "lobby":
        if (room && me && me.id === room.hostId) { room.state = "lobby"; room.sim = null; room.sentWin = false; broadcastRoom(room); }
        break;
      case "leave":
        if (room && me) {
          room.members.delete(me.id);
          if (room.sim) room.sim.removeController(me.id);
          fixHost(room);
          broadcastRoom(room);
          room = null; me = null;
        }
        break;
      case "debug":
        if (!DEBUG || !room || !room.sim) return;
        if (msg.cmd === "autoplay") room.sim.setAutoplay(!!msg.on);
        if (msg.cmd === "speed") room.speed = clamp(Number(msg.value) || 1, 0.1, 40);
        if (msg.cmd === "goal") room.sim.forceGoal(msg.team === "red" ? "red" : "blue");
        if (msg.cmd === "foul") room.sim.debugFoul(msg.team === "red" ? "red" : "blue", msg.inBox !== false, !!msg.behind);
        if (msg.cmd === "offside") room.sim.debugOffside(msg.team === "red" ? "red" : "blue");
        if (msg.cmd === "skill") room.sim.debugSkill(msg.team === "red" ? "red" : "blue", String(msg.type || "stepover"));
        if (msg.cmd === "card") room.sim.giveCard(Number(msg.index) || 0, msg.kind === "red" ? "red" : "yellow");
        if (msg.cmd === "shootout") room.sim.startShootout();
        break;
    }
    if (msg.t === "start" || msg.t === "rematch") { if (room) room.sentWin = false; }
  });

  ws.on("close", () => {
    if (!room || !me || me.ws !== ws) return;
    me.connected = false;
    if (room.sim && me.team) room.sim.setConnected(me.id, false); // the computer takes over
    fixHost(room);
    broadcastRoom(room);
  });
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clampPing = (v) => clamp(Math.round(Number(v) || 0), 0, 9999);

function debugRoom(room) {
  const sim = room.sim;
  return {
    code: room.code, state: room.state, mode: room.mode, speed: room.speed,
    members: [...room.members.values()].map((m) => ({ id: m.id, name: m.name, team: m.team, connected: m.connected })),
    game: sim ? {
      phase: sim.game.phase, score: sim.game.score, ball: { x: sim.ball.x, y: sim.ball.y },
      setpiece: sim.game.setpiece ? sim.game.setpiece.type : null, penalty: !!sim.game.penalty, stats: sim.game.stats,
      shootout: sim.game.shootout ? { blue: sim.game.shootout.kicks.blue, red: sim.game.shootout.kicks.red, sudden: sim.game.shootout.sudden } : null,
      onPitch: sim.players.length, teams: { blue: sim.game.teams.blue.short, red: sim.game.teams.red.short },
      controllers: sim.controllers.map((c) => ({ id: c.id, name: c.name, team: c.team, cpu: c.cpu, active: sim.players.indexOf(c.active) })),
    } : null,
  };
}

// ---------------------------------------------------------------------
// 5. Start! Print the addresses people should open.
// ---------------------------------------------------------------------
server.listen(PORT, () => {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) urls.push("http://" + a.address + ":" + PORT);
  }
  console.log("");
  console.log("  ==============================================");
  console.log("   SOCCER SHOWDOWN 2 - ONLINE server is running!");
  console.log("  ==============================================");
  console.log("   On THIS computer open:   http://localhost:" + PORT);
  if (urls.length) {
    console.log("   On phones / other computers on the same Wi-Fi open:");
    for (const u of urls) console.log("        " + u);
  } else {
    console.log("   (No network found - connect to Wi-Fi to play with other devices)");
  }
  if (DEBUG) console.log("   DEBUG mode is ON (/debug/rooms, autoplay, fast-forward)");
  console.log("   Press Ctrl+C to stop the server.");
  console.log("");
});
