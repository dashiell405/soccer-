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
  custom: { name: "My Team", shirt: "#8e44ad", shorts: "#ffffff", socks: "#8e44ad" },
  muted: false,
};
function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem("soccerSettings") || "{}")); } catch (e) { /* ignore */ }
  settings.rules = { ...DEFAULT_RULES, ...(settings.rules || {}) };
}
function saveSettings() { try { localStorage.setItem("soccerSettings", JSON.stringify(settings)); } catch (e) { /* ignore */ } }
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
  if (!keys[e.code]) onKeyPressed(e.code);
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
const isDown = (id, action) => controlScheme(id)[action].some((c) => keys[c]) || (touchActive() && !!(pads[id] && pads[id][action]));

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
    pad.x = dx / max; pad.y = dy / max;
    if (Math.hypot(pad.x, pad.y) < 0.15) { pad.x = 0; pad.y = 0; }
    knob.style.transform = "translate(" + dx + "px," + dy + "px)";
  }
  zone.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    noteFpFollow(playerId);
    if (inMatch() && game.phase === "goal") sim.press(playerId, "skip");
    pad.pointerId = e.pointerId; pad.baseX = e.clientX; pad.baseY = e.clientY;
    base.style.left = (e.clientX - base.offsetWidth / 2) + "px";
    base.style.top = (e.clientY - base.offsetHeight / 2) + "px";
    base.style.right = "auto"; base.style.bottom = "auto";
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
  if (!p || typeof renameFor !== "function") return "";
  const id = (TEAMS[p.team] && TEAMS[p.team].id) || "";
  return renameFor(id, p.num);
}
const showHud = () => !!sim && !atMenu || (!!sim && game.phase === "win");
const localActives = () => controllers.filter((c) => !c.cpu && c.active && !game.autoplay).map((c) => c.active);
const rosterList = () => (sim ? sim.roster : []);
function hudSubtitle() {
  const kindText = matchKind === "cup" ? "CUP " + CUP_ROUND_NAMES[cup ? cup.round : 0] + ": " : "";
  if (game.matchType === "shootout") return "Penalty shootout \u2022 5 kicks each, then sudden death";
  const fmt = game.knockout ? "10 minute game \u2022 a draw goes to penalties" : "10 minute game";
  const who = settings.mode === "1p" ? "1P vs CPU (" + game.difficulty + ")" : "2 Players";
  return kindText + fmt + "  \u2022  " + who;
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
// Every match is 10 minutes. A cup match sends a draw to penalties.
function newMatch(opts) {
  const kits = buildTeamKits(opts.blue, opts.red);
  applyTeamKits(kits);
  renderBackground();         // the fans in the stands wear the new colours
  sim = createSim({
    mode: settings.mode === "2p" ? "2 players" : "1 player", difficulty: settings.difficulty, teams: kits,
    rules: settings.rules, knockout: opts.knockout, matchType: opts.matchType,
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
  // team cards + the kits they will actually wear (away kit on a clash)
  const B = teamDef(settings.blue), R = teamDef(settings.red);
  const kits = buildTeamKits(B, R);
  const card = (side, T, k) => flagHtml(T, 26, { wave: true }) + "<span class='teamMeta'><b>" + esc(T.name) + "</b> <span class='code'>" + T.short + "</span>" + (k.formation ? " <span class='code'>" + esc(k.formation) + "</span>" : "") + "<br><span class='stars'>" + stars(k.rating) + "</span>" + (k.away ? " <span class='away'>away kit</span>" : "") + "</span>";
  $("blueTeamBtn").innerHTML = "<span class='who'>" + (settings.mode === "2p" ? "P1" : "YOU") + "</span>" + card("blue", B, kits.blue);
  $("redTeamBtn").innerHTML = "<span class='who'>" + (settings.mode === "2p" ? "P2" : settings.kind === "cup" ? "CUP" : "CPU") + "</span>" + (settings.kind === "cup" ? "<b>7 random teams</b><br><span class='stars'>knockout</span>" : card("red", R, kits.red));
  $("redTeamBtn").disabled = settings.kind === "cup";
  const fmt = { quick: "Quick match \u2022 11-a-side \u2022 10 minute game \u2022 most goals wins",
                cup: "Cup \u2022 8 teams, knockout \u2022 every match is 10 minutes \u2022 a draw goes to penalties",
                shootout: "Penalty shootout \u2022 5 kicks each, then sudden death" }[settings.kind];
  $("formatLine").textContent = fmt;
  $("startBtn").textContent = settings.kind === "cup" ? "START NEW CUP" : settings.kind === "shootout" ? "TAKE PENALTIES" : "KICK OFF";
  const saved = loadCup();
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
document.querySelectorAll("[data-diff]").forEach((b) => b.addEventListener("click", () => { settings.difficulty = b.dataset.diff; renderMenu(); }));
$("ruleOffside").addEventListener("change", (e) => { settings.rules.offside = e.target.checked; saveSettings(); });
$("ruleCards").addEventListener("change", (e) => { settings.rules.cards = e.target.checked; saveSettings(); });

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
      "<span class='teamName'><b>" + esc(T.name) + "</b> <span class='code'>" + T.short + "</span></span><span class='stars'>" + stars(T.rating) + "</span></button>";
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
function saveCup() { try { localStorage.setItem("soccerCup", JSON.stringify(cup)); } catch (e) { /* ignore */ } }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// A new cup: your team + 7 random others. teams[0] is always you.
function newCup() {
  const mine = teamDef(settings.blue);
  const others = shuffle(TEAM_LIST.filter((t) => t.id !== mine.id)).slice(0, 7);
  const teams = [mine, ...others];
  const order = shuffle([1, 2, 3, 4, 5, 6, 7]);
  order.splice(Math.floor(Math.random() * 4) * 2, 0, 0);   // you go somewhere in the draw
  const qf = [];
  for (let i = 0; i < 8; i += 2) qf.push({ a: order[i], b: order[i + 1], sa: null, sb: null, pens: null, winner: null });
  cup = { teams, rounds: [qf, [], []], round: 0, over: false, champion: null, out: false, difficulty: settings.difficulty };
  saveCup();
  showCup();
}
const myCupMatch = () => cup.rounds[cup.round].find((m) => m.a === 0 || m.b === 0) || null;

// Results of computer vs computer matches (better rating = better chance)
function simulateCupMatch(m) {
  const ra = cup.teams[m.a].rating || 3, rb = cup.teams[m.b].rating || 3;
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
    flagHtml(T(i), 18) + "<span class='nm'>" + esc(T(i).name) + "</span><span class='sc'>" + (s === null ? "" : s) + (pen !== null && pen !== undefined ? " <small>(" + pen + ")</small>" : "") + "</span></div>";
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
  $("cupFormat").textContent = "Each match is 10 minutes \u2022 most goals wins \u2022 a draw goes to a penalty shootout";
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

// ---- Trophy ceremony: a shining cup, confetti and the crowd going wild ----
let trophyAnim = null;
function showTrophy() {
  showScreen("trophyScreen");
  $("trophyTeam").innerHTML = cup ? flagHtml(cup.teams[0], 28, { wave: true }) + "<span>" + esc(cup.teams[0].name) + "</span>" : "";
  Sound.init(); Sound.fanfare();
  const cv = $("trophyCanvas"), g = cv.getContext("2d");
  const W = cv.width = 360, H = cv.height = 300;
  const kit = cup ? cup.teams[0].home : ["#ffd33d", "#fff", "#fff"];
  const bits = [];
  for (let i = 0; i < 140; i++) bits.push({ x: Math.random() * W, y: -Math.random() * H, v: 40 + Math.random() * 90, r: Math.random() * 6, c: [kit[0], kit[1], "#ffd33d", "#fff"][i % 4] });
  const t0 = performance.now();
  cancelAnimationFrame(trophyAnim);
  const loop = (now) => {
    if ($("trophyScreen").classList.contains("hidden")) return;
    const t = (now - t0) / 1000;
    g.clearRect(0, 0, W, H);
    // light rays
    g.save(); g.translate(W / 2, 150); g.rotate(t * 0.3);
    for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.fillStyle = "rgba(255,230,120,0.10)"; g.beginPath(); g.moveTo(0, 0); g.lineTo(-25, -220); g.lineTo(25, -220); g.fill(); }
    g.restore();
    // the trophy (rises up and bobs)
    const rise = Math.min(1, t / 1.2), y = 40 + (1 - rise) * 200 + Math.sin(t * 2) * 4;
    g.save(); g.translate(W / 2, y);
    const gold = g.createLinearGradient(-60, 0, 60, 0);
    const sh = (Math.sin(t * 2.5) + 1) / 2;
    gold.addColorStop(0, "#a87a00"); gold.addColorStop(clamp(sh, 0.05, 0.95), "#fff6c0"); gold.addColorStop(1, "#c99a06");
    g.fillStyle = gold; g.strokeStyle = "#7a5700"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-55, 0); g.quadraticCurveTo(-60, 95, 0, 110); g.quadraticCurveTo(60, 95, 55, 0); g.closePath(); g.fill(); g.stroke();     // bowl
    g.beginPath(); g.ellipse(-62, 35, 18, 28, 0, 0, Math.PI * 2); g.ellipse(62, 35, 18, 28, 0, 0, Math.PI * 2); g.lineWidth = 7; g.strokeStyle = gold; g.stroke(); // handles
    g.fillStyle = gold; g.fillRect(-10, 108, 20, 40); g.fillRect(-40, 148, 80, 14); g.fillStyle = "#5b3b1a"; g.fillRect(-50, 162, 100, 30);       // stem + base
    g.fillStyle = "#ffd33d"; g.font = "bold 12px Arial"; g.textAlign = "center"; g.fillText("CHAMPIONS", 0, 182);
    g.restore();
    for (const b of bits) {
      b.y += b.v / 60; b.r += 0.1; if (b.y > H) { b.y = -10; b.x = Math.random() * W; }
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-4, -2, 8, 4); g.restore();
    }
    trophyAnim = requestAnimationFrame(loop);
  };
  trophyAnim = requestAnimationFrame(loop);
}

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
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1;
  if (inMatch() && !paused) {
    feedInput();
    accumulator += dt;
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
    ball.x = 860; ball.y = side === "far" ? 80 : 1040; ball.z = 0; ball.vx = 0; ball.vy = 0; ball.vz = 0;
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
    const M = 1400 / 105;
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
