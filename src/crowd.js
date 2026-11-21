/* How many people have Kickoff open.
   Every device joins the same Supabase Presence channel.
   The message is only "menu or match" and "online or solo".
   No name, email, or account id is sent.
   The helpers panel is the only place that shows the numbers.
   If the internet is down, the panel says Offline and the match still runs. */
(function (root) {
  function peoplePhrase(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n === 0) return "nobody";
    if (n === 1) return "1 person";
    return n + " people";
  }
  function tally(state) {
    const out = { total: 0, match: 0, menu: 0, online: 0, solo: 0 };
    if (!state || typeof state !== "object") return out;
    const keys = Object.keys(state);
    for (let i = 0; i < keys.length; i++) {
      const metas = state[keys[i]];
      if (!Array.isArray(metas) || !metas.length) continue;
      const meta = metas[metas.length - 1] || {};
      out.total++;
      if (meta.place === "match") out.match++;
      else out.menu++;
      if (meta.kind === "online") out.online++;
      else out.solo++;
    }
    return out;
  }
  function readActivity(env) {
    env = env || {};
    let online = false;
    let match = false;
    const here = env.room;
    if (env.netRole === "host" || env.netRole === "guest") online = true;
    if (here && (here.code || here.state)) online = true;
    if (env.inMatch) match = true;
    if (here && here.state && here.state !== "playing") match = false;
    if (env.atMenu) match = false;
    return {
      place: match ? "match" : "menu",
      kind: online ? "online" : "solo",
    };
  }
  function roomTally(env) {
    env = env || {};
    const list = env.hostedMembers || env.roomMembers;
    if (!list || typeof list.length !== "number") return null;
    let here = 0;
    let away = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].connected === false) away++;
      else here++;
    }
    return { here: here, away: away, total: here + away };
  }
  function lines(view) {
    view = view || {};
    const out = { now: "", split: "", kind: "", peak: "", room: "", hint: "" };
    const totals = view.totals;
    if (view.status === "live" && totals) {
      out.now = "Playing right now: " + peoplePhrase(totals.total);
      out.split = "In a match: " + totals.match + " · On menus: " + totals.menu;
      out.kind = "Online games: " + totals.online + " · Solo: " + totals.solo;
    } else if (view.status === "offline") {
      out.now = "Playing right now: Offline";
      out.hint = "The count needs the internet. The game still works.";
    } else {
      out.now = "Playing right now: Checking…";
    }
    const peak = Math.round(Number(view.peak) || 0);
    if (peak > 0) out.peak = "Most at once this session: " + peoplePhrase(peak);
    const room = view.room;
    if (!room) out.room = "In this online game: Not online";
    else if (room.away > 0) out.room = "In this online game: " + peoplePhrase(room.total) + " (" + room.away + " away)";
    else out.room = "In this online game: " + peoplePhrase(room.total);
    const ever = everLines(view.devices);
    out.ever = ever.ever;
    out.today = ever.today;
    return out;
  }
  function everLines(devices) {
    devices = devices || {};
    if (!devices.status) return { ever: "", today: "" };
    if (devices.status === "offline") return { ever: "Players ever: Offline", today: "" };
    if (devices.status === "soon") return { ever: "Players ever: Coming soon", today: "" };
    if (devices.status === "checking" || devices.total == null || !isFinite(Number(devices.total))) {
      return { ever: "Players ever: …", today: "" };
    }
    const total = Math.max(0, Math.round(Number(devices.total) || 0));
    const out = { ever: "Players ever: " + total, today: "" };
    if (devices.today != null && isFinite(Number(devices.today)) && Number(devices.today) >= 0) {
      out.today = "New today: " + Math.round(Number(devices.today));
    }
    return out;
  }
  function hexToUuid(hex) {
    hex = String(hex || "").toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(hex)) return "";
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }
  function storageBox(storage) {
    if (storage) return storage;
    try { if (typeof localStorage !== "undefined") return localStorage; } catch (e) { /* private */ }
    return null;
  }
  function deviceUuid(storage) {
    const box = storageBox(storage);
    let hex = "";
    try { hex = box ? (box.getItem("soccerDeviceId") || "") : ""; } catch (e) { hex = ""; }
    const fromHex = hexToUuid(hex);
    if (fromHex && fromHex !== "00000000-0000-0000-0000-000000000000") return fromHex;
    let prev = "";
    try { prev = box ? (box.getItem("soccerDeviceUuid") || "") : ""; } catch (e) { prev = ""; }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(prev)) {
      const id = prev.toLowerCase();
      if (id !== "00000000-0000-0000-0000-000000000000") return id;
    }
    let id = "";
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) id = crypto.randomUUID().toLowerCase();
    } catch (e) { id = ""; }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      id = hexToUuid(Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join(""));
    }
    try { if (box) box.setItem("soccerDeviceUuid", id); } catch (e) { /* private mode */ }
    return id;
  }

  root.KickoffCrowd = {
    peoplePhrase: peoplePhrase,
    tally: tally,
    readActivity: readActivity,
    roomTally: roomTally,
    lines: lines,
    everLines: everLines,
    deviceUuid: deviceUuid,
  };

  if (typeof document === "undefined") return;

  const crowd = {
    gen: 0,
    status: "checking",
    totals: null,
    peak: 0,
    channel: null,
    client: null,
    joining: false,
    sent: "",
    retryAt: Date.now() + 800,
    devices: { status: "checking" },
  };
  let deviceFetchAt = 0;
  let deviceRecorded = false;

  function missingRpc(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const msg = String(error.message || error.details || "").toLowerCase();
    if (code === "PGRST202" || code === "42883" || code === "PGRST205") return true;
    return msg.indexOf("could not find the function") >= 0 || msg.indexOf("does not exist") >= 0 || msg.indexOf("schema cache") >= 0;
  }
  function countFrom(data) {
    if (data == null || data === "") return null;
    const n = Number(data);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n);
  }
  let painted = "";

  function loadPeak() {
    try {
      const n = Number(sessionStorage.getItem("soccerCrowdPeak"));
      if (isFinite(n) && n > 0 && n < 100000) return Math.round(n);
    } catch (e) { /* private mode */ }
    return 0;
  }
  function savePeak(n) {
    try { sessionStorage.setItem("soccerCrowdPeak", String(n)); } catch (e) { /* private mode */ }
  }
  function sessionId() {
    const key = "soccerCrowdId";
    try {
      const prev = sessionStorage.getItem(key);
      if (prev && /^[a-z0-9-]{8,64}$/i.test(prev)) return prev;
      const id = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : ("k" + Math.random().toString(36).slice(2) + Date.now().toString(36));
      sessionStorage.setItem(key, id);
      return id;
    } catch (e) {
      return "k" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }
  crowd.peak = loadPeak();

  function liveActivity() {
    let role = null;
    let here = null;
    let menu = false;
    let playing = false;
    try { if (typeof netRole === "string") role = netRole; } catch (e) { /* offline page */ }
    try { if (typeof room !== "undefined") here = room; } catch (e) { /* offline page */ }
    try { if (typeof atMenu !== "undefined") menu = !!atMenu; } catch (e) { /* online page */ }
    try { if (typeof inMatch === "function") playing = !!inMatch(); } catch (e) { /* not ready */ }
    const raw = readActivity({ netRole: role, room: here, atMenu: menu, inMatch: playing });
    return {
      place: raw.place === "match" ? "match" : "menu",
      kind: raw.kind === "online" ? "online" : "solo",
    };
  }
  function liveRoom() {
    try {
      if (typeof netIsHost === "function" && netIsHost() && typeof hosted !== "undefined" && hosted && hosted.members) {
        return roomTally({ hostedMembers: [...hosted.members.values()] });
      }
    } catch (e) { /* not the host */ }
    try {
      if (typeof room !== "undefined" && room && Array.isArray(room.members)) {
        return roomTally({ roomMembers: room.members });
      }
    } catch (e) { /* not in a room */ }
    return null;
  }
  function helpersOpen() {
    const panel = document.getElementById("adminPanel");
    return !!(panel && !panel.hidden);
  }
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || "";
  }
  function paintCrowd() {
    try {
      if (!helpersOpen()) return;
      const view = lines({ status: crowd.status, totals: crowd.totals, peak: crowd.peak, room: liveRoom(), devices: crowd.devices });
      const stamp = [view.now, view.split, view.kind, view.peak, view.room, view.hint, view.ever, view.today].join("|");
      if (stamp === painted) return;
      painted = stamp;
      setText("adminCrowdNow", view.now);
      setText("adminCrowdSplit", view.split);
      setText("adminCrowdKind", view.kind);
      setText("adminCrowdPeak", view.peak);
      setText("adminCrowdEver", view.ever);
      setText("adminCrowdToday", view.today);
      setText("adminCrowdRoom", view.room);
      setText("adminCrowdHint", view.hint);
      const body = document.getElementById("adminBody");
      if (body) body.dispatchEvent(new Event("scroll"));
    } catch (e) { /* the match keeps running */ }
  }
  root.KickoffCrowd.paint = paintCrowd;

  function dropChannel() {
    const ch = crowd.channel;
    const client = crowd.client;
    crowd.channel = null;
    if (!client || !ch || typeof client.removeChannel !== "function") return Promise.resolve();
    try { return Promise.resolve(client.removeChannel(ch)).catch(function () {}); }
    catch (e) { return Promise.resolve(); }
  }
  function applySync(gen) {
    if (gen !== crowd.gen || !crowd.channel || typeof crowd.channel.presenceState !== "function") return;
    let state = null;
    try { state = crowd.channel.presenceState(); }
    catch (e) { return; }
    const totals = tally(state);
    crowd.totals = totals;
    crowd.status = "live";
    if (totals.total > crowd.peak) {
      crowd.peak = totals.total;
      savePeak(crowd.peak);
    }
    paintCrowd();
  }
  function failJoin(gen) {
    if (gen !== crowd.gen) return;
    crowd.gen++;
    crowd.status = "offline";
    crowd.joining = false;
    crowd.sent = "";
    crowd.retryAt = Date.now() + 8000;
    dropChannel();
    paintCrowd();
  }
  function pushTrack() {
    const ch = crowd.channel;
    if (!ch || crowd.status !== "live" || typeof ch.track !== "function") return;
    const payload = liveActivity();
    const stamp = payload.place + "/" + payload.kind;
    if (stamp === crowd.sent) return;
    crowd.sent = stamp;
    Promise.resolve(ch.track(payload)).catch(function () { crowd.sent = ""; });
  }
  function joinCrowd() {
    if (crowd.joining) return;
    if (crowd.status === "live" && crowd.channel) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      crowd.status = "offline";
      crowd.retryAt = Date.now() + 4000;
      paintCrowd();
      return;
    }
    const ask = (typeof CloudAccount !== "undefined" && CloudAccount.sharedClient) ? CloudAccount.sharedClient() : null;
    if (!ask) {
      crowd.status = "offline";
      crowd.retryAt = Date.now() + 8000;
      paintCrowd();
      return;
    }
    const gen = ++crowd.gen;
    crowd.joining = true;
    if (crowd.status !== "live") crowd.status = "checking";
    paintCrowd();
    const timer = setTimeout(function () { failJoin(gen); }, 12000);
    Promise.resolve(ask).then(function (client) {
      if (gen !== crowd.gen) return null;
      if (!client || typeof client.channel !== "function") { failJoin(gen); return null; }
      crowd.client = client;
      return dropChannel().then(function () { return client; });
    }).then(function (client) {
      if (!client || gen !== crowd.gen) return;
      const ch = client.channel("kickoff-playing", {
        config: { presence: { key: sessionId() } },
      });
      crowd.channel = ch;
      ch.on("presence", { event: "sync" }, function () { applySync(gen); });
      ch.subscribe(function (status) {
        if (gen !== crowd.gen) return;
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          crowd.status = "live";
          crowd.joining = false;
          crowd.sent = "";
          pushTrack();
          paintCrowd();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(timer);
          failJoin(gen);
        }
      });
    }).catch(function () {
      clearTimeout(timer);
      failJoin(gen);
    });
  }

  function askClient() {
    if (typeof CloudAccount === "undefined" || !CloudAccount.sharedClient) return null;
    return CloudAccount.sharedClient();
  }
  function recordThisDevice() {
    if (deviceRecorded) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const id = deviceUuid();
    if (!id) return;
    const ask = askClient();
    if (!ask) return;
    Promise.resolve(ask).then(function (client) {
      if (!client || typeof client.rpc !== "function") return null;
      return client.rpc("record_device", { device_id: id });
    }).then(function (res) {
      if (!res) return;
      if (res.error) {
        if (missingRpc(res.error)) {
          deviceRecorded = true;
          crowd.devices = { status: "soon" };
          paintCrowd();
        }
        return;
      }
      deviceRecorded = true;
    }).catch(function () { /* the count can wait */ });
  }
  function fetchDevices() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      crowd.devices = { status: "offline" };
      paintCrowd();
      return;
    }
    const ask = askClient();
    if (!ask) {
      crowd.devices = { status: "soon" };
      paintCrowd();
      return;
    }
    Promise.resolve(ask).then(function (client) {
      if (!client || typeof client.rpc !== "function") {
        crowd.devices = { status: "soon" };
        paintCrowd();
        return null;
      }
      return client.rpc("players_ever").then(function (res) {
        if (res.error && missingRpc(res.error)) {
          crowd.devices = { status: "soon" };
          deviceFetchAt = Date.now() + 120000;
          paintCrowd();
          return null;
        }
        if (res.error) {
          crowd.devices = { status: "offline" };
          paintCrowd();
          return null;
        }
        const total = countFrom(res.data);
        return client.rpc("players_new_today").then(function (todayRes) {
          let today = null;
          if (todayRes && !todayRes.error) today = countFrom(todayRes.data);
          crowd.devices = { status: "live", total: total == null ? 0 : total, today: today };
          paintCrowd();
        });
      });
    }).catch(function () {
      crowd.devices = { status: "offline" };
      paintCrowd();
    });
  }
  function maybeFetchDevices() {
    if (Date.now() < deviceFetchAt) return;
    deviceFetchAt = Date.now() + 30000;
    recordThisDevice();
    fetchDevices();
  }
  root.KickoffCrowd.previewDevices = function (devices) {
    let host = "";
    try { host = location.hostname; } catch (e) { host = ""; }
    if (host !== "localhost" && host !== "127.0.0.1") return;
    crowd.devices = devices || { status: "live", total: 0, today: 0 };
    painted = "";
    paintCrowd();
  };

  setInterval(function () {
    try {
      if (crowd.status === "live") pushTrack();
      else if (!crowd.joining && Date.now() >= crowd.retryAt) joinCrowd();
      maybeFetchDevices();
      paintCrowd();
    } catch (e) { /* the match keeps running */ }
  }, 1000);
  window.addEventListener("offline", function () {
    crowd.gen++;
    crowd.status = "offline";
    crowd.joining = false;
    crowd.sent = "";
    crowd.retryAt = Date.now() + 4000;
    crowd.devices = { status: "offline" };
    dropChannel();
    paintCrowd();
  });
  window.addEventListener("online", function () {
    crowd.retryAt = 0;
    deviceFetchAt = 0;
    try { joinCrowd(); } catch (e) { /* stay on Offline until the next try */ }
    try { maybeFetchDevices(); } catch (e2) { /* the count can wait */ }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (crowd.status === "live") { crowd.sent = ""; pushTrack(); }
    else { crowd.retryAt = 0; joinCrowd(); }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
