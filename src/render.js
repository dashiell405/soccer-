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

