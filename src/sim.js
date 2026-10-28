/* =====================================================================
   STADIUM SOCCER  :  game.js  (the shared game simulation, "the sim")
   ---------------------------------------------------------------------
   This ONE file is the game's brain. It is used by:
     * the offline game (soccer.html / offline.html) - copied in at build time
     * the online SERVER (Node.js), which runs the real match for a room
     * the online BROWSER, which only uses the settings, team list + helpers
   The source lives in src/sim.js; run "python3 build.py" in the soccer
   folder to rebuild soccer.html, game.js, client.js and offline.html.

   What's inside createSim():
     3. game state        8. skill moves         13. player movement
     4. helpers           9. kicking             14. rules: goals, out of play
     5. controllers       10. ball physics       15. fouls, cards, penalties
        (the humans)      11. ball contact       16. offside
     6. setup             12. computer AI        17. penalty shootout
     7. human kicks                              18. officials, celebrations + update
   ===================================================================== */
"use strict";

// =====================================================================
// 1. SETTINGS
// =====================================================================

// The whole stadium ("world") is bigger than the screen. A camera shows
// part of it. All positions below are in world pixels.
// FIELD makes the pitch about 18% longer and wider. Lines, goals, and
// running speeds use the same scale so a bigger field still feels right.
const FIELD = 1.18;
const WORLD_W = Math.round(1640 * FIELD), WORLD_H = Math.round(1100 * FIELD);
const STANDS = Math.round(70 * FIELD);                 // thickness of the crowd stands
const PITCH = { left: Math.round(120 * FIELD), top: Math.round(120 * FIELD), right: Math.round(1520 * FIELD), bottom: Math.round(980 * FIELD) };
PITCH.w = PITCH.right - PITCH.left;
PITCH.h = PITCH.bottom - PITCH.top;
PITCH.cx = (PITCH.left + PITCH.right) / 2;
PITCH.cy = (PITCH.top + PITCH.bottom) / 2;

// Pitch markings (roughly real proportions, goals a bit bigger for fun)
const GOAL_W = Math.round(160 * FIELD);                // goal mouth width
const GOAL_DEPTH = Math.round(36 * FIELD);             // how deep the net is
const CROSSBAR = Math.round(40 * FIELD);               // crossbar height (ball z)
const GOAL_TOP = PITCH.cy - GOAL_W / 2;
const GOAL_BOTTOM = PITCH.cy + GOAL_W / 2;
const BOX = { depth: Math.round(210 * FIELD), width: Math.round(520 * FIELD) };     // penalty box
const SIX = { depth: Math.round(70 * FIELD), width: Math.round(250 * FIELD) };      // 6-yard box
const PEN_SPOT = Math.round(140 * FIELD);              // penalty spot distance from goal line
const CIRCLE_R = Math.round(115 * FIELD);              // center circle radius
const POST_R = Math.max(4, Math.round(4 * FIELD));

const MATCH_LENGTH = 300;         // every real match is 5:00 of game time. No goal limit.
// Overhead throw-in: wind the ball up behind the head, then swing it forward.
const THROW_WIND = 0.42;          // seconds with the ball going up and back
const THROW_RELEASE = 0.70;       // when the ball leaves the hands
const THROW_DONE = 1.00;          // arms finish their follow-through
const GOAL_CELEBRATION_TIME = 5.5; // seconds of celebrating after a goal (tap / any key skips)

// Players
const PLAYER_R = 11;               // collision radius (at the feet)
const RUN_SPEED = 190 * FIELD;     // normal running speed (px/s)
const SPRINT_MULT = 1.4;           // sprinting is 40% faster...
const DRIBBLE_MULT = 0.92;         // ...and you are a bit slower with the ball
const ACCEL = 540 * FIELD;         // how quickly players speed up (px/s^2). A bit of weight, still quick to respond.
const STAMINA_DRAIN = 0.22;        // stamina used per second of sprinting
const STAMINA_REGEN = 0.10;        // stamina regained per second
const SLIDE_SPEED = 400 * FIELD;
const SLIDE_TIME = 0.45;

// Ball
const BALL_R = 6;
const GRAVITY = 650 * FIELD;       // pulls the ball back down (px/s^2)
const GROUND_FRICTION = 0.58;      // fraction of speed left after 1 s rolling
const AIR_DRAG = 0.85;             // fraction of speed left after 1 s flying
const BOUNCE = 0.58;               // how bouncy the ball is on the ground
const CONTROL_HEIGHT = 18;         // ball lower than this can be controlled
const HEADER_HEIGHT = 36;          // ball lower than this can be headed
const GK_HAND_HEIGHT = 56;         // goalies can catch up to this height
const CONTROL_SPEED = 640 * FIELD; // faster balls bounce off instead of sticking

// Kicking
const SHOT_MIN = 520 * FIELD, SHOT_MAX = 1200 * FIELD; // shot speed range (charge 0 -> 1)
const CHARGE_TIME = 0.9;           // seconds to fully charge a kick
const TAP_TIME = 0.22;             // a press shorter than this is a "tap"
const KICK_RANGE = PLAYER_R + BALL_R + 10;
const SETPIECE_DIST = 75;          // opponents must stand this far away
const HUMAN_STEAL = 3.2;           // how good YOU are at poking the ball away

// Penalties
const PEN_POWER_MIN = 560 * FIELD, PEN_POWER_MAX = 1150 * FIELD; // penalty shot speed (power bar 0 -> 1)
const PEN_RISKY = 0.88;            // power bar above this = the ball can fly over the bar!
const PEN_AIM_SPEED = 170 * FIELD; // how fast the aim marker moves (px/s)
const SHOOTOUT_KICKS = 5;          // kicks each in a shootout (then sudden death)

// Skill moves (R / F keys, SKILL button)
const SKILL_COOLDOWN = 0.9;        // seconds before you can do another trick
const SKILL_TIME = { stepover: 0.45, spin: 0.45, flick: 0.55, burst: 0.7 };
const SKILL_NAMES = { stepover: "Step-over!", spin: "Roulette!", flick: "Rainbow flick!", burst: "Burst!" };
// How often the computer does tricks when a defender is close (per decision)
const AI_SKILL_CHANCE = { easy: 0, normal: 0.18, hard: 0.45 };

// Difficulty settings for the COMPUTER team
//   speed      - fraction of RUN_SPEED
//   think      - seconds between decisions (slower = easier)
//   aimErr     - shot inaccuracy
//   shootRange - how far from goal the AI will shoot
//   steal      - chance per second to poke the ball away when close
//   slide      - how often they try slide tackles
//   gkDive / gkReact / gkCatch - goalie dive speed, reaction time, safe hands
//   passErr    - how sloppy passes are
const DIFFICULTY = {
  easy:   { speed: 0.82, think: 0.45, aimErr: 0.60, shootRange: 300 * FIELD, steal: 1.0, slide: 0.0, gkDive: 330 * FIELD, gkReact: 0.30, gkCatch: 0.45, passErr: 0.25 },
  normal: { speed: 0.92, think: 0.25, aimErr: 0.40, shootRange: 360 * FIELD, steal: 1.8, slide: 0.35, gkDive: 390 * FIELD, gkReact: 0.40, gkCatch: 0.60, passErr: 0.12 },
  hard:   { speed: 1.00, think: 0.12, aimErr: 0.25, shootRange: 420 * FIELD, steal: 2.8, slide: 0.7, gkDive: 450 * FIELD, gkReact: 0.50, gkCatch: 0.72, passErr: 0.05 },
};
// Computer-controlled teammates of a human use these
const TEAMMATE_AI = { speed: 0.95, think: 0.22, aimErr: 0.35, shootRange: 360 * FIELD, steal: 1.8, slide: 0.0, gkDive: 400 * FIELD, gkReact: 0.42, gkCatch: 0.62, passErr: 0.1 };

// =====================================================================
// 2. TEAMS & KITS
// =====================================================================

const TEAMS = {
  blue: { id: "blue", name: "Blue", short: "BLU", ui: "#5aa0ff", dir: 1, ownGoalX: PITCH.left, targetGoalX: PITCH.right,
          kit: { shirt: "#1f5fd6", shorts: "#ffffff", socks: "#1f5fd6", number: "#ffffff" },
          gk:  { shirt: "#2ecc40", shorts: "#111111", socks: "#2ecc40", number: "#0b3d14" } },
  red:  { id: "red", name: "Red", short: "RED", ui: "#ff6b6b", dir: -1, ownGoalX: PITCH.right, targetGoalX: PITCH.left,
          kit: { shirt: "#d62828", shorts: "#111111", socks: "#ffffff", number: "#ffffff" },
          gk:  { shirt: "#ffcc00", shorts: "#222222", socks: "#ffcc00", number: "#5a4300" } },
};
const other = (team) => (team === "blue" ? "red" : "blue");

// ---- Teams you can pick (country names, made-up kits; rating 1-5 stars
// makes the computer a little better or worse when it plays that team) ----
const TEAM_LIST = [
  { id: "blue", name: "Blue Stars",  short: "BLU", rating: 3, home: ["#1f5fd6", "#ffffff", "#1f5fd6"], away: ["#ffffff", "#1f5fd6", "#ffffff"] },
  { id: "red",  name: "Red Rockets", short: "RED", rating: 3, home: ["#d62828", "#111111", "#ffffff"], away: ["#ffffff", "#d62828", "#d62828"] },
  { id: "bra", name: "Brazil",      short: "BRA", rating: 5, home: ["#ffd500", "#1d4fb8", "#ffffff"], away: ["#1d4fb8", "#ffffff", "#1d4fb8"] },
  { id: "arg", name: "Argentina",   short: "ARG", rating: 5, home: ["#75aadb", "#1b1b2f", "#ffffff"], away: ["#2b2d6e", "#2b2d6e", "#2b2d6e"] },
  { id: "fra", name: "France",      short: "FRA", rating: 5, home: ["#1d2d6b", "#ffffff", "#d62828"], away: ["#f4f4f4", "#1d2d6b", "#f4f4f4"] },
  { id: "eng", name: "England",     short: "ENG", rating: 4, home: ["#f4f4f4", "#1d2d6b", "#f4f4f4"], away: ["#c8102e", "#c8102e", "#c8102e"] },
  { id: "ger", name: "Germany",     short: "GER", rating: 4, home: ["#f4f4f4", "#111111", "#f4f4f4"], away: ["#0b6e4f", "#111111", "#0b6e4f"] },
  { id: "esp", name: "Spain",       short: "ESP", rating: 4, home: ["#c60b1e", "#1d2d6b", "#c60b1e"], away: ["#ffd200", "#ffd200", "#ffd200"] },
  { id: "por", name: "Portugal",    short: "POR", rating: 4, home: ["#8b0a1a", "#046a38", "#8b0a1a"], away: ["#f4f4f4", "#f4f4f4", "#f4f4f4"] },
  { id: "ned", name: "Netherlands", short: "NED", rating: 4, home: ["#ff6f00", "#ff6f00", "#ff6f00"], away: ["#1d2d6b", "#1d2d6b", "#1d2d6b"] },
  { id: "ita", name: "Italy",       short: "ITA", rating: 4, home: ["#0066cc", "#f4f4f4", "#0066cc"], away: ["#f4f4f4", "#0066cc", "#f4f4f4"] },
  { id: "jpn", name: "Japan",       short: "JPN", rating: 3, home: ["#102a83", "#f4f4f4", "#102a83"], away: ["#f4f4f4", "#102a83", "#f4f4f4"] },
  { id: "usa", name: "USA",         short: "USA", rating: 3, home: ["#f4f4f4", "#1d2d6b", "#f4f4f4"], away: ["#1d2d6b", "#c8102e", "#1d2d6b"] },
  { id: "mex", name: "Mexico",      short: "MEX", rating: 3, home: ["#006847", "#f4f4f4", "#c8102e"], away: ["#222222", "#222222", "#222222"] },
  { id: "nga", name: "Nigeria",     short: "NGA", rating: 3, home: ["#00a650", "#f4f4f4", "#00a650"], away: ["#f4f4f4", "#00a650", "#f4f4f4"] },
  { id: "kor", name: "South Korea", short: "KOR", rating: 3, home: ["#e4002b", "#111111", "#e4002b"], away: ["#f4f4f4", "#111111", "#f4f4f4"] },
];
const GK_COLORS = ["#2ecc40", "#ffcc00", "#ff7f00", "#9b59b6", "#00d1d1", "#222222"];

function hexRgb(h) { const n = parseInt(String(h).slice(1, 7), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function colorDist(a, b) { const x = hexRgb(a), y = hexRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
function isLight(h) { const [r, g, b] = hexRgb(h); return r * 0.3 + g * 0.59 + b * 0.11 > 150; }
// A colour for writing the team name on dark backgrounds
function uiColor(h) {
  let [r, g, b] = hexRgb(h);
  const l = r * 0.3 + g * 0.59 + b * 0.11;
  if (l < 110) { const k = 110 / Math.max(l, 1); r = Math.min(255, r * k + 60); g = Math.min(255, g * k + 60); b = Math.min(255, b * k + 60); }
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
const isColor = (c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
function findTeam(id) { return TEAM_LIST.find((t) => t.id === id) || null; }
// A "Custom team" made by the player: {name, shirt, shorts, socks}
function customTeam(c) {
  const name = String((c && c.name) || "My Team").replace(/[<>]/g, "").trim().slice(0, 16) || "My Team";
  const k = [c && c.shirt, c && c.shorts, c && c.socks].map((x, i) => (isColor(x) ? x : ["#8e44ad", "#ffffff", "#8e44ad"][i]));
  const away = isLight(k[0]) ? ["#222222", "#222222", "#222222"] : ["#f4f4f4", "#f4f4f4", "#f4f4f4"];
  return { id: "custom", name, short: name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X"), rating: 3, home: k, away, custom: true };
}
function kitFrom(cols) { return { shirt: cols[0], shorts: cols[1], socks: cols[2], number: isLight(cols[0]) ? "#111111" : "#ffffff" }; }

// Work out what both teams wear. If the shirts look too alike, the "away"
// team (red side) changes to its away kit (and then to plain white/black).
function buildTeamKits(blueTeam, redTeam) {
  const B = blueTeam || TEAM_LIST[0], R = redTeam || TEAM_LIST[1];
  const blueKit = kitFrom(B.home);
  let redCols = R.home, away = false;
  if (colorDist(blueKit.shirt, redCols[0]) < 130) { redCols = R.away; away = true; }
  if (colorDist(blueKit.shirt, redCols[0]) < 130) redCols = isLight(blueKit.shirt) ? ["#222222", "#222222", "#222222"] : ["#f4f4f4", "#f4f4f4", "#f4f4f4"];
  const redKit = kitFrom(redCols);
  // goalies wear something different from everybody
  const gkPick = (avoid) => GK_COLORS.find((c) => avoid.every((a) => colorDist(c, a) > 120)) || "#2ecc40";
  const g1 = gkPick([blueKit.shirt, redKit.shirt]);
  const g2 = gkPick([blueKit.shirt, redKit.shirt, g1]);
  const side = (T, kit, gkc, isAway) => {
    const sq = typeof squadById === "function" ? squadById(T.id, T) : null;
    return {
      id: T.id, name: T.name, short: T.short, rating: clamp(Number(T.rating) || 3, 1, 5), away: isAway,
      formation: sq ? sq.formation : "4-4-2", style: sq ? sq.style : "control",
      ui: uiColor(kit.shirt), kit, gk: { shirt: gkc, shorts: "#222222", socks: gkc, number: isLight(gkc) ? "#222222" : "#ffffff" },
    };
  };
  return { blue: side(B, blueKit, g1, false), red: side(R, redKit, g2, away) };
}
// The browser draws with TEAMS, so copy the chosen kits + names into it
function applyTeamKits(k) {
  for (const t of ["blue", "red"]) {
    if (!k || !k[t]) continue;
    Object.assign(TEAMS[t], {
      id: k[t].id || t, name: k[t].name, short: k[t].short, ui: k[t].ui,
      formation: k[t].formation || "4-4-2", style: k[t].style || "control",
      kit: { ...k[t].kit }, gk: { ...k[t].gk },
    });
  }
}

// Formation (kickoff positions). d = depth (0 = own goal line, 1 = other
// goal line), l = left/right (-1 = top touchline, +1 = bottom touchline).
const FORMATION = [
  { role: "GK",  num: 1, d: 0.03, l: 0 },
  { role: "DEF", num: 4, d: 0.20, l: -0.42 },
  { role: "DEF", num: 5, d: 0.20, l: 0.42 },
  { role: "MID", num: 8, d: 0.33, l: -0.20 },
  { role: "FWD", num: 9, d: 0.40, l: 0.18 },
];

const POSTS = [
  { x: PITCH.left, y: GOAL_TOP }, { x: PITCH.left, y: GOAL_BOTTOM },
  { x: PITCH.right, y: GOAL_TOP }, { x: PITCH.right, y: GOAL_BOTTOM },
];


// =====================================================================
// SHARED HELPERS (used by the server AND the browser)
// =====================================================================
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function normalize(x, y) {
  const len = Math.hypot(x, y);
  return len > 1e-6 ? { x: x / len, y: y / len } : { x: 1, y: 0 };
}
function distToSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1), 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}
// Small seeded random generator (the crowd looks the same every time)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function formatClock(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return (m < 10 ? "0" : "") + m + ":" + (sec < 10 ? "0" : "") + sec;
}
// Player states are sent as small numbers to keep messages short
const STATE_NAMES = ["run", "slide", "dive", "down"];
const STATE_CODES = { run: 0, slide: 1, dive: 2, down: 3 };
const SKILL_LIST = [null, "stepover", "spin", "flick", "burst"];
const CELEBRATIONS = ["slide", "spin", "plane", "pile"];   // knee slide, spin, airplane arms, pile-on
// Shared by the offline game, the server and the browser: the default rules
const DEFAULT_RULES = { offside: true, cards: true };

// =====================================================================
// createSim(): makes ONE match. The server makes one per room.
// =====================================================================
// Official squad name, unless this device has a private rename (offline only).
// Kept outside the match so the pitch labels, goal banner, and full-time list can see it.
// Which sides get the device-only "play as me" player. Offline sets this
// before a match. Online leaves it empty, so both players see the squad list.
let playAsMeSides = {};
function setPlayAsMeSides(sides) {
  playAsMeSides = sides && typeof sides === "object" ? sides : {};
}

function shownName(p) {
  if (!p) return "";
  if (typeof localRename === "function") {
    const n = localRename(p);
    if (n) return n;
  }
  return p.name || ("#" + p.num);
}

function createSim(opts = {}) {

  // ===================================================================
  // 3. GAME STATE
  // ===================================================================
  const game = {
    // "setpiece" | "play" | "dead" | "goal" | "win"
    // + "shootout" (waiting for the next shootout kick) | "pkflight" (shootout ball flying)
    phase: "setpiece",
    mode: opts.mode || "1v1",
    difficulty: DIFFICULTY[opts.difficulty] ? opts.difficulty : "normal",
    teams: opts.teams || buildTeamKits(TEAM_LIST[0], TEAM_LIST[1]),   // names, kits, ratings
    rules: { ...DEFAULT_RULES, ...(opts.rules || {}) },               // offside / cards on or off
    // A normal match is always 5:00. A penalty-shootout mode has no clock.
    // Old goal-limit and match-length options are ignored.
    timeLimit: opts.matchType === "shootout" ? 0 : MATCH_LENGTH,
    knockout: opts.matchType === "shootout" ? false : !!opts.knockout, // a draw goes to penalties
    matchType: opts.matchType === "shootout" ? "shootout" : "match",   // or just a penalty shootout
    penalty: null,          // the penalty kick being taken (aim, goalie choice...)
    shootout: null,         // penalty shootout scores
    celebration: null,      // {scorer, type, t} after a goal
    cardPopup: null,        // the referee showing a card
    flag: null,             // the assistant referee's offside flag
    camera: { x: 0, y: 0, cx: PITCH.cx, cy: PITCH.cy, zoom: 1 },
    score: { blue: 0, red: 0 },
    clock: 0, timer: 0, time: 0,
    autoplay: false,        // debug: the computer plays for everybody
    winner: null, lastScorer: null,
    pending: null, setpiece: null,
    plans: { blue: {}, red: {} },
    comment: { text: "", timer: 0, color: "#fff" },
    stats: newStats(),
    events: [],             // sounds etc. that happened since the last snapshot
    lastKick: null,
  };
  let roster = [];   // both teams (including anyone sent off)
  let players = [];  // players still on the pitch
  // The referee and two assistant referees. They never touch the ball.
  // 0 = referee on the pitch, 1 = linesman on the near touchline (blue's half),
  // 2 = linesman on the far touchline (red's half).
  // The linesmen stand just outside the line. They never step onto the grass.
  const AR_NEAR_Y = PITCH.bottom + 20;
  const AR_FAR_Y = PITCH.top - 20;
  const officials = [
    { role: "ref", side: "", x: PITCH.cx, y: PITCH.cy + 78, vx: 0, vy: 0, fx: 1, fy: 0, anim: 0, sig: 0, skin: "#e0ac69", hair: "#111" },
    { role: "ar", side: "near", x: PITCH.cx + 180, y: AR_NEAR_Y, vx: 0, vy: 0, fx: 0, fy: -1, anim: 1, sig: 0, skin: "#c68642", hair: "#1a1a1a" },
    { role: "ar", side: "far", x: PITCH.cx - 180, y: AR_FAR_Y, vx: 0, vy: 0, fx: 0, fy: 1, anim: 2, sig: 0, skin: "#f1c27d", hair: "#2b1b0e" },
  ];
  game.officials = officials;
  let officialCue = "";
  let officialCueT = 0;
  // Where the referee is walking toward. This lags behind the ball on purpose,
  // so he does not dart after every touch.
  const refSpot = { x: PITCH.cx, y: PITCH.cy + 160 };
  const arSpotX = [PITCH.cx + 200, PITCH.cx - 200];
  const ball = {
    x: PITCH.cx, y: PITCH.cy, z: 0, vx: 0, vy: 0, vz: 0,
    owner: null, lastTouch: null, lastTeam: null, intended: null,
    shot: null, inNet: null, spin: 0, curl: 0,
    offside: null,     // {team, players} - who was offside when the ball was played
    indirect: null,    // taker of an indirect free kick (can't score directly)
  };
  // One controller per human player (see the CONTROLLERS section)
  const controllers = [];

  function newStats() {
    return { throw: 0, corner: 0, goalkick: 0, free: 0, kickoff: 0, penalty: 0, saves: 0, shots: { blue: 0, red: 0 }, passes: 0, fouls: 0, tackles: 0,
             yellow: { blue: 0, red: 0 }, red: { blue: 0, red: 0 }, offside: 0, skills: 0, pens: { scored: 0, missed: 0 }, scorers: [] };
  }

  // ===================================================================
  // 4. HELPERS that need the game state
  // ===================================================================
  const ballSpeed = () => Math.hypot(ball.vx, ball.vy);
  const teamPlayers = (team) => players.filter((p) => p.team === team);
  const goalieOf = (team) => players.find((p) => p.team === team && p.role === "GK");
  function inOwnBox(team, pt) {
    const T = TEAMS[team];
    const depth = (pt.x - T.ownGoalX) * T.dir;
    return depth > -GOAL_DEPTH && depth < BOX.depth && Math.abs(pt.y - PITCH.cy) < BOX.width / 2;
  }
  // Computer players: the difficulty setting (or "teammate" level when a
  // human is on that team), nudged up or down by the team's star rating.
  const aiCache = {};
  function aiSettings(team) {
    const human = isHumanTeam(team);
    const key = team + (human ? "h" : "c") + game.difficulty;
    if (aiCache[key]) return aiCache[key];
    const base = human ? TEAMMATE_AI : DIFFICULTY[game.difficulty];
    const r = (game.teams[team].rating || 3) - 3;   // -2 .. +2
    return (aiCache[key] = {
      ...base, speed: base.speed * (1 + 0.025 * r), think: base.think * (1 - 0.08 * r), aimErr: base.aimErr * (1 - 0.1 * r),
      steal: base.steal * (1 + 0.1 * r), gkCatch: clamp(base.gkCatch + 0.04 * r, 0.2, 0.95), passErr: base.passErr * (1 - 0.15 * r),
    });
  }
  const teamName = (team) => game.teams[team].name;
  const teamUi = (team) => game.teams[team].ui;
  // Players are numbered by their place in the full roster (also online)
  const pIndex = (p) => (p ? roster.indexOf(p) : -1);

  function say(text, color = "#fff", seconds = 2) {
    game.comment = { text, color, timer: seconds };
  }
  // Record a sound for the browsers to play
  function emit(name, arg) {
    if (game.events.length < 100) game.events.push(arg === undefined ? [name] : [name, typeof arg === "number" ? Math.round(arg) : arg]);
  }

  // ===================================================================
  // 5. CONTROLLERS  (the humans)
  // ===================================================================
  // A controller = one human. It remembers the buttons they hold
  // (input), buttons they just pressed (presses) and which player they
  // control (active). If a human disconnects, c.cpu = true and the
  // computer takes over that player.
  const liveControllers = () => (game.autoplay ? [] : controllers.filter((c) => !c.cpu));
  const humanControllers = (team) => liveControllers().filter((c) => c.team === team);
  const isHumanTeam = (team) => humanControllers(team).length > 0;
  const controllerOf = (p) => liveControllers().find((c) => c.active === p) || null;
  const isHumanControlled = (p) => !!controllerOf(p);
  const humanActives = (team) => humanControllers(team).map((c) => c.active).filter(Boolean);
  function cancelCharging() { for (const c of controllers) c.charging = null; }

  // Movement direction from the human's joystick / keys (length 0..1)
  function humanMove(c) {
    let x = clamp(Number(c.input.mx) || 0, -1, 1), y = clamp(Number(c.input.my) || 0, -1, 1);
    const len = Math.hypot(x, y);
    if (len < 0.15) return { x: 0, y: 0 };
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

// Can this player kick the ball right now?
function canKick(p) {
  if (p.state !== "run") return false;
  if (game.phase === "setpiece") {
    // Once the overhead throw has started, the ball stays in the hands.
    if (game.setpiece.type === "throw" && game.setpiece.throwT > 0) return false;
    return game.setpiece.taker === p;
  }
  if (game.phase !== "play") return false;
  if (ball.owner === p) return true;
  return !ball.owner && p.controlCD <= 0 && ball.z < CONTROL_HEIGHT && dist(p, ball) < KICK_RANGE;
}

  // Button presses arrive from the network; we handle them at the start
  // of the next simulation step, in the order they were pressed.
  function processPresses() {
    for (const c of controllers) {
      const queue = c.presses.splice(0);
      if (c.cpu || game.autoplay) continue;
      // Any button during a goal celebration skips it
      if (queue.length && game.phase === "goal" && game.timer > 1) { game.timer = 1; continue; }
      if (!c.active) continue;
      for (const a of queue) humanPress(c, a);
    }
  }

  // A shoot / pass / switch button was just pressed
  function humanPress(c, action) {
    const p = c.active;
    if (!p || action === "skip") return;
    if (action === "skill" || action === "flick") {     // tricks (only with the ball)
      if (ball.owner === p && game.phase === "play") humanSkill(p, c, action);
      return;
    }
    if (action === "swap") { manualSwitch(c); return; }
    if (game.penalty && p === game.penalty.keeper) return;  // the goalie picks a dive with the arrows
    if (canKick(p)) { c.charging = action; c.held = 0; return; } // kick on release
    if (game.phase !== "play") return;
    if (action === "shoot") startSlide(p);   // no ball: SHOOT = slide tackle
    else manualSwitch(c);                    // no ball: PASS = switch player
  }

  // Charge the kick while the button is held, kick when it is released
  function updateHumanKick(c, dt) {
    if (!c.charging) return;
    const p = c.active;
    if (!p) { c.charging = null; return; }
    c.held += dt;
    if (c.input[c.charging] && c.held < 3) return; // still holding
    const action = c.charging;
    c.charging = null;
    if (!canKick(p)) return;
    const charge = clamp(c.held / CHARGE_TIME, 0, 1);
    if (game.phase === "setpiece" && game.setpiece.type === "penalty") penaltyKick(p, charge, game.penalty.aimY);
    else if (game.phase === "setpiece" && game.setpiece.type === "throw") humanThrow(p, action, charge);
    else if (action === "shoot") humanShoot(p, charge);
    else if (c.held < TAP_TIME) humanGroundPass(p);
    else humanLoftedPass(p, clamp((c.held - TAP_TIME) / (CHARGE_TIME - TAP_TIME), 0, 1));
  }

  // Outfield players this human may control (not one another human has)
  function available(c) {
    const taken = humanControllers(c.team).filter((o) => o !== c).map((o) => o.active);
    return players.filter((p) => p.team === c.team && p.role !== "GK" && !taken.includes(p));
  }
  function nearestToBall(list) {
    let best = null, bd = Infinity;
    for (const p of list) { const d = dist(p, ball); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function setActive(c, p) {
    if (c.active !== p) c.charging = null;
    c.active = p;
  }

  // Decide which player each human on a team controls
  function assignActive(team, dt) {
    for (const c of controllers) if (c.team === team && (c.cpu || game.autoplay)) c.active = null;
    const cs = humanControllers(team);
    if (!cs.length) return;
    for (const c of cs) c.switchLock -= dt;

    // Penalty kick: one human takes it, one human on the other team is the goalie
    const pen = game.penalty;
    const kickoff = game.phase === "setpiece" && game.setpiece && game.setpiece.type === "kickoff";
    if (kickoff) {
      const meP = players.find((p) => p.team === team && p.me && !p.sentOff && p.role !== "GK");
      if (meP && cs.length) {
        setActive(cs[0], meP);
        for (let i = 1; i < cs.length; i++) {
          const avail = available(cs[i]).filter((p) => p !== meP);
          setActive(cs[i], nearestToBall(avail));
        }
        return;
      }
    }

    if (pen && (game.phase === "setpiece" || game.phase === "shootout")) {
      const n = game.shootout ? game.shootout.kicks[team].length : 0;  // take turns in a shootout
      const who = cs[n % cs.length];
      for (const c of cs) setActive(c, c !== who ? null : pen.team === team ? pen.taker : pen.keeper);
      return;
    }

    // 1) A "key" player a human should control right now: the set piece
    //    taker, the ball carrier, or the player a pass is going to.
    let key = null;
    const sp = game.phase === "setpiece" ? game.setpiece : null;
    if (sp) { if (sp.team === team && sp.taker.role !== "GK") key = sp.taker; }
    else if (ball.owner) { if (ball.owner.team === team && ball.owner.role !== "GK") key = ball.owner; }
    else if (ball.intended && ball.intended.team === team && ball.intended.role !== "GK") key = ball.intended;

    let keyHolder = null;
    if (key) {
      keyHolder = cs.find((c) => c.active === key);
      if (!keyHolder) {
        // A tap (or the switch button) holds the player you picked for
        // a moment. After that, the ball carrier takes over again.
        const pool = cs.filter((c) => !(c.switchLock > 0 && c.active));
        if (pool.length) {
          keyHolder = pool.find((c) => c.active && c.active === ball.lastTouch) ||
            pool.reduce((a, b) => (dist(a.active || key, key) <= dist(b.active || key, key) ? a : b));
          setActive(keyHolder, key);
        }
      }
    }
    // 2) Everyone else: the free player nearest the ball (a bit "sticky")
    for (const c of cs) {
      if (c === keyHolder) continue;
      const avail = available(c).filter((p) => p !== key);
      if (!avail.length) { setActive(c, null); continue; }
      const cur = avail.includes(c.active) ? c.active : null;
      if (cur && c.switchLock > 0) continue;
      const best = nearestToBall(avail);
      if (!cur || (best !== cur && dist(best, ball) < dist(cur, ball) - 40)) setActive(c, best);
    }
  }

  function manualSwitch(c) {
    if (game.phase === "setpiece") return;
    const next = nearestToBall(available(c).filter((p) => p !== c.active));
    if (next) { setActive(c, next); c.switchLock = 1.2; }
  }

  // Switch to one teammate (a finger tap, or a message from online).
  // index is that player's place in the roster. The goalkeeper stays
  // with the computer. Returns true when the switch happened.
  function switchTo(id, index) {
    const c = findController(id);
    const p = roster[index];
    if (!c || c.cpu || !p || p.sentOff || p.team !== c.team || p.role === "GK") return false;
    if (game.phase === "setpiece" || game.phase === "shootout" || game.phase === "pkflight") return false;
    if (c.active !== p && !available(c).includes(p)) return false;
    setActive(c, p);
    c.switchLock = 3.5;
    return true;
  }

// --- How one player's stats change a touch ---
function stat01(v) { return clamp((Number(v) || 60) - 45, 0, 50) / 50; }
function boosts(p) {
  const pace = stat01(p.pace), shoot = stat01(p.shoot), pass = stat01(p.pass);
  const drib = stat01(p.dribble), def = stat01(p.defend), stam = stat01(p.stam), gk = stat01(p.gk);
  const t = p.trait;
  let run = lerp(0.92, 1.08, pace);
  let sprint = lerp(0.94, 1.10, pace);
  let shot = lerp(0.90, 1.12, shoot);
  let aim = lerp(1.15, 0.55, shoot);
  let passErr = lerp(1.25, 0.45, pass);
  let hold = lerp(0.85, 1.35, drib);
  let steal = lerp(0.85, 1.35, def);
  let stamDrain = lerp(1.25, 0.62, stam);
  let gkCatch = lerp(-0.08, 0.16, gk);
  let gkDive = lerp(0.90, 1.15, gk);
  let gkReact = lerp(1.10, 0.72, gk);
  if (t === "speedster") { run *= 1.04; sprint *= 1.12; }
  if (t === "finisher") { shot *= 1.10; aim *= 0.75; }
  if (t === "playmaker") passErr *= 0.55;
  if (t === "dribbler") hold *= 1.45;
  if (t === "rock") steal *= 1.25;
  if (t === "engine") stamDrain *= 0.65;
  if (t === "wall") { gkCatch += 0.14; gkDive *= 1.12; gkReact *= 0.8; }
  if (p.star) { run *= 1.03; shot *= 1.04; passErr *= 0.9; }
  // A 100 in every outfield stat is a little better than the best specialist,
  // then it stops. Fast, sharp, and hard to tire, but still catchable.
  if (p.pace >= 100 && p.shoot >= 100 && p.pass >= 100 && p.dribble >= 100 && p.defend >= 100 && p.stam >= 100) {
    run = clamp(Math.max(run, 1.25), 0, 1.28);
    sprint = clamp(Math.max(sprint, 1.33), 0, 1.36);
    shot = clamp(Math.max(shot, 1.38), 0, 1.42);
    aim = clamp(Math.min(aim, 0.38), 0.34, 2);
    passErr = clamp(Math.min(passErr, 0.20), 0.16, 2);
    hold = clamp(Math.max(hold, 2.08), 0, 2.15);
    steal = clamp(Math.max(steal, 1.76), 0, 1.82);
    stamDrain = clamp(Math.min(stamDrain, 0.38), 0.34, 2);
  }
  return { run, sprint, shot, aim, passErr, hold, steal, stamDrain, gkCatch, gkDive, gkReact };
}
function aimPoint(p, target) {
  const spread = Math.max(0, boosts(p).passErr - 0.35) * dist(ball, target) * 0.045;
  if (spread < 1) return target;
  return { x: target.x + rand(-1, 1) * spread, y: target.y + rand(-1, 1) * spread };
}

// --- Human kicks ---

function humanShoot(p, charge) {
  const T = TEAMS[p.team];
  let dir = { x: p.fx, y: p.fy };
  // Aim assist: if you shoot roughly toward goal, the ball bends a bit
  // toward the goal mouth (like most soccer video games do).
  if (dir.x * T.dir > 0.25) {
    const dx = T.targetGoalX - ball.x;
    const yAt = clamp(ball.y + dir.y / dir.x * dx, GOAL_TOP + 12, GOAL_BOTTOM - 12);
    const toGoal = normalize(dx, yAt - ball.y);
    const pull = (p.trait === "finisher" || (p.shoot || 0) > 85) ? 1.6 : 0.75;
    dir = normalize(dir.x + toGoal.x * pull, dir.y + toGoal.y * pull);
  }
  const power = lerp(SHOT_MIN, SHOT_MAX, charge) * boosts(p).shot;
  const lift = 36 + 220 * charge * charge;   // full power shots climb higher
  kickBall(p, dir, power, lift, "shot");
}

// Best teammate in the direction you are facing
function findPassTarget(p, maxAngleDeg = 55) {
  let best = null, bestScore = Infinity;
  const minCos = Math.cos(maxAngleDeg * Math.PI / 180);
  for (const m of teamPlayers(p.team)) {
    if (m === p) continue;
    const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy);
    if (d < 40) continue;
    const c = (dx * p.fx + dy * p.fy) / d;
    if (c < minCos) continue;
    const score = d * (1.7 - c);
    if (score < bestScore) { bestScore = score; best = m; }
  }
  return best;
}

function humanGroundPass(p) {
  const mate = findPassTarget(p);
  if (mate) {
    const target = aimPoint(p, { x: mate.x + mate.vx * 0.35, y: mate.y + mate.vy * 0.35 });
    groundPass(p, target, mate);
  } else {
    kickBall(p, { x: p.fx, y: p.fy }, 430, 0, "pass");
  }
}

function humanLoftedPass(p, charge) {
  const T = TEAMS[p.team];
  const mate = findPassTarget(p, 60);
  if (mate) {
    // A "through ball": aim ahead of the receiver so they run onto it
    const target = {
      x: mate.x + mate.vx * 0.6 + T.dir * 60 * charge,
      y: mate.y + mate.vy * 0.6,
    };
    loftedPass(p, aimPoint(p, clampToPitch(target, 15)), mate);
  } else {
    const d = 200 + 550 * charge;
    loftedPass(p, { x: ball.x + p.fx * d, y: ball.y + p.fy * d }, null);
  }
}

function humanThrow(p, action, charge) {
  const sp = game.setpiece;
  if (!sp || sp.type !== "throw" || sp.throwT > 0) return;
  const mate = action === "pass" ? findPassTarget(p, 75) : null;
  if (mate) startThrow(p, { x: mate.x, y: mate.y }, mate);
  else {
    const dir = throwDirection(p, null);
    const d = 150 + 210 * charge;
    startThrow(p, { x: p.x + dir.x * d, y: p.y + dir.y * d }, null);
  }
}

// ---------------------------------------------------------------------
// 8. SKILL MOVES  (R = step-over / roulette, F = rainbow flick,
//    Shift + R = knock-on burst; SKILL button on phones)
// ---------------------------------------------------------------------
// Which trick? It depends on the direction you are pushing:
//   holding sprint      -> BURST   (knock it ahead and sprint after it)
//   pulling backwards   -> RAINBOW FLICK (pop it over the defender's head)
//   pushing sideways    -> ROULETTE (spin away from the defender)
//   nothing / forwards  -> STEP-OVER (fake: nearby defenders go the wrong way)
function humanSkill(p, c, action) {
  if (action === "flick") { doSkill(p, "flick"); return; }
  if (c.input.sprint) { doSkill(p, "burst"); return; }
  const m = humanMove(c);
  if (!m.x && !m.y) { doSkill(p, "stepover"); return; }
  const n = normalize(m.x, m.y);
  const dot = n.x * p.fx + n.y * p.fy;
  if (dot < -0.4) doSkill(p, "flick");
  else if (dot < 0.6) doSkill(p, "spin", n);
  else doSkill(p, "stepover");
}

function doSkill(p, type, dir) {
  if (!SKILL_TIME[type]) return false;
  if (ball.owner !== p || p.skillCD > 0 || p.state !== "run" || game.phase !== "play") return false;
  p.skill = type; p.skillT = SKILL_TIME[type]; p.skillCD = SKILL_COOLDOWN;
  game.stats.skills++;
  emit("skill");
  say(SKILL_NAMES[type], "#ffd33d", 0.9);
  if (type === "stepover") {
    // defenders close by are fooled for a moment and step the wrong way
    for (const q of players) {
      if (q.team === p.team || q.role === "GK" || dist(q, p) > 120) continue;
      const side = Math.random() < 0.5 ? 1 : -1;
      q.fooled = 0.55; q.fooledDir = { x: -p.fy * side, y: p.fx * side };
    }
  } else if (type === "spin") {
    // spin sideways (nobody can tackle you while you spin)
    p.skillDir = dir || { x: -p.fy, y: p.fx };
  } else if (type === "flick") {
    // pop the ball up high over the defender, then run onto it
    kickBall(p, { x: p.fx, y: p.fy }, 215, 260, "skill", p);
    p.controlCD = 0.35;
  } else if (type === "burst") {
    // knock it ahead and sprint after it (uses stamina)
    kickBall(p, { x: p.fx, y: p.fy }, 250, 0, "skill", p);
    p.controlCD = 0.18;
    p.burst = SKILL_TIME.burst;
    p.stamina = Math.max(0, p.stamina - 0.12);
  }
  return true;
}

// Computer players sometimes try a trick when a defender is close in front
function aiMaybeSkill(p, presser, pressure) {
  const chance = AI_SKILL_CHANCE[game.difficulty] || 0;
  if (!chance || isHumanTeam(p.team) || p.skillCD > 0 || !presser || pressure > 75) return false;
  const to = normalize(presser.x - p.x, presser.y - p.y);
  if (to.x * p.fx + to.y * p.fy < 0.3 || Math.random() > chance) return false;
  const r = Math.random();
  if (r < 0.4) return doSkill(p, "stepover");
  if (r < 0.75) { const side = Math.random() < 0.5 ? 1 : -1; return doSkill(p, "spin", { x: -p.fy * side, y: p.fx * side }); }
  return pressure > 30 ? doSkill(p, "flick") : doSkill(p, "stepover");
}

  // ===================================================================
  // 6. SETUP
  // ===================================================================

function lineupFor(side) {
  const meta = game.teams[side] || {};
  if (typeof squadById !== "function" || typeof FORMATIONS === "undefined") {
    return FORMATION.map((s) => Object.assign({ name: "Player " + s.num, pos: s.role }, s));
  }
  let squad = squadById(meta.id, meta);
  if (playAsMeSides[side] && typeof withPlayAsMe === "function") squad = withPlayAsMe(squad);
  const form = FORMATIONS[squad.formation] || FORMATIONS["4-4-2"];
  return form.map((slot, i) => {
    const pl = (squad.players && squad.players[i]) || {};
    return {
      role: slot.role, d: slot.d, l: slot.l,
      num: pl.num || (i + 1),
      name: pl.name || ("Player " + (i + 1)),
      pos: pl.pos || slot.role,
      trait: pl.trait || "",
      star: !!pl.star,
      me: !!pl.me,
      captain: !!pl.captain,
      pace: pl.pace, shoot: pl.shoot, pass: pl.pass, dribble: pl.dribble,
      defend: pl.defend, staminaStat: pl.stamina, gk: pl.gk,
      skin: pl.skin, hair: pl.hair, cut: pl.cut, tall: pl.tall, boots: pl.boots,
    };
  });
}

function makePlayer(team, def, index) {
  const T = TEAMS[team];
  const l = team === "blue" ? def.l : -def.l;  // mirror image for red
  const skins = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
  const hairs = ["#2b1b0e", "#000000", "#6b3e1e", "#d9b25f", "#3b2a1a"];
  const p = {
    team, role: def.role, num: def.num,
    name: def.name || ("Player " + def.num),
    pos: def.pos || def.role,
    trait: def.trait || "",
    star: !!def.star,
    me: !!def.me,
    captain: !!def.captain,
    pace: def.pace || 70, shoot: def.shoot || 60, pass: def.pass || 65,
    dribble: def.dribble || 65, defend: def.defend || 60,
    stam: def.staminaStat != null ? def.staminaStat : 70,
    gk: def.gk || (def.role === "GK" ? 75 : 12),
    cut: def.cut || "short",
    tall: def.tall || 1,
    boots: def.boots || "#111111",
    homeX: T.ownGoalX + T.dir * def.d * PITCH.w,
    homeY: PITCH.cy + l * PITCH.h / 2,
    baseD: def.d, baseL: l,
    x: 0, y: 0, vx: 0, vy: 0,
    fx: T.dir, fy: 0,          // facing direction (unit vector)
    stamina: 1, sprinting: false,
    anim: Math.random() * 6,   // running animation phase
    state: "run",              // "run" | "slide" | "dive" | "down"
    stateTimer: 0, fallDir: 1, slideTouched: false,
    controlCD: 0,              // can't touch the ball until this reaches 0
    thinkTimer: 0, holdTimer: 0,
    fouls: 0, yellow: 0, sentOff: false,   // discipline
    skill: null, skillT: 0, skillCD: 0, skillDir: null, burst: 0,  // tricks
    throwT: 0,                     // overhead throw-in animation (0 = not throwing)
    fooled: 0, fooledDir: null,            // fooled by a step-over
    penSpot: null,                         // where to wait during a penalty
  };
  p.skin = def.skin || skins[(index * 3 + (team === "red" ? 1 : 0)) % skins.length];
  p.hair = def.hair || hairs[(index * 2 + (team === "red" ? 3 : 0)) % hairs.length];
  return p;
}

function createPlayers() {
  roster = [];
  for (const team of ["blue", "red"]) {
    lineupFor(team).forEach((def, i) => roster.push(makePlayer(team, def, i)));
  }
  players = roster.slice();
}

function resetToHome() {
  for (const p of players) {
    p.x = p.homeX; p.y = p.homeY; p.vx = p.vy = 0;
    p.fx = TEAMS[p.team].dir; p.fy = 0;
    p.state = "run"; p.controlCD = 0; p.sprinting = false;
    p.skill = null; p.skillT = 0; p.burst = 0; p.fooled = 0; p.penSpot = null; p.throwT = 0; p.plantX = null; p.plantY = null;
  }
}

// Before the kick-off is touched, every player except the kicker stays in
// their own half and outside the centre circle. The kicker stands in that
// circle, just on their own side of the ball.
function parkForKickoff(taker) {
  const gap = CIRCLE_R + PLAYER_R + 8;
  for (const p of players) {
    if (p.sentOff || p === taker) continue;
    const T = TEAMS[p.team];
    const line = PITCH.cx - T.dir * 16;
    if ((p.x - PITCH.cx) * T.dir > -16) p.x = line;
    if (Math.hypot(p.x - PITCH.cx, p.y - PITCH.cy) < gap) p.x = PITCH.cx - T.dir * gap;
    p.vx = 0; p.vy = 0;
  }
}


  function startGame() {
    game.score.blue = 0; game.score.red = 0;
    game.clock = 0; game.winner = null; game.lastScorer = null;
    game.penalty = null; game.shootout = null; game.celebration = null; game.cardPopup = null; game.flag = null;
    game.stats = newStats();
    createPlayers();
    resetToHome();
    for (const c of controllers) { c.active = null; c.charging = null; }
    if (game.matchType === "shootout") startShootout();
    else beginSetpiece("kickoff", Math.random() < 0.5 ? "blue" : "red", PITCH.cx, PITCH.cy);
  }
  function endGame(winner) {
    game.phase = "win";
    game.winner = winner;
    game.penalty = null;
    cancelCharging();
    emit("whistleLong");
    if (winner) emit("cheer");
  }

// ---------------------------------------------------------------------
// 9. KICKING
// ---------------------------------------------------------------------

function kickBall(p, dir, speed, lift, kind, intended = null) {
  dir = normalize(dir.x, dir.y);
  ball.owner = null;
  // Put the ball in front of the foot (but at a set piece it stays on its spot)
  if (game.phase !== "setpiece") {
    ball.x = p.x + dir.x * (PLAYER_R + BALL_R + 1);
    ball.y = p.y + dir.y * (PLAYER_R + BALL_R + 1);
  }
  ball.z = Math.max(ball.z, 0.5);
  ball.vx = dir.x * speed; ball.vy = dir.y * speed; ball.vz = lift;
  // Kicking across the body puts a little sidespin on the ball, so a
  // lofted shot bends instead of flying dead straight.
  const across = dir.x * (p.fy || 0) - dir.y * (p.fx || 0);
  ball.curl = clamp(-across * (lift > 60 ? 170 : 70), -150, 150);
  ball.lastTouch = p; ball.lastTeam = p.team;
  ball.intended = intended;
  ball.shot = kind === "shot" ? { team: p.team, x: ball.x, y: ball.y, power: speed, chip: lift > 180 } : null;
  p.fx = dir.x; p.fy = dir.y;
  p.controlCD = 0.3;
  if (kind === "shot") game.stats.shots[p.team]++;
  if (kind === "pass") game.stats.passes++;
  // OFFSIDE: remember which teammates were offside at the moment of the kick.
  // (Not from throw-ins, corners, goal kicks or penalties - that's the real rule.)
  const sp0 = game.phase === "setpiece" ? game.setpiece : null;
  const noOffside = sp0 && ["throw", "corner", "goalkick", "penalty", "kickoff"].includes(sp0.type);
  ball.offside = game.rules.offside && !noOffside && !game.shootout ? { team: p.team, players: offsidePlayers(p) } : null;
  // Indirect free kick: the taker can't score directly
  ball.indirect = sp0 && sp0.indirect ? p : null;
  game.lastKick = { by: p.team + p.num, kind, speed: Math.round(speed), lift: Math.round(lift), x: Math.round(ball.x), y: Math.round(ball.y),
                    dir: [+dir.x.toFixed(2), +dir.y.toFixed(2)], to: intended ? intended.team + intended.num + "@" + Math.round(intended.x) + "," + Math.round(intended.y) : null };
  if (game.phase === "setpiece") {
    game.phase = sp0.type === "penalty" && game.shootout ? "pkflight" : "play";
    if (sp0.type !== "penalty") game.penalty = null;
    game.setpiece = null;
  }
  emit("kick", speed + lift);
}

function clampToPitch(pt, margin) {
  return { x: clamp(pt.x, PITCH.left + margin, PITCH.right - margin), y: clamp(pt.y, PITCH.top + margin, PITCH.bottom - margin) };
}

// Ground pass: speed chosen so the ball arrives with a little pace left
function groundPass(p, target, mate) {
  const d = dist(ball, target);
  const speed = clamp(d * 0.92 + 130 * FIELD, 250 * FIELD, 1000 * FIELD);
  kickBall(p, { x: target.x - ball.x, y: target.y - ball.y }, speed, 0, "pass", mate);
}

// Lofted pass: work out the launch so the ball LANDS on the target.
// Flight time T -> upward speed vz = g*T/2, sideways speed from distance.
function loftedPass(p, target, mate, heightMult = 1) {
  const d = Math.max(30, dist(ball, target));
  const T = clamp(0.45 + d / 1000, 0.55, 1.6) * heightMult;
  const vz = GRAVITY * T / 2;
  const k = -Math.log(AIR_DRAG);
  const vh = d / ((1 - Math.pow(AIR_DRAG, T)) / k);
  kickBall(p, { x: target.x - ball.x, y: target.y - ball.y }, vh, vz, "pass", mate);
}

// Which way is "back onto the pitch" from this touchline? +1 means +y.
function throwInward(p) { return p.y < PITCH.cy ? 1 : -1; }

// Aim the throw where the player is looking, but keep it coming back into play.
function throwDirection(p, target) {
  let dx = target ? target.x - p.x : p.fx;
  let dy = target ? target.y - p.y : p.fy;
  const into = throwInward(p);
  const len = Math.hypot(dx, dy) || 1;
  if (dy * into < 0.28 * len) dy = into * Math.max(Math.abs(dx) * 0.45, 50);
  return normalize(dx, dy);
}

// Begin the overhead throw. The ball stays in the hands until THROW_RELEASE.
function startThrow(p, target, mate) {
  const sp = game.setpiece;
  if (!sp || sp.type !== "throw" || sp.throwT > 0) return;
  const dir = throwDirection(p, target);
  sp.throwT = 0.001;
  sp.throwDir = dir;
  sp.throwTarget = target;
  sp.throwMate = mate || null;
  p.fx = dir.x; p.fy = dir.y;
  p.throwT = 0.001;
}

// Ball in the hands: up and back behind the head, then swinging forward.
function holdThrowBall(p, t) {
  const into = throwInward(p);
  const aimX = (game.setpiece && game.setpiece.throwDir && game.setpiece.throwDir.x) || p.fx || 0;
  let along, z;
  if (t <= 0) { along = -8; z = 50; }                         // held above the head
  else if (t < THROW_WIND) {
    const u = t / THROW_WIND;
    along = lerp(-8, -30, u);                                 // back behind the head
    z = lerp(50, 60, u);
  } else {
    const u = clamp((t - THROW_WIND) / (THROW_RELEASE - THROW_WIND), 0, 1);
    const s = u * u * (3 - 2 * u);                            // smooth swing
    along = lerp(-30, 24, s);                                 // forward, into play
    z = lerp(60, 36, s);
  }
  ball.x = p.x + aimX * Math.max(0, along) * 0.45;
  ball.y = p.y + into * along;
  ball.z = z;
  ball.vx = 0; ball.vy = 0; ball.vz = 0;
  ball.owner = p;
}

// Let go. The ball starts above the head, lifts a little, then lands in play.
function releaseThrow(p) {
  const sp = game.setpiece;
  const dir = (sp && sp.throwDir) || throwDirection(p, null);
  const target = (sp && sp.throwTarget) || { x: p.x + dir.x * 180, y: p.y + dir.y * 180 };
  const into = throwInward(p);
  const x = clamp(p.x + dir.x * 18, PITCH.left + 12, PITCH.right - 12);
  let y = p.y + into * 22;
  y = into > 0 ? Math.max(y, PITCH.top + 16) : Math.min(y, PITCH.bottom - 16);
  ball.x = x; ball.y = y; ball.z = 35;
  ball.owner = null;
  const d = clamp(Math.hypot(target.x - x, target.y - y), 90, 320);
  const T = clamp(0.58 + d / 900, 0.72, 1.15);
  const vz = Math.max(80, GRAVITY * T / 2 - ball.z / T);
  const k = -Math.log(AIR_DRAG);
  const vh = d / ((1 - Math.pow(AIR_DRAG, T)) / k);
  p.throwT = sp ? sp.throwT : THROW_RELEASE;
  kickBall(p, dir, Math.min(vh, 540), vz, "pass", sp && sp.throwMate);
}

function faceThrowIdle(p) {
  if (controllerOf(p)) return;                                // a human aims with the stick
  const best = bestPass(p, 340);
  const into = throwInward(p);
  const T = TEAMS[p.team];
  const tgt = best ? best.target : { x: p.x + T.dir * 160, y: p.y + into * 100 };
  const dir = throwDirection(p, tgt);
  p.fx = dir.x; p.fy = dir.y;
}

function plantThrower(p) {
  if (!p || p.plantX == null) return;
  p.x = p.plantX; p.y = p.plantY; p.vx = 0; p.vy = 0;
}

// Feet stay on the touchline for the whole throw-in.
function glueThrower() {
  const sp = game.phase === "setpiece" ? game.setpiece : null;
  if (!sp || sp.type !== "throw" || !sp.taker) return;
  const p = sp.taker;
  p.plantX = sp.spotX; p.plantY = sp.spotY;
  p.x = sp.spotX; p.y = sp.spotY; p.vx = 0; p.vy = 0; p.state = "run";
  if (sp.throwT > 0 && sp.throwDir) { p.fx = sp.throwDir.x; p.fy = sp.throwDir.y; p.throwT = sp.throwT; }
  else { p.throwT = 0; faceThrowIdle(p); holdThrowBall(p, 0); }
}

function advanceThrow(dt) {
  const sp = game.phase === "setpiece" ? game.setpiece : null;
  let winding = null;
  if (sp && sp.type === "throw" && sp.throwT > 0 && sp.taker) {
    sp.throwT += dt;
    const p = sp.taker;
    p.throwT = sp.throwT;
    if (sp.throwDir) { p.fx = sp.throwDir.x; p.fy = sp.throwDir.y; }
    p.x = sp.spotX; p.y = sp.spotY; p.vx = 0; p.vy = 0;
    if (sp.throwT >= THROW_RELEASE) releaseThrow(p);
    else { holdThrowBall(p, sp.throwT); winding = p; }
  }
  for (const p of roster) {
    if (p === winding || !(p.throwT > 0)) continue;
    p.throwT += dt;
    if (p.throwT >= THROW_DONE) { p.throwT = 0; p.plantX = null; p.plantY = null; }
    else plantThrower(p);
  }
}

// ---------------------------------------------------------------------
// 10. BALL PHYSICS
// ---------------------------------------------------------------------

function updateBall(dt) {
  // --- Being dribbled: the ball stays just ahead of the player's feet ---
  if (ball.owner) {
    const o = ball.owner;
    if (game.phase === "setpiece") return; // the ball waits on the spot
    const holding = o.role === "GK" && inOwnBox(o.team, o);
    const ahead = holding ? 4 : PLAYER_R + BALL_R + 2 + (o.sprinting ? 5 : 0) + Math.sin(o.anim * 2) * 1.5;
    const tx = o.x + o.fx * ahead, ty = o.y + o.fy * ahead;
    const k = Math.min(1, dt * 14);
    ball.x += (tx - ball.x) * k;
    ball.y += (ty - ball.y) * k;
    ball.z = holding ? 14 : 0; ball.vz = 0;   // a goalie holds it in his hands
    ball.vx = o.vx; ball.vy = o.vy;
    ball.spin += Math.hypot(o.vx, o.vy) * dt / BALL_R;
    return;
  }

  // --- Height: gravity pulls the ball down, it bounces on the grass ---
  if (ball.z > 0 || ball.vz > 0) {
    ball.vz -= GRAVITY * dt;
    ball.z += ball.vz * dt;
    if (ball.z <= 0) {
      ball.z = 0;
      if (ball.vz < -60) {
        ball.vz = -ball.vz * BOUNCE;
        ball.vx *= 0.88; ball.vy *= 0.88;
      } else ball.vz = 0;
    }
  }

  // Sidespin bends the ball, mostly while it is in the air.
  const cspd = Math.hypot(ball.vx, ball.vy);
  if (ball.curl && cspd > 8) {
    const air = ball.z > 1 ? 1 : 0.18;
    const ox = ball.vx, oy = ball.vy;
    ball.vx = ox + (-oy / cspd) * ball.curl * air * dt;
    ball.vy = oy + (ox / cspd) * ball.curl * air * dt;
  }
  if (ball.curl) ball.curl *= Math.pow(ball.z > 1 ? 0.5 : 0.12, dt);

  // --- Friction: rolling on grass slows it much more than flying ---
  const f = Math.pow(ball.z > 0.5 ? AIR_DRAG : GROUND_FRICTION, dt);
  ball.vx *= f; ball.vy *= f;
  if (game.phase === "dead") { ball.vx *= 0.97; ball.vy *= 0.97; } // out of play: stops quickly
  if (ball.z === 0 && ballSpeed() < 8) { ball.vx = 0; ball.vy = 0; }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.spin += ballSpeed() * dt / BALL_R;

  // --- Goal posts (only if the ball is lower than the crossbar) ---
  if (ball.z < CROSSBAR) {
    for (const post of POSTS) {
      const dx = ball.x - post.x, dy = ball.y - post.y, d = Math.hypot(dx, dy);
      const minD = BALL_R + POST_R;
      if (d < minD && d > 0) {
        const nx = dx / d, ny = dy / d;
        ball.x = post.x + nx * minD; ball.y = post.y + ny * minD;
        const along = ball.vx * nx + ball.vy * ny;
        if (along < 0) {
          ball.vx -= 1.6 * along * nx; ball.vy -= 1.6 * along * ny;
          if (game.phase === "play" && -along > 250) { say("Off the post!", "#ffd33d"); emit("post"); emit("ooh"); }
        }
      }
    }
  }

  // --- Inside the net: the net catches the ball ---
  if (ball.inNet) {
    const left = ball.inNet === "left";
    const back = left ? PITCH.left - GOAL_DEPTH + BALL_R : PITCH.right + GOAL_DEPTH - BALL_R;
    const front = left ? PITCH.left - BALL_R : PITCH.right + BALL_R;
    if (left ? ball.x < back : ball.x > back) { ball.x = back; ball.vx *= -0.2; }
    if (left ? ball.x > front : ball.x < front) { ball.x = front; ball.vx *= -0.2; }
    if (ball.y < GOAL_TOP + BALL_R) { ball.y = GOAL_TOP + BALL_R; ball.vy *= -0.2; }
    if (ball.y > GOAL_BOTTOM - BALL_R) { ball.y = GOAL_BOTTOM - BALL_R; ball.vy *= -0.2; }
    if (ball.z > CROSSBAR - BALL_R) { ball.z = CROSSBAR - BALL_R; ball.vz = -Math.abs(ball.vz) * 0.2; }
  }

  // --- Stadium wall (the ball can never leave the world) ---
  const m = STANDS + BALL_R;
  if (ball.x < m) { ball.x = m; ball.vx = Math.abs(ball.vx) * 0.3; }
  if (ball.x > WORLD_W - m) { ball.x = WORLD_W - m; ball.vx = -Math.abs(ball.vx) * 0.3; }
  if (ball.y < m) { ball.y = m; ball.vy = Math.abs(ball.vy) * 0.3; }
  if (ball.y > WORLD_H - m) { ball.y = WORLD_H - m; ball.vy = -Math.abs(ball.vy) * 0.3; }
}

// Predict where a loose ball will be over the next 2.5 seconds.
// The AI uses this to run to where the ball is GOING, not where it is.
const trajectory = [];
function predictBall() {
  trajectory.length = 0;
  let { x, y, z, vx, vy, vz } = ball;
  let curl = ball.curl || 0;
  const h = 0.05;
  for (let i = 1; i <= 50; i++) {
    if (z > 0 || vz > 0) {
      vz -= GRAVITY * h; z += vz * h;
      if (z <= 0) {
        z = 0;
        if (vz < -60) { vz = -vz * BOUNCE; vx *= 0.88; vy *= 0.88; }
        else vz = 0;
      }
    }
    const cspd = Math.hypot(vx, vy);
    if (curl && cspd > 8) {
      const air = z > 1 ? 1 : 0.18;
      const ox = vx, oy = vy;
      vx = ox + (-oy / cspd) * curl * air * h;
      vy = oy + (ox / cspd) * curl * air * h;
    }
    if (curl) curl *= Math.pow(z > 1 ? 0.5 : 0.12, h);
    const f = Math.pow(z > 0.5 ? AIR_DRAG : GROUND_FRICTION, h);
    vx *= f; vy *= f; x += vx * h; y += vy * h;
    trajectory.push({ x, y, z, t: i * h });
  }
}

// Earliest point where player p could reach the ball (time + position)
function interceptFor(p, speed, maxZ = CONTROL_HEIGHT) {
  if (ball.owner) return { x: ball.x, y: ball.y, t: dist(p, ball) / speed };
  for (const s of trajectory) {
    if (s.z < maxZ && Math.hypot(s.x - p.x, s.y - p.y) - PLAYER_R - BALL_R <= speed * s.t) return s;
  }
  const last = trajectory[trajectory.length - 1] || ball;
  return { x: last.x, y: last.y, t: 2.5 + dist(p, last) / speed };
}

// ---------------------------------------------------------------------
// 11. BALL CONTACT (dribbling, tackles, saves, headers)
// ---------------------------------------------------------------------

function takePossession(p) {
  ball.owner = p;
  ball.intended = null; ball.shot = null;
  ball.lastTouch = p; ball.lastTeam = p.team;
  ball.z = 0; ball.vz = 0; ball.curl = 0;
  p.thinkTimer = 0.15 + Math.random() * 0.2;  // a moment to settle the ball
  if (p.role === "GK") p.holdTimer = 0.9;
}

// Knock the ball loose in a direction (used for pokes and slide tackles)
function knockBall(p, dir, speed) {
  ball.owner = null; ball.intended = null; ball.shot = null;
  ball.vx = dir.x * speed + p.vx * 0.3;
  ball.vy = dir.y * speed + p.vy * 0.3;
  ball.vz = 40; ball.curl = 0;
  ball.lastTouch = p; ball.lastTeam = p.team;
}

function ballContacts(dt) {
  if (game.phase !== "play") return;
  if (ball.owner) { contestOwnedBall(dt); return; }

  // Find the closest player who can reach the loose ball
  let best = null, bestD = Infinity;
  for (const p of players) {
    if (p.controlCD > 0 || p.state === "down") continue;
    const d = dist(p, ball);
    if (d < reachFor(p) && d < bestD) { best = p; bestD = d; }
  }
  if (!best) return;
  const p = best;

  // Was this player offside when the ball was played? Then it's a free kick.
  if (ball.offside) {
    if (ball.offside.team === p.team && ball.offside.players.includes(p)) { callOffside(p); return; }
    ball.offside = null;   // someone else touched it: offside no longer counts
  }
  if (ball.indirect && ball.indirect !== p) ball.indirect = null;  // a second touch: now it can go in

  // Goalie in his own box can use his hands
  if (p.role === "GK" && inOwnBox(p.team, p) && ball.z < GK_HAND_HEIGHT) { goalieTouch(p); return; }

  if (ball.z < CONTROL_HEIGHT) {
    if (p.state === "slide") {
      p.slideTouched = true;
      knockBall(p, { x: p.fx, y: p.fy }, 330);
      p.controlCD = 0.4;
      return;
    }
    const rel = Math.hypot(ball.vx - p.vx, ball.vy - p.vy);
    const limit = CONTROL_SPEED + (isHumanControlled(p) ? 120 : 0);
    if (rel < limit && p.state === "run") {
      // A heavy ball doesn't glue to the foot. The first touch pops it
      // into the stride, and the player settles it a moment later.
      if (rel > 280 && p.touchSettle !== 1) {
        const face = normalize((p.fx || 0) + 1e-4, p.fy || 0);
        const keep = Math.min(150, rel * 0.22);
        ball.vx = p.vx * 0.45 + face.x * keep;
        ball.vy = p.vy * 0.45 + face.y * keep;
        ball.vz = Math.min(48, 10 + rel * 0.035);
        ball.z = Math.max(ball.z, 0.6);
        ball.curl *= 0.25;
        ball.lastTouch = p; ball.lastTeam = p.team; ball.intended = null; ball.shot = null;
        p.controlCD = 0.09;
        p.touchSettle = 1;
        return;
      }
      p.touchSettle = 0;
      takePossession(p); return;
    }
    // Too fast to control: it bounces off the player (a block!)
    const n = normalize(ball.x - p.x, ball.y - p.y);
    const along = ball.vx * n.x + ball.vy * n.y;
    if (along < 0) { ball.vx -= 1.5 * along * n.x; ball.vy -= 1.5 * along * n.y; }
    ball.vx *= 0.5; ball.vy *= 0.5; ball.vz = Math.max(ball.vz, 80);
    ball.lastTouch = p; ball.lastTeam = p.team; ball.intended = null;
    p.controlCD = 0.25;
  } else if (p.state === "run") {
    header(p);
  }
}

function reachFor(p) {
  if (p.role === "GK" && inOwnBox(p.team, p) && ball.z < GK_HAND_HEIGHT) return PLAYER_R + BALL_R + (p.state === "dive" ? 16 : 6);
  if (ball.z < HEADER_HEIGHT) return PLAYER_R + BALL_R + 2;
  return -1;
}

function header(p) {
  const T = TEAMS[p.team];
  let dir;
  const goal = { x: T.targetGoalX, y: PITCH.cy + rand(-50, 50) };
  const attacking = dist(p, goal) < 320;
  if (attacking) dir = normalize(goal.x - ball.x, goal.y - ball.y);
  else if (isHumanControlled(p)) dir = { x: p.fx, y: p.fy };
  else dir = normalize(T.dir, rand(-0.6, 0.6));
  kickBall(p, dir, attacking ? 560 : 420, attacking ? 30 : 140, attacking ? "shot" : "header");
  if (attacking) say("Header!", "#fff", 1.2);
}

// Goalie catches or punches the ball
function goalieTouch(g) {
  const ai = aiSettings(g.team);
  const s = ballSpeed();
  const dangerous = ball.shot && ball.shot.team !== g.team;
  const extra = boosts(g).gkCatch;
  const catchChance = s < 480 ? clamp(0.92 + extra, 0.7, 0.99) : clamp((ai.gkCatch + extra) * clamp(1 - (s - 480) / 1300, 0.2, 1), 0.12, 0.95);
  if (Math.random() < catchChance) {
    takePossession(g);
    if (dangerous) { say(g.state === "dive" ? "What a save!" : "Safe hands!", "#9fffa0"); game.stats.saves++; emit("ooh"); }
  } else {
    // Parry: punch the ball away from goal (often out for a corner!)
    const T = TEAMS[g.team];
    if (Math.random() < 0.45) {
      // tipped wide of the post -> probably a corner kick
      ball.vx = -T.dir * rand(120, 260);
      ball.vy = (ball.y < PITCH.cy ? -1 : 1) * rand(260, 420);
    } else {
      // punched back out into the field
      ball.vx = T.dir * (Math.abs(ball.vx) * 0.35 + 120);
      ball.vy = ball.vy * 0.4 + rand(-260, 260);
    }
    ball.vz = 160;
    ball.lastTouch = g; ball.lastTeam = g.team; ball.intended = null;
    g.controlCD = 0.45;
    if (dangerous) { say("Great save!", "#9fffa0"); game.stats.saves++; emit("ooh"); }
    ball.shot = null;
  }
}

// Somebody has the ball: can an opponent poke it away?
function contestOwnedBall(dt) {
  const o = ball.owner;
  if (o.role === "GK" && inOwnBox(o.team, o)) return; // can't tackle a goalie holding it
  if (o.skill === "spin") return;                      // spinning away: can't be tackled
  for (const q of players) {
    if (q.team === o.team || q.controlCD > 0 || (q.state !== "run" && q.state !== "slide")) continue;
    if (q.fooled > 0 && q.state === "run") continue;   // fooled by a step-over
    if (dist(q, ball) > PLAYER_R + BALL_R + 3) continue;
    if (q.state === "slide") {
      // Clean slide tackle: ball first
      q.slideTouched = true;
      knockBall(q, { x: q.fx, y: q.fy }, 340);
      o.controlCD = 0.6;
      if (dist(q, o) < PLAYER_R * 2 + 6) fallDown(o, 0.6);
      q.controlCD = 0.35;
      say("Great tackle!", "#fff", 1.2);
      game.stats.tackles++;
      return;
    }
    const rate = (isHumanControlled(q) ? HUMAN_STEAL : aiSettings(q.team).steal) * boosts(q).steal / Math.max(0.45, boosts(o).hold);
    if (Math.random() < rate * dt) {
      const away = normalize(ball.x - q.x, ball.y - q.y);
      const dir = normalize(away.x + q.fx, away.y + q.fy);
      knockBall(q, dir, 230);
      o.controlCD = 0.5;
      q.controlCD = 0.12;
      game.stats.tackles++;
      return;
    }
  }
}

// ---------------------------------------------------------------------
// 12. COMPUTER AI
// ---------------------------------------------------------------------

// Team-level plan: who chases a loose ball, who presses, who marks whom
function computePlans() {
  predictBall();
  for (const team of ["blue", "red"]) {
    const plan = { mode: "loose", chaser: null, presser: null, marks: new Map(), gkRush: false };
    const actives = humanActives(team);   // players controlled by humans on this team
    const active = actives.length ? actives.reduce((a, b) => (dist(a, ball) <= dist(b, ball) ? a : b)) : null;
    const owner = ball.owner;
    const mates = teamPlayers(team).filter((p) => p.role !== "GK" && !actives.includes(p) && p.state === "run");

    if (owner) plan.mode = owner.team === team ? "attack" : "defend";

    if (!owner) {
      // Who gets to the ball first? Defenders only chase it in their own half,
      // so the back line does not all run up the pitch.
      const T = TEAMS[team];
      const ballDepth = (ball.x - T.ownGoalX) * T.dir / PITCH.w;
      const pool = ballDepth > 0.46 ? mates.filter((p) => p.role !== "DEF") : mates;
      const choices = pool.length ? pool : mates;
      let best = null, bestT = Infinity;
      for (const p of choices) {
        const t = interceptFor(p, RUN_SPEED * aiSettings(team).speed).t;
        if (t < bestT) { bestT = t; best = p; }
      }
      if (active) {
        const tHuman = interceptFor(active, RUN_SPEED).t;
        if (bestT > tHuman - 0.35) best = null; // let the human go for it
      }
      plan.chaser = best;
      // Should the goalie come out?
      const gk = goalieOf(team);
      const gi = interceptFor(gk, RUN_SPEED * 0.95, GK_HAND_HEIGHT);
      if (inOwnBox(team, gi)) {
        let oppT = Infinity;
        for (const q of teamPlayers(other(team))) oppT = Math.min(oppT, interceptFor(q, RUN_SPEED).t);
        if (gi.t < oppT + 0.15) { plan.gkRush = true; if (plan.chaser && interceptFor(plan.chaser, RUN_SPEED).t > gi.t) plan.chaser = null; }
      }
    } else if (plan.mode === "defend") {
      // One player presses. A defender only steps out if nobody else is close,
      // so the other defenders stay in their line.
      const sorted = mates.slice().sort((a, b) => dist(a, owner) - dist(b, owner));
      let best = sorted[0] || null;
      if (best && best.role === "DEF") {
        const otherPress = sorted.find((p) => p.role !== "DEF");
        if (otherPress && dist(otherPress, owner) < dist(best, owner) + 110) best = otherPress;
      }
      if (active && best && dist(active, owner) < dist(best, owner) - 30) best = null;
      plan.presser = best;
      // Everyone else marks the most dangerous free opponent
      const free = teamPlayers(other(team)).filter((q) => q !== owner && q.role !== "GK");
      const T = TEAMS[team];
      free.sort((a, b) => (a.x - T.ownGoalX) * T.dir - (b.x - T.ownGoalX) * T.dir);
      const markers = mates.filter((p) => p !== plan.presser);
      for (const q of free) {
        let m = null, md = Infinity;
        for (const p of markers) {
          if ([...plan.marks.values()].includes(p)) continue;
          const d = Math.hypot(formationSpot(p, false).x - q.x, formationSpot(p, false).y - q.y);
          if (d < md) { md = d; m = p; }
        }
        if (m) plan.marks.set(q, m);
      }
    }
    game.plans[team] = plan;
  }
}

// Where a player should stand to keep the team's shape.
// The whole formation slides up/down and side-to-side with the ball.
function formationSpot(p, hasBall) {
  const T = TEAMS[p.team];
  if (p.role === "GK") return { x: T.ownGoalX + T.dir * 18 * FIELD, y: PITCH.cy };
  const style = (game.teams[p.team] && game.teams[p.team].style) || "control";
  const push = style === "attack" ? 0.04 : style === "defend" ? -0.04 : 0;
  const bd = clamp((ball.x - T.ownGoalX) * T.dir / PITCH.w, 0, 1);  // ball depth for this team
  const bl = clamp((ball.y - PITCH.cy) / (PITCH.h / 2), -1, 1);
  const shift = bd - 0.5;
  let d, l;
  // Defenders stay in their own half. Midfielders and forwards only cross
  // the halfway line when the ball is already up there, and they keep their
  // width instead of all running to the same spot.
  if (p.role === "DEF") { d = clamp(0.16 + shift * 0.28 + (hasBall ? 0.03 : -0.04) + push, 0.08, 0.42); l = p.baseL * 0.92 + bl * 0.18; }
  else if (p.role === "MID") { d = clamp(0.34 + shift * 0.34 + (hasBall ? 0.04 : -0.03) + push, 0.20, 0.62); l = p.baseL * 0.88 + bl * 0.24; }
  else { d = clamp(0.46 + shift * 0.38 + (hasBall ? 0.05 : 0) + push, 0.32, 0.80); l = p.baseL * 0.86 + bl * 0.26; }
  l = clamp(l, -0.88, 0.88);
  return { x: T.ownGoalX + T.dir * d * PITCH.w, y: PITCH.cy + l * PITCH.h / 2 };
}

// Main AI brain for one player: returns where to run (and whether to sprint)
function aiDecide(p, dt) {
  const T = TEAMS[p.team];
  const plan = game.plans[p.team];
  const hold = { x: p.x, y: p.y, sprint: false };

  // Penalties + shootouts: everybody waits at their spot outside the box
  if (p.penSpot && (game.penalty || game.phase === "shootout" || game.phase === "pkflight")) {
    if (game.phase === "pkflight" && game.penalty && p === game.penalty.keeper) return hold;
    return { x: p.penSpot.x, y: p.penSpot.y, sprint: false };
  }
  // Fooled by a step-over: lunge the wrong way for a moment
  if (p.fooled > 0 && p.fooledDir && game.phase === "play") {
    return { x: p.x + p.fooledDir.x * 60, y: p.y + p.fooledDir.y * 60, sprint: false };
  }

  if (game.phase === "setpiece") {
    const sp = game.setpiece;
    if (sp.type === "kickoff" || p === sp.taker) return hold;
    // Corner kick: attackers crowd the box (near post, penalty spot, far post)
    if (sp.type === "corner" && p.team === sp.team && p.role !== "GK") {
      const G = TEAMS[other(p.team)];
      const nearTop = ball.y < PITCH.cy ? -1 : 1;
      const same = teamPlayers(p.team).filter((q) => q.role === p.role);
      const slot = Math.max(0, same.indexOf(p));
      const spots = { DEF: [PEN_SPOT + 70, 0], MID: [PEN_SPOT - 10, -nearTop * 36], FWD: [64, nearTop * 18] };
      const [d0, off0] = spots[p.role] || spots.MID;
      const spread = (slot - (same.length - 1) / 2) * 34;
      const extra = p.role === "DEF" && slot === same.length - 1 ? 210 * FIELD : 0;
      return { x: G.ownGoalX + G.dir * (d0 + extra), y: clamp(PITCH.cy + off0 + spread, PITCH.top + 36, PITCH.bottom - 36), sprint: false };
    }
    return { ...formationSpot(p, sp.team === p.team), sprint: false };
  }
  if (game.phase === "dead" && game.pending && game.pending.type === "throw" && p === game.pending.taker) {
    const spot = game.pending;
    return { x: spot.x, y: spot.y, sprint: Math.hypot(p.x - spot.x, p.y - spot.y) > 80 };
  }
  if (game.phase === "dead" || game.phase === "goal") {
    const ce = game.celebration;
    if (game.phase === "goal" && ce && ce.scorer) {
      const sc = ce.scorer;
      if (p === sc) {
        // celebrate! run toward the corner flag (airplane = fly around in circles)
        const spot = ce.spot;
        if (ce.type === "plane" && dist(p, spot) < 60) {
          const a = game.time * 3;
          return { x: spot.x + Math.cos(a) * 55 - T.dir * 40, y: spot.y + Math.sin(a) * 40 * (spot.y < PITCH.cy ? 1 : -1) + (spot.y < PITCH.cy ? 50 : -50), sprint: false };
        }
        return { x: spot.x, y: spot.y, sprint: true };
      }
      if (p.team === sc.team && p.role !== "GK" && ce.t > 0.8) {
        // teammates run over to join in (a pile-on if that's the celebration)
        const ring = ce.type === "pile" ? 6 : 30;
        const a = pIndex(p) * 1.7;
        return { x: sc.x + Math.cos(a) * ring, y: sc.y + Math.sin(a) * ring * 0.6, sprint: true };
      }
    }
    return { ...formationSpot(p, false), sprint: false };
  }

  if (p.role === "GK") return goalieAI(p, dt);
  if (ball.owner === p) return ownerAI(p, dt);

  if (!ball.owner && (ball.intended === p || plan.chaser === p)) {
    const ai = aiSettings(p.team);
    const ip = interceptFor(p, RUN_SPEED * ai.speed * (p.stamina > 0.2 ? SPRINT_MULT : 1));
    return { x: ip.x, y: ip.y, sprint: dist(p, ip) > 90 };
  }

  if (plan.mode === "defend") {
    if (plan.presser === p) {
      const goal = { x: T.ownGoalX, y: PITCH.cy };
      const g = normalize(goal.x - ball.x, goal.y - ball.y);
      const target = { x: ball.x + g.x * 6, y: ball.y + g.y * 6 };
      maybeSlide(p, dt);
      return { ...target, sprint: dist(p, ball) > 80 };
    }
    for (const [opp, marker] of plan.marks) {
      if (marker === p) {
        const g = normalize(T.ownGoalX - opp.x, PITCH.cy - opp.y);
        const spot = formationSpot(p, false);
        const tight = (game.teams[p.team] && game.teams[p.team].style === "defend") ? 0.1 : 0.22;
        return { x: lerp(opp.x + g.x * 36, spot.x, tight), y: lerp(opp.y + g.y * 22, spot.y, tight), sprint: dist(p, opp) > 140 };
      }
    }
    const back = formationSpot(p, false);
    return { ...back, sprint: dist(p, back) > 180 && p.stamina > 0.35 };
  }

  if (plan.mode === "attack") return supportSpot(p);
  const shape = formationSpot(p, ball.lastTeam === p.team);
  return { ...shape, sprint: dist(p, shape) > 200 && p.stamina > 0.35 };
}

// Teammates of the ball carrier: get into space and make runs
function supportSpot(p) {
  const T = TEAMS[p.team];
  const o = ball.owner;
  const spot = formationSpot(p, true);
  if (!o) return { ...spot, sprint: false }; // the ball was just passed
  if (p.role === "FWD" || p.role === "MID") {
    const ownerDepth = (o.x - T.ownGoalX) * T.dir;
    const want = ownerDepth + (p.role === "FWD" ? 160 : 40);
    const depth = Math.max((spot.x - T.ownGoalX) * T.dir, Math.min(want, PITCH.w - 120));
    spot.x = T.ownGoalX + T.dir * depth;
    if (p.role === "FWD") {
      const away = o.y >= PITCH.cy ? -1 : 1;
      spot.y = clamp(spot.y + away * 50, PITCH.top + 40, PITCH.bottom - 40);
    }
  }
  // Stay onside: don't run past the second-last defender (unless behind the ball)
  if (game.rules.offside) {
    const line = Math.max(offsideLine(p.team), (o.x - T.ownGoalX) * T.dir) - 10;
    if ((spot.x - T.ownGoalX) * T.dir > line) spot.x = T.ownGoalX + T.dir * line;
  }
  // Don't stand right next to the ball carrier: open a passing lane
  if (Math.abs(spot.y - o.y) < 110 && dist(spot, o) < 220) spot.y += (spot.y < o.y ? -1 : 1) * 110;
  // Step away from the nearest defender
  let near = null, nd = Infinity;
  for (const q of teamPlayers(other(p.team))) { const d = dist(q, spot); if (d < nd) { nd = d; near = q; } }
  if (near && nd < 80) { const a = normalize(spot.x - near.x, spot.y - near.y); spot.x += a.x * 40; spot.y += a.y * 40; }
  const s = clampToPitch(spot, 25);
  return { x: s.x, y: s.y, sprint: dist(p, s) > 220 && p.stamina > 0.5 };
}

// Slide tackle chance for the pressing defender
function maybeSlide(p, dt) {
  const ai = aiSettings(p.team);
  if (ai.slide <= 0 || p.stamina < 0.3 || !ball.owner || p.state !== "run") return;
  const d = dist(p, ball);
  if (d > 60 || d < 20) return;
  const to = normalize(ball.x - p.x, ball.y - p.y);
  if (to.x * p.fx + to.y * p.fy < 0.85) return;
  if (dist(p, ball) > dist(p, ball.owner) - 4) return; // only when the ball is nearer than the player (fewer fouls)
  let rate = ai.slide;
  if (inOwnBox(p.team, ball)) rate *= 0.25;                  // careful in your own box (penalty!)
  if (ball.owner.fx * p.fx + ball.owner.fy * p.fy > 0.5) rate *= 0.4;   // and from behind (card!)
  if (game.rules.cards && p.yellow) rate *= 0.3;            // already on a yellow card
  if (Math.random() < rate * dt) startSlide(p);
}

// How good is this spot for attacking? (closer to the other goal = better)
function attackValue(pt, team) {
  const T = TEAMS[team];
  return (1 - Math.hypot(T.targetGoalX - pt.x, PITCH.cy - pt.y) / 1500) * 100;
}

// Look at every teammate and score how good a pass to them would be
function bestPass(p, maxDist = 700) {
  const T = TEAMS[p.team];
  const ai = aiSettings(p.team);
  const opps = teamPlayers(other(p.team));
  let best = null;
  for (const m of teamPlayers(p.team)) {
    if (m === p || m.role === "GK" || m.state !== "run") continue;
    if (game.rules.offside && isOffsidePosition(m, p)) continue;   // don't pass to an offside player
    const options = [{ x: m.x + m.vx * 0.4, y: m.y + m.vy * 0.4, through: false }];
    if ((m.x - p.x) * T.dir > 40 && m.role !== "DEF") options.push({ x: m.x + T.dir * 90 + m.vx * 0.3, y: m.y + m.vy * 0.3, through: true });
    for (const o of options) {
      const target = clampToPitch(o, 20);
      const d = dist(ball, target);
      if (d < 70 || d > maxDist) continue;
      let lane = Infinity, space = Infinity;
      for (const q of opps) {
        lane = Math.min(lane, distToSegment(q, ball, target));
        space = Math.min(space, dist(q, target));
      }
      const lofted = lane < 28;
      if (lofted && (space < 45 || d < 180)) continue;
      const score = attackValue(target, p.team) + Math.min(space, 140) * 0.4 - (lofted ? 12 : 0) - d * 0.015 + rand(-1, 1) * ai.passErr * 40;
      if (!best || score > best.score) best = { mate: m, target, lofted, score, through: o.through };
    }
  }
  return best;
}

function doPass(p, best) {
  const ai = aiSettings(p.team);
  const d = dist(ball, best.target);
  const err = ai.passErr * boosts(p).passErr;
  const t = { x: best.target.x + rand(-1, 1) * err * d * 0.12, y: best.target.y + rand(-1, 1) * err * d * 0.12 };
  if (best.lofted || d > 480) loftedPass(p, t, best.mate);
  else groundPass(p, t, best.mate);
  if (best.through && Math.random() < 0.4) say("Through ball!", "#fff", 1.2);
}

// Shoot at the corner the goalie is NOT covering
function aiShoot(p) {
  const T = TEAMS[p.team];
  const ai = aiSettings(p.team);
  const gk = goalieOf(other(p.team));
  const topY = GOAL_TOP + 16, botY = GOAL_BOTTOM - 16;
  let ty = Math.abs(gk.y - topY) > Math.abs(gk.y - botY) ? topY : botY;
  const shotB = boosts(p);
  ty += rand(-1, 1) * ai.aimErr * shotB.aim * GOAL_W * 0.5;
  const gkOffLine = Math.abs(gk.x - T.targetGoalX) > 90;
  const distGoal = Math.hypot(T.targetGoalX - ball.x, PITCH.cy - ball.y);
  if (gkOffLine && distGoal > 200 && Math.random() < 0.6) {
    // Goalie has come out: chip it over his head!
    loftedPass(p, { x: T.targetGoalX + T.dir * 10, y: ty }, null, 1.1);
    ball.shot = { team: p.team, x: ball.x, y: ball.y, power: 600, chip: true };
    game.stats.shots[p.team]++;
    return;
  }
  kickBall(p, { x: T.targetGoalX - ball.x, y: ty - ball.y }, rand(900, 1150) * shotB.shot, rand(10, 120), "shot");
}

// The AI player with the ball: dribble, pass or shoot
function ownerAI(p, dt) {
  const T = TEAMS[p.team];
  const ai = aiSettings(p.team);
  const goal = { x: T.targetGoalX, y: PITCH.cy };
  const distGoal = dist(ball, goal);
  let pressure = Infinity, presser = null;
  for (const q of teamPlayers(other(p.team))) { const d = dist(q, p); if (d < pressure) { pressure = d; presser = q; } }

  p.thinkTimer -= dt;
  if (p.thinkTimer <= 0) {
    p.thinkTimer = ai.think + rand(0.05, 0.15);
    if (aiMaybeSkill(p, presser, pressure)) return { x: p.x + p.fx * 50, y: p.y + p.fy * 50, sprint: false };
    const angleOK = Math.abs(ball.y - PITCH.cy) < distGoal * 0.85;
    if (distGoal < ai.shootRange && angleOK) { aiShoot(p); return { x: p.x, y: p.y, sprint: false }; }
    const best = bestPass(p);
    const mine = attackValue(p, p.team) + Math.min(pressure, 120) * 0.4;
    if (best && (best.score > mine + 10 || (pressure < 40 && best.score > mine - 30))) {
      doPass(p, best);
      return { x: p.x, y: p.y, sprint: false };
    }
  }

  // Dribble toward goal, steering around defenders in the way
  let dir = normalize(goal.x - p.x, goal.y - p.y);
  for (const q of teamPlayers(other(p.team))) {
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (d > 140 || d < 1) continue;
    const ahead = (dx * dir.x + dy * dir.y) / d;
    if (ahead < 0.2) continue;
    const side = dx * -dir.y + dy * dir.x > 0 ? -1 : 1;  // dodge to the other side
    const w = (140 - d) / 140 * 1.4;
    dir = normalize(dir.x + -dir.y * side * w, dir.y + dir.x * side * w);
  }
  const t = clampToPitch({ x: p.x + dir.x * 100, y: p.y + dir.y * 100 }, 30);
  return { x: t.x, y: t.y, sprint: pressure > 110 && p.stamina > 0.4 };
}

// Goalie brain: stay between ball and goal, dive at shots, rush out
function goalieAI(g, dt) {
  const T = TEAMS[g.team];
  const ai = aiSettings(g.team);
  const plan = game.plans[g.team];

  if (ball.owner === g) {
    g.holdTimer -= dt;
    if (g.holdTimer <= 0) aiDistribute(g);
    return { x: g.x, y: g.y, sprint: false };
  }

  // Shot coming? Work out where it crosses our line and dive for it.
  const toward = -ball.vx * T.dir;
  if (!ball.owner && toward > 250 && g.state === "run" && ball.z < GK_HAND_HEIGHT + 20 && !(g.noReact > 0)) {
    const t = ((ball.x - g.x) * T.dir) / toward;
    const gkB = boosts(g);
    if (t > 0 && t < ai.gkReact * gkB.gkReact) {
      const py = ball.y + ball.vy * t;
      if (py > GOAL_TOP - 40 && py < GOAL_BOTTOM + 40) {
        const dy = py - g.y;
        if (Math.abs(dy) > 20) startDive(g, dy, ai.gkDive * gkB.gkDive);
      }
    }
  }

  if (!ball.owner && plan.gkRush) {
    const ip = interceptFor(g, RUN_SPEED * 0.95, GK_HAND_HEIGHT);
    return { x: ip.x, y: ip.y, sprint: true };
  }

  // Positioning: on the line from the goal center to the ball
  const gc = { x: T.ownGoalX, y: PITCH.cy };
  const v = normalize(ball.x - gc.x, ball.y - gc.y);
  const depth = clamp(dist(ball, gc) * 0.1, 12, 55);
  let x = gc.x + v.x * (depth + 8), y = gc.y + v.y * (depth + 8);
  if ((x - T.ownGoalX) * T.dir < 10) x = T.ownGoalX + T.dir * 10;
  y = clamp(y, GOAL_TOP - 10, GOAL_BOTTOM + 10);
  return { x, y, sprint: false };
}

// Goalie (or a set piece taker) gets rid of the ball
function aiDistribute(p) {
  const T = TEAMS[p.team];
  const best = bestPass(p, 800);
  if (best) {
    const d = dist(ball, best.target);
    if (best.lofted || d > 300) loftedPass(p, best.target, best.mate);
    else groundPass(p, best.target, best.mate);
  } else {
    loftedPass(p, { x: ball.x + T.dir * 420, y: PITCH.cy + rand(-220, 220) }, null);
  }
}

// What the AI does with a throw-in / corner / goal kick / free kick / kickoff
function aiTakeSetpiece(p, type) {
  const T = TEAMS[p.team];
  if (type === "kickoff") {
    let m = null, md = Infinity;
    for (const q of teamPlayers(p.team)) { if (q === p || q.role === "GK") continue; const d = dist(q, ball); if (d < md) { md = d; m = q; } }
    groundPass(p, { x: m.x, y: m.y }, m);
  } else if (type === "corner") {
    // Cross it into the box, ideally to a teammate
    const inBox = teamPlayers(p.team).filter((m) => m !== p && inOwnBox(other(p.team), m));
    const target = inBox.length ? inBox[Math.floor(Math.random() * inBox.length)]
      : { x: T.targetGoalX - T.dir * PEN_SPOT, y: PITCH.cy + rand(-60, 60) };
    loftedPass(p, { x: target.x, y: target.y }, inBox.length ? target : null, 1.1);
  } else if (type === "throw") {
    const best = bestPass(p, 330);
    if (best) startThrow(p, best.target, best.mate);
    else {
      const into = ball.y < PITCH.cy ? 1 : -1;
      startThrow(p, { x: ball.x + T.dir * 180, y: ball.y + into * 80 }, null);
    }
  } else if (type === "penalty") {
    aiPenalty(p);
  } else if (type === "free") {
    const distGoal = Math.hypot(T.targetGoalX - ball.x, PITCH.cy - ball.y);
    if (distGoal < aiSettings(p.team).shootRange + 40 && !game.setpiece.indirect) aiShoot(p);
    else aiDistribute(p);
  } else {
    aiDistribute(p); // goal kick
  }
}

// ---------------------------------------------------------------------
// 13. PLAYER MOVEMENT
// ---------------------------------------------------------------------

function startSlide(p) {
  if (p.state !== "run" || p.stamina < 0.1) return;
  p.state = "slide"; p.stateTimer = SLIDE_TIME; p.slideTouched = false;
  p.vx = p.fx * SLIDE_SPEED; p.vy = p.fy * SLIDE_SPEED;
  p.fallDir = p.fx >= 0 ? 1 : -1;
  p.stamina -= 0.08;
}
function startDive(g, dy, speed) {
  const T = TEAMS[g.team];
  g.state = "dive"; g.stateTimer = 0.5;
  const d = normalize(T.dir * 0.15, Math.sign(dy));
  const s = Math.min(speed, Math.abs(dy) / 0.3 + 120);
  g.vx = d.x * s; g.vy = d.y * s;
  g.fallDir = dy > 0 ? 1 : -1;
}
function fallDown(p, seconds) {
  p.state = "down"; p.stateTimer = seconds;
  p.fallDir = Math.random() < 0.5 ? -1 : 1;
  if (ball.owner === p) ball.owner = null;
}

function updatePlayers(dt) {
  // the current set piece (or null). A function, because a kick during
  // this loop can end the set piece.
  const sp = () => (game.phase === "setpiece" ? game.setpiece : null);
  const pen = game.penalty;
  for (const p of players) {
    p.controlCD -= dt;
    if (!ball.owner && dist(p, ball) > 50) p.touchSettle = 0;
    // trick + "fooled" timers
    p.skillCD -= dt; p.burst -= dt; p.fooled -= dt; p.noReact = (p.noReact || 0) - dt;
    if (p.pendingDive && (p.pendingDive.t -= dt) <= 0) { if (p.state === "run") startDive(p, p.pendingDive.dy, 420); p.pendingDive = null; }
    if (p.skill) { p.skillT -= dt; if (p.skillT <= 0 || ball.owner !== p && p.skill === "spin") { if (p.skill === "spin" && p.skillDir) { p.fx = p.skillDir.x; p.fy = p.skillDir.y; } p.skill = null; } }

    // --- Special states: sliding, diving, lying on the grass ---
    if (p.state !== "run") {
      p.stateTimer -= dt;
      const drag = p.state === "slide" ? 0.15 : p.state === "dive" ? 0.4 : 0.02;
      const f = Math.pow(drag, dt);
      p.vx *= f; p.vy *= f;
      if (p.stateTimer <= 0) {
        if (p.state === "slide") fallDown(p, 0.35);       // get back up
        else if (p.state === "dive") fallDown(p, 0.55);
        else p.state = "run";
      }
    } else {
      // --- Normal running: work out the wanted velocity ---
      let want = { x: 0, y: 0 }, sprint = false, speedMult = 1;
      const ctrl = game.phase === "goal" ? null : controllerOf(p);   // everyone celebrates by themselves
      const human = !!ctrl;
      if (human) {
        const m = humanMove(ctrl);
        sprint = !!ctrl.input.sprint;
        if (m.x || m.y) {
          // turn toward the input direction quickly (but not instantly)
          const k = Math.min(1, dt * 14);
          const nf = normalize(lerp(p.fx, m.x, k) + 1e-3 * -p.fy, lerp(p.fy, m.y, k) + 1e-3 * p.fx);
          p.fx = nf.x; p.fy = nf.y;
        }
        want = m;
        updateHumanKick(ctrl, dt);
      } else {
        const t = aiDecide(p, dt);
        if (p.state !== "run") continue; // started a slide this frame
        speedMult = aiSettings(p.team).speed * (p.role === "GK" ? 0.95 : 1);
        sprint = t.sprint && p.stamina > 0.15;
        const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
        if (d > 3) {
          const arrive = Math.min(1, d / 60);   // slow down when arriving
          want = { x: dx / d * arrive, y: dy / d * arrive };
        }
      }
      // PENALTY: the taker aims (up/down moves the aim marker), the goalie
      // picks a dive (up / down, left/right = stay in the middle)
      if (pen && (game.phase === "setpiece" || game.phase === "shootout") && (p === pen.taker || p === pen.keeper)) {
        if (p === pen.taker && human) {
          pen.aimY = clamp(pen.aimY + want.y * PEN_AIM_SPEED * dt, GOAL_TOP + 6, GOAL_BOTTOM - 6);
        }
        if (p === pen.keeper && human && Math.hypot(want.x, want.y) > 0.3) {
          pen.gkChoice = Math.abs(want.y) > Math.abs(want.x) ? Math.sign(want.y) : 0;
        }
        if (p === pen.taker) { const f = normalize(TEAMS[p.team].targetGoalX - p.x, pen.aimY - p.y); p.fx = f.x; p.fy = f.y; }
        want = { x: 0, y: 0 };
      } else if (game.phase === "shootout" || game.phase === "pkflight") {
        want = { x: 0, y: 0 };   // shootout: the others watch from the halfway line
      } else if (sp() && (p === sp().taker || sp().type === "kickoff")) {
        // Set piece taker (and everyone at kickoff) stands still
        if (human && (want.x || want.y)) { const n = normalize(want.x, want.y); p.fx = n.x; p.fy = n.y; }
        want = { x: 0, y: 0 };
      }
      // Overhead throw: both feet stay on the touchline until the arms finish.
      if ((p.throwT || 0) > 0) { want = { x: 0, y: 0 }; sprint = false; }
      // ROULETTE: spin away sideways with the ball
      if (p.skill === "spin" && ball.owner === p && p.skillDir) { want = { x: p.skillDir.x, y: p.skillDir.y }; speedMult *= 1.1; }

      // --- Sprint + stamina (a high stamina stat, or the Engine trait, tires slower) ---
      const body = boosts(p);
      const moving = Math.hypot(want.x, want.y) > 0.3;
      p.sprinting = sprint && moving && p.stamina > 0.02;
      if (p.sprinting) p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * body.stamDrain * dt);
      else p.stamina = Math.min(1, p.stamina + STAMINA_REGEN * dt);

      let maxSpeed = RUN_SPEED * speedMult * body.run;
      if (p.sprinting) maxSpeed *= SPRINT_MULT * body.sprint;
      if (ball.owner === p) maxSpeed *= DRIBBLE_MULT;
      if (p.stamina < 0.15) maxSpeed *= 0.88; // tired legs
      if (p.burst > 0) maxSpeed *= 1.35;       // knock-on burst
      if (p.skill === "stepover") maxSpeed *= 0.8;

      // --- Momentum: velocity changes gradually toward the wanted velocity ---
      const tvx = want.x * maxSpeed, tvy = want.y * maxSpeed;
      let dvx = tvx - p.vx, dvy = tvy - p.vy;
      const dv = Math.hypot(dvx, dvy);
      const spdNow = Math.hypot(p.vx, p.vy);
      const wantSpd = Math.hypot(tvx, tvy);
      const dot = spdNow > 8 && wantSpd > 8 ? (p.vx * tvx + p.vy * tvy) / (spdNow * wantSpd) : 1;
      const stopping = wantSpd < 30 && spdNow > 40;
      // Turning takes longer than setting off. Stopping is still fairly quick.
      const maxChange = ACCEL * (stopping ? 1.35 : dot < 0.35 ? 0.62 : 1) * dt;
      if (dv > maxChange) { dvx = dvx / dv * maxChange; dvy = dvy / dv * maxChange; }
      p.vx += dvx; p.vy += dvy;

      // AI players look where they run (or at the ball when standing)
      if (!human && !(sp() && p === sp().taker)) {
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 30) { p.fx = p.vx / sp; p.fy = p.vy / sp; }
        else { const b = normalize(ball.x - p.x, ball.y - p.y); p.fx = b.x; p.fy = b.y; }
      }
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = clamp(p.x, PITCH.left - 40, PITCH.right + 40);
    p.y = clamp(p.y, PITCH.top - 40, PITCH.bottom + 40);
    p.anim += Math.hypot(p.vx, p.vy) * dt * 0.09;
  }
  separatePlayers();
  if (sp() && sp().type === "kickoff") parkForKickoff(sp().taker);
  else if (sp()) keepAwayFromSetpiece();
  glueThrower();
  advanceThrow(dt);
}

// Bodies can't overlap. Also: a slide that hits the PLAYER before the
// ball is a foul!
function separatePlayers() {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      const minD = PLAYER_R * 2;
      if (d >= minD || d === 0) continue;
      if (game.phase === "play" && a.team !== b.team) {
        if (a.state === "slide" && !a.slideTouched && b.state === "run") { foul(a, b); return; }
        if (b.state === "slide" && !b.slideTouched && a.state === "run") { foul(b, a); return; }
      }
      const push = (minD - d) / 2;
      a.x -= dx / d * push; a.y -= dy / d * push;
      b.x += dx / d * push; b.y += dy / d * push;
    }
  }
}

function keepAwayFromSetpiece() {
  const sp = game.setpiece;
  for (const p of players) {
    if (p.team === sp.team) continue;
    const d = dist(p, ball);
    if (d < SETPIECE_DIST && d > 0) {
      p.x = ball.x + (p.x - ball.x) / d * SETPIECE_DIST;
      p.y = ball.y + (p.y - ball.y) / d * SETPIECE_DIST;
    }
  }
}

// ---------------------------------------------------------------------
// 14. RULES (goals, out of play, restarts)
// ---------------------------------------------------------------------

function checkOutOfPlay() {
  if (game.phase !== "play" || ball.inNet) return;
  const r = BALL_R;
  const inMouth = ball.y > GOAL_TOP && ball.y < GOAL_BOTTOM;

  // Crossbar: a ball at exactly crossbar height bounces back out
  for (const side of ["left", "right"]) {
    const L = side === "left" ? PITCH.left : PITCH.right, s = side === "left" ? -1 : 1;
    const past = (ball.x - L) * s;
    if (inMouth && past > 0 && past < 3 * r && Math.abs(ball.z - CROSSBAR) < r + 1 && ball.vx * s > 0) {
      ball.vx = -ball.vx * 0.5; ball.x = L - s * 1;
      ball.vz = ball.z > CROSSBAR ? Math.abs(ball.vz) * 0.5 + 60 : -Math.abs(ball.vz) * 0.5;
      say("Off the crossbar!", "#ffd33d"); emit("post"); emit("ooh");
      return;
    }
  }

  // Over a touchline (top or bottom): THROW-IN to the other team
  if (ball.y < PITCH.top - r || ball.y > PITCH.bottom + r) {
    const team = other(ball.lastTeam || "red");
    const spot = { x: clamp(ball.x, PITCH.left + 18, PITCH.right - 18), y: ball.y < PITCH.cy ? PITCH.top : PITCH.bottom };
    goDead("throw", team, spot, nearestOutfield(team, spot));
    return;
  }

  // Over a goal line: GOAL, CORNER or GOAL KICK
  for (const side of ["left", "right"]) {
    const crossed = side === "left" ? ball.x < PITCH.left - r : ball.x > PITCH.right + r;
    if (!crossed) continue;
    const defending = side === "left" ? "blue" : "red";
    const T = TEAMS[defending];
    if (inMouth && ball.z < CROSSBAR) {
      if (ball.indirect && ball.indirect.team !== defending) {
        goDead("goalkick", defending, { x: T.ownGoalX + T.dir * SIX.depth, y: PITCH.cy }, null, { label: "No goal - it was an indirect free kick!" });
        return;
      }
      scoreGoal(other(defending), side); return;
    }
    const wasShot = ball.shot && ball.shot.team !== defending;
    const top = ball.y < PITCH.cy;
    if (ball.lastTeam === defending) {
      goDead("corner", other(defending), { x: T.ownGoalX + T.dir * 4, y: top ? PITCH.top + 4 : PITCH.bottom - 4 });
    } else {
      goDead("goalkick", defending, { x: T.ownGoalX + T.dir * SIX.depth, y: PITCH.cy + (top ? -60 : 60) });
      if (wasShot) { say(inMouth ? "Over the bar!" : "Just wide!", "#ffd33d"); emit("ooh"); }
    }
    return;
  }
}

// The ball is out: blow the whistle, wait a moment, then restart
function goDead(type, team, spot, taker = null, extra = {}) {
  game.phase = "dead";
  game.timer = type === "free" || type === "penalty" ? 1.6 : 1.1;
  if (extra.long) game.timer = 2.4;          // time to show the card
  game.pending = { type, team, x: spot.x, y: spot.y, taker, indirect: !!extra.indirect };
  ball.owner = null; ball.intended = null; ball.offside = null; ball.indirect = null;
  cancelCharging();
  emit("whistle");
  const names = { throw: "Throw-in", corner: "Corner kick!", goalkick: "Goal kick", free: "Foul! Free kick", penalty: "PENALTY!" };
  say((extra.label || names[type]) + " \u2013 " + teamName(team), teamUi(team), type === "penalty" ? 2.4 : 1.8);
}

function scoreGoal(team, side) {
  game.score[team]++;
  game.lastScorer = team;
  ball.inNet = side;
  ball.owner = null;
  game.phase = "goal";
  game.timer = GOAL_CELEBRATION_TIME;
  const shot = ball.shot;
  let text = "GOAL!";
  if (ball.lastTeam && ball.lastTeam !== team) text = "Own goal!";
  else if (shot && shot.penalty) text = "Penalty scored!";
  else if (shot && shot.chip) text = "What a chip!";
  else if (shot && Math.hypot(shot.x - ball.x, shot.y - ball.y) > 450) text = "From long range!";
  else if (shot && shot.power >= 1050) text = "What a strike!";
  emit("cheer");
  emit("whistle");
  // ---- celebration: the scorer runs to the corner flag, teammates join ----
  let scorer = ball.lastTouch && ball.lastTouch.team === team && !ball.lastTouch.sentOff ? ball.lastTouch : null;
  if (!scorer || scorer.role === "GK") {
    let bd = Infinity;
    for (const p of teamPlayers(team)) { if (p.role === "GK") continue; const d = dist(p, ball); if (d < bd) { bd = d; scorer = p; } }
  }
  const who = (ball.lastTeam && ball.lastTeam !== team && ball.lastTouch) ? ball.lastTouch : scorer;
  if (who) text += " " + shownName(who);
  say(text, teamUi(team), 3);
  if (who) game.stats.scorers.push({ team, name: shownName(who), num: who.num, og: !!(ball.lastTeam && ball.lastTeam !== team) });
  const T = TEAMS[team];
  const top = scorer ? scorer.y < PITCH.cy : true;
  game.celebration = scorer ? {
    scorer, t: 0, type: CELEBRATIONS[Math.floor(Math.random() * CELEBRATIONS.length)],
    spot: { x: T.targetGoalX - T.dir * 70, y: top ? PITCH.top + 45 : PITCH.bottom - 45 },
  } : null;
  cancelCharging();
}

// The 5:00 clock ran out. Most goals wins. A draw is a draw, unless this
// is a cup match, which goes to a penalty shootout.
function fullTime() {
  emit("whistleLong");
  if (game.score.blue !== game.score.red) endGame(game.score.blue > game.score.red ? "blue" : "red");
  else if (game.knockout) { say("It's a draw - PENALTIES!", "#ffd33d", 3); startShootout(); }
  else endGame(null);
}

// Restart the game with a set piece: the taker waits with the ball
function beginSetpiece(type, team, x, y, taker = null, indirect = false) {
  const T = TEAMS[team];
  if (type === "kickoff") resetToHome();
  Object.assign(ball, { x, y, z: 0, vx: 0, vy: 0, vz: 0, curl: 0, inNet: null, shot: null, intended: null, offside: null, indirect: null });

  if (!taker || taker.state !== "run" || taker.sentOff || (type === "penalty" && taker.role === "GK" && !game.shootout)) {
    if (type === "kickoff" || type === "penalty") {
      const meP = type === "kickoff" ? players.find((p) => p.team === team && p.me && !p.sentOff && p.role !== "GK") : null;
      taker = meP || players.find((p) => p.team === team && p.role === "FWD") || teamPlayers(team).find((p) => p.role !== "GK");
    }
    else if (type === "goalkick") taker = goalieOf(team);
    else {
      let best = null, bd = Infinity;
      for (const p of teamPlayers(team)) { if (p.role === "GK") continue; const d = dist(p, ball); if (d < bd) { bd = d; best = p; } }
      taker = best;
    }
  }
  taker.state = "run";
  let f;
  if (type === "throw") {
    // Both feet on the touchline, body facing back into the pitch.
    const into = y < PITCH.cy ? 1 : -1;
    f = normalize(T.dir * 0.45, into);
    taker.x = x; taker.y = y;
  } else {
    if (type === "corner") f = normalize(PITCH.cx - x, PITCH.cy - y);
    else if (type === "free") f = normalize(T.targetGoalX - x, PITCH.cy - y);
    else f = { x: T.dir, y: 0 };
    const back = type === "penalty" ? 26 : 0;  // a little run-up for penalties
    taker.x = x - f.x * (PLAYER_R + BALL_R + 1 + back);
    taker.y = y - f.y * (PLAYER_R + BALL_R + 1 + back);
  }
  taker.fx = f.x; taker.fy = f.y;
  taker.vx = taker.vy = 0;
  taker.throwT = 0;

  ball.owner = type === "penalty" ? null : taker;
  ball.lastTouch = taker; ball.lastTeam = team;
  const humanTakes = isHumanTeam(team) && taker.role !== "GK";
  const humanPen = type === "penalty" && (isHumanTeam(team) || isHumanTeam(other(team)));
  game.setpiece = { type, team, taker, indirect: !!indirect,
                    timer: type === "penalty" ? (humanPen ? 12 : rand(1.4, 2)) : humanTakes ? 7 : rand(0.9, 1.5),
                    spotX: taker.x, spotY: taker.y, throwT: 0, throwDir: null, throwTarget: null, throwMate: null };
  game.phase = "setpiece";
  cancelCharging();
  game.stats[type]++;
  if (type === "penalty") setupPenalty(team, taker);
  else {
    game.penalty = null;
    if (type === "throw") holdThrowBall(taker, 0);   // ball is already over the head, not at the feet
    if (type !== "kickoff") keepAwayFromSetpiece();
    else { parkForKickoff(taker); say("Kick off!", "#fff", 1.5); emit("whistle"); }
  }
}

// Nearest teammate who can take a throw-in (not the goalkeeper).
function nearestOutfield(team, spot) {
  let best = null, bd = Infinity, fallback = null, fd = Infinity;
  for (const p of teamPlayers(team)) {
    if (p.role === "GK" || p.sentOff) continue;
    const d = Math.hypot(p.x - spot.x, p.y - spot.y);
    if (d < fd) { fd = d; fallback = p; }
    if (p.state !== "run") continue;
    if (d < bd) { bd = d; best = p; }
  }
  return best || fallback;
}

// ---------------------------------------------------------------------
// 15. FOULS, CARDS + PENALTIES
// ---------------------------------------------------------------------
// A foul (a slide that hits the player instead of the ball).
//   Yellow card: a slide from behind, or a 3rd foul by the same player
//   Red card: a second yellow, or a very bad foul (stopping a clear run
//             at goal as the last defender, or a fast slide from behind)
//   Foul inside your own penalty box = PENALTY KICK for the other team
function foul(offender, victim) {
  const hadBall = ball.owner === victim || (ball.lastTouch === victim && dist(ball, victim) < 45);
  const speed = Math.hypot(offender.vx, offender.vy);
  fallDown(victim, 0.9);
  game.stats.fouls++;
  offender.fouls++;
  const inBox = inOwnBox(offender.team, victim);
  let card = null;
  if (game.rules.cards) {
    const fromBehind = offender.fx * victim.fx + offender.fy * victim.fy > 0.55;
    const depth = (pt) => depthFor(victim.team, pt);
    const defendersBack = teamPlayers(offender.team).filter((q) => q !== offender && q.role !== "GK" && depth(q) > depth(victim)).length;
    const lastMan = hadBall && defendersBack === 0 && depth(victim) > PITCH.w * 0.62;
    if (lastMan || (fromBehind && speed > 330 && Math.random() < 0.3)) card = "red";
    else if (fromBehind || offender.fouls >= 3 || (inBox && Math.random() < 0.35)) card = "yellow";
  }
  if (card) giveCard(offender, card);
  if (inBox) goDead("penalty", victim.team, penaltySpot(victim.team), victim, { long: !!card });
  else goDead("free", victim.team, clampToPitch(victim, 15), victim, { long: !!card });
}

// Show a card. A red card (or 2nd yellow) sends the player off: his team
// plays one player short. (A team never drops below 2 outfield players.)
function giveCard(p, kind) {
  let shown = kind;
  if (kind === "yellow") {
    p.yellow++;
    game.stats.yellow[p.team]++;
    if (p.yellow >= 2) shown = "second";
  }
  if (shown !== "yellow") {
    const outfield = teamPlayers(p.team).filter((q) => q.role !== "GK").length;
    if (outfield > 2) { sendOff(p); game.stats.red[p.team]++; }
    else if (kind === "red") { shown = "yellow"; p.yellow = Math.max(p.yellow, 1); }  // too few players left
  }
  game.cardPopup = { team: p.team, idx: pIndex(p), num: p.num, kind: shown, timer: 3 };
  emit("card", shown === "yellow" ? 1 : 2);
  say(shown === "yellow" ? "Yellow card!" : shown === "second" ? "Second yellow - RED CARD!" : "RED CARD!", shown === "yellow" ? "#ffd33d" : "#ff4d4d", 2.2);
}

function sendOff(p) {
  p.sentOff = true;
  p.state = "run"; p.vx = p.vy = 0;
  if (ball.owner === p) ball.owner = null;
  if (ball.intended === p) ball.intended = null;
  for (const c of controllers) if (c.active === p) setActive(c, null);
  players = roster.filter((q) => !q.sentOff);
}

const penaltySpot = (team) => ({ x: TEAMS[team].targetGoalX - TEAMS[team].dir * PEN_SPOT, y: PITCH.cy });

// Put everybody in place for a penalty kick
function setupPenalty(team, taker) {
  const A = TEAMS[team];
  const keeper = goalieOf(other(team));
  keeper.state = "run";
  keeper.x = A.targetGoalX - A.dir * 8; keeper.y = PITCH.cy; keeper.vx = keeper.vy = 0;
  keeper.fx = -A.dir; keeper.fy = 0;
  game.penalty = { team, taker, keeper, aimY: PITCH.cy + (Math.random() < 0.5 ? -40 : 40), gkChoice: 0, dive: null, flightT: 0 };
  const count = { blue: 0, red: 0 };
  for (const p of players) {
    if (p === taker || p === keeper) { p.penSpot = { x: p.x, y: p.y }; continue; }
    const k = count[p.team]++;
    let spot;
    if (game.shootout) {
      // shootout: everyone else watches from the centre circle
      spot = { x: PITCH.cx + (p.team === "blue" ? -18 : 18), y: PITCH.cy - 90 + k * 45 };
    } else if (p.role === "GK") {
      spot = { x: TEAMS[p.team].ownGoalX + TEAMS[p.team].dir * 18, y: PITCH.cy };
    } else {
      // outside the box, near the "D"
      const lane = k * 2 + (p.team === team ? 0 : 1);
      spot = { x: A.targetGoalX - A.dir * (BOX.depth + 28 + (lane % 2) * 26), y: PITCH.cy + (lane - 3.5) * 50 };
    }
    p.penSpot = spot;
    p.x = spot.x; p.y = spot.y; p.vx = p.vy = 0; p.state = "run";
    p.fx = A.dir; p.fy = 0;
  }
  ball.owner = null;
}

// Shoot a penalty at aimY with this much power (0..1)
function penaltyKick(p, charge, aimY) {
  const pen = game.penalty;
  if (!pen) return;
  const A = TEAMS[p.team];
  const target = { x: A.targetGoalX + A.dir * 6, y: aimY };
  const power = lerp(PEN_POWER_MIN, PEN_POWER_MAX, charge);
  const lift = 20 + 470 * Math.pow(charge, 3);   // too much power = over the bar!
  const keeperIsHuman = !!controllerOf(pen.keeper);
  pen.aimY = aimY; pen.power = charge;
  kickBall(p, { x: target.x - ball.x, y: target.y - ball.y }, power, lift, "shot");
  ball.shot.penalty = true;
  // The goalie dives: a human picked a side; the computer has to guess
  const k = pen.keeper;
  let choice;
  if (keeperIsHuman) choice = pen.gkChoice;
  else {
    const side = Math.abs(aimY - PITCH.cy) > 24 ? Math.sign(aimY - PITCH.cy) : 0;
    const read = ({ easy: 0.2, normal: 0.28, hard: 0.36 }[game.difficulty] || 0.28) + 0.04 * ((game.teams[k.team].rating || 3) - 3);
    choice = Math.random() < read ? side : Math.random() < 0.15 ? 0 : Math.random() < 0.5 ? -1 : 1;
  }
  pen.dive = choice;
  // The dive starts a split second after the kick, so a hard shot right
  // into the corner can beat even a goalie who guessed the right way.
  k.pendingDive = choice ? { dy: choice * 70, t: 0.12 } : null;
  k.noReact = 0.8;   // and no second "reaction" dive
  if (!game.shootout) game.penalty = null;   // in a match the game goes on (rebounds!)
}

// The computer takes a penalty: usually aims for a corner
function aiPenalty(p) {
  const ai = aiSettings(p.team);
  const side = Math.random() < 0.5 ? -1 : 1;
  let aimY = PITCH.cy + (Math.random() < 0.18 ? rand(-15, 15) : side * rand(36, 70));
  aimY += rand(-1, 1) * ai.aimErr * 30;
  const charge = Math.random() < ai.aimErr * 0.2 ? rand(0.93, 1) : rand(0.4, 0.85);
  penaltyKick(p, charge, clamp(aimY, GOAL_TOP - 20, GOAL_BOTTOM + 20));
}

// ---------------------------------------------------------------------
// 16. OFFSIDE
// ---------------------------------------------------------------------
// "depth" = how far up the pitch a point is for a team (0 = its own goal line)
function depthFor(team, pt) { return (pt.x - TEAMS[team].ownGoalX) * TEAMS[team].dir; }
// The offside line: the second-last defender (the goalie is usually the last)
function offsideLine(team) {
  const d = teamPlayers(other(team)).map((q) => depthFor(team, q)).sort((a, b) => b - a);
  return d.length > 1 ? d[1] : PITCH.w;
}
// Offside position: in the other half, past the second-last defender AND past the ball
function isOffsidePosition(q) {
  const d = depthFor(q.team, q);
  return d > PITCH.w / 2 && d > offsideLine(q.team) + 4 && d > depthFor(q.team, ball) + 4;
}
function offsidePlayers(kicker) {
  return teamPlayers(kicker.team).filter((q) => q !== kicker && q.state !== "down" && isOffsidePosition(q));
}
// An offside player touched the ball: indirect free kick to the defenders
function callOffside(p) {
  game.stats.offside++;
  goDead("free", other(p.team), clampToPitch(p, 15), null, { indirect: true, label: "Offside! Free kick" });
  game.flag = { team: p.team, idx: pIndex(p), num: p.num, timer: 2.6 };
  emit("flag");
}

// ---------------------------------------------------------------------
// 17. PENALTY SHOOTOUT  (5 kicks each, then sudden death)
// ---------------------------------------------------------------------
function startShootout() {
  cancelCharging();
  game.shootout = { first: Math.random() < 0.5 ? "blue" : "red", kicks: { blue: [], red: [] }, sudden: false, done: false, winner: null, last: null };
  game.phase = "shootout"; game.timer = 2.2;
  game.penalty = null; game.setpiece = null; game.celebration = null;
  resetToHome();
  Object.assign(ball, { x: PITCH.cx, y: PITCH.cy, z: 0, vx: 0, vy: 0, vz: 0, curl: 0, owner: null, inNet: null, shot: null, offside: null });
  const count = { blue: 0, red: 0 };
  for (const p of players) {
    const k = count[p.team]++;
    p.penSpot = { x: PITCH.cx + (p.team === "blue" ? -18 : 18), y: PITCH.cy - 90 + k * 45 };
    p.x = p.penSpot.x; p.y = p.penSpot.y;
  }
  emit("whistle");
  say("Penalty shootout!", "#ffd33d", 2.2);
}
const sumKicks = (list) => list.reduce((a, b) => a + b, 0);
function shootoutTurn() {
  const so = game.shootout, f = so.first, s2 = other(f);
  return so.kicks[f].length <= so.kicks[s2].length ? f : s2;
}
// Everybody takes a turn: forwards first, the goalie last
function shootoutTaker(team) {
  const order = { FWD: 0, MID: 1, DEF: 2, GK: 3 };
  const list = teamPlayers(team).slice().sort((a, b) => order[a.role] - order[b.role] || a.num - b.num);
  return list[game.shootout.kicks[team].length % list.length];
}
function nextShootoutKick() {
  const team = shootoutTurn();
  const spot = penaltySpot(team);
  beginSetpiece("penalty", team, spot.x, spot.y, shootoutTaker(team));
}
// The ball is flying: did it go in?
function updatePkFlight(dt) {
  const pen = game.penalty, A = TEAMS[pen.team], k = pen.keeper;
  pen.flightT += dt;
  updatePlayers(dt);
  updateBall(dt);
  // only the goalie can touch it
  if (!ball.owner && k.state !== "down" && k.controlCD <= 0 && dist(k, ball) < reachFor(k) && ball.z < GK_HAND_HEIGHT) goalieTouch(k);
  const past = (ball.x - A.targetGoalX) * A.dir;
  const inMouth = ball.y > GOAL_TOP && ball.y < GOAL_BOTTOM;
  let result = null;
  if (past > BALL_R) result = inMouth && ball.z < CROSSBAR ? "goal" : "miss";
  else if (ball.owner === k) result = "saved";
  else if (pen.flightT > 0.35 && (ball.vx * A.dir < 0 || ballSpeed() < 40)) result = ball.lastTouch === k ? "saved" : "miss";
  else if (pen.flightT > 3) result = "miss";
  if (result) shootoutResult(result);
}
function shootoutResult(result) {
  const so = game.shootout, pen = game.penalty;
  const scored = result === "goal";
  so.kicks[pen.team].push(scored ? 1 : 0);
  if (scored) {
    ball.inNet = pen.team === "blue" ? "right" : "left";
    emit("cheer"); say("SCORED!", teamUi(pen.team), 1.8); game.stats.pens.scored++;
  } else {
    emit("ooh"); say(result === "saved" ? "SAVED!" : "MISSED!", "#ffd33d", 1.8); game.stats.pens.missed++;
  }
  so.last = { team: pen.team, scored, result };
  game.phase = "shootout"; game.timer = 2.0;
  game.penalty = null;
  // Is it over?
  const f = so.first, s2 = other(f), a = so.kicks[f], b = so.kicks[s2];
  const sa = sumKicks(a), sb = sumKicks(b);
  let winner = null;
  if (!so.sudden) {
    const ra = SHOOTOUT_KICKS - a.length, rb = SHOOTOUT_KICKS - b.length;
    if (sa + ra < sb) winner = s2;
    else if (sb + rb < sa) winner = f;
    else if (!ra && !rb) { so.sudden = true; say("Sudden death!", "#ff9f1c", 2.2); }
  } else if (a.length === b.length && sa !== sb) winner = sa > sb ? f : s2;
  if (winner) { so.done = true; so.winner = winner; game.timer = 2.6; }
}

// ---------------------------------------------------------------------
// 18. MATCH OFFICIALS
// The referee keeps a gap of about 12 to 18 metres and watches from the
// side. He does not run onto the ball. Each linesman stays just outside
// his own touchline and only slides along it, level with the offside
// line in the half he looks after. They only move themselves: players
// and the ball go straight through them.
// Signals: 0 run, 1 whistle, 2 point, 3 yellow card, 4 red card,
//          5 flag straight up (offside), 6 flag angled (throw-in / corner)
// ---------------------------------------------------------------------
// The pitch is about 105 metres long. One metre is this many pixels.
const METRE = PITCH.w / 105;
const REF_NEAR = 12 * METRE; // viewing spot sits about 12 to 15 metres out
const REF_FAR = 15 * METRE;
const REF_MIN = 11 * METRE;  // hard gap during open play, so a shot cannot catch him
function clearOfBall(x, y, gap) {
  const dx = x - ball.x, dy = y - ball.y;
  const d = Math.hypot(dx, dy);
  if (d >= gap) return { x, y };
  const ux = d > 1 ? dx / d : 0;
  const uy = d > 1 ? dy / d : 1;
  return { x: ball.x + ux * gap, y: ball.y + uy * gap };
}
// -1 left penalty area, +1 right, 0 outside. pad grows the box a little.
function penaltySide(x, y, pad) {
  const extra = pad || 0;
  const half = BOX.width / 2 + extra;
  const depth = BOX.depth + extra;
  if ((x - PITCH.left) < depth && Math.abs(y - PITCH.cy) < half) return -1;
  if ((PITCH.right - x) < depth && Math.abs(y - PITCH.cy) < half) return 1;
  return 0;
}
// Shift a point out of a penalty area, toward midfield, along the 18-yard line.
function clearOfBoxes(x, y, pad) {
  const extra = pad == null ? 22 : pad;
  const side = penaltySide(x, y, extra);
  if (!side) return { x, y };
  const goalX = side < 0 ? PITCH.left : PITCH.right;
  return { x: goalX - side * (BOX.depth + extra), y };
}
// On the pitch, outside both penalty areas, and at least `gap` from the ball.
// The way out is toward open grass, never deeper into the goal.
function legalView(x, y, gap) {
  for (let i = 0; i < 3; i++) {
    x = clamp(x, PITCH.left + 48, PITCH.right - 48);
    y = clamp(y, PITCH.top + 36, PITCH.bottom - 36);
    const boxed = clearOfBoxes(x, y, 18);
    x = boxed.x; y = boxed.y;
    let dx = x - ball.x, dy = y - ball.y;
    let d = Math.hypot(dx, dy);
    if (d >= gap) return { x, y };
    if (d < 1) {
      dx = ball.x < PITCH.cx ? 1 : -1;
      dy = (ball.y < PITCH.cy ? 1 : -1) * 0.7;
      d = Math.hypot(dx, dy);
    }
    let sx = dx / d, sy = dy / d;
    const goalSign = (x - PITCH.left) <= (PITCH.right - x) ? -1 : 1;
    if (sx * goalSign > 0 && Math.min(x - PITCH.left, PITCH.right - x) < BOX.depth + 110) sx = -goalSign;
    if (y <= PITCH.top + 56 && sy < 0) sy = 0.4;
    if (y >= PITCH.bottom - 56 && sy > 0) sy = -0.4;
    const len = Math.hypot(sx, sy) || 1;
    x = ball.x + (sx / len) * gap;
    y = ball.y + (sy / len) * gap;
  }
  x = clamp(x, PITCH.left + 48, PITCH.right - 48);
  y = clamp(y, PITCH.top + 36, PITCH.bottom - 36);
  const boxed = clearOfBoxes(x, y, 18);
  return { x: boxed.x, y: boxed.y };
}
function faceToward(x, y, fallback) {
  const len = Math.hypot(x, y);
  return len > 0.05 ? { x: x / len, y: y / len } : (fallback || { x: 1, y: 0 });
}
// Where this linesman should stand along his touchline: level with the
// second-last defender in the half he watches. If the ball is nearer that
// goal than the defenders are, he slides up with the ball instead.
function arTrackX(attackTeam) {
  const A = TEAMS[attackTeam];
  const line = offsideLine(attackTeam);
  const ballD = depthFor(attackTeam, ball);
  let depth = ballD > line + 8 ? ballD : line;
  // Stay in his own half. Do not chase the ball back down the other end.
  const halfway = PITCH.w * 0.5;
  if (depth < halfway - 12) depth = halfway - 12;
  depth = clamp(depth, halfway - 12, PITCH.w - 36);
  return A.ownGoalX + A.dir * depth;
}
function refPlayTarget() {
  // Behind the way play is going, and off to the side. If "behind" would
  // put him in a penalty area (or on the goal line ahead of the ball),
  // he stands toward midfield instead and watches from there.
  const speedX = ball.vx || 0;
  const going = speedX > 70 ? 1 : speedX < -70 ? -1 : (ball.lastTeam === "red" ? -1 : 1);
  let tx = ball.x - going * 8 * METRE;
  const nearGoalLine = tx < PITCH.left + BOX.depth + 28 || tx > PITCH.right - BOX.depth - 28;
  if (nearGoalLine || penaltySide(tx, PITCH.cy, 24)) {
    tx = ball.x + (ball.x < PITCH.cx ? 1 : -1) * 8 * METRE;
  }
  const side = ball.y < PITCH.cy ? 1 : -1;
  // Near a touchline he stays infield, so he is not standing on the ball.
  const sideAmt = Math.abs(ball.y - PITCH.cy) > PITCH.h * 0.3 ? 0.1 : 0.24;
  let ty = PITCH.cy + side * PITCH.h * sideAmt;
  const u = clamp((ball.x - PITCH.left) / PITCH.w, 0, 1);
  const diagY = lerp(PITCH.bottom - PITCH.h * 0.32, PITCH.top + PITCH.h * 0.32, u);
  ty = ty * 0.7 + diagY * 0.3;
  let dx = tx - ball.x, dy = ty - ball.y;
  let distB = Math.hypot(dx, dy) || 1;
  const want = clamp(distB, REF_NEAR, REF_FAR);
  tx = ball.x + (dx / distB) * want;
  ty = ball.y + (dy / distB) * want;
  // Step out of a pack of players, then put the spot back somewhere he can see from.
  let ox = 0, oy = 0, n = 0;
  for (const p of players) {
    const px = tx - p.x, py = ty - p.y;
    const pd = Math.hypot(px, py);
    if (pd < 64 && pd > 0.5) { ox += px / pd; oy += py / pd; n++; }
  }
  if (n) { tx += (ox / n) * 36; ty += (oy / n) * 36; }
  return legalView(tx, ty, REF_NEAR);
}
function refIntent() {
  if (game.cardPopup) {
    const p = roster[game.cardPopup.idx];
    if (p) {
      const side = p.y > PITCH.cy ? -1 : 1;
      const c = clearOfBall(p.x + 28, p.y + side * 26, 36);
      return {
        x: clamp(c.x, PITCH.left + 28, PITCH.right - 28),
        y: clamp(c.y, PITCH.top + 24, PITCH.bottom - 24),
        sig: game.cardPopup.kind === "yellow" ? 3 : 4,
        face: faceToward(p.x - c.x, p.y - c.y, { x: 1, y: 0 }),
        hurry: true,
      };
    }
  }
  if (game.flag) {
    const p = roster[game.flag.idx];
    const A = TEAMS[game.flag.team];
    const tx = p ? p.x - A.dir * 55 : ball.x;
    const ty = p ? p.y : PITCH.cy;
    const c = clearOfBall(tx, ty, 40);
    return {
      x: clamp(c.x, PITCH.left + 36, PITCH.right - 36),
      y: clamp(c.y, PITCH.top + 30, PITCH.bottom - 30),
      sig: officialCueT < 1.15 ? 1 : 2,
      face: p ? faceToward(p.x - c.x, p.y - c.y) : { x: A.dir, y: 0 },
      hurry: true,
    };
  }
  if (game.phase === "goal") {
    const A = TEAMS[game.lastScorer] || TEAMS.blue;
    return { x: PITCH.cx, y: PITCH.cy + 76, sig: 2, face: { x: A.dir, y: 0 }, hurry: false };
  }
  const pending = game.phase === "dead" ? game.pending : null;
  const sp = game.phase === "setpiece" ? game.setpiece : null;
  const pen = game.penalty;
  if (pen && (game.phase === "setpiece" || game.phase === "pkflight" || game.phase === "shootout")) {
    const A = TEAMS[pen.team];
    const x = A.targetGoalX - A.dir * (BOX.depth + 18);
    const y = PITCH.cy + 86;
    return { x, y, sig: officialCueT < 1.2 ? 1 : 2, face: faceToward(A.targetGoalX - x, PITCH.cy - y), hurry: true };
  }
  if (pending) {
    const A = TEAMS[pending.team];
    const c = clearOfBall(pending.x - A.dir * 40, pending.y + (pending.y > PITCH.cy ? -36 : 36), 40);
    let face = { x: A.dir, y: 0 };
    if (pending.type === "penalty") face = faceToward(A.targetGoalX - c.x, PITCH.cy - c.y);
    return {
      x: clamp(c.x, PITCH.left + 30, PITCH.right - 30),
      y: clamp(c.y, PITCH.top + 28, PITCH.bottom - 28),
      sig: officialCueT < 1.25 ? 1 : 2,
      face, hurry: true,
    };
  }
  if (sp) {
    const A = TEAMS[sp.team];
    if (sp.type === "kickoff") {
      return { x: PITCH.cx, y: PITCH.cy + 13 * METRE, sig: officialCueT < 1.2 ? 1 : 0, face: { x: A.dir, y: 0 }, hurry: false };
    }
    const c = clearOfBall(ball.x - A.dir * 48, ball.y + (ball.y > PITCH.cy ? -42 : 42), 44);
    return {
      x: clamp(c.x, PITCH.left + 28, PITCH.right - 28),
      y: clamp(c.y, PITCH.top + 24, PITCH.bottom - 24),
      sig: officialCueT < 1.15 ? 1 : 2,
      face: { x: A.dir, y: 0 },
      hurry: true,
    };
  }
  return {
    x: refSpot.x, y: refSpot.y, sig: 0,
    face: faceToward(ball.x - refSpot.x, ball.y - refSpot.y),
    hurry: false,
  };
}
function arIntent(o) {
  const attack = o.side === "near" ? "blue" : "red";
  const y = o.side === "near" ? AR_NEAR_Y : AR_FAR_Y;
  const facePitch = { x: 0, y: o.side === "near" ? -1 : 1 };
  const spot = arSpotX[o.side === "near" ? 0 : 1];
  if (game.flag && game.flag.team === attack) {
    const p = roster[game.flag.idx];
    return { x: clamp(p ? p.x : spot, PITCH.left + 10, PITCH.right - 10), y, sig: 5, face: facePitch, hurry: false };
  }
  const pending = game.phase === "dead" ? game.pending : null;
  const sp = game.phase === "setpiece" ? game.setpiece : null;
  const restart = sp || pending;
  if (restart && (restart.type === "throw" || restart.type === "corner")) {
    const spotY = sp ? ball.y : restart.y;
    const spotX = sp ? ball.x : restart.x;
    const onMyLine = o.side === "near" ? spotY >= PITCH.cy : spotY < PITCH.cy;
    if (onMyLine) {
      const dir = TEAMS[restart.team].dir;
      return { x: clamp(spotX - dir * 36, PITCH.left + 8, PITCH.right - 8), y, sig: 6, face: { x: dir, y: 0 }, hurry: false };
    }
  }
  const penTeam = (game.penalty && game.penalty.team) || (restart && restart.type === "penalty" ? restart.team : null);
  if (penTeam === attack && (game.phase === "setpiece" || game.phase === "pkflight" || game.phase === "dead" || game.phase === "shootout")) {
    const A = TEAMS[attack];
    return { x: A.targetGoalX - A.dir * 8, y, sig: 0, face: { x: -A.dir, y: 0 }, hurry: true };
  }
  return { x: spot, y, sig: 0, face: facePitch, hurry: false };
}
function stepOfficial(o, want, dt) {
  const dx = want.x - o.x, dy = want.y - o.y;
  const d = Math.hypot(dx, dy);
  const sprint = !!want.hurry || d > 200;
  const speed = want.hurry ? 210 : (d > 110 ? 185 : 155);
  if (d > 3) {
    const ux = dx / d, uy = dy / d;
    const aim = Math.min(speed, d * 4.2);
    const k = Math.min(1, dt * 6);
    o.vx += (ux * aim - o.vx) * k;
    o.vy += (uy * aim - o.vy) * k;
  } else {
    const drag = Math.pow(0.08, dt);
    o.vx *= drag; o.vy *= drag;
  }
  const fromX = o.x, fromY = o.y;
  o.x += o.vx * dt;
  o.y += o.vy * dt;
  if (o.role === "ref") {
    const watching = game.phase === "play" && !game.cardPopup && !game.flag;
    if (watching) {
      // Open play: never inside a penalty area, and never within 11 metres.
      // If a long ball leaves him too far to see it, glide toward the spot.
      const bdNow = Math.hypot(o.x - ball.x, o.y - ball.y);
      if (bdNow > 17 * METRE) {
        const spot = legalView(refSpot.x, refSpot.y, REF_NEAR);
        const pull = Math.min(1, dt * 3.2);
        o.x += (spot.x - o.x) * pull;
        o.y += (spot.y - o.y) * pull;
      }
      // Correct before anyone draws him, so a fast shot cannot land on him.
      const tooClose = Math.hypot(o.x - ball.x, o.y - ball.y) < REF_MIN;
      const boxed = penaltySide(o.x, o.y, 6);
      if (tooClose || boxed) {
        const spot = legalView(refSpot.x, refSpot.y, REF_NEAR);
        const dest = Math.hypot(spot.x - ball.x, spot.y - ball.y) >= REF_MIN - 1
          ? spot : legalView(o.x, o.y, REF_MIN);
        o.x = dest.x;
        o.y = dest.y;
        o.vx = (o.x - fromX) / Math.max(dt, 1 / 120);
        o.vy = (o.y - fromY) / Math.max(dt, 1 / 120);
        const cap = 190;
        const spv = Math.hypot(o.vx, o.vy);
        if (spv > cap) { o.vx *= cap / spv; o.vy *= cap / spv; }
      }
      o.x = clamp(o.x, PITCH.left + 40, PITCH.right - 40);
      o.y = clamp(o.y, PITCH.top + 24, PITCH.bottom - 24);
      if (Math.hypot(o.x - ball.x, o.y - ball.y) < REF_MIN || penaltySide(o.x, o.y, 0)) {
        const again = legalView(o.x, o.y, REF_MIN);
        o.x = again.x;
        o.y = again.y;
      }
    } else {
      const minD = 34;
      const bx = o.x - ball.x, by = o.y - ball.y;
      const bd = Math.hypot(bx, by);
      if (bd < minD && bd > 0.01) {
        o.x += (bx / bd) * (minD - bd);
        o.y += (by / bd) * (minD - bd);
      }
      o.x = clamp(o.x, PITCH.left + 22, PITCH.right - 22);
      o.y = clamp(o.y, PITCH.top + 16, PITCH.bottom - 16);
    }
  } else {
    // Linesmen only ever slide along their own touchline.
    o.y = o.side === "near" ? AR_NEAR_Y : AR_FAR_Y;
    o.vy = 0;
    o.x = clamp(o.x, PITCH.left + 8, PITCH.right - 8);
  }
  const sp = Math.hypot(o.vx, o.vy);
  if (want.face) { o.fx = want.face.x; o.fy = want.face.y; }
  else if (sp > 16) { o.fx = o.vx / sp; o.fy = o.vy / sp; }
  o.sig = want.sig || 0;
  o.anim += sp * dt * 0.09;
}
function updateOfficials(dt) {
  let key = "play";
  if (game.cardPopup) key = "card";
  else if (game.flag) key = "flag";
  else if (game.phase === "goal") key = "goal";
  else if (game.phase === "dead") key = "dead:" + (game.pending && game.pending.type);
  else if (game.phase === "setpiece" && game.setpiece) key = "sp:" + game.setpiece.type;
  else if (game.phase === "pkflight") key = "pk";
  else if (game.phase === "shootout") key = "so";
  if (key !== officialCue) { officialCue = key; officialCueT = 0; }
  else officialCueT += dt;
  // Ease the viewing spots. The people themselves walk toward these,
  // so a quick pass does not yank them onto the ball.
  const view = refPlayTarget();
  const kv = 1 - Math.exp(-dt * 2.8);
  refSpot.x += (view.x - refSpot.x) * kv;
  refSpot.y += (view.y - refSpot.y) * kv;
  // A straight blend can pass through the ball when play switches sides.
  // Park the spot back on the viewing circle before he walks toward it.
  const held = legalView(refSpot.x, refSpot.y, REF_NEAR);
  refSpot.x = held.x;
  refSpot.y = held.y;
  const ka = 1 - Math.exp(-dt * 1.35);
  arSpotX[0] += (arTrackX("blue") - arSpotX[0]) * ka;
  arSpotX[1] += (arTrackX("red") - arSpotX[1]) * ka;
  stepOfficial(officials[0], refIntent(), dt);
  stepOfficial(officials[1], arIntent(officials[1]), dt);
  stepOfficial(officials[2], arIntent(officials[2]), dt);
}

// ---------------------------------------------------------------------
// 19. MAIN UPDATE  (called 120 times a second)
// ---------------------------------------------------------------------
function update(dt) {
  game.time += dt;
  processPresses();
  if (game.comment.timer > 0) game.comment.timer -= dt;
  if (game.cardPopup && (game.cardPopup.timer -= dt) <= 0) game.cardPopup = null;
  if (game.flag && (game.flag.timer -= dt) <= 0) game.flag = null;

  if (game.phase === "setpiece") {
    assignActive("blue", dt); assignActive("red", dt);
    computePlans();
    updatePlayers(dt);
    if (game.phase === "setpiece") {
      const sp = game.setpiece;
      sp.timer -= dt;
      // Computer takers go after a short pause; humans get 7 seconds (12 for penalties)
      if (sp.timer <= 0) aiTakeSetpiece(sp.taker, sp.type);
    }
  } else if (game.phase === "play") {
    game.clock += dt;
    assignActive("blue", dt); assignActive("red", dt);
    computePlans();
    updatePlayers(dt);
    updateBall(dt);
    ballContacts(dt);
    checkOutOfPlay();
    if (game.phase === "play" && game.timeLimit && game.clock >= game.timeLimit) fullTime();
  } else if (game.phase === "dead") {
    game.timer -= dt;
    computePlans();
    updatePlayers(dt);
    updateBall(dt);
    if (game.timer <= 0) {
      const pd = game.pending;
      if (game.timeLimit && game.clock >= game.timeLimit) fullTime();
      else beginSetpiece(pd.type, pd.team, pd.x, pd.y, pd.taker, pd.indirect);
    }
  } else if (game.phase === "goal") {
    game.timer -= dt;
    if (game.celebration) game.celebration.t += dt;
    updatePlayers(dt);
    updateBall(dt);
    if (game.timer <= 0) {
      game.celebration = null;
      // Goals never end the match. Only the clock does (after the celebration).
      if (game.timeLimit && game.clock >= game.timeLimit) fullTime();
      else beginSetpiece("kickoff", other(game.lastScorer), PITCH.cx, PITCH.cy);
    }
  } else if (game.phase === "shootout") {
    game.timer -= dt;
    updatePlayers(dt);
    updateBall(dt);
    if (game.timer <= 0) {
      if (game.shootout.done) endGame(game.shootout.winner);
      else nextShootoutKick();
    }
  } else if (game.phase === "pkflight") {
    updatePkFlight(dt);
  }
  if (game.phase !== "win") updateOfficials(dt);
}


  // ===================================================================
  // API used by the server
  // ===================================================================
  function findController(id) { return controllers.find((c) => c.id === id) || null; }
  function addController(id, name, team) {
    let c = findController(id);
    if (!c) {
      c = { id, name, team, cpu: false, input: { mx: 0, my: 0, sprint: false, shoot: false, pass: false },
            presses: [], active: null, charging: null, held: 0, switchLock: 0 };
      controllers.push(c);
    } else { c.name = name; c.team = team; c.cpu = false; }
    return c;
  }
  function setConnected(id, on) {
    const c = findController(id);
    if (!c) return;
    c.cpu = !on;
    if (!on) {
      c.active = null; c.charging = null; c.presses.length = 0;
      c.input = { mx: 0, my: 0, sprint: false, shoot: false, pass: false };
    }
  }
  function removeController(id) {
    const i = controllers.findIndex((c) => c.id === id);
    if (i >= 0) controllers.splice(i, 1);
  }
  function setInput(id, inp) {
    const c = findController(id);
    if (!c || !inp) return;
    c.input = {
      mx: clamp(Number(inp.mx) || 0, -1, 1), my: clamp(Number(inp.my) || 0, -1, 1),
      sprint: !!inp.sprint, shoot: !!inp.shoot, pass: !!inp.pass,
    };
  }
  function press(id, action) {
    const c = findController(id);
    if (c && ["shoot", "pass", "swap", "skill", "flick", "skip"].includes(action) && c.presses.length < 10) c.presses.push(action);
  }

  // A compact picture of the match, sent to every browser ~30x a second
  const idx = pIndex;   // index into the full roster (sent-off players stay in the list)
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  function snapshot() {
    const c = game.comment;
    return {
      ph: game.phase,
      sc: [game.score.blue, game.score.red],
      cl: r1(game.clock), tm: r2(game.timer),
      cm: c.timer > 0 ? [c.text, c.color, r2(c.timer)] : null,
      sp: game.setpiece ? [game.setpiece.type, game.setpiece.team, idx(game.setpiece.taker), game.setpiece.indirect ? 1 : 0, r2(game.setpiece.throwT || 0)] : null,
      ls: game.lastScorer, w: game.winner,
      p: roster.map((p) => [r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), r2(p.fx), r2(p.fy), STATE_CODES[p.state] || 0, p.fallDir, r2(p.stamina), p.sprinting ? 1 : 0,
                            p.yellow, p.sentOff ? 1 : 0, SKILL_LIST.indexOf(p.skill), r2(Math.max(0, p.skillT)), r2(Math.max(0, p.throwT || 0))]),
      // penalty: [team, taker, keeper, aimY, goalie choice, dive]
      pe: game.penalty ? [game.penalty.team, idx(game.penalty.taker), idx(game.penalty.keeper), r1(game.penalty.aimY), game.penalty.gkChoice, game.penalty.dive] : null,
      so: game.shootout ? [game.shootout.first, game.shootout.kicks.blue.join(""), game.shootout.kicks.red.join(""), game.shootout.sudden ? 1 : 0, game.shootout.done ? 1 : 0, game.shootout.winner] : null,
      ce: game.celebration ? [idx(game.celebration.scorer), game.celebration.type, r2(game.celebration.t)] : null,
      cp: game.cardPopup ? [game.cardPopup.team, game.cardPopup.idx, game.cardPopup.kind, r2(game.cardPopup.timer)] : null,
      fl: game.flag ? [game.flag.team, game.flag.idx, r2(game.flag.timer)] : null,
      b: [r1(ball.x), r1(ball.y), r1(ball.z), r1(ball.vx), r1(ball.vy), idx(ball.owner)],
      // referee, near linesman, far linesman: x y vx vy fx fy signal stride
      of: officials.map((o) => [r1(o.x), r1(o.y), r1(o.vx), r1(o.vy), r2(o.fx), r2(o.fy), o.sig | 0, r1(o.anim)]),
      c: controllers.map((k) => [k.id, game.autoplay ? -1 : idx(k.active), k.charging || 0, r2(k.held), k.cpu || game.autoplay ? 1 : 0]),
      ev: game.events.splice(0),
      st: game.phase === "win" ? game.stats : undefined,
    };
  }
  // Things about players that never change (sent once per match)
  function staticInfo() {
    return roster.map((p) => [p.team, p.role, p.num, p.skin, p.hair, p.name, p.trait || "", p.tall || 1, p.boots || "#111111", p.cut || "short", p.captain ? 1 : 0, p.star ? 1 : 0, p.pos || p.role]);
  }
  // Everything else a browser needs to know about this match
  function matchInfo() {
    return { teams: game.teams, rules: game.rules, timeLimit: game.timeLimit, knockout: game.knockout, matchType: game.matchType };
  }

  // ---------------- debug / test helpers ----------------
  // Make a foul happen right now (inBox = inside a penalty box -> penalty)
  function debugFoul(team = "red", inBox = true, behind = false) {
    if (game.phase !== "play" && game.phase !== "setpiece") return false;
    const A = TEAMS[team];
    const victim = teamPlayers(team).find((p) => p.role === "FWD");
    const offender = teamPlayers(other(team)).find((p) => p.role === "DEF" && p.state === "run") || teamPlayers(other(team)).find((p) => p.role !== "GK");
    if (!victim || !offender) return false;
    game.phase = "play"; game.setpiece = null;
    victim.x = A.targetGoalX - A.dir * (inBox ? 90 : 380); victim.y = PITCH.cy + 40; victim.state = "run";
    victim.fx = A.dir; victim.fy = 0;
    offender.x = victim.x - A.dir * 20; offender.y = victim.y;
    offender.fx = behind ? A.dir : -A.dir; offender.fy = 0;
    offender.vx = A.dir * (behind ? 200 : 100); offender.vy = 0;
    Object.assign(ball, { x: victim.x + A.dir * 14, y: victim.y, z: 0, vx: 0, vy: 0, owner: victim });
    foul(offender, victim);
    return { victim: pIndex(victim), offender: pIndex(offender) };
  }
  // Set up an offside: a forward stands offside and a teammate passes to him
  function debugOffside(team = "blue") {
    const A = TEAMS[team];
    const fwd = teamPlayers(team).find((p) => p.role === "FWD");
    const mid = teamPlayers(team).find((p) => p.role === "MID");
    if (!fwd || !mid) return { offside: [] };
    game.phase = "play"; game.setpiece = null;
    // defenders back at halfway+, forward behind them
    for (const q of teamPlayers(other(team))) {
      if (q.role === "GK") { q.x = A.targetGoalX - A.dir * 20; q.y = PITCH.cy; }
      else { q.x = PITCH.cx + A.dir * 180; q.y = PITCH.cy - 150 + (q.num % 4) * 100; }
      q.vx = q.vy = 0; q.state = "run"; q.controlCD = 2;
    }
    fwd.x = PITCH.cx + A.dir * 420; fwd.y = PITCH.cy; fwd.state = "run"; fwd.vx = fwd.vy = 0;
    mid.x = PITCH.cx - A.dir * 40; mid.y = PITCH.cy; mid.state = "run";
    // Everyone else stays in their own half, so only this forward is offside.
    let slot = 0;
    for (const q of teamPlayers(team)) {
      if (q === fwd || q === mid) continue;
      q.x = A.ownGoalX + A.dir * (80 + (slot % 5) * 70);
      q.y = PITCH.cy - 160 + (slot % 5) * 80;
      q.vx = q.vy = 0; q.state = "run";
      slot++;
    }
    Object.assign(ball, { x: mid.x + A.dir * 14, y: mid.y, z: 0, vx: 0, vy: 0, owner: mid });
    mid.fx = A.dir; mid.fy = 0;
    kickBall(mid, { x: fwd.x - ball.x, y: fwd.y - ball.y }, 700, 0, "pass", fwd);
    return { offside: ball.offside ? ball.offside.players.map(pIndex) : [] };
  }
  // Make a player do a trick (type: stepover | spin | flick | burst)
  function debugSkill(team = "blue", type = "stepover") {
    let p = ball.owner && ball.owner.team === team ? ball.owner : teamPlayers(team).find((q) => q.role !== "GK");
    if (!p) return { ok: false };
    game.phase = "play"; game.setpiece = null;
    p.state = "run"; p.skillCD = 0;
    Object.assign(ball, { x: p.x + p.fx * 14, y: p.y + p.fy * 14, z: 0, vx: 0, vy: 0, owner: p });
    const ok = doSkill(p, type, { x: -p.fy, y: p.fx });
    return { ok, player: pIndex(p), skill: p.skill };
  }

  createPlayers();
  resetToHome();

  return {
    game, ball, controllers,
    get players() { return players; },
    get roster() { return roster; },
    start: startGame, update,
    addController, setConnected, removeController, setInput, press, switchTo,
    snapshot, staticInfo, matchInfo,
    debugFoul, debugOffside, debugSkill,
    debugBoosts(i) { return roster[i] ? boosts(roster[i]) : null; },
    startShootout() { startShootout(); },
    giveCard(i, kind) { if (roster[i] && !roster[i].sentOff) giveCard(roster[i], kind); },
    setAutoplay(on) { game.autoplay = !!on; },
    forceGoal(team) {
      if (game.phase === "setpiece" || game.phase === "play") {
        const sc = teamPlayers(team).find((p) => p.star && p.role !== "GK") || teamPlayers(team).find((p) => p.role === "FWD");
        ball.owner = null; ball.lastTeam = team; ball.lastTouch = sc || ball.lastTouch;
        scoreGoal(team, team === "blue" ? "right" : "left");
      }
    },
  };
}

// Node.js (the server) loads this file with require()
if (typeof module === "object" && module.exports) {
  module.exports = { createSim, MATCH_LENGTH, FIELD, PITCH, DIFFICULTY, TEAMS, STATE_NAMES, SKILL_LIST, SKILL_NAMES,
                     TEAM_LIST, findTeam, customTeam, buildTeamKits, applyTeamKits, DEFAULT_RULES, setPlayAsMeSides };
}
