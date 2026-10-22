/* =====================================================================
   SOCCER SHOWDOWN 2 - ONLINE  :  client.js  (runs in each browser)
   ---------------------------------------------------------------------
   The browser does NOT decide what happens in the match - the server
   does. The browser:
     1. shows the lobby (create / join a room, pick a team)
     2. sends your buttons to the server (move, sprint, shoot, pass)
     3. receives snapshots ~30 times a second and draws them smoothly
        (it draws 100 ms "in the past" and blends between two snapshots,
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
const isTouchDevice = ("ontouchstart" in window) || (window.matchMedia && matchMedia("(pointer: coarse)").matches);
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


