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
      width: min(440px, calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right)));
      background: rgba(8, 16, 28, .97); border: 2px solid #e8c547; border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0,0,0,.55); box-sizing: border-box;
    }
    #adminPrompt {
      left: 50%; top: 18vh; transform: translateX(-50%);
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
      max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 12px);
      display: flex; flex-direction: column; overflow: hidden; padding: 0;
      touch-action: manipulation;
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
    #adminBar h2 { flex: 1; margin: 0; font-size: 18px; text-align: left; line-height: 1.2; }
    .adminGrip {
      width: 18px; height: 22px; display: grid; grid-template-columns: 4px 4px;
      grid-auto-rows: 4px; gap: 3px 4px; align-content: center; flex: 0 0 auto;
    }
    .adminGrip i { display: block; width: 4px; height: 4px; border-radius: 50%; background: #e8c547; }
    #adminMin {
      min-width: 44px; min-height: 44px; margin: 0; padding: 0;
      font-size: 26px; line-height: 1;
    }
    #adminBody {
      overflow: auto; -webkit-overflow-scrolling: touch; touch-action: pan-y;
      padding: 8px 12px 12px; overscroll-behavior: contain;
    }
    #adminPanel button, #adminPrompt button, #adminBubble {
      font: inherit; font-weight: 700; min-height: 44px; margin: 3px; padding: 8px 10px;
      border-radius: 10px; border: 1px solid rgba(255,255,255,.35);
      background: #1d4e34; color: #fff; cursor: pointer; touch-action: manipulation;
    }
    #adminPanel button.on { background: #e6b325; color: #1a1404; border-color: #ffe27a; }
    #adminPanel .grid { display: flex; flex-wrap: wrap; justify-content: center; }
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
      <button type="button" id="adminMin" aria-label="Collapse helpers">–</button>
    </div>
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
    <div class="row">
      <button type="button" id="adminReset">Put everything back</button>
      <button type="button" id="adminPlace">Reset position</button>
      <button type="button" id="adminLock">Lock</button>
    </div>
    </div>
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
      return { x: Number(raw.x), y: Number(raw.y), collapsed: !!raw.collapsed };
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
  function savePlace() {
    const el = bubble.hidden ? panel : bubble;
    if (el.hidden) return;
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify({
        x: Math.round(parseFloat(el.style.left) || 0),
        y: Math.round(parseFloat(el.style.top) || 0),
        collapsed: !bubble.hidden,
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
    put(panel, x, y, "panel");
    refreshPanel();
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
    const el = !panel.hidden ? panel : (!bubble.hidden ? bubble : null);
    if (!el) return;
    put(el, parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0, el === bubble ? "bubble" : "panel");
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
  const bar = document.getElementById("adminBar");
  bar.addEventListener("pointerdown", (e) => beginDrag(bar, e));
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
    if (btn.id === "adminPlace") { resetPlace(); return; }
    if (btn.id === "adminLock") {
      const s = liveSim();
      if (s && s.admin) s.admin("reset");
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
    if (btn.id === "adminReset") { run("reset"); return; }
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
