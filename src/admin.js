/* Hidden helpers for this device. The passcode is never stored.
   Only a PBKDF2 check lives here. A wrong guess waits a moment. */
(function () {
  const STORE = "soccerAdminUnlock";
  const SALT_HEX = "6cd0e2744c3aee0074e44c5a8076a173";
  const ITERATIONS = 310000;
  const KEY_HEX = "1cf7392fec330b8a7b071bf1793508f81b52ce4c54633cd934fc2f96aa40dedb";
  const EXPECT = hexToBytes(KEY_HEX);
  let taps = 0;
  let lastTap = 0;
  let coolUntil = 0;
  let checking = false;

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function timingEqual(got, expect) {
    const n = expect.length;
    let diff = got && got.length === n ? 0 : 1;
    for (let i = 0; i < n; i++) diff |= ((got && got[i]) || 0) ^ expect[i];
    return diff === 0;
  }
  function unlocked() {
    try { return localStorage.getItem(STORE) === "yes"; } catch (e) { return false; }
  }
  function setUnlocked(on) {
    try {
      if (on) localStorage.setItem(STORE, "yes");
      else localStorage.removeItem(STORE);
    } catch (e) { /* private mode */ }
  }
  async function derive(pass) {
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt: hexToBytes(SALT_HEX),
      iterations: ITERATIONS,
      hash: "SHA-256",
    }, material, EXPECT.length * 8);
    return new Uint8Array(bits);
  }

  function liveSim() {
    if (typeof netIsHost === "function" && netIsHost() && typeof hosted !== "undefined" && hosted && hosted.sim) return hosted.sim;
    if (typeof sim !== "undefined" && sim && sim.admin) return sim;
    return null;
  }
  function guestBlocked() {
    return typeof netRole === "string" && netRole === "guest";
  }
  function canUse() {
    if (guestBlocked()) return false;
    return !!liveSim();
  }

  function el(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    return wrap.firstElementChild;
  }

  const style = document.createElement("style");
  style.textContent = `
    #menu .coverBanner { pointer-events: auto; }
    #adminLock, #adminPanel, #adminPrompt, #adminDebug, #adminBubble {
      font-family: "Trebuchet MS", Arial, sans-serif; color: #fff;
    }
    #adminPrompt, #adminPanel {
      position: fixed; z-index: 90;
      background: rgba(8, 16, 28, .97); border: 2px solid #e8c547; border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0,0,0,.55); box-sizing: border-box;
    }
    #adminPrompt {
      left: 50%; top: 18vh; transform: translateX(-50%);
      width: min(440px, calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right)));
      padding: 16px; text-align: center;
    }
    #adminPrompt h2 { margin: 0 0 8px; font-size: 22px; }
    #adminPrompt input {
      font: inherit; font-size: 18px; width: 100%; box-sizing: border-box;
      padding: 10px; border-radius: 10px; border: 1px solid #fff; margin: 8px 0;
    }
    #adminPrompt .row, #adminPanel .row { margin: 8px 0; }
    #adminWrong { min-height: 1.2em; color: #ffb4b4; font-weight: 700; }
    #adminPanel {
      z-index: 80; left: 0; top: 0; margin: 0;
      width: 420px; height: 520px;
      display: flex; flex-direction: column; overflow: hidden; padding: 0;
      font-size: 15px;
    }
    #adminPanel[hidden], #adminBubble[hidden], #adminShield[hidden] { display: none !important; }
    #adminBar {
      display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
      padding: 6px 6px 6px 12px; margin: 0;
      background: rgba(232, 197, 71, .16);
      border-bottom: 1px solid rgba(232, 197, 71, .5);
      border-radius: 14px 14px 0 0;
      cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
    }
    #adminPanel.adminDragging #adminBar, #adminBubble.adminDragging { cursor: grabbing; }
    #adminBar h2 {
      flex: 1; margin: 0; min-width: 0; font-size: 1.15em; text-align: left; line-height: 1.2;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .adminSizes { display: flex; flex: 0 0 auto; gap: 2px; }
    .adminSizes button {
      min-width: 40px; min-height: 44px; margin: 0; padding: 0 6px;
      font-size: 15px; line-height: 1;
    }
    .adminSizes button.on { background: #e6b325; color: #1a1404; border-color: #ffe27a; }
    #adminPanel[data-fit="s"] #adminBar { flex-wrap: wrap; row-gap: 2px; }
    #adminPanel[data-fit="s"] #adminBar h2 { order: 1; }
    #adminPanel[data-fit="s"] #adminMin { order: 2; }
    #adminPanel[data-fit="s"] .adminSizes { order: 3; flex: 1 0 100%; justify-content: flex-end; }
    .adminGrip {
      width: 18px; height: 22px; display: grid; grid-template-columns: 4px 4px;
      grid-auto-rows: 4px; gap: 3px 4px; align-content: center; flex: 0 0 auto;
    }
    .adminGrip i { display: block; width: 4px; height: 4px; border-radius: 50%; background: #e8c547; }
    #adminMin {
      min-width: 44px; min-height: 44px; margin: 0; padding: 0;
      font-size: 26px; line-height: 1;
    }
    #adminScroll { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }
    #adminBody {
      flex: 1 1 auto; min-height: 0; width: 100%;
      overflow-x: hidden; overflow-y: scroll;
      -webkit-overflow-scrolling: touch; touch-action: pan-y;
      overscroll-behavior: contain;
      padding: 8px 18px 36px 12px;
      scrollbar-width: none;
    }
    #adminBody::-webkit-scrollbar { width: 0; height: 0; }
    #adminRail {
      position: absolute; right: 4px; top: 8px; bottom: 10px; width: 8px;
      border-radius: 8px; background: rgba(255,255,255,.16);
      pointer-events: none;
    }
    #adminThumb {
      display: block; width: 8px; min-height: 28px; border-radius: 8px;
      background: #e8c547; box-shadow: 0 0 0 1px rgba(0,0,0,.45);
    }
    #adminBody.can-up { box-shadow: inset 0 22px 16px -14px rgba(0,0,0,.88); }
    #adminBody.can-down { box-shadow: inset 0 -26px 18px -12px rgba(0,0,0,.9); }
    #adminBody.can-up.can-down { box-shadow: inset 0 22px 16px -14px rgba(0,0,0,.88), inset 0 -26px 18px -12px rgba(0,0,0,.9); }
    #adminPanel button, #adminPrompt button, #adminBubble {
      font: inherit; font-weight: 700; min-height: var(--admin-hit, 44px); margin: 3px; padding: 8px 10px;
      border-radius: 10px; border: 1px solid rgba(255,255,255,.35);
      background: #1d4e34; color: #fff; cursor: pointer; touch-action: manipulation;
    }
    #adminPanel button.on { background: #e6b325; color: #1a1404; border-color: #ffe27a; }
    #adminBody button, #adminBody label, #adminBody select, #adminBody input, #adminBody .hint {
      touch-action: pan-y;
    }
    #adminPanel .grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.4em), 1fr));
      gap: 6px; justify-content: stretch;
    }
    #adminPanel .grid button { margin: 0; width: 100%; }
    #adminPanel .row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px; }
    #adminPanel[data-fit="s"] .row label { font-size: 0.92em; }
    #adminPanel .team100 { align-items: stretch; }
    #adminPanel .team100 select { min-height: 44px; width: 100%; max-width: 100%; }
    #adminPanel .team100 .keep, #adminPanel .hint { font-size: 14px; line-height: 1.3; }
    #adminPanel .hint { opacity: .85; flex: 1 0 100%; text-align: center; }
    #adminCup { margin: 8px 0 4px; padding-top: 8px; border-top: 1px solid rgba(232, 197, 71, .45); }
    #adminCup[hidden] { display: none !important; }
    #adminCup h3 { margin: 0 0 4px; text-align: center; color: #e8c547; font-size: 1.05em; }
    #adminCupState { margin: 0 0 6px; text-align: center; font-size: 13px; line-height: 1.35; color: #ffd27a; }
    #adminCup select { min-height: 44px; max-width: 100%; }
    #adminCup input[type=number] { width: 58px; }
    #adminPanel[data-fit="s"] #adminCup .grid { grid-template-columns: 1fr; }
    #adminPanel #adminResize {
      position: absolute; right: 0; bottom: 0; z-index: 2;
      width: 44px; height: 44px; min-width: 44px; min-height: 44px; margin: 0; padding: 0;
      border: 0; border-radius: 0 0 14px 0; background: transparent; color: transparent;
      cursor: nwse-resize; touch-action: none;
    }
    #adminResize::after {
      content: ""; position: absolute; right: 7px; bottom: 7px; width: 16px; height: 16px;
      background:
        linear-gradient(135deg, transparent 0 45%, #e8c547 45% 58%, transparent 58% 68%, #e8c547 68% 80%, transparent 80%);
      pointer-events: none;
    }
    #adminPanel.adminResizing #adminResize { cursor: nwse-resize; }
    #adminPanel input[type=number] {
      font: inherit; font-size: 16px; width: 64px; padding: 8px; border-radius: 8px; border: 1px solid #fff;
    }
    #adminPanel select { font: inherit; font-size: 16px; max-width: 100%; padding: 8px; border-radius: 8px; }
    #adminNote { font-size: 14px; color: #ffd27a; }
    #adminBubble {
      position: fixed; z-index: 85; left: 0; top: 0; margin: 0;
      width: 56px; height: 56px; min-width: 56px; min-height: 56px; padding: 0;
      border-radius: 50%; border: 2px solid #e8c547;
      background: rgba(8, 16, 28, .96); box-shadow: 0 8px 24px rgba(0,0,0,.5);
      display: flex; align-items: center; justify-content: center;
      touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none;
    }
    #adminShield {
      position: fixed; inset: 0; z-index: 75; background: transparent;
      touch-action: none; cursor: grabbing;
    }
    #adminDebug {
      position: fixed; z-index: 70; left: 8px; top: 8px; padding: 6px 8px;
      background: rgba(0,0,0,.72); border-radius: 8px; font: 12px/1.35 ui-monospace, monospace;
      white-space: pre; pointer-events: none;
    }
    #adminBubble { box-sizing: border-box; margin: 0; padding: 0; }
    #adminMin { margin: 0; }
    #adminPanel .adminSizes button, #adminPanel #adminMin {
      min-width: 40px; min-height: 44px; margin: 0;
    }
  `;
  document.head.appendChild(style);

  const prompt = el(`<div id="adminPrompt" hidden>
    <h2>Helpers code</h2>
    <p>Type the secret code for this device.</p>
    <input id="adminCode" type="password" autocomplete="off" maxlength="64" aria-label="Secret code">
    <div id="adminWrong"></div>
    <div class="row">
      <button type="button" id="adminGo">Unlock</button>
      <button type="button" id="adminCancel">Cancel</button>
    </div>
  </div>`);
  const panel = el(`<div id="adminPanel" hidden>
    <div id="adminBar">
      <span class="adminGrip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <h2>Game helpers</h2>
      <div class="adminSizes" role="group" aria-label="Panel size">
        <button type="button" data-size="s" aria-label="Small">S</button>
        <button type="button" data-size="m" aria-label="Medium">M</button>
        <button type="button" data-size="l" aria-label="Large">L</button>
      </div>
      <button type="button" id="adminMin" aria-label="Collapse helpers">–</button>
    </div>
    <div id="adminScroll">
    <div id="adminBody">
    <p id="adminNote"></p>
    <div class="grid">
      <button type="button" data-act="goal" data-team="blue" data-n="1">Blue goal +</button>
      <button type="button" data-act="goal" data-team="blue" data-n="-1">Blue goal −</button>
      <button type="button" data-act="goal" data-team="red" data-n="1">Red goal +</button>
      <button type="button" data-act="goal" data-team="red" data-n="-1">Red goal −</button>
    </div>
    <div class="row">
      <label>Blue <input id="adminBlue" type="number" min="0" max="99" value="0"></label>
      <label>Red <input id="adminRed" type="number" min="0" max="99" value="0"></label>
      <button type="button" id="adminSetScore">Set score</button>
    </div>
    <div class="grid">
      <button type="button" data-act="time" data-n="-30">More time</button>
      <button type="button" data-act="time" data-n="30">Less time</button>
      <button type="button" id="adminClock">Pause clock</button>
      <button type="button" data-act="half">End this half</button>
      <button type="button" data-act="end">End match</button>
    </div>
    <div class="grid">
      <button type="button" data-flag="superSpeed">Super speed</button>
      <button type="button" data-flag="superShot">Super shot</button>
      <button type="button" data-flag="infiniteStamina">Endless energy</button>
      <button type="button" data-flag="perfect">Sticky ball</button>
      <button type="button" data-flag="slow">Slow motion</button>
      <button type="button" data-flag="debug">Show numbers</button>
    </div>
    <div class="grid">
      <button type="button" data-act="kickoff">Back to kick-off</button>
      <button type="button" data-act="switch">Switch player</button>
    </div>
    <div class="row">
      <select id="adminPlayer" aria-label="Which player"></select>
      <button type="button" id="adminRate">Make 100</button>
    </div>
    <div class="row team100">
      <label>Team <select id="adminTeam" aria-label="Which team"></select></label>
      <label class="keep"><input type="checkbox" id="adminTeamKeep"> Save on this device</label>
      <span class="hint">Leave unticked for this match only.</span>
      <button type="button" id="adminTeam100">Make whole team 100</button>
      <button type="button" id="adminTeamUndo">Undo team 100</button>
    </div>
    <div id="adminCup" hidden>
      <h3>Cup</h3>
      <p id="adminCupState"></p>
      <div class="row">
        <button type="button" id="adminCupStart">Start a new cup</button>
        <button type="button" id="adminCupRestart">Restart cup</button>
        <button type="button" id="adminCupUndo">Undo last cup change</button>
      </div>
      <div class="row">
        <label>I play as <select id="adminCupMe" aria-label="Team you play as in the cup"></select></label>
        <button type="button" id="adminCupMeGo">Play as this team</button>
      </div>
      <div class="row">
        <label>Send <select id="adminCupSend" aria-label="Team to send through the cup"></select></label>
      </div>
      <div class="grid">
        <button type="button" data-cup-send="0">Send to Quarterfinal</button>
        <button type="button" data-cup-send="1">Send to Semifinal</button>
        <button type="button" data-cup-send="2">Send to Final</button>
      </div>
      <div class="grid">
        <button type="button" id="adminCupWin">Win this match</button>
        <button type="button" id="adminCupSkip">Skip to next round</button>
      </div>
      <div class="row">
        <label>Match <select id="adminCupMatch" aria-label="Bracket match"></select></label>
        <label>Winner <select id="adminCupWinner" aria-label="Who wins this match"></select></label>
        <label>Score <input id="adminCupScoreA" type="number" min="0" max="30" aria-label="Goals for the first team"> - <input id="adminCupScoreB" type="number" min="0" max="30" aria-label="Goals for the second team"></label>
        <button type="button" id="adminCupResult">Set this result</button>
      </div>
      <div class="row">
        <label>Final <select id="adminCupFinalA" aria-label="First finalist"></select></label>
        <label>vs <select id="adminCupFinalB" aria-label="Second finalist"></select></label>
        <button type="button" id="adminCupFinal">Jump to Final</button>
      </div>
    </div>
    <div class="row">
      <button type="button" id="adminReset">Put everything back</button>
      <button type="button" id="adminPlace" title="Reset position and size">Reset position</button>
      <button type="button" id="adminLock">Lock</button>
    </div>
    </div>
    <div id="adminRail" aria-hidden="true"><i id="adminThumb"></i></div>
    </div>
    <button type="button" id="adminResize" aria-label="Resize helpers"></button>
  </div>`);
  const bubble = el(`<button type="button" id="adminBubble" hidden aria-label="Open game helpers"><span class="adminGrip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></button>`);
  const shield = el(`<div id="adminShield" hidden></div>`);
  const debug = el(`<div id="adminDebug" hidden></div>`);
  document.body.appendChild(shield);
  document.body.appendChild(prompt);
  document.body.appendChild(panel);
  document.body.appendChild(bubble);
  document.body.appendChild(debug);

  const PLACE_KEY = "soccerAdminPlace";
  const DRAG_SLOP = 8;
  let drag = null;
  let swallowClick = false;

  function safePads() {
    const probe = document.getElementById("safeProbe");
    if (!probe) return { left: 0, top: 0, right: 0, bottom: 0 };
    const s = getComputedStyle(probe);
    return {
      left: parseFloat(s.borderLeftWidth) || 0,
      top: parseFloat(s.borderTopWidth) || 0,
      right: parseFloat(s.borderRightWidth) || 0,
      bottom: parseFloat(s.borderBottomWidth) || 0,
    };
  }
  function viewportBox() {
    const vv = window.visualViewport;
    const width = vv ? vv.width : window.innerWidth;
    const height = vv ? vv.height : window.innerHeight;
    const ox = vv ? vv.offsetLeft : 0;
    const oy = vv ? vv.offsetTop : 0;
    const pad = safePads();
    return {
      left: ox + pad.left,
      top: oy + pad.top,
      right: ox + width - pad.right,
      bottom: oy + height - pad.bottom,
    };
  }
  function loadPlace() {
    try {
      const raw = JSON.parse(localStorage.getItem(PLACE_KEY) || "null");
      if (!raw || typeof raw !== "object") return null;
      if (!isFinite(raw.x) || !isFinite(raw.y)) return null;
      return {
        x: Number(raw.x), y: Number(raw.y), collapsed: !!raw.collapsed,
        w: isFinite(raw.w) ? Number(raw.w) : 0,
        h: isFinite(raw.h) ? Number(raw.h) : 0,
      };
    } catch (e) { return null; }
  }
  function place(el, x, y) {
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "none";
  }
  function clampPos(x, y, el) {
    const b = viewportBox();
    const w = el.offsetWidth || 56;
    const h = el.offsetHeight || 56;
    const maxX = Math.max(b.left, b.right - w);
    const maxY = Math.max(b.top, b.bottom - h);
    return {
      x: Math.min(Math.max(b.left, x), maxX),
      y: Math.min(Math.max(b.top, y), maxY),
    };
  }
  function defaultPos(el, kind) {
    const b = viewportBox();
    const w = el.offsetWidth || (kind === "bubble" ? 56 : 320);
    const h = el.offsetHeight || (kind === "bubble" ? 56 : 240);
    if (kind === "bubble") return clampPos(b.right - w - 8, b.top + 60, el);
    return clampPos(b.left + Math.max(0, (b.right - b.left - w) / 2), b.bottom - h - 8, el);
  }
  const MIN_W = 240;
  const MIN_H = 220;
  function isPhone() {
    const b = viewportBox();
    const vw = b.right - b.left;
    const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    return vw < 700 || (coarse && vw < 900);
  }
  function viewportMax() {
    const b = viewportBox();
    return {
      w: Math.max(MIN_W, b.right - b.left),
      h: Math.max(MIN_H, b.bottom - b.top),
    };
  }
  // fixed:true stops the size at the screen edge from the panel's current corner,
  // so dragging the grip never slides the panel.
  function clampSize(w, h, fixed) {
    const cap = viewportMax();
    let maxW = cap.w, maxH = cap.h;
    if (fixed) {
      const b = viewportBox();
      const left = parseFloat(panel.style.left);
      const top = parseFloat(panel.style.top);
      if (isFinite(left)) maxW = Math.max(MIN_W, b.right - left);
      if (isFinite(top)) maxH = Math.max(MIN_H, b.bottom - top);
    }
    return {
      w: Math.round(Math.min(Math.max(MIN_W, w), maxW)),
      h: Math.round(Math.min(Math.max(MIN_H, h), maxH)),
    };
  }
  function defaultSize() {
    const cap = viewportMax();
    if (isPhone()) return clampSize(Math.min(300, cap.w), Math.min(420, Math.round(cap.h * 0.62)));
    return clampSize(Math.min(440, cap.w), Math.min(560, Math.round(cap.h * 0.72)));
  }
  function presetSize(which) {
    const phone = isPhone();
    const table = phone
      ? { s: { w: 260, h: 340 }, m: { w: 320, h: 500 }, l: { w: 520, h: 700 } }
      : { s: { w: 300, h: 380 }, m: { w: 440, h: 560 }, l: { w: 700, h: 740 } };
    const t = table[which] || table.m;
    return clampSize(t.w, t.h);
  }
  function markPreset(w, h) {
    const buttons = panel.querySelectorAll(".adminSizes button");
    let best = null, bestD = 36;
    buttons.forEach((btn) => {
      const s = presetSize(btn.dataset.size);
      const d = Math.hypot(s.w - w, s.h - h);
      btn.classList.remove("on");
      if (d < bestD) { bestD = d; best = btn; }
    });
    if (best) best.classList.add("on");
  }
  function applySize(w, h, fixed) {
    const s = clampSize(w, h, fixed);
    panel.style.width = s.w + "px";
    panel.style.height = s.h + "px";
    const font = Math.round(Math.min(18, Math.max(13, 8 + s.w / 46)));
    panel.style.fontSize = font + "px";
    panel.style.setProperty("--admin-hit", (s.w < 320 ? 40 : 44) + "px");
    panel.dataset.fit = s.w < 340 ? "s" : (s.w >= 520 ? "l" : "m");
    markPreset(s.w, s.h);
    markAdminScroll();
    return s;
  }
  function savePlace() {
    const el = bubble.hidden ? panel : bubble;
    if (el.hidden) return;
    const prev = (() => { try { return JSON.parse(localStorage.getItem(PLACE_KEY) || "null") || {}; } catch (e) { return {}; } })();
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify({
        x: Math.round(parseFloat(el.style.left) || 0),
        y: Math.round(parseFloat(el.style.top) || 0),
        collapsed: !bubble.hidden,
        w: Math.round(parseFloat(panel.style.width) || prev.w || 0),
        h: Math.round(parseFloat(panel.style.height) || prev.h || 0),
      }));
    } catch (e) { /* private mode */ }
  }
  function put(el, x, y, kind) {
    const p = (x == null || y == null) ? defaultPos(el, kind) : clampPos(x, y, el);
    place(el, p.x, p.y);
  }
  function showPanelAt(x, y) {
    bubble.hidden = true;
    panel.hidden = false;
    const saved = loadPlace();
    if (saved && saved.w >= MIN_W && saved.h >= MIN_H) applySize(saved.w, saved.h);
    else { const d = defaultSize(); applySize(d.w, d.h); }
    put(panel, x, y, "panel");
    // Growing may have been clamped to the old corner. Pull it back on screen.
    const fitted = clampSize(panel.offsetWidth, panel.offsetHeight);
    applySize(fitted.w, fitted.h);
    const left = parseFloat(panel.style.left);
    const top = parseFloat(panel.style.top);
    put(panel, isFinite(left) ? left : x, isFinite(top) ? top : y, "panel");
    refreshPanel();
    requestAnimationFrame(markAdminScroll);
  }
  function showBubbleAt(x, y) {
    panel.hidden = true;
    bubble.hidden = false;
    put(bubble, x, y, "bubble");
  }
  function reveal() {
    const saved = loadPlace();
    if (saved && saved.collapsed) showBubbleAt(saved.x, saved.y);
    else if (saved) showPanelAt(saved.x, saved.y);
    else showPanelAt(null, null);
    savePlace();
  }
  function collapsePanel() {
    showBubbleAt(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0);
    savePlace();
  }
  function expandBubble() {
    showPanelAt(parseFloat(bubble.style.left) || 0, parseFloat(bubble.style.top) || 0);
    savePlace();
  }
  function resetPlace() {
    try { localStorage.removeItem(PLACE_KEY); } catch (e) { /* ignore */ }
    if (!bubble.hidden) showBubbleAt(null, null);
    else showPanelAt(null, null);
    savePlace();
  }
  function keepInside() {
    if (!panel.hidden) {
      const fitted = clampSize(panel.offsetWidth, panel.offsetHeight);
      applySize(fitted.w, fitted.h);
      put(panel, parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0, "panel");
      savePlace();
      return;
    }
    if (!bubble.hidden) {
      put(bubble, parseFloat(bubble.style.left) || 0, parseFloat(bubble.style.top) || 0, "bubble");
      savePlace();
    }
  }
  function applyPreset(which) {
    const s = presetSize(which);
    applySize(s.w, s.h);
    const p = clampPos(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0, panel);
    place(panel, p.x, p.y);
    savePlace();
  }
  function eatNextClick() {
    swallowClick = true;
    shield.hidden = false;
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    const finish = () => {
      swallowClick = false;
      if (!drag) shield.hidden = true;
      window.removeEventListener("click", stop, true);
    };
    window.addEventListener("click", stop, true);
    setTimeout(finish, 80);
  }
  function beginDrag(handle, e) {
    if (e.button != null && e.button !== 0) return;
    const target = handle.id === "adminBubble" ? bubble : panel;
    const rect = target.getBoundingClientRect();
    drag = {
      id: e.pointerId, handle: handle, target: target,
      ox: e.clientX - rect.left, oy: e.clientY - rect.top,
      x0: e.clientX, y0: e.clientY, moved: false,
      fromMin: !!(e.target && e.target.closest && e.target.closest("#adminMin")),
    };
    e.stopPropagation();
    shield.hidden = false;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopPropagation();
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) >= DRAG_SLOP) {
      drag.moved = true;
      drag.target.classList.add("adminDragging");
      shield.hidden = false;
    }
    if (!drag.moved) return;
    e.preventDefault();
    const p = clampPos(e.clientX - drag.ox, e.clientY - drag.oy, drag.target);
    place(drag.target, p.x, p.y);
  }
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const moved = drag.moved;
    const fromMin = drag.fromMin;
    const target = drag.target;
    drag = null;
    target.classList.remove("adminDragging");
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (moved) {
      // The click that follows this drag must not press a button. A later tap still does.
      eatNextClick();
      savePlace();
    } else if (fromMin) {
      eatNextClick();
      collapsePanel();
    } else shield.hidden = true;
  }
  let resizeDrag = null;
  const resizeBtn = document.getElementById("adminResize");
  function endResize(e) {
    if (!resizeDrag || (e && e.pointerId !== resizeDrag.id)) return;
    const moved = resizeDrag.moved;
    resizeDrag = null;
    panel.classList.remove("adminResizing");
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (moved) { eatNextClick(); savePlace(); }
    else shield.hidden = true;
  }
  resizeBtn.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = panel.getBoundingClientRect();
    resizeDrag = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false,
      w: rect.width, h: rect.height,
      left: parseFloat(panel.style.left) || rect.left,
      top: parseFloat(panel.style.top) || rect.top,
    };
    shield.hidden = false;
    panel.classList.add("adminResizing");
    try { resizeBtn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  resizeBtn.addEventListener("pointermove", (e) => {
    if (!resizeDrag || e.pointerId !== resizeDrag.id) return;
    e.preventDefault();
    e.stopPropagation();
    if (!resizeDrag.moved && Math.hypot(e.clientX - resizeDrag.x0, e.clientY - resizeDrag.y0) >= DRAG_SLOP) resizeDrag.moved = true;
    if (!resizeDrag.moved) return;
    const s = clampSize(resizeDrag.w + (e.clientX - resizeDrag.x0), resizeDrag.h + (e.clientY - resizeDrag.y0), true);
    applySize(s.w, s.h, true);
    place(panel, resizeDrag.left, resizeDrag.top);
  });
  resizeBtn.addEventListener("pointerup", endResize);
  resizeBtn.addEventListener("pointercancel", endResize);
  resizeBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  const bar = document.getElementById("adminBar");
  bar.addEventListener("pointerdown", (e) => {
    if (e.target && e.target.closest && e.target.closest(".adminSizes")) return;
    beginDrag(bar, e);
  });
  bar.addEventListener("pointermove", moveDrag);
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);
  bar.addEventListener("contextmenu", (e) => e.preventDefault());
  bubble.addEventListener("pointerdown", (e) => beginDrag(bubble, e));
  bubble.addEventListener("pointermove", moveDrag);
  bubble.addEventListener("pointerup", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.moved;
    endDrag(e);
    if (!moved) { eatNextClick(); expandBubble(); }
  });
  bubble.addEventListener("pointercancel", endDrag);
  bubble.addEventListener("contextmenu", (e) => e.preventDefault());
  shield.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); });
  shield.addEventListener("pointermove", (e) => { e.preventDefault(); e.stopPropagation(); });
  shield.addEventListener("pointerup", (e) => { e.preventDefault(); e.stopPropagation(); });
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());
  panel.addEventListener("pointerup", (e) => e.stopPropagation());
  const adminBody = document.getElementById("adminBody");
  function markAdminScroll() {
    if (!adminBody) return;
    const max = adminBody.scrollHeight - adminBody.clientHeight;
    adminBody.classList.toggle("can-up", adminBody.scrollTop > 6);
    adminBody.classList.toggle("can-down", max > 8 && adminBody.scrollTop < max - 6);
    const rail = document.getElementById("adminRail");
    const thumb = document.getElementById("adminThumb");
    if (!rail || !thumb) return;
    const room = max > 8;
    rail.style.opacity = room ? "1" : "0";
    const track = rail.clientHeight || 1;
    const ratio = adminBody.scrollHeight > 0 ? adminBody.clientHeight / adminBody.scrollHeight : 1;
    const h = Math.max(28, Math.round(track * Math.min(1, ratio)));
    const travel = Math.max(0, track - h);
    const top = max > 0 ? (adminBody.scrollTop / max) * travel : 0;
    thumb.style.height = h + "px";
    thumb.style.transform = "translateY(" + Math.round(top) + "px)";
  }
    if (adminBody) {
    adminBody.addEventListener("scroll", markAdminScroll, { passive: true });
    adminBody.addEventListener("wheel", (e) => {
      e.stopPropagation();
      const max = adminBody.scrollHeight - adminBody.clientHeight;
      const dy = e.deltaY || 0;
      const up = dy < 0 && adminBody.scrollTop <= 0;
      const down = dy > 0 && adminBody.scrollTop >= max - 1;
      if (up || down || max <= 1) e.preventDefault();
    }, { passive: false });
    adminBody.addEventListener("touchmove", (e) => {
      e.stopPropagation();
    }, { passive: true });
    let bodyGesture = null;
    adminBody.addEventListener("pointerdown", (e) => {
      if (e.target && e.target.closest && e.target.closest("#adminBar, #adminResize")) return;
      bodyGesture = { id: e.pointerId, y: e.clientY, moved: false };
    });
    adminBody.addEventListener("pointermove", (e) => {
      if (!bodyGesture || e.pointerId !== bodyGesture.id) return;
      if (Math.abs(e.clientY - bodyGesture.y) > 8) bodyGesture.moved = true;
      e.stopPropagation();
    });
    adminBody.addEventListener("pointerup", (e) => {
      if (bodyGesture && bodyGesture.id === e.pointerId && bodyGesture.moved) swallowClick = true;
      bodyGesture = null;
    });
    adminBody.addEventListener("pointercancel", () => { bodyGesture = null; });
  }
  window.addEventListener("resize", keepInside);
  window.addEventListener("orientationchange", keepInside);
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", keepInside);
    visualViewport.addEventListener("scroll", keepInside);
  }

  function showPrompt() {
    if (unlocked()) { hidePrompt(); reveal(); return; }
    prompt.hidden = false;
    const wrong = document.getElementById("adminWrong");
    if (wrong && Date.now() >= coolUntil) wrong.textContent = "";
    const input = document.getElementById("adminCode");
    if (input) { input.value = ""; input.focus(); }
  }
  function hidePrompt() { prompt.hidden = true; }
  function showPanel() { hidePrompt(); reveal(); }
  function hidePanel() {
    panel.hidden = true;
    bubble.hidden = true;
    shield.hidden = true;
  }

  function noteTitleTap() {
    const now = Date.now();
    if (now - lastTap > 2500) taps = 0;
    lastTap = now;
    taps++;
    if (taps >= 7) { taps = 0; showPrompt(); }
  }
  document.addEventListener("pointerup", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest(".coverBanner") || t.closest("#menu h1") || t.closest("#home h1")) noteTitleTap();
  });
  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
    if (e.shiftKey && (e.code === "KeyA" || e.key === "A")) {
      e.preventDefault();
      showPrompt();
    }
  }, true);

  document.getElementById("adminCancel").addEventListener("click", hidePrompt);
  document.getElementById("adminGo").addEventListener("click", submitCode);
  document.getElementById("adminCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitCode(); }
  });

  async function submitCode() {
    const btn = document.getElementById("adminGo");
    const wrong = document.getElementById("adminWrong");
    const input = document.getElementById("adminCode");
    if (checking || Date.now() < coolUntil) return;
    checking = true;
    btn.disabled = true;
    wrong.textContent = "Checking…";
    let ok = false;
    try {
      const got = await derive(input.value || "");
      ok = timingEqual(got, EXPECT);
    } catch (e) { ok = false; }
    checking = false;
    btn.disabled = false;
    if (ok) {
      setUnlocked(true);
      wrong.textContent = "";
      showPanel();
    } else {
      coolUntil = Date.now() + 2500;
      wrong.textContent = "Wrong code";
      btn.disabled = true;
      setTimeout(() => { if (Date.now() >= coolUntil) btn.disabled = false; }, 2500);
    }
  }

  function run(action, arg) {
    const s = liveSim();
    if (!canUse() || !s) {
      const note = document.getElementById("adminNote");
      if (note) note.textContent = guestBlocked()
        ? "Only the host can use these in an online game."
        : "Start a match first.";
      return null;
    }
    const out = s.admin(action, arg);
    refreshPanel();
    if (action === "kickoff" && typeof showScreen === "function" && typeof atMenu !== "undefined" && !atMenu) {
      try { showScreen(null); } catch (e) { /* online has no menu screen */ }
    }
    return out;
  }
  function refreshPanel() {
    const s = liveSim();
    const note = document.getElementById("adminNote");
    fillTeamSelect();
    fillCupPanel();
    markAdminScroll();
    if (!s || !s.admin) {
      if (note) note.textContent = guestBlocked() ? "Only the host can use these in an online game." : "";
      return;
    }
    const a = s.admin("get");
    if (note) note.textContent = guestBlocked() ? "Only the host can use these in an online game." : "";
    document.getElementById("adminClock").textContent = a.clockPaused ? "Play clock" : "Pause clock";
    document.getElementById("adminClock").classList.toggle("on", !!a.clockPaused);
    panel.querySelectorAll("[data-flag]").forEach((btn) => {
      btn.classList.toggle("on", !!a[btn.getAttribute("data-flag")]);
    });
    const g = s.game;
    if (g && g.score) {
      document.getElementById("adminBlue").value = g.score.blue;
      document.getElementById("adminRed").value = g.score.red;
    }
    fillTeamSelect();
    const sel = document.getElementById("adminPlayer");
    const keep = sel.value;
    sel.innerHTML = "";
    (s.roster || []).forEach((p, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = (p.team === "blue" ? "Blue" : "Red") + " #" + p.num + " " + (p.name || "");
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
    fillCupPanel();
    markAdminScroll();
  }
  function fillTeamSelect() {
    const sel = document.getElementById("adminTeam");
    if (!sel) return;
    const s = liveSim();
    const mine = s && (s.controllers || []).find((c) => c && !c.cpu);
    const mySide = mine && mine.team;
    const opts = [];
    const seen = {};
    const mark = (id) => (typeof teamShows100 === "function" && teamShows100(id)) ? " \u2605 100" : "";
    const youId = (mySide && s && s.game && s.game.teams[mySide] && s.game.teams[mySide].id)
      || (typeof settings !== "undefined" && settings && settings.blue)
      || "";
    if (s && s.game && s.game.teams) {
      for (const side of ["blue", "red"]) {
        const t = s.game.teams[side];
        if (!t || !t.id || seen[t.id]) continue;
        seen[t.id] = true;
        const who = t.id === youId ? " (you)" : " (on the pitch)";
        opts.push({ v: t.id, label: (t.name || t.id) + who + mark(t.id) });
      }
    }
    if (typeof TEAM_LIST !== "undefined") {
      for (const t of TEAM_LIST) {
        if (seen[t.id]) continue;
        seen[t.id] = true;
        opts.push({ v: t.id, label: t.name + mark(t.id) });
      }
    }
    if (!seen.custom && typeof customTeam === "function" && typeof settings !== "undefined" && settings && settings.custom) {
      const C = customTeam(settings.custom);
      opts.push({ v: "custom", label: (C.name || "My Team") + " (custom)" + mark("custom") });
    }
    const keep = sel.value || youId;
    sel.innerHTML = opts.map((o) => "<option value='" + o.v + "'>" + String(o.label).replace(/</g, "") + "</option>").join("");
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }
  function clearSavedTeam100() {
    if (typeof loadTeam100 !== "function" || typeof setTeam100Saved !== "function") return;
    for (const id of Object.keys(loadTeam100())) setTeam100Saved(id, false);
  }
  function afterTeamChange() {
    if (typeof renderMenu === "function") renderMenu();
    if (typeof paintSquad === "function") paintSquad();
    const blue = document.getElementById("blueTeamSel");
    const red = document.getElementById("redTeamSel");
    if (blue) blue.innerHTML = "";
    if (red) red.innerHTML = "";
    if (typeof renderLobby === "function" && (blue || red)) {
      try { renderLobby(); } catch (e) { /* lobby is not open */ }
    }
  }
  function cupReady() {
    const note = document.getElementById("adminNote");
    if (!unlocked()) {
      if (note) note.textContent = "Unlock the helpers first.";
      return false;
    }
    if (guestBlocked()) {
      if (note) note.textContent = "Only the host can use these in an online game.";
      return false;
    }
    if (typeof cupAdmin !== "function") {
      if (note) note.textContent = "Cups stay on this device.";
      return false;
    }
    return true;
  }
  function optHtml(list, valueKey, labelKey) {
    return list.map((o) => "<option value='" + String(o[valueKey]).replace(/'/g, "") + "'>" + String(o[labelKey]).replace(/</g, "") + "</option>").join("");
  }
  function keepSelect(sel, html, prefer) {
    if (!sel) return;
    const prev = sel.value || prefer || "";
    sel.innerHTML = html;
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else if (sel.options.length) sel.selectedIndex = 0;
  }
  function fillCupWinners() {
    const match = document.getElementById("adminCupMatch");
    const winner = document.getElementById("adminCupWinner");
    if (!match || !winner) return;
    const opt = match.selectedOptions && match.selectedOptions[0];
    const aId = opt && opt.dataset.aId;
    const bId = opt && opt.dataset.bId;
    const aName = opt && opt.dataset.aName;
    const bName = opt && opt.dataset.bName;
    const prev = winner.value;
    if (!aId || !bId) { winner.innerHTML = ""; return; }
    winner.innerHTML = "<option value='" + aId + "'>" + String(aName).replace(/</g, "") + "</option><option value='" + bId + "'>" + String(bName).replace(/</g, "") + "</option>";
    if (prev === bId) winner.value = bId;
  }
  function fillCupPanel() {
    const box = document.getElementById("adminCup");
    if (!box) return;
    const offline = typeof cupAdmin === "function";
    box.hidden = !offline;
    if (!offline) return;
    let state = { active: false, teams: [], matches: [], status: "No cup yet.", youId: "", canUndo: false };
    try { state = cupAdmin("state") || state; } catch (e) { /* cup is offline only */ }
    const status = document.getElementById("adminCupState");
    if (status) status.textContent = state.status || "";
    const teams = state.teams || [];
    const teamHtml = optHtml(teams, "id", "name");
    keepSelect(document.getElementById("adminCupMe"), teamHtml, state.youId);
    keepSelect(document.getElementById("adminCupSend"), teamHtml, state.youId);
    keepSelect(document.getElementById("adminCupFinalA"), teamHtml, state.youId);
    const other = teams.find((t) => t.id !== (document.getElementById("adminCupFinalA") || {}).value);
    keepSelect(document.getElementById("adminCupFinalB"), teamHtml, other && other.id);
    const matchHtml = (state.matches || []).map((m) => "<option value='" + m.key + "' data-a-id='" + m.aId + "' data-b-id='" + m.bId + "' data-a-name='" + String(m.aName).replace(/'/g, "") + "' data-b-name='" + String(m.bName).replace(/'/g, "") + "'>" + String(m.label).replace(/</g, "") + "</option>").join("");
    keepSelect(document.getElementById("adminCupMatch"), matchHtml, "");
    fillCupWinners();
    const start = document.getElementById("adminCupStart");
    const restart = document.getElementById("adminCupRestart");
    if (start) start.hidden = !!state.active;
    if (restart) restart.hidden = !state.active;
    markAdminScroll();
  }
  function runCup(action, arg) {
    if (!cupReady()) return;
    let state = null;
    try { state = cupAdmin(action, arg || {}); } catch (e) { state = { note: "That cup change did not work." }; }
    const note = document.getElementById("adminNote");
    if (note && state && state.note) note.textContent = state.note;
    fillCupPanel();
    markAdminScroll();
  }
  function teamOnPitch(id) {
    const s = liveSim();
    if (!s || !s.roster || !s.game || !s.game.teams) return false;
    return s.roster.some((p) => s.game.teams[p.team] && s.game.teams[p.team].id === id);
  }

  panel.addEventListener("click", (e) => {
    if (swallowClick) {
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const btn = e.target.closest("button");
    if (!btn || !panel.contains(btn)) return;
    if (btn.id === "adminMin") { collapsePanel(); return; }
    if (btn.id === "adminResize") return;
    if (btn.dataset && btn.dataset.size) { applyPreset(btn.dataset.size); return; }
    if (btn.id === "adminPlace") { resetPlace(); return; }
    if (btn.id === "adminLock") {
      clearSavedTeam100();
      const s = liveSim();
      if (s && s.admin) s.admin("reset");
      afterTeamChange();
      setUnlocked(false);
      hidePanel();
      debug.hidden = true;
      return;
    }
    if (btn.id === "adminSetScore") {
      run("score", {
        blue: document.getElementById("adminBlue").value,
        red: document.getElementById("adminRed").value,
      });
      return;
    }
    if (btn.id === "adminClock") {
      const s = liveSim();
      const on = !(s && s.admin("get").clockPaused);
      run("clock", on);
      return;
    }
    if (btn.id === "adminRate") {
      run("rate", document.getElementById("adminPlayer").value);
      return;
    }
    if (btn.id === "adminTeam100" || btn.id === "adminTeamUndo") {
      const note = document.getElementById("adminNote");
      if (!unlocked() || guestBlocked()) {
        if (note) note.textContent = guestBlocked() ? "Only the host can use these in an online game." : "Unlock the helpers first.";
        return;
      }
      const id = document.getElementById("adminTeam").value;
      const save = document.getElementById("adminTeamKeep").checked;
      if (!id) return;
      if (btn.id === "adminTeam100") {
        const onPitch = teamOnPitch(id);
        if (!onPitch && !save) {
          if (note) note.textContent = "That team is not in this match. Tick Save on this device.";
          return;
        }
        if (save && typeof setTeam100Saved === "function") setTeam100Saved(id, true);
        if (onPitch) run("team100", { id: id });
        if (note) note.textContent = save
          ? (onPitch ? "Whole team is 100, saved on this device." : "Saved on this device. They are 100 next time you play them.")
          : "Whole team is 100 for this match.";
      } else {
        if (typeof setTeam100Saved === "function") setTeam100Saved(id, false);
        if (liveSim()) run("teamundo", { id: id });
        if (note) note.textContent = "That team is back to its own stats.";
      }
      afterTeamChange();
      fillTeamSelect();
      return;
    }
    if (btn.dataset && btn.dataset.cupSend != null) {
      runCup("send", { id: document.getElementById("adminCupSend").value, round: Number(btn.dataset.cupSend) });
      return;
    }
    if (btn.id === "adminCupStart") { runCup("start"); return; }
    if (btn.id === "adminCupRestart") { runCup("restart"); return; }
    if (btn.id === "adminCupUndo") { runCup("undo"); return; }
    if (btn.id === "adminCupMeGo") { runCup("me", { id: document.getElementById("adminCupMe").value }); return; }
    if (btn.id === "adminCupWin") { runCup("win"); return; }
    if (btn.id === "adminCupSkip") { runCup("skip"); return; }
    if (btn.id === "adminCupResult") {
      const parts = (document.getElementById("adminCupMatch").value || "").split(":");
      runCup("result", {
        round: Number(parts[0]), index: Number(parts[1]),
        winner: document.getElementById("adminCupWinner").value,
        sa: document.getElementById("adminCupScoreA").value,
        sb: document.getElementById("adminCupScoreB").value,
      });
      return;
    }
    if (btn.id === "adminCupFinal") {
      runCup("final", { a: document.getElementById("adminCupFinalA").value, b: document.getElementById("adminCupFinalB").value });
      return;
    }
    if (btn.id === "adminReset") {
      clearSavedTeam100();
      run("reset");
      afterTeamChange();
      const note = document.getElementById("adminNote");
      if (note && !guestBlocked()) note.textContent = "Everything is back, including team 100.";
      return;
    }
    const flag = btn.getAttribute("data-flag");
    if (flag) {
      const s = liveSim();
      const cur = s && s.admin("get");
      run("flag", { name: flag, on: !(cur && cur[flag]) });
      return;
    }
    const act = btn.getAttribute("data-act");
    if (act === "goal") run("goal", { team: btn.getAttribute("data-team"), n: Number(btn.getAttribute("data-n")) });
    else if (act === "time") run("time", Number(btn.getAttribute("data-n")));
    else if (act) run(act);
  });
  const cupMatchSel = document.getElementById("adminCupMatch");
  if (cupMatchSel) cupMatchSel.addEventListener("change", fillCupWinners);

  let frames = 0, fpsStamp = performance.now(), fps = 0;
  function debugTick() {
    frames++;
    const now = performance.now();
    if (now - fpsStamp > 500) {
      fps = Math.round(frames * 1000 / (now - fpsStamp));
      frames = 0;
      fpsStamp = now;
    }
    const s = liveSim();
    const on = s && s.game && s.game.admin && s.game.admin.debug && unlocked();
    if (!on) { debug.hidden = true; }
    else {
      const b = s.ball;
      const c = (s.controllers || []).find((k) => !k.cpu && k.active);
      const you = c && c.active;
      debug.hidden = false;
      debug.textContent = "FPS " + fps
        + "\nBall " + Math.round(b.x) + ", " + Math.round(b.y)
        + "\nYou " + (you ? you.name + " " + Math.round(you.x) + ", " + Math.round(you.y) : "—");
    }
    requestAnimationFrame(debugTick);
  }
  requestAnimationFrame(debugTick);
})();
