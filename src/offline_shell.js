/* =====================================================================
   OFFLINE SHELL - menus, keyboard/touch, Cup + Shootout modes
   ---------------------------------------------------------------------
   The match itself runs in createSim() (the GAME LOGIC above - the very
   same code the online server runs). This part:
     A. OFFLINE STATE + SETTINGS (saved in localStorage)
     B. INPUT (keyboard for 1 or 2 players, touch joystick + buttons)
     C. HOOKS the drawing code asks for (names, hints...)
     D. STARTING MATCHES (quick match, cup match, penalty shootout)
     E. MENU + TEAM PICKER
     F. CUP MODE (8-team knockout, bracket, trophy)
     G. WIN / PAUSE SCREENS
     H. MAIN LOOP + DEBUG HOOK (for automated tests)
   ===================================================================== */

// =====================================================================
// A. OFFLINE STATE + SETTINGS
// =====================================================================
const $ = (id) => document.getElementById(id);
let sim = null;                 // the running match (createSim)
let game, players, ball, controllers;   // shortcuts the drawing code uses
let atMenu = true;              // a menu screen is showing (the match is not running)
let paused = false;
let matchKind = "quick";        // what is being played: "quick" | "cup" | "shootout"
let matchStartedAt = 0;         // for the little controls hint

// What the player picked in the menu (saved between visits)
const settings = {
  kind: "quick",                // quick | cup | shootout
  mode: "1p",                   // 1p | 2p
  difficulty: "normal",
  blue: "blue", red: "red",     // team ids (or "custom")
  rules: { offside: true, cards: true },
  minutes: 5,                   // full match. Each half is half of this.
  lengthCustom: false,          // true when the last pick was the Custom stepper
  custom: { name: "My Team", shirt: "#8e44ad", shorts: "#ffffff", socks: "#8e44ad" },
  muted: false,
};
function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem("soccerSettings") || "{}")); } catch (e) { /* ignore */ }
  settings.rules = { ...DEFAULT_RULES, ...(settings.rules || {}) };
  const len = loadSavedMinutes();
  settings.minutes = len.minutes;
  settings.lengthCustom = len.custom;
}
function saveSettings() {
  try { localStorage.setItem("soccerSettings", JSON.stringify(settings)); } catch (e) { /* ignore */ }
  saveSavedMinutes(settings.minutes, settings.lengthCustom);
  if (typeof GameSettings !== "undefined") GameSettings.set("matchLength", settings.minutes, true);
}
function chooseMatchLength(minutes, custom) {
  settings.minutes = clampMatchMinutes(minutes);
  settings.lengthCustom = !!custom;
  saveSettings();
  renderMenu();
}
// A team id -> full team (the custom team is built from your colours)
const teamDef = (id) => (id === "custom" ? customTeam(settings.custom) : findTeam(id) || TEAM_LIST[0]);

const inMatch = () => !!sim && !atMenu && ["setpiece", "play", "dead", "goal", "shootout", "pkflight"].includes(game.phase);
const isTouchDevice = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && matchMedia("(pointer: coarse)").matches);
const touchActive = () => isTouchDevice;
const splitTouch = () => touchActive() && settings.mode === "2p";
const isPortrait = () => {
  const vv = window.visualViewport;
  const w = (vv && vv.width) || window.innerWidth;
  const h = (vv && vv.height) || window.innerHeight;
  return h > w;
};
const controllerOf = (p) => (game.autoplay ? null : controllers.find((c) => !c.cpu && c.active === p) || null);
const isHumanControlled = (p) => !!controllerOf(p);
const updateScreens = () => updateHud();   // the drawing code calls this after a resize

// =====================================================================
// B. INPUT
// =====================================================================
const keys = {};
// Which keys each human uses. 1 player: both key sets work.
function controlScheme(id) {
  const one = settings.mode === "1p";
  if (id === "p1") return {
    up: one ? ["KeyW", "ArrowUp"] : ["KeyW"], down: one ? ["KeyS", "ArrowDown"] : ["KeyS"],
    left: one ? ["KeyA", "ArrowLeft"] : ["KeyA"], right: one ? ["KeyD", "ArrowRight"] : ["KeyD"],
    shoot: ["Space"], pass: ["KeyE"], sprint: one ? ["ShiftLeft", "ShiftRight"] : ["ShiftLeft"], swap: ["KeyQ"],
    skill: ["KeyR"], flick: ["KeyF"],
  };
  return {
    up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
    shoot: ["Enter", "NumpadEnter"], pass: ["ShiftRight"], sprint: ["Slash", "ControlRight"], swap: ["Period"],
    skill: ["Quote"], flick: ["Semicolon"],
  };
}
const humanIds = () => (settings.mode === "2p" ? ["p1", "p2"] : ["p1"]);

window.addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") return;   // typing a team name
  if (inMatch() && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Slash", "Period", "Tab", "Quote"].includes(e.code)) e.preventDefault();
  if (!keys[e.code]) {
    onKeyPressed(e.code);
    if (typeof opt === "function" && opt("sprintMode") === "toggle" && (e.code === "ShiftLeft" || e.code === "ShiftRight")) {
      sprintLatch.p1 = !sprintLatch.p1;
    }
  }
  keys[e.code] = true;
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

function onKeyPressed(code) {
  if (!inMatch()) return;
  if (code === "KeyP" || code === "Escape") { togglePause(); return; }
  if (code === "KeyM") { toggleSound(); return; }
  if (code === "KeyC" || code === "KeyV") { toggleCamera(); return; }
  if (paused) return;
  for (const id of humanIds()) {
    const s = controlScheme(id);
    const codes = s.up.concat(s.down, s.left, s.right, s.shoot, s.pass, s.sprint, s.swap, s.skill, s.flick);
    if (codes.includes(code)) noteFpFollow(id);
  }
  // any key skips a goal celebration
  if (game.phase === "goal") { sim.press("p1", "skip"); return; }
  for (const id of humanIds()) {
    const s = controlScheme(id);
    for (const action of ["shoot", "pass", "swap", "skill", "flick"]) if (s[action].includes(code)) sim.press(id, action);
  }
}
const isDown = (id, action) => {
  if (action === "sprint" && typeof opt === "function" && opt("sprintMode") === "toggle") return !!sprintLatch[id];
  return controlScheme(id)[action].some((c) => keys[c]) || (touchActive() && !!(pads[id] && pads[id][action]));
};

// Read the keys / joystick into the match every frame
function feedInput() {
  for (const id of humanIds()) {
    let mx = 0, my = 0;
    if (isDown(id, "left")) mx -= 1;
    if (isDown(id, "right")) mx += 1;
    if (isDown(id, "up")) my -= 1;
    if (isDown(id, "down")) my += 1;
    const pad = touchActive() ? pads[id] : null;
    if (pad && !mx && !my) { mx = pad.x; my = pad.y; }
    const stick = cameraStick(mx, my);
    sim.setInput(id, { mx: stick.mx, my: stick.my, sprint: isDown(id, "sprint"), shoot: isDown(id, "shoot"), pass: isDown(id, "pass") });
  }
}

// ---- Touch joysticks + buttons (player 2's pad is used in 2 Players) ----
function bindPad(playerId, ids) {
  const zone = $(ids.zone), base = $(ids.base), knob = $(ids.knob);
  const pad = { x: 0, y: 0, pointerId: null, baseX: 0, baseY: 0, shoot: false, pass: false, sprint: false, skill: false };
  if (!zone || !base || !knob) return pad;
  function movePad(e) {
    let dx = e.clientX - pad.baseX, dy = e.clientY - pad.baseY;
    const len = Math.hypot(dx, dy);
    const max = Math.max(36, base.offsetWidth * 0.42);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    const filtered = typeof joyFiltered === "function" ? joyFiltered(dx, dy, max) : { x: dx / max, y: dy / max };
    pad.x = filtered.x; pad.y = filtered.y;
    knob.style.transform = "translate(" + dx + "px," + dy + "px)";
  }
  zone.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    noteFpFollow(playerId);
    if (inMatch() && game.phase === "goal") sim.press(playerId, "skip");
    pad.pointerId = e.pointerId;
    const fixed = typeof opt === "function" && opt("joyMode") === "fixed";
    if (fixed) {
      const r = base.getBoundingClientRect();
      pad.baseX = r.left + r.width / 2; pad.baseY = r.top + r.height / 2;
    } else {
      pad.baseX = e.clientX; pad.baseY = e.clientY;
      base.style.left = (e.clientX - base.offsetWidth / 2) + "px";
      base.style.top = (e.clientY - base.offsetHeight / 2) + "px";
      base.style.right = "auto"; base.style.bottom = "auto";
    }
    try { zone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    movePad(e);
  });
  zone.addEventListener("pointermove", (e) => { if (e.pointerId === pad.pointerId) movePad(e); });
  function release(e) {
    if (e.pointerId !== pad.pointerId) return;
    pad.pointerId = null; pad.x = 0; pad.y = 0; knob.style.transform = "";
    // Put the stick back in its corner. Leaving it under the finger
    // can park half of it off the bottom of a phone.
    base.style.left = ""; base.style.top = ""; base.style.right = ""; base.style.bottom = "";
  }
  zone.addEventListener("pointerup", release);
  zone.addEventListener("pointercancel", release);
  for (const [id, action] of [[ids.shoot, "shoot"], [ids.pass, "pass"], [ids.sprint, "sprint"], [ids.skill, "skill"]]) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (action === "sprint" && typeof opt === "function" && opt("sprintMode") === "toggle") {
        sprintLatch[playerId] = !sprintLatch[playerId];
        el.classList.toggle("pressed", !!sprintLatch[playerId]);
        return;
      }
      pad[action] = true; el.classList.add("pressed");
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (inMatch() && !paused) {
        noteFpFollow(playerId);
        if (game.phase === "goal") sim.press(playerId, "skip");
        else if (action !== "sprint") sim.press(playerId, action);
      }
    });
    const up = () => { pad[action] = false; el.classList.remove("pressed"); };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
  return pad;
}
const sprintLatch = { p1: false, p2: false };
const pads = {
  p1: bindPad("p1", { zone: "joyZone", base: "joyBase", knob: "joyKnob", shoot: "shootBtn", pass: "passBtn", sprint: "sprintBtn", skill: "skillBtn" }),
  p2: bindPad("p2", { zone: "joyZone2", base: "joyBase2", knob: "joyKnob2", shoot: "shootBtn2", pass: "passBtn2", sprint: "sprintBtn2", skill: "skillBtn2" }),
};
// A short tap on a teammate switches to him. The joystick and buttons
// sit on top of the picture, so a touch there never counts as a tap.
(function bindPitchTap() {
  const el = $("game");
  let down = null;
  el.addEventListener("pointerdown", (e) => {
    if (inMatch() && game.phase === "goal") sim.press("p1", "skip");
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  });
  el.addEventListener("pointerup", (e) => {
    if (!down || e.pointerId !== down.id) return;
    const start = down;
    down = null;
    if (!touchActive() || !inMatch() || paused || game.phase !== "play") return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 18) return;
    if (performance.now() - start.t > 400) return;
    const team = settings.mode === "2p" ? (start.x < window.innerWidth / 2 ? "blue" : "red") : "blue";
    const id = settings.mode === "2p" ? (team === "blue" ? "p1" : "p2") : "p1";
    const p = playerAtScreen(start.x, start.y, team);
    if (!p) return;
    const idx = sim.roster.indexOf(p);
    if (idx >= 0 && sim.switchTo(id, idx)) noteFpFollow(id);
  });
  el.addEventListener("pointercancel", () => { down = null; });
})();
// Phones only start sound after a tap. The first tap anywhere unlocks it.
window.addEventListener("pointerdown", () => Sound.init());

// =====================================================================
// C. HOOKS FOR THE DRAWING CODE
// =====================================================================
const isLocal = () => true;                       // every human here is on this device
const labelFor = (c) => (settings.mode === "1p" ? "YOU" : c.id === "p1" ? "P1" : "P2");
// Private names typed on this device. Online matches keep the squad list.
function localRename(p) {
  if (!p || p.me || typeof renameFor !== "function") return "";
  const id = (TEAMS[p.team] && TEAMS[p.team].id) || "";
  return renameFor(id, p.num);
}
const showHud = () => !!sim && !atMenu || (!!sim && game.phase === "win");
const localActives = () => controllers.filter((c) => !c.cpu && c.active && !game.autoplay).map((c) => c.active);
const rosterList = () => (sim ? sim.roster : []);
function hudSubtitle() {
  const kindText = matchKind === "cup" ? "CUP " + CUP_ROUND_NAMES[cup ? cup.round : 0] + ": " : "";
  if (game.matchType === "shootout") return "Penalty shootout \u2022 5 kicks each, then sudden death";
  const info = describeMatchLength((game.timeLimit || MATCH_LENGTH) / 60);
  const half = game.timeLimit && game.clock >= game.timeLimit / 2 ? "2nd half" : "1st half";
  const who = settings.mode === "1p" ? "1P vs CPU (" + game.difficulty + ")" : "2 Players";
  const draw = game.knockout ? " \u2022 draw = penalties" : "";
  return info.minutes + " min \u2022 " + half + draw + "  \u2022  " + kindText + who;
}
function keysHint(kind) {
  const t = touchActive();
  const two = settings.mode === "2p";
  if (kind === "skip") return t ? "Tap to skip" : "Press any key to skip";
  if (kind === "throw") return t ? "aim with the joystick, tap PASS to throw" : two ? "aim, then pass to throw" : "aim, then E to throw";
  if (kind === "setpiece") return t ? "aim with the joystick, tap PASS or SHOOT" : two ? "aim, then pass or shoot" : "aim, then E = pass (hold to lob), Space = shoot";
  if (kind === "penTaker") return t ? "joystick up/down = aim, hold SHOOT = power" : two ? "up/down = aim, hold shoot = power" : "W/S or \u2191/\u2193 = aim, hold Space = power (too much = over the bar!)";
  if (kind === "penKeeper") return t ? "push the joystick up or down to pick a side" : "press up or down to pick your dive (left/right = stay)";
  return "";
}

// =====================================================================
// D. STARTING MATCHES
// =====================================================================
// Build a new match. opts: {kind, blue, red (team defs), knockout, matchType}
// The menu's match length is the full game. Each half is half of that.
// A cup match sends a draw to penalties.
// Your player is on every team you control. If both sides are the same
// squad in a 2-player game, only the left team gets him.
function applyPlayAsMeSides(blue, red) {
  if (typeof setPlayAsMeSides !== "function") return;
  const me = typeof loadPlayAsMe === "function" ? loadPlayAsMe() : { on: false };
  if (!me.on) { setPlayAsMeSides({}); return; }
  const same = blue && red && blue.id && blue.id === red.id;
  if (settings.mode === "2p" && !same) setPlayAsMeSides({ blue: true, red: true });
  else setPlayAsMeSides({ blue: true });
}
function newMatch(opts) {
  applyPlayAsMeSides(opts.blue, opts.red);
  const kits = buildTeamKits(opts.blue, opts.red);
  applyTeamKits(kits);
  renderBackground();         // the fans in the stands wear the new colours
  sim = createSim({
    mode: settings.mode === "2p" ? "2 players" : "1 player", difficulty: settings.difficulty, teams: kits,
    rules: settings.rules, knockout: opts.knockout, matchType: opts.matchType,
    minutes: settings.minutes,
  });
  game = sim.game; ball = sim.ball; controllers = sim.controllers; players = sim.players;
  sim.addController("p1", "P1", "blue");
  if (settings.mode === "2p") sim.addController("p2", "P2", "red");
  matchKind = opts.kind;
  confetti.length = 0;        // no confetti left over from the last match
  sim.start();
  players = sim.players;
  atMenu = false; paused = false; matchStartedAt = performance.now();
  Sound.init(); Sound.setMuted(settings.muted);
  showScreen(null);
  updateCamera(0, true);
}
function startQuickMatch() {
  newMatch({ kind: "quick", blue: teamDef(settings.blue), red: teamDef(settings.red) });
}
function startShootoutMatch() {
  newMatch({ kind: "shootout", blue: teamDef(settings.blue), red: teamDef(settings.red), matchType: "shootout" });
}
function startFromMenu() {
  saveSettings();
  if (settings.kind === "cup") { newCup(); return; }
  if (settings.kind === "shootout") startShootoutMatch(); else startQuickMatch();
}
// An idle match so the stadium can be drawn behind the menu
function idleSim() {
  applyPlayAsMeSides(teamDef(settings.blue), teamDef(settings.red));
  const kits = buildTeamKits(teamDef(settings.blue), teamDef(settings.red));
  applyTeamKits(kits); renderBackground();
  sim = createSim({ teams: kits });
  game = sim.game; ball = sim.ball; controllers = sim.controllers; players = sim.players;
  game.phase = "menu";
}

// =====================================================================
// E. MENU + TEAM PICKER
// =====================================================================
const SCREENS = ["menu", "pauseScreen", "winScreen", "teamPicker", "cupScreen", "trophyScreen"];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle("hidden", s !== id);
  updateHud();
}
function updateHud() {
  const playing = inMatch() && !paused;
  paintTrophyBadge();
  $("pauseBtn").classList.toggle("hidden", !playing);
  $("pauseBtn").title = isTouchDevice ? "Pause" : "Pause (P / Esc)";
  const controls = $("touchControls");
  const touchOn = playing && touchActive();
  controls.classList.toggle("hidden", !touchOn);
  const view = $("viewBtn");
  if (view) view.classList.toggle("hidden", !playing);
  syncViewBtn();
  controls.classList.toggle("split", touchOn && splitTouch());
  const portrait = isPortrait();
  const hint = $("rotateHint");
  hint.classList.toggle("hidden", !(isTouchDevice && portrait));
  if (isTouchDevice && portrait) {
    hint.textContent = settings.mode === "2p"
      ? "Two players fit best sideways — turn the phone"
      : "Turn your phone sideways — it's easier to play";
  }
  $("keysHint").classList.toggle("hidden", !(playing && !touchActive() && performance.now() - matchStartedAt < 14000));
}
function goToMenu() {
  atMenu = true; paused = false;
  idleSim();
  renderMenu();
  showScreen("menu");
}

// Small coloured kit picture (shirt / shorts / socks)
function kitHtml(cols, size = 26) {
  return "<span class='kit' style='width:" + size + "px'>" +
    "<i style='background:" + cols[0] + ";height:" + size * 0.5 + "px'></i>" +
    "<i style='background:" + cols[1] + ";height:" + size * 0.25 + "px;width:70%'></i>" +
    "<i style='background:" + cols[2] + ";height:" + size * 0.2 + "px;width:55%'></i></span>";
}
const stars = (n) => "\u2605".repeat(n) + "<span class='dim'>" + "\u2605".repeat(5 - n) + "</span>";
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function renderMenu() {
  document.querySelectorAll("[data-kind]").forEach((b) => b.classList.toggle("selected", b.dataset.kind === settings.kind));
  document.querySelectorAll("[data-mode]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.mode === settings.mode);
    b.disabled = settings.kind === "cup" && b.dataset.mode === "2p";
  });
  document.querySelectorAll("[data-diff]").forEach((b) => b.classList.toggle("selected", b.dataset.diff === settings.difficulty));
  $("diffRow").style.opacity = settings.mode === "1p" ? "1" : "0.4";
  $("ruleOffside").checked = !!settings.rules.offside;
  $("ruleCards").checked = !!settings.rules.cards;
  $("rulesRow").style.display = settings.kind === "shootout" ? "none" : "";
  const len = describeMatchLength(settings.minutes);
  const custom = !!settings.lengthCustom;
  $("lengthRow").classList.toggle("hidden", settings.kind === "shootout");
  document.querySelectorAll("[data-mins]").forEach((b) => {
    const v = b.dataset.mins;
    const on = v === "custom" ? custom : (!custom && Number(v) === len.minutes);
    b.classList.toggle("selected", on);
  });
  $("lenStep").classList.toggle("hidden", !custom || settings.kind === "shootout");
  if (document.activeElement !== $("minsInput")) $("minsInput").value = String(len.minutes);
  $("lengthLine").textContent = len.sentence;
  // team cards + the kits they will actually wear (away kit on a clash)
  const B = teamDef(settings.blue), R = teamDef(settings.red);
  const kits = buildTeamKits(B, R);
  const rateHtml = (T, k) => (typeof teamShows100 === "function" && teamShows100(T.id)) ? "<span class='ovr'>\u2605 100</span>" : "<span class='stars'>" + stars(k.rating) + "</span>";
  const card = (side, T, k) => flagHtml(T, 26, { wave: true }) + "<span class='teamMeta'><b>" + esc(T.name) + "</b> <span class='code'>" + T.short + "</span>" + (k.formation ? " <span class='code'>" + esc(k.formation) + "</span>" : "") + "<br>" + rateHtml(T, k) + (k.away ? " <span class='away'>away kit</span>" : "") + "</span>";
  $("blueTeamBtn").innerHTML = "<span class='who'>" + (settings.mode === "2p" ? "P1" : "YOU") + "</span>" + card("blue", B, kits.blue);
  $("redTeamBtn").innerHTML = "<span class='who'>" + (settings.mode === "2p" ? "P2" : settings.kind === "cup" ? "CUP" : "CPU") + "</span>" + (settings.kind === "cup" ? "<b>7 random teams</b><br><span class='stars'>knockout</span>" : card("red", R, kits.red));
  $("redTeamBtn").disabled = settings.kind === "cup";
  const minsWord = len.minutes + (len.minutes === 1 ? " minute" : " minutes");
  const fmt = { quick: "Quick match \u2022 11-a-side \u2022 " + len.game + " \u2022 " + len.halves + " \u2022 most goals wins",
                cup: "Cup \u2022 8 teams, knockout \u2022 every match is " + minsWord + " \u2022 " + len.halves + " \u2022 a draw goes to penalties",
                shootout: "Penalty shootout \u2022 5 kicks each, then sudden death" }[settings.kind];
  $("formatLine").textContent = fmt;
  $("startBtn").textContent = settings.kind === "cup" ? "START NEW CUP" : settings.kind === "shootout" ? "TAKE PENALTIES" : "KICK OFF";
  const saved = loadCup();
  if (!cup && saved && saved.over && saved.champion === 0) {
    rememberCupWin(saved);
    try { localStorage.setItem("soccerCup", JSON.stringify(saved)); } catch (e) { /* ignore */ }
  }
  paintTrophyBadge();
  $("continueCupBtn").classList.toggle("hidden", !(saved && !saved.over));
  if (saved && !saved.over) $("continueCupBtn").textContent = "Continue cup: " + esc(saved.teams[0].name) + " (" + CUP_ROUND_NAMES[saved.round] + ")";
  updateControlsHelp();
}
function updateControlsHelp() {
  const help = $("controlsHelp");
  if (isTouchDevice && settings.mode === "1p") {
    help.innerHTML =
      "<b>You attack the goal on the right.</b><br>" +
      "Left thumb moves. <b>SHOOT</b> kicks (hold for a bigger kick). <b>PASS</b> passes (hold to lob).<br>" +
      "<b>RUN</b> sprints. <b>SKILL</b> does a trick. The pause button is in the top corner.<br>" +
      "Tap a teammate to control him. <b>TV</b> / <b>1ST</b> changes the camera.<br>" +
      "Penalty: slide the stick up or down, then hold SHOOT. In goal: slide up or down.";
  } else if (isTouchDevice) {
    help.innerHTML =
      "<b>Two players, one phone.</b> Hold it sideways.<br>" +
      "<b style='color:#9cc4ff'>P1</b> uses the left stick and the left SHOOT, PASS, RUN and SKILL buttons.<br>" +
      "<b style='color:#ffb0b0'>P2</b> uses the right stick and the right buttons.<br>" +
      "Tap your own players to control them. <b>TV</b> / <b>1ST</b> changes the camera.<br>" +
      "Hold SHOOT for a bigger kick. Tap the pause button in the top corner to pause.";
  } else if (settings.mode === "1p") {
    help.innerHTML =
      "<b>You attack the goal on the right</b><br>" +
      "Move <kbd>WASD</kbd>/<kbd>Arrows</kbd> &nbsp; Sprint <kbd>Shift</kbd> &nbsp; Switch <kbd>Q</kbd> &nbsp; Camera <kbd>C</kbd><br>" +
      "<kbd>Space</kbd> shoot (hold = power) &bull; no ball: slide tackle<br>" +
      "<kbd>E</kbd> pass (hold = lob) &bull; no ball: switch player<br>" +
      "<kbd>R</kbd> skill move (push sideways = spin, back = flick, +Shift = burst) &nbsp; <kbd>F</kbd> rainbow flick<br>" +
      "Penalty: <kbd>&uarr;</kbd>/<kbd>&darr;</kbd> aim, hold <kbd>Space</kbd> &bull; in goal: <kbd>&uarr;</kbd>/<kbd>&darr;</kbd> pick a side<br>" +
      "<kbd>P</kbd> pause &nbsp; <kbd>M</kbd> sound";
  } else {
    help.innerHTML =
      "<b style='color:#9cc4ff'>P1</b>: <kbd>WASD</kbd> move, <kbd>L-Shift</kbd> sprint, <kbd>Space</kbd> shoot, <kbd>E</kbd> pass, <kbd>Q</kbd> switch, <kbd>R</kbd> skill, <kbd>F</kbd> flick, <kbd>C</kbd> camera<br>" +
      "<b style='color:#ffb0b0'>P2</b>: <kbd>Arrows</kbd> move, <kbd>/</kbd> sprint, <kbd>Enter</kbd> shoot, <kbd>R-Shift</kbd> pass, <kbd>.</kbd> switch, <kbd>'</kbd> skill, <kbd>;</kbd> flick<br>" +
      "Hold shoot for power, hold pass to lob &nbsp; <kbd>P</kbd> pause &nbsp; <kbd>M</kbd> sound";
  }
  $("pauseHelp").innerHTML = help.innerHTML;
}

document.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
  settings.kind = b.dataset.kind;
  if (settings.kind === "cup") settings.mode = "1p";
  renderMenu();
}));
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { settings.mode = b.dataset.mode; renderMenu(); }));
document.querySelectorAll("[data-diff]").forEach((b) => b.addEventListener("click", () => {
  settings.difficulty = b.dataset.diff;
  if (typeof GameSettings !== "undefined") GameSettings.set("difficulty", b.dataset.diff, true);
  renderMenu();
}));
$("ruleOffside").addEventListener("change", (e) => {
  settings.rules.offside = e.target.checked; saveSettings();
  if (typeof GameSettings !== "undefined") GameSettings.set("offside", e.target.checked, true);
});
$("ruleCards").addEventListener("change", (e) => {
  settings.rules.cards = e.target.checked; saveSettings();
  if (typeof GameSettings !== "undefined") GameSettings.set("cards", e.target.checked, true);
});
document.querySelectorAll("[data-mins]").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.mins === "custom") chooseMatchLength($("minsInput").value || settings.minutes, true);
  else chooseMatchLength(Number(b.dataset.mins), false);
}));
function stepMinutes(delta) {
  chooseMatchLength(clampMatchMinutes(Number($("minsInput").value) + delta), true);
}
$("minsDown").addEventListener("click", () => stepMinutes(-1));
$("minsUp").addEventListener("click", () => stepMinutes(1));
$("minsInput").addEventListener("input", () => {
  const raw = $("minsInput").value;
  if (raw === "" || raw === "-") return;
  const n = Number(raw);
  if (!isFinite(n)) return;
  settings.minutes = clampMatchMinutes(n);
  settings.lengthCustom = true;
  saveSettings();
  renderMenu();
});
$("minsInput").addEventListener("change", () => chooseMatchLength($("minsInput").value, true));

// ---- Team picker ----
let pickingFor = "blue";
function openTeamPicker(side) {
  pickingFor = side;
  $("pickTitle").textContent = "Pick a team for " + (side === "blue" ? (settings.mode === "2p" ? "Player 1" : "you") : settings.mode === "2p" ? "Player 2" : "the computer");
  const cur = settings[side];
  let html = "";
  for (const T of TEAM_LIST) {
    html += "<button class='teamTile" + (T.id === cur ? " selected" : "") + "' data-team='" + T.id + "'>" + flagHtml(T, 32, { wave: true }) +
      "<span class='kitRow'>" + kitHtml(T.home, 18) + kitHtml(T.away, 14) + "</span>" +
      "<span class='teamName'><b>" + esc(T.name) + "</b> <span class='code'>" + T.short + "</span></span>" + (typeof teamRatingHtml === "function" ? teamRatingHtml(T) : "<span class='stars'>" + stars(T.rating) + "</span>") + "</button>";
  }
  const C = customTeam(settings.custom);
  html += "<button class='teamTile custom" + (cur === "custom" ? " selected" : "") + "' data-team='custom'>" + flagHtml(C, 32, { wave: true }) +
    "<span class='kitRow'>" + kitHtml(C.home, 18) + "</span><span class='teamName'><b>" + esc(C.name) + "</b> <span class='code'>" + C.short + "</span></span><span class='stars'>Custom</span></button>";
  $("teamGrid").innerHTML = html;
  $("customName").value = settings.custom.name;
  $("customShirt").value = settings.custom.shirt; $("customShorts").value = settings.custom.shorts; $("customSocks").value = settings.custom.socks;
  $("teamGrid").querySelectorAll("[data-team]").forEach((b) => b.addEventListener("click", () => pickTeam(b.dataset.team)));
  showScreen("teamPicker");
}
function pickTeam(id) {
  settings[pickingFor] = id;
  saveSettings(); renderMenu(); showScreen("menu");
}
function saveCustom() {
  settings.custom = { name: $("customName").value.trim() || "My Team", shirt: $("customShirt").value, shorts: $("customShorts").value, socks: $("customSocks").value };
  pickTeam("custom");
}
$("blueTeamBtn").addEventListener("click", () => openTeamPicker("blue"));
$("redTeamBtn").addEventListener("click", () => openTeamPicker("red"));
$("customSaveBtn").addEventListener("click", saveCustom);
$("randomTeamBtn").addEventListener("click", () => pickTeam(TEAM_LIST[Math.floor(Math.random() * TEAM_LIST.length)].id));
$("pickBackBtn").addEventListener("click", () => showScreen("menu"));
$("startBtn").addEventListener("click", startFromMenu);
$("continueCupBtn").addEventListener("click", () => { cup = loadCup(); if (cup) showCup(); });

// =====================================================================
// F. CUP MODE  (8 teams: quarter-finals, semi-finals, final)
// =====================================================================
const CUP_ROUND_NAMES = ["Quarter-final", "Semi-final", "Final"];
let cup = null;
function loadCup() { try { return JSON.parse(localStorage.getItem("soccerCup") || "null"); } catch (e) { return null; } }
function saveCup() {
  try {
    if (!cup) localStorage.removeItem("soccerCup");
    else {
      rememberCupWin(cup);
      localStorage.setItem("soccerCup", JSON.stringify(cup));
    }
  } catch (e) { /* ignore */ }
  paintTrophyBadge();
}
const TROPHY_KEY = "soccerTrophies";
function newCupId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function loadTrophies() {
  try {
    const raw = JSON.parse(localStorage.getItem(TROPHY_KEY) || "null");
    if (raw && Array.isArray(raw.wins)) return raw;
  } catch (e) { /* ignore */ }
  return { wins: [] };
}
function saveTrophies(book) {
  try { localStorage.setItem(TROPHY_KEY, JSON.stringify(book)); } catch (e) { /* ignore */ }
}
function trophyTotal(book) {
  return (book && book.wins && book.wins.length) || 0;
}
function trophyTeams(book) {
  const map = {};
  (book.wins || []).forEach((w) => {
    if (!w) return;
    const id = w.teamId || "team";
    if (!map[id]) map[id] = { id: id, name: w.name || "Team", n: 0 };
    map[id].n += 1;
    if (w.name) map[id].name = w.name;
  });
  return Object.keys(map).map((id) => map[id]).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}
// One entry per cup whose final the player actually won. Sending a team
// to the final does not count; winning that final does. Undo removes it.
function rememberCupWin(c) {
  if (!c || !c.teams || !c.teams[0]) return false;
  if (!c.id) c.id = newCupId();
  const book = loadTrophies();
  const won = !!(c.over && c.champion === 0);
  const i = book.wins.findIndex((w) => w && w.id === c.id);
  const team = c.teams[0];
  if (won && i < 0) {
    book.wins.push({ id: c.id, teamId: team.id, name: team.name });
    saveTrophies(book);
    return true;
  }
  if (!won && i >= 0) {
    book.wins.splice(i, 1);
    saveTrophies(book);
  }
  return false;
}
const cupUndo = [];
function rememberCup() {
  try {
    cupUndo.push(cup ? JSON.parse(JSON.stringify(cup)) : null);
    if (cupUndo.length > 25) cupUndo.shift();
  } catch (e) { /* ignore */ }
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// A new cup: your team + 7 random others. teams[0] is always you.
function newCup() {
  rememberCup();
  const mine = teamDef(settings.blue);
  const others = shuffle(TEAM_LIST.filter((t) => t.id !== mine.id)).slice(0, 7);
  const teams = [mine, ...others];
  const order = shuffle([1, 2, 3, 4, 5, 6, 7]);
  order.splice(Math.floor(Math.random() * 4) * 2, 0, 0);   // you go somewhere in the draw
  const qf = [];
  for (let i = 0; i < 8; i += 2) qf.push({ a: order[i], b: order[i + 1], sa: null, sb: null, pens: null, winner: null });
  cup = { id: newCupId(), teams, rounds: [qf, [], []], round: 0, over: false, champion: null, out: false, difficulty: settings.difficulty };
  saveCup();
  showCup();
}
const myCupMatch = () => (cup && cup.rounds[cup.round] && cup.rounds[cup.round].find((m) => m.a === 0 || m.b === 0)) || null;

// Results of computer vs computer matches (better rating = better chance)
function simulateCupMatch(m) {
  const rank = (t) => (typeof teamShows100 === "function" && teamShows100(t.id)) ? 9 : (t.rating || 3);
  const ra = rank(cup.teams[m.a]), rb = rank(cup.teams[m.b]);
  const goals = (r, o) => { let g = 0; for (let i = 0; i < 8; i++) if (Math.random() < 0.22 + 0.05 * (r - o)) g++; return g; };
  m.sa = goals(ra, rb); m.sb = goals(rb, ra);
  if (m.sa === m.sb) {
    // penalties!
    let pa = 0, pb = 0;
    for (let i = 0; i < 5; i++) { if (Math.random() < 0.75) pa++; if (Math.random() < 0.75) pb++; }
    while (pa === pb) { if (Math.random() < 0.75) pa++; if (Math.random() < 0.75) pb++; }
    m.pens = [pa, pb];
  }
  m.winner = m.sa > m.sb || (m.pens && m.pens[0] > m.pens[1]) ? m.a : m.b;
}
// Finish the current round: play the other matches, draw the next round
function finishCupRound() {
  for (const m of cup.rounds[cup.round]) if (m.winner === null) simulateCupMatch(m);
  const winners = cup.rounds[cup.round].map((m) => m.winner);
  if (cup.round === 2) { cup.over = true; cup.champion = winners[0]; }
  else {
    cup.round++;
    cup.rounds[cup.round] = [];
    for (let i = 0; i < winners.length; i += 2) cup.rounds[cup.round].push({ a: winners[i], b: winners[i + 1], sa: null, sb: null, pens: null, winner: null });
  }
  if (cup.out && !cup.over) finishCupRound();   // you're out: the cup plays on without you
}
function playCupMatch() {
  const m = myCupMatch();
  if (!m) return;
  const oppIdx = m.a === 0 ? m.b : m.a;
  settings.difficulty = cup.difficulty || settings.difficulty; settings.mode = "1p";
  newMatch({ kind: "cup", blue: cup.teams[0], red: cup.teams[oppIdx], knockout: true });
}
// Called when your cup match ends
function recordCupResult() {
  const m = myCupMatch();
  if (!m) return;
  const meA = m.a === 0;
  const so = game.shootout;
  m.sa = meA ? game.score.blue : game.score.red; m.sb = meA ? game.score.red : game.score.blue;
  if (so) {
    const pb = so.kicks.blue.reduce((x, y) => x + y, 0), pr = so.kicks.red.reduce((x, y) => x + y, 0);
    m.pens = meA ? [pb, pr] : [pr, pb];
  }
  const iWon = game.winner === "blue";
  m.winner = iWon ? 0 : meA ? m.b : m.a;
  if (!iWon) cup.out = true;
  finishCupRound();
  saveCup();
}

function matchLine(m) {
  if (m.a === undefined || m.a === null) return "<div class='cm tbd'>?</div>";
  const T = (i) => cup.teams[i];
  const row = (i, s, pen) => "<div class='ct" + (m.winner === i ? " won" : m.winner !== null ? " lost" : "") + (i === 0 ? " me" : "") + "'>" +
    flagHtml(T(i), 18) + "<span class='nm'>" + esc(T(i).name) + ((typeof teamShows100 === "function" && teamShows100(T(i).id)) ? " <span class='ovr'>\u2605 100</span>" : "") + "</span><span class='sc'>" + (s === null ? "" : s) + (pen !== null && pen !== undefined ? " <small>(" + pen + ")</small>" : "") + "</span></div>";
  return "<div class='cm" + (m.a === 0 || m.b === 0 ? " mine" : "") + "'>" + row(m.a, m.sa, m.pens && m.pens[0]) + row(m.b, m.sb, m.pens && m.pens[1]) + "</div>";
}
function showCup() {
  atMenu = true; paused = false;
  let html = "";
  for (let r = 0; r < 3; r++) {
    const list = cup.rounds[r].length ? cup.rounds[r] : new Array(4 >> r).fill({});
    html += "<div class='col'><div class='label'>" + CUP_ROUND_NAMES[r] + "</div>" + list.map(matchLine).join("") + "</div>";
  }
  $("bracket").innerHTML = html;
  const cupLen = describeMatchLength(settings.minutes);
  const cupWord = cupLen.minutes + (cupLen.minutes === 1 ? " minute" : " minutes");
  $("cupFormat").textContent = "Each match is " + cupWord + " \u2022 " + cupLen.halves + " \u2022 most goals wins \u2022 a draw goes to a penalty shootout";
  const m = cup.over ? null : myCupMatch();
  let status;
  if (cup.over) status = cup.champion === 0 ? "\ud83c\udfc6 You won the cup!" : esc(cup.teams[cup.champion].name) + " won the cup." + (cup.out ? " You were knocked out - try again!" : "");
  else if (m) { const opp = cup.teams[m.a === 0 ? m.b : m.a]; status = CUP_ROUND_NAMES[cup.round] + ": " + esc(cup.teams[0].name) + " vs " + esc(opp.name); }
  else status = "";
  $("cupStatus").innerHTML = status;
  $("cupPlayBtn").classList.toggle("hidden", !m);
  if (m) $("cupPlayBtn").textContent = "PLAY " + CUP_ROUND_NAMES[cup.round].toUpperCase();
  $("cupTrophyBtn").classList.toggle("hidden", !(cup.over && cup.champion === 0));
  $("cupNewBtn").classList.toggle("hidden", !cup.over);
  showScreen("cupScreen");
}
$("cupPlayBtn").addEventListener("click", playCupMatch);
$("cupMenuBtn").addEventListener("click", goToMenu);
$("cupNewBtn").addEventListener("click", newCup);
$("cupTrophyBtn").addEventListener("click", showTrophy);
$("trophyMenuBtn").addEventListener("click", goToMenu);
$("trophyCupBtn").addEventListener("click", () => showCup());

// Helpers for the hidden panel. Every change is one undo step, saved on this device.
function blankTie(a, b) {
  return { a: a, b: b, sa: null, sb: null, pens: null, winner: null };
}
function resolveCupTeam(id) {
  if (!id) return null;
  if (id === "custom" && typeof customTeam === "function" && typeof settings !== "undefined") return customTeam(settings.custom);
  return (typeof findTeam === "function" && findTeam(id)) || null;
}
function cupStrength(idx) {
  const t = cup.teams[idx];
  if (!t) return 0;
  if (typeof teamShows100 === "function" && teamShows100(t.id)) return 9;
  return t.rating || 3;
}
function favored(i, j) {
  const d = cupStrength(i) - cupStrength(j);
  if (d !== 0) return d > 0 ? i : j;
  return i < j ? i : j;
}
function award(m, winner) {
  m.winner = winner;
  const home = winner === m.a;
  m.sa = home ? 2 : 0;
  m.sb = home ? 0 : 2;
  m.pens = null;
}
function cupIds(extra) {
  const ids = [];
  const add = (id) => { if (id && ids.indexOf(id) < 0 && resolveCupTeam(id)) ids.push(id); };
  (extra || []).forEach(add);
  if (cup && cup.teams) cup.teams.forEach((t) => add(t.id));
  if (typeof settings !== "undefined" && settings.blue) add(settings.blue);
  if (typeof TEAM_LIST !== "undefined") TEAM_LIST.forEach((t) => add(t.id));
  return ids.slice(0, 8).map((id) => resolveCupTeam(id));
}
function freshCup(teams) {
  return {
    id: newCupId(), teams: teams, rounds: [[], [], []], round: 0, over: false, champion: null, out: false,
    difficulty: (typeof settings !== "undefined" && settings.difficulty) || "normal",
  };
}
function playerAlive() {
  if (!cup) return false;
  if (cup.over) return cup.champion === 0;
  for (let r = 0; r < 3; r++) {
    for (const m of cup.rounds[r] || []) {
      if ((m.a === 0 || m.b === 0) && m.winner == null) return true;
    }
  }
  return false;
}
function syncCupProgress() {
  cup.over = false;
  cup.champion = null;
  let open = -1;
  for (let r = 0; r < 3; r++) {
    const list = cup.rounds[r] || [];
    if (!list.length || list.some((m) => m.winner == null)) {
      open = list.length ? r : Math.max(0, r - 1);
      break;
    }
  }
  if (open < 0) {
    cup.round = 2;
    cup.over = true;
    cup.champion = cup.rounds[2][0] ? cup.rounds[2][0].winner : null;
  } else cup.round = open;
  cup.out = !playerAlive();
}
function cupRefresh() {
  const won = cup ? rememberCupWin(cup) : false;
  saveCup();
  if (won) { showTrophy(); return; }
  if (cup && typeof showCup === "function") showCup();
  else {
    if (typeof renderMenu === "function") renderMenu();
    if (typeof showScreen === "function") showScreen("menu");
  }
}
function takeSlot(used) {
  for (let i = 0; i < cup.teams.length; i++) if (!used[i]) { used[i] = true; return i; }
  return 0;
}
function installPath(focusId, target, rivalId) {
  const playerId = (cup && cup.teams && cup.teams[0] && cup.teams[0].id) || settings.blue;
  const teams = cupIds(rivalId ? [focusId, rivalId] : [playerId, focusId]);
  if (teams.length < 8) return "Not enough teams for a cup.";
  if (rivalId) {
    const a = resolveCupTeam(focusId), b = resolveCupTeam(rivalId);
    const rest = teams.filter((t) => t.id !== a.id && t.id !== b.id);
    cup = freshCup([a, b].concat(rest).slice(0, 8));
  } else {
    const focus = resolveCupTeam(focusId);
    const me = resolveCupTeam(playerId) || focus;
    const ordered = [];
    const push = (t) => { if (t && !ordered.some((x) => x.id === t.id)) ordered.push(t); };
    push(me); push(focus); teams.forEach(push);
    cup = freshCup(ordered.slice(0, 8));
  }
  const fi = cup.teams.findIndex((t) => t.id === focusId);
  const used = {};
  used[fi] = true;
  let bi = -1;
  if (rivalId) { bi = cup.teams.findIndex((t) => t.id === rivalId); used[bi] = true; }
  const qf = [null, null, null, null];
  if (rivalId) {
    const o0 = takeSlot(used), o1 = takeSlot(used), o2 = takeSlot(used);
    const o3 = takeSlot(used), o4 = takeSlot(used), o5 = takeSlot(used);
    qf[0] = blankTie(fi, o0); award(qf[0], fi);
    qf[1] = blankTie(o1, o2); award(qf[1], favored(o1, o2));
    qf[2] = blankTie(bi, o3); award(qf[2], bi);
    qf[3] = blankTie(o4, o5); award(qf[3], favored(o4, o5));
    const sf0 = blankTie(fi, qf[1].winner); award(sf0, fi);
    const sf1 = blankTie(bi, qf[3].winner); award(sf1, bi);
    cup.rounds = [qf, [sf0, sf1], [blankTie(fi, bi)]];
  } else if ((target | 0) <= 0) {
    const order = [fi];
    while (order.length < 8) order.push(takeSlot(used));
    for (let i = 0; i < 4; i++) qf[i] = blankTie(order[i * 2], order[i * 2 + 1]);
    cup.rounds = [qf, [], []];
  } else if ((target | 0) === 1) {
    const opp = takeSlot(used);
    qf[0] = blankTie(fi, opp); award(qf[0], fi);
    const a = takeSlot(used), b = takeSlot(used); qf[1] = blankTie(a, b); award(qf[1], favored(a, b));
    const c = takeSlot(used), d = takeSlot(used); qf[2] = blankTie(c, d); award(qf[2], favored(c, d));
    const e = takeSlot(used), f = takeSlot(used); qf[3] = blankTie(e, f); award(qf[3], favored(e, f));
    cup.rounds = [qf, [blankTie(fi, qf[1].winner), blankTie(qf[2].winner, qf[3].winner)], []];
  } else {
    const opp = takeSlot(used);
    qf[0] = blankTie(fi, opp); award(qf[0], fi);
    const a = takeSlot(used), b = takeSlot(used); qf[1] = blankTie(a, b); award(qf[1], favored(a, b));
    const c = takeSlot(used), d = takeSlot(used); qf[2] = blankTie(c, d); award(qf[2], favored(c, d));
    const e = takeSlot(used), f = takeSlot(used); qf[3] = blankTie(e, f); award(qf[3], favored(e, f));
    const side = favored(qf[2].winner, qf[3].winner);
    const sf0 = blankTie(fi, qf[1].winner); award(sf0, fi);
    const sf1 = blankTie(qf[2].winner, qf[3].winner); award(sf1, side);
    cup.rounds = [qf, [sf0, sf1], [blankTie(fi, side)]];
  }
  syncCupProgress();
  return "";
}
function remapIndex(i, from, to) {
  if (i === from) return to;
  if (i === to) return from;
  return i;
}
function remapMatch(m, from, to) {
  m.a = remapIndex(m.a, from, to);
  m.b = remapIndex(m.b, from, to);
  if (m.winner != null) m.winner = remapIndex(m.winner, from, to);
}
function cupControlsOpen() {
  try {
    if (localStorage.getItem("soccerAdminUnlock") !== "yes") return false;
  } catch (e) { return false; }
  if (typeof netRole === "string" && netRole === "guest") return false;
  if (typeof netIsHost === "function" && typeof netRole === "string" && netRole && !netIsHost()) return false;
  return true;
}
function cupBlockedNote() {
  if (typeof netRole === "string" && netRole === "guest") return "Only the host can use these in an online game.";
  if (typeof netIsHost === "function" && typeof netRole === "string" && netRole && !netIsHost()) return "Only the host can use these in an online game.";
  return "Unlock the helpers first.";
}
function cupSetMe(id) {
  if (!cupControlsOpen()) return cupBlockedNote();
  const team = resolveCupTeam(id);
  if (!team) return "Pick a team.";
  rememberCup();
  if (!cup) {
    const teams = cupIds([team.id]);
    const rest = teams.filter((t) => t.id !== team.id);
    cup = freshCup([team].concat(rest).slice(0, 8));
    const qf = [];
    for (let i = 0; i < 4; i++) qf.push(blankTie(i * 2, i * 2 + 1));
    cup.rounds = [qf, [], []];
    syncCupProgress();
    cupRefresh();
    return "You play as " + team.name + ".";
  }
  const idx = cup.teams.findIndex((t) => t.id === team.id);
  if (idx === 0) { cupUndo.pop(); return "You already play as " + team.name + "."; }
  if (idx > 0) {
    const tmp = cup.teams[0];
    cup.teams[0] = cup.teams[idx];
    cup.teams[idx] = tmp;
    for (const round of cup.rounds) for (const m of round) remapMatch(m, 0, idx);
    if (cup.champion != null) cup.champion = remapIndex(cup.champion, 0, idx);
  } else cup.teams[0] = team;
  syncCupProgress();
  cupRefresh();
  return "You play as " + cup.teams[0].name + ".";
}
function cupSend(id, round) {
  if (!cupControlsOpen()) return cupBlockedNote();
  const team = resolveCupTeam(id);
  if (!team) return "Pick a team.";
  rememberCup();
  const err = installPath(team.id, round | 0, null);
  if (err) { cup = cupUndo.pop(); return err; }
  cupRefresh();
  const where = ["quarterfinal", "semifinal", "final"][round | 0] || "bracket";
  return team.name + " are in the " + where + ".";
}
function cupJumpFinal(idA, idB) {
  if (!cupControlsOpen()) return cupBlockedNote();
  const a = resolveCupTeam(idA), b = resolveCupTeam(idB);
  if (!a || !b) return "Pick two teams.";
  if (a.id === b.id) return "Pick two different teams.";
  rememberCup();
  const err = installPath(a.id, 2, b.id);
  if (err) { cup = cupUndo.pop(); return err; }
  cupRefresh();
  return "Final: " + a.name + " vs " + b.name + ". You play as " + a.name + ".";
}
function advanceRound() {
  const list = cup.rounds[cup.round] || [];
  if (!list.length || list.some((m) => m.winner == null)) { syncCupProgress(); return; }
  if (cup.round >= 2) { syncCupProgress(); return; }
  const winners = list.map((m) => m.winner);
  const next = [];
  for (let i = 0; i < winners.length; i += 2) next.push(blankTie(winners[i], winners[i + 1]));
  cup.rounds[cup.round + 1] = next;
  for (let r = cup.round + 2; r < 3; r++) cup.rounds[r] = [];
  cup.round += 1;
  syncCupProgress();
}
function cupWinCurrent() {
  if (!cupControlsOpen()) return cupBlockedNote();
  if (!cup) return "Start a cup first.";
  if (cup.over) return "The cup is already over.";
  const m = myCupMatch();
  if (!m) return "You are not in this round.";
  rememberCup();
  award(m, 0);
  for (const o of cup.rounds[cup.round]) if (o.winner == null) simulateCupMatch(o);
  advanceRound();
  cupRefresh();
  if (cup.over) return cup.champion === 0 ? "You won the cup." : cup.teams[cup.champion].name + " won the cup.";
  return "You won. Next up: the " + ["quarterfinal", "semifinal", "final"][cup.round] + ".";
}
function cupSkipRound() {
  if (!cupControlsOpen()) return cupBlockedNote();
  if (!cup) return "Start a cup first.";
  if (cup.over) return "The cup is already over.";
  rememberCup();
  for (const o of cup.rounds[cup.round]) if (o.winner == null) simulateCupMatch(o);
  advanceRound();
  cupRefresh();
  if (cup.over) return cup.champion === 0 ? "You won the cup." : cup.teams[cup.champion].name + " won the cup.";
  return "On to the " + ["quarterfinal", "semifinal", "final"][cup.round] + (cup.out ? ". You are out." : ".");
}
function cupSetResult(round, index, winnerId, sa, sb) {
  if (!cupControlsOpen()) return cupBlockedNote();
  if (!cup) return "Start a cup first.";
  const m = (cup.rounds[round | 0] || [])[index | 0];
  if (!m || !cup.teams[m.a] || !cup.teams[m.b]) return "That match is not in the bracket.";
  const winner = winnerId === cup.teams[m.a].id ? m.a : winnerId === cup.teams[m.b].id ? m.b : null;
  if (winner == null) return "Pick one of the two teams.";
  rememberCup();
  m.winner = winner;
  const a = sa === "" || sa == null ? null : Number(sa);
  const b = sb === "" || sb == null ? null : Number(sb);
  if (a != null && b != null && isFinite(a) && isFinite(b)) {
    m.sa = Math.max(0, a | 0);
    m.sb = Math.max(0, b | 0);
    if (m.sa === m.sb) m.pens = winner === m.a ? [5, 4] : [4, 5];
    else {
      m.pens = null;
      if ((winner === m.a) !== (m.sa > m.sb)) { const t = m.sa; m.sa = m.sb; m.sb = t; }
    }
  } else award(m, winner);
  for (let r = round | 0; r < 2; r++) {
    const prev = cup.rounds[r];
    if (!prev.length || prev.some((x) => x.winner == null)) {
      for (let k = r + 1; k < 3; k++) cup.rounds[k] = [];
      break;
    }
    const winners = prev.map((x) => x.winner);
    const old = cup.rounds[r + 1] || [];
    const built = [];
    for (let i = 0; i < winners.length; i += 2) {
      const A = winners[i], B = winners[i + 1];
      const keep = old[i / 2];
      if (keep && keep.winner != null && ((keep.a === A && keep.b === B) || (keep.a === B && keep.b === A))) built.push(keep);
      else built.push(blankTie(A, B));
    }
    cup.rounds[r + 1] = built;
  }
  syncCupProgress();
  cupRefresh();
  return cup.teams[winner].name + " win that match.";
}
function undoCupChange() {
  if (!cupControlsOpen()) return cupBlockedNote();
  if (!cupUndo.length) return "Nothing to undo.";
  cup = cupUndo.pop();
  cupRefresh();
  return cup ? "Undid the last cup change." : "Undid the cup.";
}
function cupRoundWord(n) { return ["Quarterfinal", "Semifinal", "Final"][n] || "Cup"; }
function cupPanelState() {
  const teams = (typeof TEAM_LIST !== "undefined" ? TEAM_LIST : []).map((t) => ({ id: t.id, name: t.name }));
  if (!cup) return { active: false, canUndo: cupUndo.length > 0, youId: settings.blue, teams: teams, matches: [], status: "No cup yet." };
  const matches = [];
  for (let r = 0; r < 3; r++) {
    (cup.rounds[r] || []).forEach((m, i) => {
      const A = cup.teams[m.a], B = cup.teams[m.b];
      if (!A || !B) return;
      const score = m.winner == null ? "vs" : (m.sa + "-" + m.sb + (m.pens ? " pens" : ""));
      matches.push({
        key: r + ":" + i, round: r, index: i,
        aId: A.id, bId: B.id, aName: A.name, bName: B.name,
        label: cupRoundWord(r) + ": " + A.name + " " + score + " " + B.name,
      });
    });
  }
  let status;
  if (cup.over) status = cup.champion === 0 ? "You won the cup." : cup.teams[cup.champion].name + " won the cup.";
  else if (cup.out) status = cupRoundWord(cup.round) + " · you are out";
  else {
    const m = myCupMatch();
    const opp = m ? cup.teams[m.a === 0 ? m.b : m.a] : null;
    status = cupRoundWord(cup.round) + " · you play as " + cup.teams[0].name + (opp ? " vs " + opp.name : "");
  }
  return {
    active: true, canUndo: cupUndo.length > 0, over: !!cup.over, out: !!cup.out,
    round: cup.round, youId: cup.teams[0].id, youName: cup.teams[0].name,
    teams: teams, matches: matches, status: status,
  };
}
function cupAdmin(action, arg) {
  arg = arg || {};
  if (action === "state") return cupPanelState();
  if (!cupControlsOpen()) {
    const state = cupPanelState();
    state.note = cupBlockedNote();
    state.blocked = true;
    return state;
  }
  let note = "";
  if (action === "undo") note = undoCupChange();
  else if (action === "start" || action === "restart") {
    newCup();
    note = "New cup. You play as " + cup.teams[0].name + ".";
  } else if (action === "send") note = cupSend(arg.id, arg.round | 0);
  else if (action === "win") note = cupWinCurrent();
  else if (action === "skip") note = cupSkipRound();
  else if (action === "result") note = cupSetResult(arg.round | 0, arg.index | 0, arg.winner, arg.sa, arg.sb);
  else if (action === "final") note = cupJumpFinal(arg.a, arg.b);
  else if (action === "me") note = cupSetMe(arg.id);
  else note = "Unknown cup command.";
  const state = cupPanelState();
  state.note = note;
  return state;
}

// ---- Trophy count (this device) and the champions scene ----
function paintTrophyBadge() {
  const badge = $("trophyBadge");
  const count = $("trophyCount");
  if (!badge || !count) return;
  const book = loadTrophies();
  const n = trophyTotal(book);
  count.textContent = String(n);
  badge.setAttribute("aria-label", n === 1 ? "1 cup trophy" : n + " cup trophies");
  const playing = typeof inMatch === "function" && inMatch();
  badge.classList.toggle("hidden", !!playing);
  const box = $("trophyBreak");
  if (playing && box) box.classList.add("hidden");
  if (box && !box.classList.contains("hidden")) fillTrophyBreak();
}
function fillTrophyBreak() {
  const box = $("trophyBreak");
  if (!box) return;
  const teams = trophyTeams(loadTrophies());
  box.innerHTML = teams.length
    ? "<div class='label'>Cups won</div>" + teams.map((t) => "<div><b>" + esc(t.name) + "</b> " + t.n + "</div>").join("")
    : "<div>No cup trophies yet.</div>";
}
function paintTrophyLines() {
  const book = loadTrophies();
  const n = trophyTotal(book);
  const line = $("trophyCountLine");
  const split = $("trophySplit");
  if (line) line.textContent = "\uD83C\uDFC6 " + n + (n === 1 ? " cup" : " cups");
  if (split) {
    const teams = trophyTeams(book);
    split.textContent = teams.map((t) => t.name + " " + t.n).join(" \u00b7 ");
  }
}
let trophyAnim = null;
function showTrophy() {
  if (cup && cup.over && cup.champion === 0) rememberCupWin(cup);
  showScreen("trophyScreen");
  paintTrophyBadge();
  paintTrophyLines();
  const team = cup && cup.teams && cup.teams[0];
  $("trophyTeam").innerHTML = team ? flagHtml(team, 32, { wave: true }) + "<span>" + esc(team.name) + "</span>" : "";
  Sound.init(); Sound.fanfare();
  const cv = $("trophyCanvas");
  const g = cv.getContext("2d");
  const cssW = Math.max(280, Math.min(560, (cv.parentElement && cv.parentElement.clientWidth) || 360));
  const cssH = Math.round(cssW * 0.74);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.style.width = cssW + "px";
  cv.style.height = cssH + "px";
  cv.width = Math.round(cssW * dpr);
  cv.height = Math.round(cssH * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  const kit = (team && team.home) || ["#1f5fd6", "#ffffff", "#1f5fd6"];
  const skin = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
  const bits = [];
  for (let i = 0; i < 90; i++) bits.push({ x: Math.random() * W, y: Math.random() * H, v: 28 + Math.random() * 70, r: Math.random() * 6, c: [kit[0], kit[1], "#ffd33d", "#fff", "#ff6b6b"][i % 5], s: 3 + Math.random() * 4 });
  const sparks = [];
  const boom = (x, y) => {
    const cols = ["#ffe27a", "#fff", kit[0], "#7eb6ff", "#ff8a5b"];
    for (let i = 0; i < 22; i++) {
      const a = (Math.PI * 2 * i) / 22;
      const sp = 28 + (i % 5) * 16;
      sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: cols[i % cols.length], life: 1 });
    }
  };
  boom(W * 0.22, H * 0.22);
  boom(W * 0.78, H * 0.18);
  const squad = [
    { x: 0.16, s: 0.72, lift: false },
    { x: 0.32, s: 0.86, lift: false },
    { x: 0.50, s: 1.05, lift: true },
    { x: 0.68, s: 0.86, lift: false },
    { x: 0.84, s: 0.72, lift: false },
  ];
  const t0 = performance.now();
  let nextBoom = 900;
  cancelAnimationFrame(trophyAnim);
  const loop = (now) => {
    if ($("trophyScreen").classList.contains("hidden")) return;
    const t = (now - t0) / 1000;
    if (now - t0 > nextBoom) { boom(W * (0.2 + Math.random() * 0.6), H * (0.12 + Math.random() * 0.2)); nextBoom += 700; }
    g.clearRect(0, 0, W, H);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#10243f"); sky.addColorStop(0.55, "#16382a"); sky.addColorStop(1, "#0c1a12");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,230,120,0.08)";
    g.save(); g.translate(W / 2, H * 0.42); g.rotate(t * 0.25);
    for (let i = 0; i < 10; i++) { g.rotate(Math.PI / 5); g.beginPath(); g.moveTo(0, 0); g.lineTo(-18, -H); g.lineTo(18, -H); g.fill(); }
    g.restore();
    g.fillStyle = "#0e2a18"; g.fillRect(0, H * 0.78, W, H);
    g.fillStyle = "#1b4a2c"; g.fillRect(0, H * 0.78, W, 8);
    g.fillStyle = "#fff"; g.font = "800 " + Math.round(W * 0.075) + "px Impact, Arial Black, sans-serif"; g.textAlign = "center";
    g.fillText("CHAMPIONS!", W / 2, H * 0.12);
    const ground = H * 0.80;
    squad.forEach((p, i) => drawCelebrant(g, p.x * W, ground, p.s * (W / 520), kit, skin[i % skin.length], p.lift, t));
    const bob = Math.sin(t * 2.2) * 4;
    drawGoldCup(g, W / 2, ground - 168 * (W / 520) + bob, W / 520);
    if (team && typeof drawFlagBadge === "function") drawFlagBadge(g, team.id, 16, H * 0.045, 32);
    sparks.forEach((s) => {
      s.x += s.vx / 60; s.y += s.vy / 60; s.vy += 18 / 60; s.life -= 0.012;
      if (s.life <= 0) return;
      g.globalAlpha = Math.max(0, s.life);
      g.fillStyle = s.c; g.beginPath(); g.arc(s.x, s.y, 2.4, 0, 7); g.fill();
      g.globalAlpha = 1;
    });
    for (const b of bits) {
      b.y += b.v / 60; b.r += 0.08; if (b.y > H) { b.y = -8; b.x = Math.random() * W; }
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-b.s, -b.s / 2, b.s * 2, b.s); g.restore();
    }
    trophyAnim = requestAnimationFrame(loop);
  };
  trophyAnim = requestAnimationFrame(loop);
}
function drawCelebrant(g, x, y, s, kit, skin, lift, t) {
  const arm = lift ? -1.15 + Math.sin(t * 2) * 0.06 : 0.35;
  g.save();
  g.fillStyle = "rgba(0,0,0,.35)";
  g.beginPath(); g.ellipse(x, y + 2, 18 * s, 5 * s, 0, 0, 7); g.fill();
  g.fillStyle = kit[2] || "#111";
  g.fillRect(x - 9 * s, y - 32 * s, 7 * s, 32 * s);
  g.fillRect(x + 2 * s, y - 32 * s, 7 * s, 32 * s);
  g.fillStyle = "#111";
  g.fillRect(x - 10 * s, y - 6 * s, 9 * s, 5 * s);
  g.fillRect(x + 1 * s, y - 6 * s, 9 * s, 5 * s);
  g.fillStyle = kit[1] || "#fff";
  g.fillRect(x - 12 * s, y - 48 * s, 24 * s, 18 * s);
  g.fillStyle = kit[0] || "#1f5fd6";
  g.fillRect(x - 14 * s, y - 78 * s, 28 * s, 32 * s);
  g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1;
  g.strokeRect(x - 14 * s, y - 78 * s, 28 * s, 32 * s);
  g.save();
  g.translate(x - 14 * s, y - 70 * s); g.rotate(arm);
  g.fillStyle = kit[0]; g.fillRect(-16 * s, -3 * s, 18 * s, 7 * s); g.restore();
  g.save();
  g.translate(x + 14 * s, y - 70 * s); g.rotate(-arm);
  g.fillStyle = kit[0]; g.fillRect(-2 * s, -3 * s, 18 * s, 7 * s); g.restore();
  g.fillStyle = skin;
  g.beginPath(); g.arc(x, y - 90 * s, 10 * s, 0, 7); g.fill();
  g.fillStyle = "#222";
  g.beginPath(); g.arc(x, y - 96 * s, 8 * s, Math.PI, 0); g.fill();
  g.restore();
}
function drawGoldCup(g, x, y, s) {
  g.save(); g.translate(x, y);
  const gold = g.createLinearGradient(-28 * s, 0, 28 * s, 0);
  gold.addColorStop(0, "#a87a00"); gold.addColorStop(0.45, "#fff6c0"); gold.addColorStop(1, "#c99a06");
  g.fillStyle = gold; g.strokeStyle = "#7a5700"; g.lineWidth = 2 * s;
  g.beginPath(); g.moveTo(-26 * s, 0); g.quadraticCurveTo(-28 * s, 42 * s, 0, 50 * s); g.quadraticCurveTo(28 * s, 42 * s, 26 * s, 0); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.ellipse(-30 * s, 16 * s, 8 * s, 12 * s, 0, 0, 7); g.ellipse(30 * s, 16 * s, 8 * s, 12 * s, 0, 0, 7); g.stroke();
  g.fillRect(-5 * s, 48 * s, 10 * s, 16 * s);
  g.fillRect(-18 * s, 64 * s, 36 * s, 7 * s);
  g.fillStyle = "#5b3b1a"; g.fillRect(-22 * s, 71 * s, 44 * s, 10 * s);
  g.restore();
}
const trophyBadgeBtn = $("trophyBadge");
if (trophyBadgeBtn) trophyBadgeBtn.addEventListener("click", () => {
  const box = $("trophyBreak");
  if (!box) return;
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden")) fillTrophyBreak();
});

// =====================================================================
// G. WIN / PAUSE SCREENS
// =====================================================================
function togglePause() {
  paused = !paused;
  showScreen(paused ? "pauseScreen" : null);
}
function toggleSound() {
  settings.muted = !settings.muted; Sound.setMuted(settings.muted); saveSettings();
}
function showWin() {
  const w = game.winner;
  const so = game.shootout;
  $("winTitle").textContent = w ? TEAMS[w].name + " win!" : "It's a draw!";
  $("winTitle").style.color = w ? TEAMS[w].ui : "#fff";
  const sideMark = (side) => flagHtml({ id: TEAMS[side].id, kit: TEAMS[side].kit }, 22) + "<span>" + esc(TEAMS[side].short) + "</span>";
  let score = sideMark("blue") + "<span>" + game.score.blue + " - " + game.score.red + "</span>" + sideMark("red");
  if (so) {
    const pb = so.kicks.blue.reduce((a, b) => a + b, 0), pr = so.kicks.red.reduce((a, b) => a + b, 0);
    score = game.matchType === "shootout"
      ? sideMark("blue") + "<span>" + pb + " - " + pr + " (penalties)</span>" + sideMark("red")
      : score + "<span>(" + pb + "-" + pr + " on penalties)</span>";
  }
  $("winScore").innerHTML = score;
  const s = game.stats;
  $("winStats").innerHTML = game.matchType === "shootout" ? "Penalties scored: " + s.pens.scored + " \u2022 missed / saved: " + s.pens.missed :
    "Shots " + s.shots.blue + " - " + s.shots.red + " \u2022 Saves " + s.saves + " \u2022 Fouls " + s.fouls +
    " \u2022 Cards \ud83d\udfe8" + (s.yellow.blue + s.yellow.red) + " \ud83d\udfe5" + (s.red.blue + s.red.red) +
    " \u2022 Offside " + s.offside + " \u2022 Skills " + s.skills + " \u2022 Time " + formatClock(game.clock);
  const scorers = $("winScorers");
  if (scorers) scorers.innerHTML = game.matchType === "shootout" ? "" : (typeof goalScorersHtml === "function" ? goalScorersHtml(s) : "");
  const isCup = matchKind === "cup";
  $("againBtn").classList.toggle("hidden", isCup);
  $("cupContinueBtn").classList.toggle("hidden", !isCup);
  if (isCup) {
    recordCupResult();
    $("cupContinueBtn").textContent = cup.over && cup.champion === 0 ? "\ud83c\udfc6 Lift the trophy!" : "Continue cup";
  }
  showScreen("winScreen");
}
$("againBtn").addEventListener("click", () => { if (matchKind === "shootout") startShootoutMatch(); else startQuickMatch(); });
$("cupContinueBtn").addEventListener("click", () => { if (cup.over && cup.champion === 0) showTrophy(); else showCup(); });
$("menuBtn").addEventListener("click", goToMenu);
$("pauseMenuBtn").addEventListener("click", goToMenu);
$("resumeBtn").addEventListener("click", togglePause);
$("pauseBtn").addEventListener("click", togglePause);

// =====================================================================
// H. MAIN LOOP  (fixed 1/120 s logic steps, drawn every frame)
// =====================================================================
const STEP = 1 / 120;
let lastTime = performance.now(), accumulator = 0, wasWin = false;
function frame(now) {
  if (typeof frameGate === "function" && !frameGate(now)) { requestAnimationFrame(frame); return; }
  window.__fps = Math.round(1000 / Math.max(8, now - (frame.prev || now)));
  frame.prev = now;
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1;
  if (inMatch() && !paused) {
    feedInput();
    if (typeof pushMatchTune === "function") pushMatchTune();
    const pace = typeof opt === "function" ? (Number(opt("gameSpeed")) || 1) : 1;
    accumulator += dt * pace * (game && game.admin && game.admin.slow ? 0.35 : 1);
    while (accumulator >= STEP) { sim.update(STEP); accumulator -= STEP; }
    players = sim.players;
    for (const ev of game.events.splice(0)) playEvent(ev);
  } else accumulator = 0;
  if (sim && game.phase === "win" && !wasWin && !atMenu) { wasWin = true; setTimeout(showWin, 900); }
  if (game && game.phase !== "win") wasWin = false;
  updateCamera(dt);
  draw();
  if (inMatch()) updateHud();
  requestAnimationFrame(frame);
}

loadSettings();
Sound.setMuted(settings.muted);
idleSim();
renderMenu();
resize();
requestAnimationFrame(frame);

// ---- DEBUG HOOK (for automated tests; try soccerDebug.setAutoplay(true)
//      in the browser console to watch computer vs computer) ----
window.soccerDebug = {
  start(opts = {}) {
    if (typeof opts === "string") opts = { mode: opts, difficulty: arguments[1] };
    Object.assign(settings, { mode: opts.mode || "1p", difficulty: opts.difficulty || "normal", kind: opts.kind || "quick" });
    if (opts.blue) settings.blue = opts.blue;
    if (opts.red) settings.red = opts.red;
    if (opts.rules) settings.rules = { ...settings.rules, ...opts.rules };
    if (opts.minutes != null) {
      settings.minutes = clampMatchMinutes(opts.minutes);
      settings.lengthCustom = opts.lengthCustom != null ? !!opts.lengthCustom : !isPresetMinute(settings.minutes);
    }
    startFromMenu();
    return this.state();
  },
  setAutoplay(on) { if (sim) sim.setAutoplay(on); },
  step(seconds) {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) { if (paused || !inMatch()) break; sim.update(STEP); }
    players = sim.players;
    for (const ev of game.events.splice(0)) { /* sounds skipped */ }
    updateCamera(0, true); draw();
    return this.state();
  },
  state() {
    const pen = game.penalty, so = game.shootout, ce = game.celebration;
    return {
      phase: game.phase, mode: settings.mode, kind: matchKind, difficulty: game.difficulty,
      score: { ...game.score }, winner: game.winner, clock: Math.round(game.clock),
      timeLimit: game.timeLimit, knockout: !!game.knockout,
      setpiece: game.setpiece ? game.setpiece.type : null, indirect: !!(game.setpiece && game.setpiece.indirect),
      throwT: game.setpiece && game.setpiece.type === "throw" ? game.setpiece.throwT || 0 : 0,
      hint: game.setpiece && game.setpiece.type === "throw" ? keysHint("throw") : "",
      zoom: game.camera ? Math.round(game.camera.zoom * 100) / 100 : 1,
      camera: cameraFP ? "fp" : "tv",
      active: controllers.filter((c) => !c.cpu && c.active).map((c) => ({ id: c.id, num: c.active.num, team: c.active.team })),
      ballZ: ball ? Math.round(ball.z || 0) : 0,
      linesman: game.officials ? game.officials.map((o) => o.sig) : [],
      ball: { x: Math.round(ball.x), y: Math.round(ball.y), z: Math.round(ball.z) },
      stats: game.stats ? JSON.parse(JSON.stringify(game.stats)) : null,
      players: players.length, onPitch: { blue: players.filter((p) => p.team === "blue").length, red: players.filter((p) => p.team === "red").length },
      teams: { blue: { name: TEAMS.blue.name, short: TEAMS.blue.short, shirt: TEAMS.blue.kit.shirt }, red: { name: TEAMS.red.name, short: TEAMS.red.short, shirt: TEAMS.red.kit.shirt, away: game.teams.red.away } },
      cards: sim.roster.filter((p) => p.yellow || p.sentOff).map((p) => ({ team: p.team, num: p.num, yellow: p.yellow, sentOff: p.sentOff })),
      cardPopup: game.cardPopup ? game.cardPopup.kind : null, flag: !!game.flag,
      penalty: pen ? { team: pen.team, aimY: pen.aimY, gkChoice: pen.gkChoice } : null,
      shootout: so ? { blue: so.kicks.blue.slice(), red: so.kicks.red.slice(), sudden: so.sudden, done: so.done, winner: so.winner } : null,
      celebration: ce ? { type: ce.type, t: ce.t } : null,
      skills: sim.roster.filter((p) => p.skill).map((p) => p.skill),
      screens: SCREENS.filter((s) => !$(s).classList.contains("hidden")),
      cup: cup ? { round: cup.round, over: cup.over, champion: cup.champion, out: cup.out } : null,
      paused,
    };
  },
  forceGoal(team) { if (inMatch()) sim.forceGoal(team); },
  setClock(seconds) { if (game) game.clock = Math.max(0, Number(seconds) || 0); return this.state(); },
  setScore(blue, red) { if (game) { game.score.blue = Math.max(0, blue | 0); game.score.red = Math.max(0, red | 0); } return this.state(); },
  foul(team = "red", inBox = true, behind = false) { return sim.debugFoul(team, inBox, behind); },
  card(index, kind) { sim.giveCard(index, kind); return this.state().cards; },
  offside(team = "blue") { return sim.debugOffside(team); },
  skill(team = "blue", type = "stepover") { return sim.debugSkill(team, type); },
  press(id, action) { sim.press(id, action); },
  switchTo(id, index) { return !!(sim && sim.switchTo(id, index)); },
  where(index) {
    const p = sim && sim.roster[index];
    if (!p) return null;
    const s = w2s(p.x, p.y, 18);
    const rect = $("game").getBoundingClientRect();
    return { x: rect.left + s.x * viewScale, y: rect.top + s.y * viewScale, num: p.num, team: p.team, role: p.role };
  },
  setInput(id, inp) { sim.setInput(id, inp); },
  // Put the ball over a touchline so the next step is a throw-in.
  ballOut(side = "near") {
    game.phase = "play"; game.setpiece = null;
    ball.owner = null; ball.lastTeam = "red"; ball.shot = null;
    ball.x = PITCH.cx; ball.y = side === "far" ? PITCH.top - 40 : PITCH.bottom + 40; ball.z = 0; ball.vx = 0; ball.vy = 0; ball.vz = 0;
    return this.state();
  },
  // Give the ball to the player a human controls (to test buttons)
  giveBall(id = "p1") {
    const c = sim.controllers.find((k) => k.id === id);
    const p = c && (c.active || sim.players.find((q) => q.team === c.team && q.role === "FWD"));
    if (!p) return false;
    game.phase = "play"; game.setpiece = null; c.active = p; p.skillCD = 0;
    Object.assign(ball, { x: p.x + p.fx * 14, y: p.y + p.fy * 14, z: 0, vx: 0, vy: 0, owner: p });
    return true;
  },
  roster() { return sim.roster.map((p, i) => ({ i, team: p.team, role: p.role, num: p.num, sentOff: p.sentOff })); },
  // Where the referee and linesmen are, for checks and screenshots.
  crew() {
    const M = PITCH.w / 105;
    const ref = game.officials[0], near = game.officials[1], far = game.officials[2];
    return {
      phase: game.phase,
      refM: Math.round(Math.hypot(ref.x - ball.x, ref.y - ball.y) / M * 10) / 10,
      ref: { x: Math.round(ref.x), y: Math.round(ref.y) },
      near: { x: Math.round(near.x), y: Math.round(near.y) },
      far: { x: Math.round(far.x), y: Math.round(far.y) },
      ball: { x: Math.round(ball.x), y: Math.round(ball.y) },
    };
  },
  // Cup helpers: win (or lose) your current cup match instantly
  finishMatch(winner = "blue", score = [3, 1]) {
    game.score.blue = score[0]; game.score.red = score[1];
    sim.game.phase = "win"; sim.game.winner = winner;
  },
  showWinNow() { showWin(); },
};
