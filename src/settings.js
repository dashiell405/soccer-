/* =====================================================================
   SETTINGS - one list of options, saved on this device
   ---------------------------------------------------------------------
   Add a setting by putting a field in SETTINGS_TABS. The menu, the
   save file and Reset to defaults all come from that list.
   Gameplay rules here are for matches on this device. Online, the
   host's room choices are the ones that count.
   ===================================================================== */
const SETTINGS_KEY = "soccerOptions";

const SETTINGS_TABS = [
  {
    id: "controls", title: "Controls",
    fields: [
      { id: "lookTouch", label: "Look sensitivity (touch)", type: "range", min: 0.4, max: 2, step: 0.1, def: 1 },
      { id: "lookMouse", label: "Look sensitivity (mouse)", type: "range", min: 0.4, max: 2, step: 0.1, def: 1 },
      { id: "joySens", label: "Joystick sensitivity", type: "range", min: 0.5, max: 1.8, step: 0.1, def: 1 },
      { id: "joyDead", label: "Joystick dead zone", type: "range", min: 0, max: 0.4, step: 0.05, def: 0.15 },
      { id: "invertY", label: "Invert look up and down", type: "toggle", def: false },
      { id: "joyMode", label: "Joystick", type: "select", def: "float", options: [
        { v: "float", label: "Floating" }, { v: "fixed", label: "Fixed" } ] },
      { id: "btnSize", label: "Touch button size", type: "range", min: 0.7, max: 1.4, step: 0.05, def: 1 },
      { id: "btnOpacity", label: "Touch button opacity", type: "range", min: 0.35, max: 1, step: 0.05, def: 0.85 },
      { id: "leftHand", label: "Left-handed layout", type: "toggle", def: false },
      { id: "haptics", label: "Vibration", type: "toggle", def: false, help: "A small buzz on kicks and goals. On iPhone this works in the Kickoff app." },
      { id: "autoSwitch", label: "Auto-switch player", type: "select", def: "assisted", options: [
        { v: "off", label: "Off" }, { v: "assisted", label: "Assisted" }, { v: "auto", label: "Auto" } ] },
      { id: "assist", label: "Pass and shot help", type: "select", def: "medium", options: [
        { v: "low", label: "Low" }, { v: "medium", label: "Medium" }, { v: "high", label: "High" } ] },
      { id: "sprintMode", label: "Sprint", type: "select", def: "hold", options: [
        { v: "hold", label: "Hold to sprint" }, { v: "toggle", label: "Tap to sprint" } ] },
      { id: "hints", label: "Show control hints", type: "toggle", def: true },
    ],
  },
  {
    id: "camera", title: "Camera",
    fields: [
      { id: "camDefault", label: "Default camera", type: "select", def: "tv", options: [
        { v: "tv", label: "Broadcast" }, { v: "close", label: "Close" }, { v: "fp", label: "First person" } ] },
      { id: "camZoom", label: "Camera zoom", type: "range", min: 0.8, max: 1.4, step: 0.05, def: 1 },
      { id: "camHeight", label: "Camera height", type: "range", min: 0.7, max: 1.3, step: 0.05, def: 1 },
      { id: "fpFov", label: "First-person view angle", type: "range", min: 75, max: 90, step: 1, def: 84, suffix: "°" },
      { id: "headBob", label: "Head bob", type: "toggle", def: true },
      { id: "shake", label: "Screen shake", type: "toggle", def: true },
      { id: "replays", label: "Goal replays", type: "toggle", def: true },
    ],
  },
  {
    id: "game", title: "Gameplay",
    note: "These apply to matches on this device. In an online game, the host's rules are used.",
    fields: [
      { id: "difficulty", label: "Computer difficulty", type: "select", def: "normal", options: [
        { v: "easy", label: "Easy" }, { v: "normal", label: "Normal" }, { v: "hard", label: "Hard" }, { v: "legendary", label: "Legendary" } ] },
      { id: "matchLength", label: "Default match length", type: "select", def: 5, options: [
        { v: 1, label: "1 minute" }, { v: 2, label: "2 minutes" }, { v: 3, label: "3 minutes" },
        { v: 5, label: "5 minutes" }, { v: 10, label: "10 minutes" }, { v: 15, label: "15 minutes" }, { v: 20, label: "20 minutes" } ] },
      { id: "offside", label: "Offside", type: "toggle", def: true },
      { id: "cards", label: "Fouls and cards", type: "toggle", def: true },
      { id: "stoppage", label: "Injury and stoppage time", type: "toggle", def: false },
      { id: "ballSpeed", label: "Ball speed", type: "range", min: 0.85, max: 1.25, step: 0.05, def: 1 },
      { id: "gameSpeed", label: "Game speed", type: "range", min: 0.7, max: 1.3, step: 0.05, def: 1 },
    ],
  },
  {
    id: "display", title: "Display",
    fields: [
      { id: "quality", label: "Graphics", type: "select", def: "auto", options: [
        { v: "auto", label: "Auto" }, { v: "low", label: "Low" }, { v: "medium", label: "Medium" }, { v: "high", label: "High" } ] },
      { id: "fpsCap", label: "Frame rate", type: "select", def: 60, options: [
        { v: 30, label: "30 fps" }, { v: 60, label: "60 fps" } ] },
      { id: "showRadar", label: "Radar", type: "toggle", def: true },
      { id: "showNames", label: "Player names", type: "toggle", def: true },
      { id: "showStamina", label: "Stamina bars", type: "toggle", def: true },
      { id: "showFps", label: "FPS counter", type: "toggle", def: false },
      { id: "hudSize", label: "HUD size", type: "range", min: 0.8, max: 1.5, step: 0.05, def: 1 },
      { id: "colorblind", label: "Colorblind-friendly colors", type: "toggle", def: false },
    ],
  },
  {
    id: "audio", title: "Audio",
    fields: [
      { id: "master", label: "Master volume", type: "range", min: 0, max: 1, step: 0.05, def: 1 },
      { id: "crowd", label: "Crowd", type: "range", min: 0, max: 1, step: 0.05, def: 1 },
      { id: "sfx", label: "Sound effects", type: "range", min: 0, max: 1, step: 0.05, def: 1 },
      { id: "whistle", label: "Whistle", type: "range", min: 0, max: 1, step: 0.05, def: 1 },
      { id: "mute", label: "Mute", type: "toggle", def: false },
    ],
  },
  {
    id: "access", title: "Accessibility",
    fields: [
      { id: "bigText", label: "Bigger text", type: "toggle", def: false },
      { id: "reduceMotion", label: "Reduce motion", type: "toggle", def: false, help: "Turns off shake, head bob and speed blur." },
      { id: "contrast", label: "High contrast outlines", type: "toggle", def: false },
    ],
  },
  {
    id: "account", title: "Account",
    fields: [],
  },
];

function settingsFields() {
  const all = [];
  for (const tab of SETTINGS_TABS) for (const f of tab.fields) all.push(f);
  return all;
}
function settingsField(id) {
  return settingsFields().find((f) => f.id === id) || null;
}
function coerceSetting(field, value) {
  if (!field) return value;
  if (field.type === "toggle") return !!value;
  if (field.type === "range") return clamp(Number(value), field.min, field.max);
  if (field.type === "select") {
    const ok = field.options.some((o) => String(o.v) === String(value));
    return ok ? (typeof field.def === "number" ? Number(value) : value) : field.def;
  }
  return value;
}

const GameSettings = {
  values: {},
  tab: "controls",
  load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; } catch (e) { saved = {}; }
    for (const f of settingsFields()) {
      this.values[f.id] = saved[f.id] == null ? f.def : coerceSetting(f, saved[f.id]);
    }
    if (saved.matchLength == null && typeof loadSavedMinutes === "function") {
      this.values.matchLength = loadSavedMinutes().minutes;
    }
    // Safari on iPhone cannot buzz. The Kickoff app can, so a new install
    // turns vibration on. A saved choice (on or off) always wins.
    if (saved.haptics == null && nativeAppShell()) this.values.haptics = true;
  },
  save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.values)); } catch (e) { /* private mode */ }
  },
  get(id) {
    if (this.values[id] == null) {
      const f = settingsField(id);
      return f ? f.def : undefined;
    }
    return this.values[id];
  },
  set(id, value, quiet) {
    const f = settingsField(id);
    if (!f) return;
    this.values[id] = coerceSetting(f, value);
    this.save();
    if (!quiet) {
      applySettings();
      const label = document.querySelector("[data-val='" + id + "']");
      if (label && f.type === "range") {
        label.textContent = f.suffix ? Math.round(this.values[id]) + f.suffix : (Math.round(this.values[id] * 100) / 100);
      } else this.paint();
    }
  },
  resetTab(tabId) {
    const tab = SETTINGS_TABS.find((t) => t.id === tabId);
    if (!tab) return;
    for (const f of tab.fields) this.values[f.id] = f.def;
    this.save();
    applySettings();
    this.paint();
  },
  open(tabId) {
    if (tabId) this.tab = tabId;
    const root = document.getElementById("settingsScreen");
    if (root) root.classList.remove("hidden");
    this.paint();
  },
  close() {
    const root = document.getElementById("settingsScreen");
    if (root) root.classList.add("hidden");
    if (typeof PlayerAccount !== "undefined" && PlayerAccount.ensure) PlayerAccount.ensure();
  },
  paint() { paintSettings(); },
};

function opt(id) { return GameSettings.get(id); }
function onlineMatch() { return typeof netRole === "string" && !!netRole; }
function frameGate(now) {
  const cap = Number(opt("fpsCap")) === 30 ? 30 : 60;
  if (cap >= 60) return true;
  if (!frameGate.t) frameGate.t = now;
  if (now - frameGate.t < 32) return false;
  frameGate.t = now;
  return true;
}
function hudScale() {
  let s = Number(opt("hudSize")) || 1;
  if (opt("bigText")) s *= 1.15;
  return clamp(s, 0.8, 1.6);
}
function joyFiltered(dx, dy, max) {
  const sens = Number(opt("joySens")) || 1;
  const dead = Number(opt("joyDead"));
  let x = (dx / max) * sens, y = (dy / max) * sens;
  const len = Math.hypot(x, y);
  if (len < (isFinite(dead) ? dead : 0.15)) return { x: 0, y: 0 };
  if (len > 1) { x /= len; y /= len; }
  return { x: x, y: y };
}
function nativeAppShell() {
  try {
    if (typeof location !== "undefined" && (location.protocol === "capacitor:" || location.protocol === "ionic:")) return true;
    if (typeof Capacitor !== "undefined" && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) return true;
  } catch (e) { /* a normal browser */ }
  return false;
}
function haptic(ms) {
  if (!opt("haptics")) return;
  try {
    const cap = typeof Capacitor !== "undefined" && Capacitor.Plugins && Capacitor.Plugins.Haptics;
    if (cap && cap.impact) {
      const ret = cap.impact({ style: ms >= 24 ? "MEDIUM" : "LIGHT" });
      if (ret && typeof ret.catch === "function") ret.catch(function () {});
      return;
    }
  } catch (e) { /* use the browser buzz below */ }
  if (!navigator.vibrate) return;
  try { navigator.vibrate(ms); } catch (e) { /* not allowed */ }
}

function applySettings() {
  const g = GameSettings.values;
  const root = document.documentElement;
  root.style.setProperty("--touch-scale", String(g.btnSize || 1));
  root.style.setProperty("--touch-opacity", String(g.btnOpacity == null ? 0.85 : g.btnOpacity));
  root.classList.toggle("left-hand", !!g.leftHand);
  root.classList.toggle("big-text", !!g.bigText);
  root.classList.toggle("reduce-motion", !!g.reduceMotion);
  root.classList.toggle("high-contrast", !!g.contrast);
  root.classList.toggle("colorblind", !!g.colorblind);
  root.classList.toggle("hide-hints", !g.hints);

  if (typeof setCameraFP === "function") {
    if (g.camDefault === "fp") setCameraFP(true);
    else setCameraFP(false);
  }
  if (typeof fpShakeOn !== "undefined") fpShakeOn = !g.reduceMotion && !!g.shake;
  if (typeof quality !== "undefined" && g.quality && g.quality !== "auto") {
    if (quality !== g.quality) quality = g.quality;
  }

  if (typeof Sound !== "undefined" && Sound.applyMix) Sound.applyMix(g);

  if (!onlineMatch() && typeof settings !== "undefined" && settings) {
    settings.difficulty = g.difficulty || settings.difficulty;
    if (settings.rules) {
      settings.rules.offside = !!g.offside;
      settings.rules.cards = !!g.cards;
    }
    const off = document.getElementById("ruleOffside");
    const cards = document.getElementById("ruleCards");
    if (off) off.checked = !!g.offside;
    if (cards) cards.checked = !!g.cards;
    if (typeof chooseMatchLength === "function" && settings.minutes !== g.matchLength) {
      chooseMatchLength(g.matchLength, false);
    } else if (typeof renderMenu === "function") renderMenu();
    if (typeof sim !== "undefined" && sim && sim.game) pushMatchTune();
  }
  if (typeof createDiff !== "undefined") {
    const d = g.difficulty === "legendary" ? "hard" : g.difficulty;
    if (d === "easy" || d === "normal" || d === "hard") createDiff = d;
  }
}

function pushMatchTune() {
  if (onlineMatch() || typeof sim === "undefined" || !sim || !sim.game) return;
  const g = GameSettings.values;
  sim.game.difficulty = g.difficulty || sim.game.difficulty;
  if (sim.game.rules) {
    sim.game.rules.offside = !!g.offside;
    sim.game.rules.cards = !!g.cards;
  }
  sim.game.tune = {
    assist: g.assist || "medium",
    autoSwitch: g.autoSwitch || "assisted",
    ball: Number(g.ballSpeed) || 1,
    stoppage: !!g.stoppage,
  };
}

function revealSettingsTab(scroller, btn) {
  if (!scroller || !btn) return;
  const s = scroller.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  if (b.left < s.left + 4) scroller.scrollLeft -= s.left - b.left + 8;
  else if (b.right > s.right - 4) scroller.scrollLeft += b.right - s.right + 8;
}

function paintSettings() {
  const tabs = document.getElementById("settingsTabs");
  const body = document.getElementById("settingsBody");
  const card = document.getElementById("settingsCard");
  if (!tabs || !body) return;
  const tabChanged = body.dataset.tab !== GameSettings.tab;
  tabs.innerHTML = SETTINGS_TABS.map((t) =>
    "<button type='button' data-stab='" + t.id + "'" + (t.id === GameSettings.tab ? " class='on'" : "") + ">" + t.title + "</button>"
  ).join("");
  const tab = SETTINGS_TABS.find((t) => t.id === GameSettings.tab) || SETTINGS_TABS[0];
  let html = tab.note ? "<p class='setNote'>" + tab.note + "</p>" : "";
  for (const f of tab.fields) {
    const v = GameSettings.values[f.id];
    html += "<label class='setRow'><span>" + f.label + "</span>";
    if (f.type === "toggle") {
      html += "<input type='checkbox' data-set='" + f.id + "'" + (v ? " checked" : "") + ">";
    } else if (f.type === "range") {
      const shown = f.suffix ? Math.round(v) + f.suffix : (Math.round(v * 100) / 100);
      html += "<span class='setRange'><input type='range' data-set='" + f.id + "' min='" + f.min + "' max='" + f.max + "' step='" + f.step + "' value='" + v + "'><b data-val='" + f.id + "'>" + shown + "</b></span>";
    } else if (f.type === "select") {
      html += "<select data-set='" + f.id + "'>" + f.options.map((o) =>
        "<option value='" + o.v + "'" + (String(o.v) === String(v) ? " selected" : "") + ">" + o.label + "</option>"
      ).join("") + "</select>";
    }
    html += "</label>";
    if (f.help) html += "<p class='setHelp'>" + f.help + "</p>";
  }
  if (tab.id === "account") html += "<div id='accountPanel'></div>";
  html += "<div class='setReset'><button type='button' id='settingsEditPlayer'>Edit profile</button>";
  if (tab.id !== "account") html += " <button type='button' id='settingsReset'>Reset to defaults</button>";
  html += "</div>";
  body.innerHTML = html;
  body.dataset.tab = tab.id;
  if (tabChanged && card) card.scrollTop = 0;
  revealSettingsTab(tabs, tabs.querySelector("button.on"));
  tabs.querySelectorAll("[data-stab]").forEach((b) => b.addEventListener("click", () => {
    GameSettings.tab = b.dataset.stab;
    GameSettings.paint();
  }));
  body.querySelectorAll("[data-set]").forEach((el) => {
    const id = el.dataset.set;
    const go = () => {
      let value = el.type === "checkbox" ? el.checked : el.value;
      GameSettings.set(id, value);
    };
    el.addEventListener("input", go);
    el.addEventListener("change", go);
  });
  const reset = document.getElementById("settingsReset");
  if (reset) reset.addEventListener("click", () => GameSettings.resetTab(tab.id));
  const edit = document.getElementById("settingsEditPlayer");
  if (edit) edit.addEventListener("click", () => { if (typeof PlayerAccount !== "undefined") PlayerAccount.open(true); });
  if (tab.id === "account" && typeof CloudAccount !== "undefined" && CloudAccount.paint) {
    CloudAccount.paint(document.getElementById("accountPanel"));
  }
}

function mountSettings() {
  if (document.getElementById("settingsScreen")) return;
  const style = document.createElement("style");
  style.textContent = `
    #settingsScreen.hidden { display: none !important; }
    #settingsScreen {
      position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
      box-sizing: border-box; background: rgba(4, 8, 16, .72);
      padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
      overflow: hidden; overscroll-behavior: none;
    }
    /* min-height: 0 lets this flex child honour max-height, so a short phone
       window can scroll. The card scrolls. The title, Close and tabs stay put. */
    #settingsCard {
      width: min(860px, 100%); min-height: 0; box-sizing: border-box;
      max-height: min(92vh, 760px);
      max-height: min(760px, calc(100svh - max(12px, env(safe-area-inset-top)) - max(12px, env(safe-area-inset-bottom))));
      background: linear-gradient(180deg, #121a2b, #0c121c); color: #fff;
      border: 1px solid rgba(232, 197, 71, .45); border-radius: 18px;
      overflow-x: hidden; overflow-y: auto;
      -webkit-overflow-scrolling: touch; touch-action: pan-y; overscroll-behavior: contain;
      box-shadow: 0 24px 60px rgba(0,0,0,.5); font-family: "Trebuchet MS", Arial, sans-serif;
    }
    #settingsStick { position: sticky; top: 0; z-index: 2; background: #0e1626; }
    #settingsHead { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #0e1626; border-bottom: 1px solid rgba(255,255,255,.08); }
    #settingsHead h2 { margin: 0; flex: 1; min-width: 0; font-size: 22px; letter-spacing: .4px; }
    #settingsHead h2 span { color: #e8c547; margin-right: 8px; }
    #settingsClose { flex: 0 0 auto; min-width: 44px; min-height: 44px; border-radius: 10px; border: 1px solid rgba(255,255,255,.3); background: #1d4e34; color: #fff; font: inherit; font-weight: 700; touch-action: manipulation; }
    #settingsTabs {
      display: flex; gap: 6px; padding: 8px 10px; min-width: 0; max-width: 100%;
      overflow-x: auto; overflow-y: hidden; background: #101826; scrollbar-width: thin;
      -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y;
      overscroll-behavior-x: contain; overscroll-behavior-y: auto;
    }
    #settingsTabs button { flex: 0 0 auto; min-height: 44px; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.2); background: transparent; color: #d5dbe6; font: inherit; font-weight: 700; touch-action: manipulation; }
    #settingsTabs button.on { background: #e8c547; color: #1a1404; border-color: #e8c547; }
    #settingsBody { padding: 8px 16px 18px; box-sizing: border-box; max-width: 100%; }
    .setNote, .setHelp { margin: 4px 0 10px; color: #ffd27a; font-size: 14px; line-height: 1.4; overflow-wrap: break-word; }
    .setRow { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; min-height: 52px; max-width: 100%; border-bottom: 1px solid rgba(255,255,255,.06); font-size: 16px; }
    .setRow > span { flex: 1 1 10em; min-width: 0; }
    .setRow select, .setRange { font: inherit; }
    .setRow select { min-height: 44px; min-width: min(140px, 100%); max-width: 100%; margin-left: auto; box-sizing: border-box; border-radius: 10px; border: 1px solid rgba(255,255,255,.3); background: #0d2818; color: #fff; padding: 0 8px; }
    .setRow input[type=checkbox] { width: 28px; height: 28px; margin-left: auto; accent-color: #e8c547; }
    .setRange { display: flex; align-items: center; gap: 8px; flex: 1 1 180px; min-width: min(180px, 100%); max-width: min(280px, 100%); margin-left: auto; box-sizing: border-box; }
    .setRange input { flex: 1; min-width: 0; min-height: 44px; touch-action: manipulation; }
    .setRange b { min-width: 42px; text-align: right; color: #e8c547; }
    .setReset { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; text-align: center; margin-top: 14px; }
    .setReset button { max-width: 100%; }
    #settingsReset { min-height: 44px; padding: 8px 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,.3); background: #243044; color: #fff; font: inherit; font-weight: 700; }
    .gearBtn { min-height: 44px; }
    html.big-text, html.big-text button, html.big-text select { font-size: 18px; }
    html.hide-hints #keysHint, html.hide-hints #controlsHelp, html.hide-hints #pauseHelp, html.hide-hints #matchHelp { display: none !important; }
    .tbtn { opacity: var(--touch-opacity, .85); }
    html.left-hand #touchControls { transform: scaleX(-1); }
    html.left-hand #touchControls .tbtn { transform: scale(var(--touch-scale, 1)) scaleX(-1); }
    html:not(.left-hand) #touchControls .tbtn { transform: scale(var(--touch-scale, 1)); }
    #joyBase, #joyBase2 { transform: scale(var(--touch-scale, 1)); }
  `;
  document.head.appendChild(style);
  const screen = document.createElement("div");
  screen.id = "settingsScreen";
  screen.className = "hidden";
  screen.innerHTML = "<div id='settingsCard'><div id='settingsStick'><div id='settingsHead'><h2><span>⚙</span>Settings</h2><button type='button' id='settingsClose' aria-label='Close'>Close</button></div><div id='settingsTabs'></div></div><div id='settingsBody'></div></div>";
  document.body.appendChild(screen);
  document.getElementById("settingsClose").addEventListener("click", () => GameSettings.close());
  screen.addEventListener("pointerdown", (e) => { if (e.target === screen) GameSettings.close(); });
  ["settingsBtn", "pauseSettingsBtn", "onlineSettingsBtn", "menuSettingsBtn"].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      GameSettings.open();
    });
  });
  window.addEventListener("keydown", (e) => {
    const open = screen && !screen.classList.contains("hidden");
    if (!open) return;
    if (e.key === "Escape") GameSettings.close();
  });
}

function bootSettings() {
  GameSettings.load();
  mountSettings();
  applySettings();
}
setTimeout(bootSettings, 0);
