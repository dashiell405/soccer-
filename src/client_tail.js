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

