/* A player name for this device. No password is stored here.
   An optional parent-email sign-in lives in Settings → Account. */
(function () {
  const KEY = "soccerPlayer";
  const COLORS = ["#e6b325", "#1f5fd6", "#d62828", "#0b6e4f", "#6b3e1e", "#7b2cbf", "#f4f4f4", "#111111"];
  const SLURS = ["fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "retard", "whore", "slut", "nazi"];
  const MILD = ["damn", "hell", "crap", "dick", "piss", "ass"];

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && typeof raw.name === "string" && raw.name) return raw;
    } catch (e) { /* ignore */ }
    return null;
  }
  function write(account) {
    try { localStorage.setItem(KEY, JSON.stringify(account)); } catch (e) { /* private mode */ }
  }
  function hasOldSave() {
    const keys = ["soccerSettings", "soccerName", "soccerCup", "soccerTrophies", "soccerMatchMinutes", "soccerAdminUnlock", "soccerPlayAsMe"];
    try { return keys.some((k) => localStorage.getItem(k)); } catch (e) { return false; }
  }
  function prefill() {
    let name = "";
    let team = "blue";
    try { name = localStorage.getItem("soccerName") || ""; } catch (e) { /* ignore */ }
    if (!name) {
      try {
        const me = JSON.parse(localStorage.getItem("soccerPlayAsMe") || "null");
        if (me && me.name && me.name !== "Dashiell G.") name = me.name;
      } catch (e) { /* ignore */ }
    }
    try {
      const s = JSON.parse(localStorage.getItem("soccerSettings") || "null");
      if (s && s.blue) team = s.blue;
    } catch (e) { /* ignore */ }
    return { name: String(name).replace(/[<>]/g, "").trim().slice(0, 16), team: team, color: COLORS[0] };
  }
  function folded(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function badName(name) {
    const flat = folded(name);
    if (SLURS.some((w) => flat.indexOf(w) >= 0)) return true;
    const words = String(name || "").toLowerCase().split(/[^a-z0-9]+/);
    return words.some((w) => MILD.indexOf(w) >= 0);
  }
  function checkName(name) {
    const n = String(name || "").replace(/[<>]/g, "").trim();
    if (n.length < 3 || n.length > 16) return "Use 3 to 16 characters.";
    if (!/^[A-Za-z0-9 ]+$/.test(n) || !/[A-Za-z]/.test(n)) return "Use letters and numbers only.";
    if (badName(n)) return "Pick a different name.";
    return "";
  }
  function filterText(text) {
    const raw = String(text || "");
    if (raw.replace(/[<>]/g, "").trim().length > 100) return "Keep the message under 100 characters.";
    const s = raw.replace(/[<>]/g, "").trim();
    if (!s) return "";
    if (badName(s)) return "Pick a different message.";
    return "";
  }
  function deviceId() {
    let id = "";
    try { id = localStorage.getItem("soccerDeviceId") || ""; } catch (e) { /* ignore */ }
    if (!/^[a-f0-9]{32}$/.test(id)) {
      const saved = read();
      if (saved && /^[a-f0-9]{32}$/.test(saved.deviceId || "")) id = saved.deviceId;
    }
    if (!/^[a-f0-9]{32}$/.test(id)) {
      const bytes = new Uint8Array(16);
      if (crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    try { localStorage.setItem("soccerDeviceId", id); } catch (e) { /* private mode */ }
    return id;
  }

  const style = document.createElement("style");
  style.textContent = `
    #playerGate {
      position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center;
      background: rgba(4, 10, 18, .82); box-sizing: border-box; overflow: hidden; overscroll-behavior: none;
      padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
    }
    #playerGate[hidden] { display: none !important; }
    #playerCard {
      width: min(440px, 100%); min-height: 0; box-sizing: border-box;
      max-height: 100%;
      max-height: calc(100svh - max(12px, env(safe-area-inset-top)) - max(12px, env(safe-area-inset-bottom)));
      overflow-x: hidden; overflow-y: auto;
      -webkit-overflow-scrolling: touch; touch-action: pan-y; overscroll-behavior: contain;
      background: rgba(8, 16, 28, .97); color: #fff; border: 2px solid #e8c547; border-radius: 16px;
      padding: 16px; font-family: "Trebuchet MS", Arial, sans-serif; text-align: center;
    }
    #playerCard h2 { margin: 0 0 6px; font-size: 26px; overflow-wrap: break-word; }
    #playerCard p { margin: 0 0 10px; font-size: 14px; line-height: 1.4; overflow-wrap: break-word; }
    #playerCard input, #playerCard select {
      font: inherit; font-size: 16px; width: 100%; box-sizing: border-box;
      min-height: 44px; padding: 8px 10px; border-radius: 10px; border: 1px solid #fff; color: #111; background: #fff;
    }
    #playerCard label { display: block; text-align: left; margin: 8px 0 4px; font-weight: 700; }
    #playerColors { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 6px 0 10px; }
    #playerColors button {
      width: 44px; height: 44px; min-height: 44px; border-radius: 50%; border: 3px solid transparent; padding: 0;
    }
    #playerColors button.on { border-color: #fff; box-shadow: 0 0 0 2px #e6b325; }
    #playerGateMsg { min-height: 1.2em; color: #ffb4b4; font-weight: 700; }
    #playerCard .row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
    #playerCard .row button {
      font: inherit; font-weight: 800; min-height: 44px; max-width: 100%; padding: 8px 16px; border-radius: 10px;
      border: 0; background: #e6b325; color: #1a1404; cursor: pointer; touch-action: manipulation;
    }
    #playerCancel, #playerSignIn { background: #243044 !important; color: #fff !important; }
    #playerChip {
      position: fixed; z-index: 45; margin: 0;
      top: calc(8px + env(safe-area-inset-top));
      right: calc(86px + env(safe-area-inset-right));
      min-height: 44px; max-width: min(46vw, 180px); padding: 6px 12px;
      border-radius: 999px; border: 2px solid rgba(255,255,255,.7);
      background: rgba(8, 16, 28, .88); color: #fff; font: 700 15px/1.2 "Trebuchet MS", Arial, sans-serif;
      display: flex; align-items: center; gap: 8px;
    }
    #playerChip[hidden] { display: none !important; }
    #playerChip i { width: 18px; height: 18px; border-radius: 50%; display: block; flex: 0 0 auto; border: 2px solid #fff; }
    #playerChip b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  document.head.appendChild(style);

  const gate = document.createElement("div");
  gate.id = "playerGate";
  gate.hidden = true;
  gate.innerHTML = `
    <form id="playerCard">
      <h2 id="playerTitle">Create your player</h2>
      <p id="playerBlurb">Pick a name friends will see. It stays on this phone. No password. A parent can sign in from Settings, then Account, to use the same player on another device.</p>
      <label for="playerName">Player name</label>
      <input id="playerName" maxlength="16" autocomplete="off" autocapitalize="words" placeholder="3 to 16 characters">
      <label for="playerTeam">Favourite team</label>
      <select id="playerTeam"></select>
      <label>Avatar colour</label>
      <div id="playerColors"></div>
      <div id="playerGateMsg"></div>
      <div class="row">
        <button type="submit" id="playerSave">Start playing</button>
        <button type="button" id="playerCancel" hidden>Cancel</button>
        <button type="button" id="playerSignIn">Sign in with a parent email</button>
      </div>
    </form>`;
  document.body.appendChild(gate);
  const chip = document.createElement("div");
  chip.id = "playerChip";
  chip.hidden = true;
  chip.innerHTML = "<i></i><b></b>";
  document.body.appendChild(chip);

  let color = COLORS[0];
  let editing = false;

  function fillTeams(selected) {
    const sel = document.getElementById("playerTeam");
    if (!sel || typeof TEAM_LIST === "undefined") return;
    sel.innerHTML = TEAM_LIST.map((t) => "<option value='" + t.id + "'>" + String(t.name).replace(/</g, "") + "</option>").join("");
    if (selected && [...sel.options].some((o) => o.value === selected)) sel.value = selected;
  }
  function paintColors() {
    const box = document.getElementById("playerColors");
    box.innerHTML = COLORS.map((c) => "<button type='button' data-color='" + c + "' style='background:" + c + "' aria-label='Colour " + c + "'></button>").join("");
    box.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.color === color);
      b.addEventListener("click", () => { color = b.dataset.color; paintColors(); });
    });
  }
  function paintChip() {
    const account = read();
    const playing = (typeof inMatch === "function" && inMatch())
      || (typeof room !== "undefined" && room && room.state === "playing" && !(typeof game !== "undefined" && game && game.phase === "win"));
    if (!account || playing || !gate.hidden) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.querySelector("i").style.background = account.color || COLORS[0];
    chip.querySelector("b").textContent = account.name;
    chip.setAttribute("aria-label", "Player " + account.name + ". Edit in Settings.");
  }
  function open(edit) {
    editing = !!edit;
    const current = read() || prefill();
    color = COLORS.indexOf(current.color) >= 0 ? current.color : COLORS[0];
    document.getElementById("playerTitle").textContent = editing ? "Edit profile" : "Create your player";
    document.getElementById("playerBlurb").textContent = editing
      ? "This name is what friends see in a room. It stays on this phone. Settings, then Account, can save it with a parent email."
      : "Pick a name friends will see. It stays on this phone. No password. A parent can sign in from Settings, then Account, to use the same player on another device.";
    document.getElementById("playerSave").textContent = editing ? "Save" : "Start playing";
    document.getElementById("playerCancel").hidden = !editing;
    document.getElementById("playerName").value = current.name || "";
    document.getElementById("playerGateMsg").textContent = "";
    fillTeams(current.team || "blue");
    paintColors();
    gate.hidden = false;
    paintChip();
  }
  function close() {
    gate.hidden = true;
    paintChip();
  }
  function save(e) {
    if (e) e.preventDefault();
    const name = document.getElementById("playerName").value;
    const msg = checkName(name);
    const box = document.getElementById("playerGateMsg");
    if (msg) { box.textContent = msg; return; }
    const team = document.getElementById("playerTeam").value || "blue";
    const account = { name: name.replace(/[<>]/g, "").trim(), team: team, color: color, deviceId: deviceId() };
    write(account);
    try { localStorage.setItem("soccerName", account.name); } catch (err) { /* ignore */ }
    const input = document.getElementById("nameInput");
    if (input) input.value = account.name;
    close();
  }

  document.getElementById("playerCard").addEventListener("submit", save);
  document.getElementById("playerCancel").addEventListener("click", () => { if (read()) close(); });
  document.getElementById("playerSignIn").addEventListener("click", () => {
    gate.hidden = true;
    paintChip();
    if (typeof GameSettings !== "undefined") GameSettings.open("account");
  });

  function ensure() {
    if (!read()) open(false);
    else paintChip();
  }

  function refresh() {
    const account = read();
    const nameEl = document.getElementById("playerName");
    const typed = !gate.hidden && nameEl && nameEl.value.trim();
    const typing = typed && (!account || nameEl.value.trim() !== account.name);
    if (account && !typing) close();
    else paintChip();
    const input = document.getElementById("nameInput");
    if (input && account && document.activeElement !== input) input.value = account.name;
  }

  window.PlayerAccount = {
    load: read,
    name() { const a = read(); return a ? a.name : ""; },
    open: open,
    refresh: refresh,
    ensure: ensure,
    deviceId: deviceId,
    filterText: filterText,
  };
  deviceId();

  if (!read()) open(false);
  paintChip();
  setInterval(paintChip, 700);
})();
