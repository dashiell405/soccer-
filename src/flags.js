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
  const wave = opts.wave && height >= 32;
  return "<span class='flagBadge" + (wave ? " wave" : "") + "' style='height:" + height + "px;width:" + w + "px'>" +
    "<img alt='' width='" + w + "' height='" + height + "' src='" + src + "'>" +
    (height >= 28 ? "<i class='shine'></i>" : "") + "</span>";
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
