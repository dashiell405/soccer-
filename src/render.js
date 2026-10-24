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
  const y0 = PITCH.top - 220;
  const y1 = PITCH.bottom + 180;
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
  if (!sub) return { mx, my };
  const fl = Math.hypot(sub.fx || 1, sub.fy || 0) || 1;
  const fx = (sub.fx || 1) / fl, fy = (sub.fy || 0) / fl;
  const rx = -fy, ry = fx;
  return { mx: rx * mx - fx * my, my: ry * mx - fy * my };
}
// Eyes just behind and above the player. `behind` means the point is
// too close to (or past) the camera, so it must not be drawn.
function w2sEyes(x, y, z, sub) {
  const fl = Math.hypot(sub.fx || 1, sub.fy || 0) || 1;
  const fx = (sub.fx || 1) / fl, fy = (sub.fy || 0) / fl;
  const pitch = 0.40;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const lx = fx * cp, ly = fy * cp, lz = -sp;
  const rx = -fy, ry = fx;
  const upx = -lz * ry, upy = lz * rx, upz = lx * ry - ly * rx;
  const camX = sub.x - fx * 78, camY = sub.y - fy * 78, camZ = 46;
  const dx = x - camX, dy = y - camY, dz = (z || 0) - camZ;
  const depth = dx * lx + dy * ly + dz * lz;
  const right = dx * rx + dy * ry;
  const up = dx * upx + dy * upy + dz * upz;
  const focal = Math.min(VIEW_W, VIEW_H) * 0.92;
  const d = Math.max(depth, 0.5);
  const sx = VIEW_W * 0.5 + (right / d) * focal;
  const sy = VIEW_H * 0.58 - (up / d) * focal;
  const behind = depth < 18 || Math.abs(sx) > VIEW_W * 3 || Math.abs(sy) > VIEW_H * 3;
  return { x: sx, y: sy, s: clamp(focal / d * 0.155, 0.16, 2.3), t: clamp(depth / 900, 0, 1), behind, depth };
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

  let tx = bx + clamp(bvx, -420, 420) * 0.3;
  let ty = by;
  const phone = phonePlay();
  let zoom = phone ? 1.0 : 1.04;

  if (game.phase === "menu" || game.phase === "lobby") {
    tx = PITCH.cx + Math.sin(viewTime * 0.18) * 90;
    ty = PITCH.cy;
    zoom = 0.94;
  }
  if (game.phase === "goal") {
    zoom = replayOn ? (phone ? 1.16 : 1.42) : (phone ? 1.08 : 1.24);
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
    zoom = phone ? 1.18 : 1.46;
  } else if (game.phase === "setpiece" && game.setpiece) {
    zoom = game.setpiece.type === "kickoff" ? 1.0 : game.setpiece.type === "throw" ? (phone ? 1.14 : 1.42) : (phone ? 1.1 : 1.28);
  }
  if (game.phase === "win") { zoom = 0.98; tx = PITCH.cx; }

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
  const bob = (game.phase === "goal" ? Math.sin(viewTime * 9 + row) * 2.2 : Math.sin(viewTime * 1.4 + row) * 0.4);
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
    ? [{ y: PITCH.top - 48, z0: 16, z1: 48 }]
    : [
        { y: PITCH.top - 86, z0: 52, z1: 86 },
        { y: PITCH.top - 64, z0: 30, z1: 60 },
        { y: PITCH.top - 44, z0: 12, z1: 40 },
      ];
  rows.forEach((r, i) => drawStandFace(30, WORLD_W - 30, r.y, r.z0, r.z1, i));
  drawStandBanners();
}
// A flag for each team, hung on the far stand. A few slices make the
// cloth ripple. Low quality draws them flat so phones stay smooth.
function drawStandBanners() {
  if (!TEAMS.blue || !TEAMS.blue.kit) return;
  const spots = [
    { team: "blue", x: PITCH.cx - 340 },
    { team: "red", x: PITCH.cx + 220 },
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
    ? [{ y: PITCH.bottom + 36, z0: 0, z1: 9 }]
    : [
        { y: PITCH.bottom + 30, z0: 0, z1: 8 },
        { y: PITCH.bottom + 48, z0: 3, z1: 12 },
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

function drawPitchEyes() {
  const sub = fpSubject();
  if (sub) {
    const fl = Math.hypot(sub.fx || 1, sub.fy || 0) || 1;
    const far = w2s(sub.x + (sub.fx || 1) / fl * 5000, sub.y + (sub.fy || 0) / fl * 5000, 0);
    const hy = far.behind ? VIEW_H * 0.42 : clamp(far.y, 0, VIEW_H);
    ctx.fillStyle = "#145226";
    ctx.fillRect(0, hy, VIEW_W, VIEW_H - hy + 2);
  }
  const step = PITCH.w / 14;
  for (let x = PITCH.left - step; x < PITCH.right + step; x += step) {
    for (let y = PITCH.top - step; y < PITCH.bottom + step; y += step) {
      const x2 = x + step, y2 = y + step;
      const a = w2s(x, y, 0), b = w2s(x2, y, 0), c = w2s(x2, y2, 0), d = w2s(x, y2, 0);
      if (a.behind || b.behind || c.behind || d.behind) continue;
      const ix = x + step * 0.5, iy = y + step * 0.5;
      const on = ix >= PITCH.left && ix < PITCH.right && iy >= PITCH.top && iy < PITCH.bottom;
      const stripe = Math.floor((ix - PITCH.left) / step);
      const col = !on ? "#145226" : (stripe % 2 ? "#17692c" : "#1e7c36");
      quad(a, b, c, d, col);
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
    ctx.fillStyle = "#ffd33d";
    ctx.fillRect(H * 0.1, -H * 0.74, H * 0.09, H * 0.05);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.strokeRect(H * 0.1, -H * 0.74, H * 0.09, H * 0.05);
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
  const foot = w2s(p.x, p.y, 0);
  if (foot.behind) return;
  const H = 34 * ZMUL * foot.s * (p.tall || 1);
  const mine = isLocal(c);
  const nm = typeof shownName === "function" ? shownName(p) : (p.name || "");
  const label = (labelFor(c) || "") + "  #" + p.num;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold " + Math.max(11, Math.round(12 + foot.s * 2)) + "px Arial";
  const y = foot.y - H - 12;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.strokeText(label, foot.x, y);
  ctx.fillStyle = mine ? "#ffd33d" : TEAMS[p.team].ui;
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
  if (mine) {
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

  drawBoards(true);
  drawNearStands();
  for (const o of crew) if (o.side === "near") drawOfficial(o);
  // Both arms are drawn last, so the hands stay on the ball above the head.
  if (!replayOn) drawThrowArmsOnTop(cast);
  drawTower(PITCH.left + 48, PITCH.bottom + 14, false);
  drawTower(PITCH.right - 48, PITCH.bottom + 14, false);
  drawPenaltyAids();

  if (!replayOn && controllers) {
    for (const c of controllers) {
      if (!c.cpu && c.active && !c.active.sentOff && (inMatch() || game.phase === "win")) drawPlayerHud(c.active, c);
    }
  }

  drawVignette();
  updateConfetti();
  if (showHud()) {
    drawScoreboard();
    drawCommentary();
    drawRefPopups();
    drawMatchBugs(replayOn);
    if (!game.shootout && game.phase !== "goal") drawMinimap();
  }
  drawConfetti();
  ballSrc = ball;
  considerQuality();
}

function drawCrosshair() {
  const x = VIEW_W * 0.5, y = VIEW_H * 0.56;
  ctx.strokeStyle = "rgba(255,211,61,0.92)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 12, y); ctx.lineTo(x - 4, y);
  ctx.moveTo(x + 4, y); ctx.lineTo(x + 12, y);
  ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 4);
  ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 12);
  ctx.stroke();
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
