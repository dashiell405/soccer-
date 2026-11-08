/* Optional parent-email account (Supabase Auth magic link / email code).
   Signed-out and offline play keep using localStorage, the same keys as today.
   This file never reads or writes soccerAdminUnlock2 or soccerAdminPlace.
   Synced keys:
     soccerPlayer (name, team, colour only — device id stays on this phone)
     soccerName, soccerPlayAsMe, soccerTrophies, soccerCup, soccerSettings,
     soccerOptions, soccerMatchMinutes, soccerRenames, soccerTeam100,
     soccerCamera, soccerHostBans
   Those objects are stored as-is inside public.profiles. */
(function (root) {
  const SITE = (typeof KICKOFF_SITE_URL === "string" && KICKOFF_SITE_URL) || "https://dashiell405.github.io/soccer-/";
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm";
  const CHOICE_KEY = "soccerCloudChoice";
  const META_KEY = "soccerCloudMeta";
  const WRITE_KEYS = {
    soccerPlayer: 1, soccerName: 1, soccerPlayAsMe: 1, soccerTrophies: 1, soccerCup: 1,
    soccerSettings: 1, soccerOptions: 1, soccerMatchMinutes: 1, soccerRenames: 1,
    soccerTeam100: 1, soccerCamera: 1, soccerHostBans: 1,
  };
  const WATCH = {
    soccerPlayer: 1, soccerName: 1, soccerPlayAsMe: 1, soccerTrophies: 1, soccerCup: 1,
    soccerSettings: 1, soccerOptions: 1, soccerMatchMinutes: 1, soccerRenames: 1,
    soccerTeam100: 1, soccerCamera: 1, soccerHostBans: 1,
  };

  function storageOf(storage) {
    if (storage) return storage;
    try { if (typeof localStorage !== "undefined") return localStorage; } catch (e) { /* private */ }
    return null;
  }
  function getRaw(storage, key) {
    try { return storage ? storage.getItem(key) : null; } catch (e) { return null; }
  }
  function parseObj(raw) {
    if (raw == null || raw === "") return null;
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch (e) { /* ignore */ }
    return null;
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).sort().forEach(function (k) {
        if (value[k] !== undefined) out[k] = canonical(value[k]);
      });
      return out;
    }
    return value;
  }
  function readMinutes(raw) {
    if (raw == null || raw === "") return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "number" && isFinite(parsed)) return { minutes: Math.round(parsed), custom: false };
      if (parsed && typeof parsed === "object" && parsed.minutes != null && isFinite(Number(parsed.minutes))) {
        return { minutes: Math.round(Number(parsed.minutes)), custom: !!parsed.custom };
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function readCamera(raw) {
    return raw === "fp" || raw === "tv" ? raw : null;
  }
  function readLocal(storage) {
    storage = storageOf(storage);
    const empty = {
      player: null, name: "", playAsMe: null, trophies: null, cup: null, settings: null,
      options: null, minutes: null, renames: null, team100: null, camera: null, bans: null,
    };
    if (!storage) return empty;
    return {
      player: parseObj(getRaw(storage, "soccerPlayer")),
      name: getRaw(storage, "soccerName") || "",
      playAsMe: parseObj(getRaw(storage, "soccerPlayAsMe")),
      trophies: parseObj(getRaw(storage, "soccerTrophies")),
      cup: parseObj(getRaw(storage, "soccerCup")),
      settings: parseObj(getRaw(storage, "soccerSettings")),
      options: parseObj(getRaw(storage, "soccerOptions")),
      minutes: readMinutes(getRaw(storage, "soccerMatchMinutes")),
      renames: parseObj(getRaw(storage, "soccerRenames")),
      team100: parseObj(getRaw(storage, "soccerTeam100")),
      camera: readCamera(getRaw(storage, "soccerCamera")),
      bans: parseObj(getRaw(storage, "soccerHostBans")),
    };
  }
  function clipName(name, max) {
    return String(name || "").replace(/[<>]/g, "").trim().slice(0, max);
  }
  function richness(snap) {
    if (!snap) return 0;
    let n = 0;
    const playerName = clipName(snap.player && snap.player.name, 16);
    const looseName = clipName(snap.name, 16);
    if (playerName || looseName) n += 3;
    const wins = snap.trophies && snap.trophies.wins;
    if (Array.isArray(wins) && wins.length) n += 10 + wins.length;
    if (snap.cup && typeof snap.cup === "object" && Object.keys(snap.cup).length) n += 6;
    if (snap.renames && typeof snap.renames === "object" && Object.keys(snap.renames).length) n += 2 + Object.keys(snap.renames).length;
    if (snap.team100 && typeof snap.team100 === "object" && Object.keys(snap.team100).length) n += 2 + Object.keys(snap.team100).length;
    const banList = snap.bans && Array.isArray(snap.bans.bans) ? snap.bans.bans : null;
    if (banList && banList.length) n += 2 + banList.length;
    if (snap.settings && typeof snap.settings === "object" && Object.keys(snap.settings).length) n += 1;
    if (snap.options && typeof snap.options === "object" && Object.keys(snap.options).length) n += 1;
    if (snap.playAsMe && (clipName(snap.playAsMe.name, 18) || typeof snap.playAsMe.on === "boolean")) n += 1;
    if (snap.minutes && snap.minutes.minutes != null && isFinite(Number(snap.minutes.minutes))) n += 1;
    if (snap.camera === "fp" || snap.camera === "tv") n += 1;
    return n;
  }
  function unwrapSettings(raw) {
    const empty = { menu: null, options: null, play: null, minutes: null };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
    if ("soccerSettings" in raw || "soccerOptions" in raw || "soccerPlayAsMe" in raw || "soccerMatchMinutes" in raw) {
      return {
        menu: raw.soccerSettings && typeof raw.soccerSettings === "object" ? raw.soccerSettings : null,
        options: raw.soccerOptions && typeof raw.soccerOptions === "object" ? raw.soccerOptions : null,
        play: raw.soccerPlayAsMe && typeof raw.soccerPlayAsMe === "object" ? raw.soccerPlayAsMe : null,
        minutes: raw.soccerMatchMinutes && typeof raw.soccerMatchMinutes === "object" ? raw.soccerMatchMinutes : null,
      };
    }
    return { menu: raw, options: null, play: null, minutes: null };
  }
  function snapFromRow(row) {
    if (!row || typeof row !== "object") {
      return { player: null, name: "", playAsMe: null, trophies: null, cup: null, settings: null, options: null, minutes: null, renames: null, team100: null, camera: null, bans: null };
    }
    const bag = unwrapSettings(row.settings);
    const display = clipName(row.display_name, 16);
    let minutes = null;
    if (row.match_minutes != null && isFinite(Number(row.match_minutes))) {
      minutes = { minutes: Math.round(Number(row.match_minutes)), custom: !!(bag.minutes && bag.minutes.custom) };
    } else if (bag.minutes && bag.minutes.minutes != null && isFinite(Number(bag.minutes.minutes))) {
      minutes = { minutes: Math.round(Number(bag.minutes.minutes)), custom: !!bag.minutes.custom };
    }
    let play = null;
    if (bag.play || typeof row.play_as_me === "boolean") {
      play = {
        on: typeof row.play_as_me === "boolean" ? row.play_as_me : !!bag.play.on,
        name: clipName(bag.play && bag.play.name, 18),
      };
    }
    return {
      player: display || row.favorite_team || row.favorite_color ? {
        name: display,
        team: row.favorite_team ? String(row.favorite_team) : "",
        color: row.favorite_color ? String(row.favorite_color) : "",
      } : null,
      name: display,
      playAsMe: play,
      trophies: row.trophies && typeof row.trophies === "object" ? row.trophies : null,
      cup: row.cup && typeof row.cup === "object" ? row.cup : null,
      settings: bag.menu,
      options: bag.options,
      minutes: minutes,
      renames: row.renames && typeof row.renames === "object" && !Array.isArray(row.renames) ? row.renames : null,
      team100: row.team_100 && typeof row.team_100 === "object" && !Array.isArray(row.team_100) ? row.team_100 : null,
      camera: row.camera_choice === "fp" || row.camera_choice === "tv" ? row.camera_choice : null,
      bans: row.host_bans && typeof row.host_bans === "object" ? row.host_bans : null,
    };
  }
  function profileSnap(snap) {
    const player = snap && snap.player ? {
      name: clipName(snap.player.name, 16),
      team: snap.player.team ? String(snap.player.team) : "",
      color: snap.player.color ? String(snap.player.color) : "",
    } : null;
    return canonical({
      player: player,
      name: clipName((snap && snap.name) || (player && player.name) || "", 16),
      playAsMe: snap && snap.playAsMe ? { on: !!snap.playAsMe.on, name: clipName(snap.playAsMe.name, 18) } : null,
      trophies: (snap && snap.trophies) || null,
      cup: (snap && snap.cup) || null,
      settings: (snap && snap.settings) || null,
      options: (snap && snap.options) || null,
      minutes: (snap && snap.minutes) || null,
      renames: (snap && snap.renames) || null,
      team100: (snap && snap.team100) || null,
      camera: (snap && snap.camera) || null,
      bans: (snap && snap.bans) || null,
    });
  }
  function hashSnap(snap) {
    const s = JSON.stringify(profileSnap(snap));
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16) + ":" + s.length;
  }
  function toRow(snap, userId) {
    const player = snap && snap.player;
    const display = clipName((player && player.name) || (snap && snap.name) || "", 16);
    const play = snap && snap.playAsMe && typeof snap.playAsMe === "object" ? snap.playAsMe : null;
    const minutes = snap && snap.minutes && snap.minutes.minutes != null && isFinite(Number(snap.minutes.minutes))
      ? { minutes: Math.round(Number(snap.minutes.minutes)), custom: !!snap.minutes.custom }
      : null;
    const playSaved = play ? { on: !!play.on, name: clipName(play.name, 18) || "Dashiell G." } : null;
    return {
      id: userId,
      display_name: display || null,
      favorite_team: player && player.team ? String(player.team).slice(0, 40) : null,
      favorite_color: player && player.color ? String(player.color).slice(0, 32) : null,
      play_as_me: play ? !!play.on : null,
      trophies: snap && snap.trophies && typeof snap.trophies === "object" ? snap.trophies : null,
      cup: snap && snap.cup && typeof snap.cup === "object" ? snap.cup : null,
      settings: {
        soccerSettings: snap && snap.settings && typeof snap.settings === "object" ? snap.settings : null,
        soccerOptions: snap && snap.options && typeof snap.options === "object" ? snap.options : null,
        soccerPlayAsMe: playSaved,
        soccerMatchMinutes: minutes,
      },
      renames: snap && snap.renames && typeof snap.renames === "object" && !Array.isArray(snap.renames) ? snap.renames : null,
      team_100: snap && snap.team100 && typeof snap.team100 === "object" && !Array.isArray(snap.team100) ? snap.team100 : null,
      host_bans: snap && snap.bans && typeof snap.bans === "object" ? snap.bans : null,
      match_minutes: minutes ? minutes.minutes : null,
      camera_choice: snap && (snap.camera === "fp" || snap.camera === "tv") ? snap.camera : null,
    };
  }
  function shouldUpload(localSnap, cloudRow) {
    const localScore = richness(localSnap);
    const cloudScore = cloudRow ? richness(snapFromRow(cloudRow)) : 0;
    if (localScore === 0 && cloudScore > 0) return false;
    if (localScore === 0) return false;
    return true;
  }
  function planSync(opts) {
    opts = opts || {};
    const local = opts.local || {};
    const cloudSnap = opts.cloud ? snapFromRow(opts.cloud) : null;
    const localScore = richness(local);
    const cloudScore = cloudSnap ? richness(cloudSnap) : 0;
    const choice = opts.choice && opts.choice.userId === opts.userId ? opts.choice : null;
    const localEmpty = localScore === 0;
    const cloudEmpty = !opts.cloud || cloudScore === 0;
    if (choice && choice.mode === "keep") return { action: "keep" };
    if (localEmpty && !cloudEmpty) return { action: "download" };
    if (localEmpty && cloudEmpty) return { action: "noop" };
    if (cloudEmpty) {
      if (choice && choice.mode === "sync") return { action: "upload" };
      return { action: "ask-upload" };
    }
    const localHash = opts.localHash || hashSnap(local);
    const cloudHash = hashSnap(cloudSnap);
    if (choice && choice.mode === "sync") {
      const localDirty = !!opts.baseHash && localHash !== opts.baseHash;
      const cloudTime = Date.parse(opts.cloud && opts.cloud.updated_at) || 0;
      const syncTime = Date.parse(opts.syncedAt) || 0;
      const cloudNewer = !!opts.syncedAt && cloudTime > syncTime + 1500;
      if (!opts.syncedAt) {
        if (localHash === cloudHash) return { action: "noop" };
        return { action: "ask-merge" };
      }
      if (cloudNewer && localDirty) return { action: "ask-merge" };
      if (cloudNewer) return { action: "download" };
      if (localDirty) return { action: "upload" };
      return { action: "noop" };
    }
    return { action: "ask-merge" };
  }
  function writesFromRow(row, ctx) {
    ctx = ctx || {};
    const existing = ctx.player && typeof ctx.player === "object" ? ctx.player : {};
    const deviceId = String(existing.deviceId || ctx.deviceId || "");
    const bag = unwrapSettings(row && row.settings);
    const display = row && typeof row.display_name === "string" ? clipName(row.display_name, 16) : "";
    const writes = {};
    if (display) {
      const player = {
        name: display,
        team: String(row.favorite_team || existing.team || "blue").slice(0, 40),
        color: String(row.favorite_color || existing.color || "#e6b325").slice(0, 32),
      };
      if (/^[a-f0-9]{32}$/.test(deviceId)) player.deviceId = deviceId;
      writes.soccerPlayer = JSON.stringify(player);
      writes.soccerName = display;
    }
    const playName = bag.play && typeof bag.play.name === "string" ? bag.play.name : "";
    const playOn = row && typeof row.play_as_me === "boolean"
      ? row.play_as_me
      : (bag.play && typeof bag.play.on === "boolean" ? bag.play.on : null);
    if (playOn !== null || playName) {
      const name = clipName(playName, 18) || "Dashiell G.";
      writes.soccerPlayAsMe = JSON.stringify({ on: playOn === null ? true : !!playOn, name: name });
    } else {
      writes.soccerPlayAsMe = null;
    }
    writes.soccerTrophies = row && row.trophies && typeof row.trophies === "object" ? JSON.stringify(row.trophies) : null;
    writes.soccerCup = row && row.cup && typeof row.cup === "object" ? JSON.stringify(row.cup) : null;
    writes.soccerSettings = bag.menu ? JSON.stringify(bag.menu) : null;
    writes.soccerOptions = bag.options ? JSON.stringify(bag.options) : null;
    let minutes = null;
    if (row && row.match_minutes != null && isFinite(Number(row.match_minutes))) {
      minutes = { minutes: Math.round(Number(row.match_minutes)), custom: !!(bag.minutes && bag.minutes.custom) };
    } else if (bag.minutes && bag.minutes.minutes != null && isFinite(Number(bag.minutes.minutes))) {
      minutes = { minutes: Math.round(Number(bag.minutes.minutes)), custom: !!bag.minutes.custom };
    }
    writes.soccerMatchMinutes = minutes ? JSON.stringify(minutes) : null;
    writes.soccerRenames = row && row.renames && typeof row.renames === "object" && !Array.isArray(row.renames) ? JSON.stringify(row.renames) : null;
    writes.soccerTeam100 = row && row.team_100 && typeof row.team_100 === "object" && !Array.isArray(row.team_100) ? JSON.stringify(row.team_100) : null;
    writes.soccerCamera = row && (row.camera_choice === "fp" || row.camera_choice === "tv") ? row.camera_choice : null;
    writes.soccerHostBans = row && row.host_bans && typeof row.host_bans === "object" ? JSON.stringify(row.host_bans) : null;
    return writes;
  }
  function applyWrites(storage, writes) {
    if (!storage || !writes) return;
    Object.keys(writes).forEach(function (key) {
      if (!WRITE_KEYS[key]) return;
      try {
        if (writes[key] == null) storage.removeItem(key);
        else storage.setItem(key, writes[key]);
      } catch (e) { /* private mode */ }
    });
  }
  function isMissingTable(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const msg = String(error.message || error.details || "").toLowerCase();
    if (code === "PGRST205" || code === "42P01") return true;
    return msg.indexOf("profiles") >= 0 && (msg.indexOf("schema cache") >= 0 || msg.indexOf("does not exist") >= 0 || msg.indexOf("could not find the table") >= 0);
  }
  function inNativeApp(loc) {
    try {
      if (loc && (loc.protocol === "capacitor:" || loc.protocol === "ionic:")) return true;
      if (typeof Capacitor !== "undefined" && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) return true;
    } catch (e) { /* a normal browser */ }
    return false;
  }
  function appRedirect() {
    return (typeof KICKOFF_APP_REDIRECT === "string" && KICKOFF_APP_REDIRECT) || "kickoff://login";
  }
  function emailRedirectTo(loc) {
    if (inNativeApp(loc)) return appRedirect();
    try {
      if (loc && loc.origin === "https://dashiell405.github.io" && String(loc.pathname || "").indexOf("/soccer-") === 0) {
        return loc.origin + loc.pathname;
      }
    } catch (e) { /* use the live site */ }
    return SITE;
  }
  function redirectBlocked(error) {
    const low = String((error && (error.message || error.error_description)) || "").toLowerCase();
    return low.indexOf("redirect") >= 0 || low.indexOf("not allowed") >= 0;
  }
  function askUploadMessage() {
    return "This phone already has a saved Kickoff game. Save it to the parent email so another phone can use it?\n\nOK = save this phone's game to the account\nCancel = not now. This phone keeps the game, and nothing is uploaded.";
  }
  function askMergeMessage() {
    return "This phone has a saved game, and the email account has one too.\n\nOK = use this phone's game and save it to the account\nCancel = use the account's game on this phone";
  }
  function friendlyAuthError(error) {
    const msg = String((error && (error.message || error.error_description)) || "");
    const low = msg.toLowerCase();
    if (!msg) return "Something went wrong. You can still play on this phone.";
    if (low.indexOf("rate") >= 0 || low.indexOf("once every") >= 0 || low.indexOf("too many") >= 0) return "Wait a minute, then ask for another email.";
    if (low.indexOf("email") >= 0 && low.indexOf("invalid") >= 0) return "Type the parent email, like name@email.com.";
    if (low.indexOf("token") >= 0 || low.indexOf("otp") >= 0 || low.indexOf("expired") >= 0) return "That code is not right or it is too old. Ask for a new email.";
    if (low.indexOf("redirect") >= 0 || low.indexOf("not allowed") >= 0) return "The sign-in link was blocked. A parent needs to allow this website in Supabase.";
    if (low.indexOf("fetch") >= 0 || low.indexOf("network") >= 0 || low.indexOf("failed to fetch") >= 0) return "Sign-in needs the internet. You can keep playing on this phone.";
    return "Could not sign in. You can keep playing on this phone.";
  }

  const api = {
    richness: richness,
    readLocal: readLocal,
    toRow: toRow,
    snapFromRow: snapFromRow,
    planSync: planSync,
    shouldUpload: shouldUpload,
    writesFromRow: writesFromRow,
    applyWrites: applyWrites,
    hashSnap: hashSnap,
    isMissingTable: isMissingTable,
    emailRedirectTo: emailRedirectTo,
    inNativeApp: inNativeApp,
    askUploadMessage: askUploadMessage,
    askMergeMessage: askMergeMessage,
    friendlyAuthError: friendlyAuthError,
    paint: function () {},
    signOut: function () {},
  };
  root.CloudAccount = api;

  if (typeof document === "undefined") return;

  const state = {
    email: "",
    code: "",
    status: "You can play with no account. This phone still remembers your game.",
    mode: "signed-out",
    session: null,
    choice: null,
    metaUser: "",
    syncedAt: "",
    baseHash: "",
    tableMissing: false,
    busy: false,
    planning: false,
    planAgain: false,
    dirty: false,
    pushing: false,
    applying: false,
    pushTimer: 0,
    waitTimer: 0,
    client: null,
    clientPromise: null,
    booted: false,
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function setStatus(text) {
    state.status = text;
    const el = document.getElementById("accountStatus");
    if (el) el.textContent = text;
  }
  function playerLabel() {
    const snap = readLocal(storageOf());
    return clipName((snap.player && snap.player.name) || snap.name, 16);
  }
  function loadBook() {
    const store = storageOf();
    if (!store) return;
    const choice = parseObj(getRaw(store, CHOICE_KEY));
    if (choice && choice.userId && (choice.mode === "sync" || choice.mode === "keep")) state.choice = choice;
    const meta = parseObj(getRaw(store, META_KEY));
    if (meta && meta.userId) {
      state.metaUser = String(meta.userId);
      state.syncedAt = meta.at || "";
      state.baseHash = meta.hash || "";
    }
  }
  function saveBook(userId) {
    const store = storageOf();
    if (!store || !userId || !state.choice) return;
    const prev = state.applying;
    state.applying = true;
    try {
      store.setItem(CHOICE_KEY, JSON.stringify({ userId: userId, mode: state.choice.mode }));
      store.setItem(META_KEY, JSON.stringify({ userId: userId, at: state.syncedAt || "", hash: state.baseHash || "" }));
    } catch (e) { /* ignore */ }
    state.applying = prev;
  }
  function refreshGame() {
    try { if (typeof loadSettings === "function") loadSettings(); } catch (e) { /* online page has no menu settings */ }
    try {
      if (typeof GameSettings !== "undefined" && GameSettings.load) {
        GameSettings.load();
        if (typeof applySettings === "function") applySettings();
      }
    } catch (e) { /* ignore */ }
    try { if (typeof loadCameraMode === "function") loadCameraMode(); } catch (e) { /* ignore */ }
    try { if (typeof PlayerAccount !== "undefined" && PlayerAccount.refresh) PlayerAccount.refresh(); } catch (e) { /* ignore */ }
    try { if (typeof renderMenu === "function") renderMenu(); } catch (e) { /* ignore */ }
    try { if (typeof paintTrophyBadge === "function") paintTrophyBadge(); } catch (e) { /* ignore */ }
    try { if (typeof paintPlayAsMe === "function") paintPlayAsMe(); } catch (e) { /* ignore */ }
    try { if (typeof paintSquad === "function") paintSquad(); } catch (e) { /* ignore */ }
  }
  function downloadRow(row) {
    const store = storageOf();
    if (!store || !row) return;
    const existing = readLocal(store);
    const writes = writesFromRow(row, { player: existing.player, deviceId: getRaw(store, "soccerDeviceId") || "" });
    state.applying = true;
    try {
      applyWrites(store, writes);
      refreshGame();
    } finally {
      state.applying = false;
    }
    state.baseHash = hashSnap(readLocal(store));
    state.syncedAt = row.updated_at || new Date().toISOString();
    state.metaUser = state.session && state.session.user ? state.session.user.id : state.metaUser;
  }
  function userId() {
    return state.session && state.session.user ? state.session.user.id : "";
  }
  function clientOrNull() {
    if (state.client) return Promise.resolve(state.client);
    if (state.clientPromise) return state.clientPromise;
    if (typeof SUPABASE_URL !== "string" || typeof SUPABASE_PUBLISHABLE_KEY !== "string") {
      return Promise.resolve(null);
    }
    state.clientPromise = import(SUPABASE_JS).then(function (mod) {
      const createClient = mod.createClient || (mod.default && mod.default.createClient);
      if (!createClient) return null;
      state.client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
          flowType: "pkce",
        },
      });
      return state.client;
    }).catch(function () {
      state.clientPromise = null;
      return null;
    });
    return state.clientPromise;
  }
  function fetchRow(client, id) {
    return client.from("profiles").select("*").eq("id", id).maybeSingle().then(function (res) {
      if (res.error) {
        if (isMissingTable(res.error)) return { missing: true, row: null, error: res.error };
        return { missing: false, row: null, error: res.error };
      }
      return { missing: false, row: res.data || null, error: null };
    });
  }
  function markMissing() {
    state.tableMissing = true;
    setStatus("Signed in, but the saved-game table is not ready yet. A parent still needs to create it in Supabase. You can keep playing on this phone.");
    api.paint();
  }
  function matchRunning() {
    try {
      if (typeof inMatch === "function" && inMatch()) return true;
      if (typeof room !== "undefined" && room && room.state === "playing") return true;
    } catch (e) { /* ignore */ }
    return false;
  }
  async function push() {
    if (state.applying) { state.dirty = true; return; }
    if (state.pushing) { state.dirty = true; return; }
    const id = userId();
    if (!id || !state.choice || state.choice.mode !== "sync" || state.choice.userId !== id) return;
    if (state.tableMissing) return;
    state.pushing = true;
    state.dirty = false;
    try {
      const client = await clientOrNull();
      if (!client) {
        state.dirty = true;
        setStatus("Still on this phone. It will save to the account when the internet is back.");
        return;
      }
      const local = readLocal(storageOf());
      const existing = await fetchRow(client, id);
      if (existing.missing) { markMissing(); return; }
      if (existing.error) {
        state.dirty = true;
        setStatus("Still on this phone. It will try the account again when the internet is back.");
        return;
      }
      if (!shouldUpload(local, existing.row)) {
        if (existing.row && richness(snapFromRow(existing.row)) > 0) {
          state.choice = { userId: id, mode: "sync" };
          downloadRow(existing.row);
          saveBook(id);
          setStatus("This phone is using the saved game from the account.");
          api.paint();
        }
        return;
      }
      const row = toRow(local, id);
      const saved = await client.from("profiles").upsert(row, { onConflict: "id" }).select("updated_at").maybeSingle();
      if (saved.error) {
        if (isMissingTable(saved.error)) { markMissing(); return; }
        state.dirty = true;
        const low = String(saved.error.message || "").toLowerCase();
        if (low.indexOf("column") >= 0) setStatus("Signed in, but the saved-game table is missing a column. A parent needs to update it. You can keep playing on this phone.");
        else setStatus("Still on this phone. It will try the account again when the internet is back.");
        return;
      }
      state.syncedAt = (saved.data && saved.data.updated_at) || new Date().toISOString();
      state.baseHash = hashSnap(readLocal(storageOf()));
      state.metaUser = id;
      state.choice = { userId: id, mode: "sync" };
      saveBook(id);
      setStatus("Saved to the account.");
    } catch (e) {
      state.dirty = true;
      setStatus("Still on this phone. It will try the account again when the internet is back.");
    } finally {
      state.pushing = false;
      if (state.dirty && state.choice && state.choice.mode === "sync") {
        clearTimeout(state.pushTimer);
        state.pushTimer = setTimeout(function () { push(); }, 4000);
      }
    }
  }
  function schedulePush() {
    if (state.applying || !state.session) return;
    const id = userId();
    if (!state.choice || state.choice.mode !== "sync" || state.choice.userId !== id) return;
    state.dirty = true;
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(function () { push(); }, 700);
  }
  async function planOnce() {
    const id = userId();
    if (!id) return false;
    if (state.tableMissing) return false;
    if (state.waitTimer) return true;
    const client = await clientOrNull();
    if (!client) {
      setStatus("Signed in. Saving needs the internet. You can keep playing on this phone.");
      return false;
    }
    const got = await fetchRow(client, id);
    if (got.missing) { markMissing(); return false; }
    if (got.error) {
      setStatus("Signed in, but the saved game could not be loaded. You can keep playing on this phone.");
      return false;
    }
    const local = readLocal(storageOf());
    const choice = state.choice && state.choice.userId === id ? state.choice : null;
    const metaOk = state.metaUser === id;
    const plan = planSync({
      local: local,
      cloud: got.row,
      choice: choice,
      userId: id,
      syncedAt: metaOk ? state.syncedAt : "",
      baseHash: metaOk ? state.baseHash : "",
      localHash: hashSnap(local),
    });
    if ((plan.action === "download" || plan.action === "ask-upload" || plan.action === "ask-merge") && matchRunning()) {
      state.waitTimer = setTimeout(function () {
        state.waitTimer = 0;
        runPlan();
      }, 2000);
      return true;
    }
    if (plan.action === "download" && got.row) {
      state.choice = { userId: id, mode: "sync" };
      downloadRow(got.row);
      saveBook(id);
      setStatus("This phone is using the saved game from the account.");
      api.paint();
    } else if (plan.action === "upload") {
      state.choice = { userId: id, mode: "sync" };
      saveBook(id);
      await push();
    } else if (plan.action === "ask-upload") {
      const ok = window.confirm(askUploadMessage());
      if (ok) {
        state.choice = { userId: id, mode: "sync" };
        saveBook(id);
        await push();
      } else {
        state.choice = { userId: id, mode: "keep" };
        saveBook(id);
        setStatus("Nothing was uploaded. This phone keeps its game.");
        api.paint();
      }
    } else if (plan.action === "ask-merge") {
      const ok = window.confirm(askMergeMessage());
      if (ok) {
        state.choice = { userId: id, mode: "sync" };
        saveBook(id);
        await push();
      } else if (got.row) {
        state.choice = { userId: id, mode: "sync" };
        downloadRow(got.row);
        saveBook(id);
        setStatus("This phone is using the saved game from the account.");
        api.paint();
      }
    } else if (plan.action === "keep") {
      setStatus("Signed in. This phone is not copying its game to the account.");
      api.paint();
    } else {
      const email = state.session.user && state.session.user.email;
      setStatus(email ? "Signed in as " + email + "." : "Signed in.");
      api.paint();
    }
    return false;
  }
  function runPlan() {
    if (state.planning) { state.planAgain = true; return; }
    state.planning = true;
    (async function () {
      try {
        do {
          state.planAgain = false;
          const waiting = await planOnce();
          if (waiting) return;
        } while (state.planAgain);
      } catch (e) {
        setStatus("Signed in, but the saved game could not be loaded. You can keep playing on this phone.");
      } finally {
        state.planning = false;
      }
    })();
  }
  async function sendLink() {
    const email = String(state.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("Type the parent email, like name@email.com.");
      return;
    }
    state.busy = true;
    api.paint();
    try {
      const client = await clientOrNull();
      if (!client) {
        setStatus("Sign-in needs the internet. You can keep playing on this phone.");
        return;
      }
      const native = inNativeApp(window.location);
      let redirect = emailRedirectTo(window.location);
      let result = await client.auth.signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: redirect,
          shouldCreateUser: true,
        },
      });
      // The code works as soon as the email sends. If kickoff://login is not
      // on the Supabase allow list yet, ask again with the website address
      // so the email (and the code) still arrive.
      if (result.error && native && redirect !== SITE && redirectBlocked(result.error)) {
        redirect = SITE;
        result = await client.auth.signInWithOtp({
          email: email,
          options: { emailRedirectTo: SITE, shouldCreateUser: true },
        });
        if (!result.error) {
          state.mode = "code";
          setStatus("Check the parent email and type the code here. The link opens the website, not this app, until a parent allows kickoff://login in Supabase.");
          return;
        }
      }
      if (result.error) { setStatus(friendlyAuthError(result.error)); return; }
      state.mode = "code";
      setStatus(native
        ? "Check the parent email. Type the code here. Tapping the link should open Kickoff."
        : "Check the parent email. Open the link on this phone, or type the code from the email.");
    } catch (e) {
      setStatus("Sign-in needs the internet. You can keep playing on this phone.");
    } finally {
      state.busy = false;
      api.paint();
    }
  }
  async function verifyCode() {
    const email = String(state.email || "").trim();
    const token = String(state.code || "").replace(/\s/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || token.length < 6) {
      setStatus("Type the parent email and the code from the email.");
      return;
    }
    state.busy = true;
    api.paint();
    try {
      const client = await clientOrNull();
      if (!client) {
        setStatus("Sign-in needs the internet. You can keep playing on this phone.");
        return;
      }
      const result = await client.auth.verifyOtp({ email: email, token: token, type: "email" });
      if (result.error) { setStatus(friendlyAuthError(result.error)); return; }
      setStatus("Signed in. Checking the saved game...");
    } catch (e) {
      setStatus("Sign-in needs the internet. You can keep playing on this phone.");
    } finally {
      state.busy = false;
      api.paint();
    }
  }
  async function signOut() {
    const client = state.client;
    state.session = null;
    state.mode = "signed-out";
    state.dirty = false;
    if (client) {
      try { await client.auth.signOut(); } catch (e) { /* still leave the screen signed out */ }
    }
    setStatus("Signed out. This phone still has its game.");
    api.paint();
  }
  async function savePhone() {
    const id = userId();
    if (!id) return;
    const local = readLocal(storageOf());
    if (richness(local) === 0) {
      setStatus("This phone does not have a saved game to copy yet.");
      return;
    }
    if (!window.confirm("Save this phone's game to the account? The account will use this phone's name, trophies and settings.")) return;
    state.choice = { userId: id, mode: "sync" };
    saveBook(id);
    await push();
    api.paint();
  }
  async function useAccount() {
    const id = userId();
    if (!id) return;
    const client = await clientOrNull();
    if (!client) {
      setStatus("That needs the internet. You can keep playing on this phone.");
      return;
    }
    const got = await fetchRow(client, id);
    if (got.missing) { markMissing(); return; }
    if (got.error || !got.row || richness(snapFromRow(got.row)) === 0) {
      setStatus("The account does not have a saved game yet.");
      return;
    }
    if (!window.confirm("Use the account's game on this phone? This phone's saved name, trophies and settings will switch to the account.")) return;
    state.choice = { userId: id, mode: "sync" };
    downloadRow(got.row);
    saveBook(id);
    setStatus("This phone is using the saved game from the account.");
    api.paint();
  }
  function paint(panel) {
    try {
      const box = panel || document.getElementById("accountPanel");
      if (!box) return;
      const signedIn = !!(state.session && state.session.user);
      const email = signedIn && state.session.user.email ? state.session.user.email : "";
      const shown = playerLabel();
      const native = inNativeApp(typeof location !== "undefined" ? location : null);
      let html = "<h3>Account (optional)</h3>";
      if (!signedIn) {
        if (native) {
          html += "<p>Sign in with a parent email to keep this player on another phone or tablet. Kickoff does not save a password. We email a code. Type that code here.</p>";
          html += "<p>The email also has a link. Tapping it should open this app. If it opens the website instead, type the code. You can skip this. With no account, this phone keeps the game it already saved.</p>";
        } else {
          html += "<p>Sign in with a parent email to keep this player on another phone or tablet. Kickoff does not save a password. We email a link. If the email has a code, type it here.</p>";
          html += "<p>You can skip this. With no account, or when you are offline, this phone keeps the game it already saved.</p>";
        }
        html += "<p class='privacy'>What is saved: your player name, favourite team, colour, play-as-me name, trophies, cup, settings, match length, renamed players, star teams, camera, and bans from games you host. Friends in a room see your player name. If you saved \"Dashiell G.\", that is the name they see. A parent can delete the account in Supabase.</p>";
        html += "<label for='accountEmail'>Parent email</label>";
        html += "<input id='accountEmail' type='email' autocomplete='email' inputmode='email' placeholder='name@email.com'>";
        html += native
          ? "<div class='accountRow'><button type='button' id='accountSend'>Email me a code</button></div>"
          : "<div class='accountRow'><button type='button' id='accountSend'>Email me a sign-in link</button></div>";
        html += "<label for='accountCode'>Code from the email</label>";
        html += "<input id='accountCode' inputmode='numeric' autocomplete='one-time-code' maxlength='12' placeholder='6 digit code'>";
        html += "<div class='accountRow'><button type='button' id='accountUseCode'>Use this code</button></div>";
      } else {
        html += "<p>Signed in as <b>" + esc(email || "your email") + "</b>.</p>";
        html += shown
          ? "<p>Friends in a room see <b>" + esc(shown) + "</b>.</p>"
          : "<p>Friends in a room see your player name once you pick one.</p>";
        html += "<p class='privacy'>The account stores that name, your team, colour, trophies, cup, settings and host bans. It does not store a password. A parent can delete the account in Supabase. Signing out keeps the game on this phone.</p>";
        if (state.choice && state.choice.mode === "keep") {
          html += "<div class='accountRow'><button type='button' id='accountSavePhone'>Save this phone's game to the account</button></div>";
          html += "<div class='accountRow'><button type='button' id='accountUseCloud'>Use the account game on this phone</button></div>";
        }
        html += "<div class='accountRow'><button type='button' id='accountSignOut'>Sign out</button></div>";
      }
      html += "<p id='accountStatus' aria-live='polite'></p>";
      box.innerHTML = html;
      const status = document.getElementById("accountStatus");
      if (status) status.textContent = state.status;
      const emailInput = document.getElementById("accountEmail");
      const codeInput = document.getElementById("accountCode");
      if (emailInput) {
        emailInput.value = state.email;
        emailInput.disabled = !!state.busy;
        emailInput.addEventListener("input", function () { state.email = emailInput.value; });
        emailInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); sendLink(); } });
      }
      if (codeInput) {
        codeInput.value = state.code;
        codeInput.disabled = !!state.busy;
        codeInput.addEventListener("input", function () { state.code = codeInput.value; });
      }
      const send = document.getElementById("accountSend");
      const use = document.getElementById("accountUseCode");
      const out = document.getElementById("accountSignOut");
      const save = document.getElementById("accountSavePhone");
      const cloud = document.getElementById("accountUseCloud");
      if (send) { send.disabled = !!state.busy; send.addEventListener("click", function () { sendLink(); }); }
      if (use) { use.disabled = !!state.busy; use.addEventListener("click", function () { verifyCode(); }); }
      if (out) out.addEventListener("click", function () { signOut(); });
      if (save) save.addEventListener("click", function () { savePhone(); });
      if (cloud) cloud.addEventListener("click", function () { useAccount(); });
    } catch (e) { /* the game keeps running */ }
  }
  function watchStorage() {
    const store = storageOf();
    if (!store || store.__kickoffWrapped) return;
    const orig = store.setItem.bind(store);
    try {
      store.setItem = function (key, value) {
        try { orig(key, value); } catch (e) { return; }
        if (state.applying) return;
        if (WATCH[key]) schedulePush();
      };
      store.__kickoffWrapped = true;
    } catch (e) { /* host object would not wrap; the timer below still notices changes */ }
  }
  function showUrlError() {
    try {
      const q = new URLSearchParams(window.location.search);
      const h = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
      const msg = q.get("error_description") || h.get("error_description");
      if (msg) setStatus(friendlyAuthError({ message: msg }));
    } catch (e) { /* ignore */ }
  }
  function finishNativeLogin(url) {
    if (!url || String(url).indexOf("kickoff://") !== 0) return;
    let code = "";
    let access = "";
    let refresh = "";
    let err = "";
    try {
      const parsed = new URL(url);
      const hash = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
      code = parsed.searchParams.get("code") || hash.get("code") || "";
      access = parsed.searchParams.get("access_token") || hash.get("access_token") || "";
      refresh = parsed.searchParams.get("refresh_token") || hash.get("refresh_token") || "";
      err = parsed.searchParams.get("error_description") || hash.get("error_description") || "";
    } catch (e) {
      setStatus("That sign-in link did not work. Type the code from the email.");
      return;
    }
    if (err) { setStatus(friendlyAuthError({ message: err })); return; }
    if (!code && !(access && refresh)) return;
    clientOrNull().then(function (client) {
      if (!client || !client.auth) {
        setStatus("Sign-in needs the internet. You can keep playing on this phone.");
        return;
      }
      const done = function (result) {
        if (result && result.error) setStatus(friendlyAuthError(result.error));
        else setStatus("Signed in. Checking the saved game...");
      };
      const fail = function () { setStatus("That sign-in link did not work. Type the code from the email."); };
      if (code && client.auth.exchangeCodeForSession) {
        Promise.resolve(client.auth.exchangeCodeForSession(code)).then(done).catch(fail);
        return;
      }
      if (access && refresh && client.auth.setSession) {
        Promise.resolve(client.auth.setSession({ access_token: access, refresh_token: refresh })).then(done).catch(fail);
      }
    }).catch(function () {
      setStatus("Sign-in needs the internet. You can keep playing on this phone.");
    });
  }
  function listenForAppLinks() {
    let AppPlugin = null;
    try { AppPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App; } catch (e) { AppPlugin = null; }
    if (!AppPlugin) return;
    if (typeof AppPlugin.addListener === "function") {
      try {
        AppPlugin.addListener("appUrlOpen", function (data) { finishNativeLogin(data && data.url); });
      } catch (e) { /* the code box still works */ }
    }
    if (typeof AppPlugin.getLaunchUrl === "function") {
      Promise.resolve(AppPlugin.getLaunchUrl()).then(function (res) {
        if (res && res.url) finishNativeLogin(res.url);
      }).catch(function () {});
    }
  }
  function boot() {
    if (state.booted) return;
    state.booted = true;
    const style = document.createElement("style");
    style.textContent = ""
      + "#accountPanel { text-align: left; margin: 8px 0 12px; max-width: 100%; }"
      + "#accountPanel h3 { margin: 4px 0 8px; font-size: 18px; overflow-wrap: break-word; }"
      + "#accountPanel p { margin: 0 0 8px; font-size: 15px; line-height: 1.4; color: #d5dbe6; overflow-wrap: break-word; }"
      + "#accountPanel .privacy { color: #ffd27a; }"
      + "#accountPanel label { display: block; font-weight: 700; margin: 8px 0 4px; }"
      + "#accountPanel input { width: 100%; box-sizing: border-box; min-height: 44px; border-radius: 10px; border: 1px solid rgba(255,255,255,.35); background: #fff; color: #111; font: inherit; font-size: 16px; padding: 8px 10px; user-select: text; -webkit-user-select: text; }"
      + "#accountPanel .accountRow { margin: 8px 0; }"
      + "#accountPanel button { min-height: 44px; max-width: 100%; padding: 8px 14px; border-radius: 10px; border: 0; background: #e8c547; color: #1a1404; font: inherit; font-weight: 800; white-space: normal; }"
      + "#accountSignOut, #accountUseCloud { background: #243044 !important; color: #fff !important; }"
      + "#accountStatus { font-weight: 700; color: #fff; }";
    document.head.appendChild(style);
    loadBook();
    watchStorage();
    showUrlError();
    listenForAppLinks();
    api.paint = paint;
    api.signOut = signOut;
    setInterval(function () {
      const id = userId();
      if (!id || state.applying || state.pushing) return;
      if (!state.choice || state.choice.mode !== "sync" || state.choice.userId !== id) return;
      if (!state.baseHash) return;
      if (hashSnap(readLocal(storageOf())) !== state.baseHash) schedulePush();
    }, 8000);
    window.addEventListener("online", function () { if (state.dirty) push(); });
    window.addEventListener("pagehide", function () { if (state.dirty) push(); });
    clientOrNull().then(function (client) {
      if (!client) {
        setStatus("Sign-in needs the internet. You can keep playing on this phone.");
        return;
      }
      client.auth.onAuthStateChange(function (_event, session) {
        state.session = session || null;
        state.mode = session ? "signed-in" : "signed-out";
        if (!session) {
          api.paint();
          return;
        }
        api.paint();
        runPlan();
      });
      client.auth.getSession().then(function (res) {
        const session = res && res.data && res.data.session;
        if (!session) return;
        state.session = session;
        state.mode = "signed-in";
        runPlan();
      }).catch(function () { /* still playable with no account */ });
    }).catch(function () {
      setStatus("Sign-in needs the internet. You can keep playing on this phone.");
    });
  }
  api.sharedClient = function () {
    try { return clientOrNull(); }
    catch (e) { return Promise.resolve(null); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof globalThis !== "undefined" ? globalThis : this);
