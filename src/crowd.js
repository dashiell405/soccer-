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
    return out;
  }

  root.KickoffCrowd = {
    peoplePhrase: peoplePhrase,
    tally: tally,
    readActivity: readActivity,
    roomTally: roomTally,
    lines: lines,
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
  };
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
      const view = lines({ status: crowd.status, totals: crowd.totals, peak: crowd.peak, room: liveRoom() });
      const stamp = [view.now, view.split, view.kind, view.peak, view.room, view.hint].join("|");
      if (stamp === painted) return;
      painted = stamp;
      setText("adminCrowdNow", view.now);
      setText("adminCrowdSplit", view.split);
      setText("adminCrowdKind", view.kind);
      setText("adminCrowdPeak", view.peak);
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

  setInterval(function () {
    try {
      if (crowd.status === "live") pushTrack();
      else if (!crowd.joining && Date.now() >= crowd.retryAt) joinCrowd();
      paintCrowd();
    } catch (e) { /* the match keeps running */ }
  }, 1000);
  window.addEventListener("offline", function () {
    crowd.gen++;
    crowd.status = "offline";
    crowd.joining = false;
    crowd.sent = "";
    crowd.retryAt = Date.now() + 4000;
    dropChannel();
    paintCrowd();
  });
  window.addEventListener("online", function () {
    crowd.retryAt = 0;
    try { joinCrowd(); } catch (e) { /* stay on Offline until the next try */ }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (crowd.status === "live") { crowd.sent = ""; pushTrack(); }
    else { crowd.retryAt = 0; joinCrowd(); }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
