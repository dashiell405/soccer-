/* Kickoff account.
   A player can make a username and a password. The username becomes a
   non-routable address, <lowercase>@players.kickoff.invalid, so no real
   email is collected. A parent email (magic link / email code) still works.
   Signed-out and offline play keep using localStorage, the same keys as today.
   This file never reads or writes soccerAdminUnlock2 or soccerAdminPlace.
   Synced keys:
     soccerPlayer (name, team, colour only — device id stays on this phone)
     soccerName, soccerPlayAsMe, soccerTrophies, soccerCup, soccerSettings,
     soccerOptions, soccerMatchMinutes, soccerRenames, soccerTeam100,
     soccerCamera, soccerHostBans,
     soccerCareer, soccerCoins, soccerUpgrades, soccerChallenges, soccerKit,
     soccerRecord
   Those objects are stored as-is inside public.profiles.
   Career, coins, upgrades, challenges and the kit ride along inside the
   settings object on the player's own row. No new secret and no service key. */
(function (root) {
  const SITE = (typeof KICKOFF_SITE_URL === "string" && KICKOFF_SITE_URL) || "https://dashiell405.github.io/soccer-/";
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm";
  const CHOICE_KEY = "soccerCloudChoice";
  const META_KEY = "soccerCloudMeta";
  const WRITE_KEYS = {
    soccerPlayer: 1, soccerName: 1, soccerPlayAsMe: 1, soccerTrophies: 1, soccerCup: 1,
    soccerSettings: 1, soccerOptions: 1, soccerMatchMinutes: 1, soccerRenames: 1,
    soccerTeam100: 1, soccerCamera: 1, soccerHostBans: 1,
    soccerCareer: 1, soccerCoins: 1, soccerUpgrades: 1, soccerChallenges: 1, soccerKit: 1, soccerRecord: 1,
  };
  const WATCH = {
    soccerPlayer: 1, soccerName: 1, soccerPlayAsMe: 1, soccerTrophies: 1, soccerCup: 1,
    soccerSettings: 1, soccerOptions: 1, soccerMatchMinutes: 1, soccerRenames: 1,
    soccerTeam100: 1, soccerCamera: 1, soccerHostBans: 1,
    soccerCareer: 1, soccerCoins: 1, soccerUpgrades: 1, soccerChallenges: 1, soccerKit: 1, soccerRecord: 1,
  };
  const PROGRESS_FIELDS = ["soccerCareer", "soccerCoins", "soccerUpgrades", "soccerChallenges", "soccerKit", "soccerRecord"];
  const PLAYER_EMAIL_DOMAIN = "@players.kickoff.invalid";
  const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
  const TRY_LIMIT = 5;
  const TRY_WINDOW_MS = 60000;

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
      career: null, coins: null, upgrades: null, challenges: null, kit: null, record: null,
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
      career: parseObj(getRaw(storage, "soccerCareer")),
      coins: parseObj(getRaw(storage, "soccerCoins")),
      upgrades: parseObj(getRaw(storage, "soccerUpgrades")),
      challenges: parseObj(getRaw(storage, "soccerChallenges")),
      kit: parseObj(getRaw(storage, "soccerKit")),
      record: parseObj(getRaw(storage, "soccerRecord")),
    };
  }
  function progressObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function progressFromBag(bag) {
    const out = { career: null, coins: null, upgrades: null, challenges: null, kit: null, record: null };
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) return out;
    out.career = progressObject(bag.soccerCareer);
    out.coins = progressObject(bag.soccerCoins);
    out.upgrades = progressObject(bag.soccerUpgrades);
    out.challenges = progressObject(bag.soccerChallenges);
    out.kit = progressObject(bag.soccerKit);
    out.record = progressObject(bag.soccerRecord);
    return out;
  }
  function progressWrites(bag) {
    const writes = {};
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) return writes;
    PROGRESS_FIELDS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(bag, key)) return;
      const value = bag[key];
      writes[key] = value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : null;
    });
    return writes;
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
    if (snap.career && snap.career.clubName) n += 4;
    if (snap.career && snap.career.matchday) n += Math.min(6, Number(snap.career.matchday) || 0);
    if (snap.coins && Number(snap.coins.coins) > 0) n += 1;
    if (snap.upgrades) {
      const sum = ["sprint", "shot", "pass", "stamina"].reduce(function (a, k) { return a + (Number(snap.upgrades[k]) || 0); }, 0);
      if (sum > 0) n += 1 + Math.min(20, sum);
    }
    if (snap.challenges && Array.isArray(snap.challenges.badges) && snap.challenges.badges.length) n += snap.challenges.badges.length;
    if (snap.kit && snap.kit.touched) n += 1;
    if (snap.record && Number(snap.record.wins) > 0) n += 1;
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
      return { player: null, name: "", playAsMe: null, trophies: null, cup: null, settings: null, options: null, minutes: null, renames: null, team100: null, camera: null, bans: null, career: null, coins: null, upgrades: null, challenges: null, kit: null, record: null };
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
      career: progressFromBag(row.settings).career,
      coins: progressFromBag(row.settings).coins,
      upgrades: progressFromBag(row.settings).upgrades,
      challenges: progressFromBag(row.settings).challenges,
      kit: progressFromBag(row.settings).kit,
      record: progressFromBag(row.settings).record,
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
      career: (snap && snap.career) || null,
      coins: (snap && snap.coins) || null,
      upgrades: (snap && snap.upgrades) || null,
      challenges: (snap && snap.challenges) || null,
      kit: (snap && snap.kit) || null,
      record: (snap && snap.record) || null,
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
        soccerCareer: progressObject(snap && snap.career),
        soccerCoins: progressObject(snap && snap.coins),
        soccerUpgrades: progressObject(snap && snap.upgrades),
        soccerChallenges: progressObject(snap && snap.challenges),
        soccerKit: progressObject(snap && snap.kit),
        soccerRecord: progressObject(snap && snap.record),
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
    const extra = progressWrites(row && row.settings);
    Object.keys(extra).forEach(function (key) { writes[key] = extra[key]; });
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
    return "This phone already has a saved Kickoff game. Keep this device's progress on the account so another phone can use it?\n\nOK = keep this device's progress and save it\nCancel = not now. This phone keeps the game, and nothing is uploaded.";
  }
  function askMergeMessage() {
    return "This phone has a saved game, and the account has one too. Keep this device's progress or load your account's?\n\nOK = keep this device's progress\nCancel = load your account's";
  }
  function normalizeUsername(raw) {
    return String(raw || "").trim();
  }
  function usernameError(raw) {
    const name = normalizeUsername(raw);
    if (!name) return "Type a username.";
    if (!USERNAME_RE.test(name)) return "Use 3 to 16 letters, numbers, or underscores.";
    return "";
  }
  function playerEmail(username) {
    return normalizeUsername(username).toLowerCase() + PLAYER_EMAIL_DOMAIN;
  }
  function passwordStrength(pw) {
    const s = String(pw || "");
    if (s.length < 8) return { ok: false, label: "Use at least 8 characters." };
    let kinds = 0;
    if (/[a-z]/.test(s)) kinds++;
    if (/[A-Z]/.test(s)) kinds++;
    if (/[0-9]/.test(s)) kinds++;
    if (/[^A-Za-z0-9]/.test(s)) kinds++;
    if (s.length >= 12 && kinds >= 3) return { ok: true, label: "Strong password." };
    if (kinds >= 2) return { ok: true, label: "Okay password. A longer one is safer." };
    return { ok: true, label: "Weak password. Add a number or another word." };
  }
  function rateLimitAllow(now, stamps, limit, windowMs) {
    const t = Number(now) || 0;
    const lim = limit || TRY_LIMIT;
    const win = windowMs || TRY_WINDOW_MS;
    const recent = (Array.isArray(stamps) ? stamps : []).filter(function (s) { return t - Number(s) < win; });
    if (recent.length >= lim) {
      const oldest = Number(recent[0]) || t;
      return { ok: false, stamps: recent, retryIn: Math.max(0, win - (t - oldest)) };
    }
    recent.push(t);
    return { ok: true, stamps: recent, retryIn: 0 };
  }
  function authReason(error) {
    const msg = String((error && (error.message || error.error_description || error.code)) || "");
    const low = msg.toLowerCase();
    const status = Number(error && (error.status || error.statusCode)) || 0;
    const code = String(error && error.code || "");
    if (!low && !status) return "unknown";
    if (status === 429 || code === "over_request_rate_limit" || low.indexOf("rate") >= 0 || low.indexOf("once every") >= 0 || low.indexOf("too many") >= 0) return "rate";
    if (low.indexOf("fetch") >= 0 || low.indexOf("network") >= 0 || low.indexOf("failed to fetch") >= 0 || low.indexOf("offline") >= 0) return "offline";
    if (low.indexOf("already") >= 0 || low.indexOf("registered") >= 0 || low.indexOf("exists") >= 0 || low.indexOf("taken") >= 0 || low.indexOf("duplicate") >= 0 || low.indexOf("unique") >= 0 || code === "23505") return "taken";
    if (low.indexOf("invalid login") >= 0 || low.indexOf("invalid credentials") >= 0 || low.indexOf("invalid grant") >= 0) return "bad-login";
    if (low.indexOf("confirm") >= 0 && low.indexOf("email") >= 0) return "confirm-email";
    if (low.indexOf("password") >= 0 && (low.indexOf("least") >= 0 || low.indexOf("short") >= 0 || low.indexOf("weak") >= 0 || low.indexOf("characters") >= 0 || code === "weak_password")) return "weak-password";
    if (low.indexOf("email") >= 0 && low.indexOf("invalid") >= 0) return "bad-email";
    if (low.indexOf("token") >= 0 || low.indexOf("otp") >= 0 || low.indexOf("expired") >= 0) return "bad-code";
    if (low.indexOf("redirect") >= 0 || low.indexOf("not allowed") >= 0) return "redirect";
    return "unknown";
  }
  function confirmEmailMessage() {
    return "Kickoff could not finish signing you in. A grown-up needs to turn off Confirm email. In Supabase that is Authentication, then Sign In / Providers, then Email. You can keep playing on this phone.";
  }
  function friendlyAuthError(error, kind) {
    const reason = authReason(error);
    if (kind === "password") {
      if (reason === "rate") return "Too many tries. Wait a minute, then try again.";
      if (reason === "taken") return "That username is taken. Try another.";
      if (reason === "bad-login") return "That username or password is not right.";
      if (reason === "weak-password") return "That password was not accepted. Use at least 8 characters. If it still fails, a grown-up can set the Supabase minimum password length to 8.";
      if (reason === "offline") return "Sign-in needs the internet. You can keep playing on this phone.";
      if (reason === "confirm-email") return confirmEmailMessage();
      if (!error || !String(error.message || error.error_description || "")) return "Something went wrong. You can still play on this phone.";
      return "Could not sign in. You can keep playing on this phone.";
    }
    const msg = String((error && (error.message || error.error_description)) || "");
    if (!msg) return "Something went wrong. You can still play on this phone.";
    if (reason === "rate") return "Wait a minute, then ask for another email.";
    if (reason === "bad-email") return "Type the parent email, like name@email.com.";
    if (reason === "bad-code") return "That code is not right or it is too old. Ask for a new email.";
    if (reason === "redirect") return "The sign-in link was blocked. A parent needs to allow this website in Supabase.";
    if (reason === "offline") return "Sign-in needs the internet. You can keep playing on this phone.";
    return "Could not sign in. You can keep playing on this phone.";
  }
  function signupOutcome(result) {
    result = result || {};
    if (result.error) return { ok: false, reason: authReason(result.error) };
    const data = result.data || {};
    const user = data.user || null;
    const session = data.session || null;
    if (session && (session.access_token || session.refresh_token)) return { ok: true, reason: "session", user: user };
    const identities = user && user.identities;
    if (Array.isArray(identities) && identities.length === 0) return { ok: false, reason: "taken", user: user };
    const confirmed = user && (user.email_confirmed_at || user.confirmed_at);
    if (!session || (user && !confirmed)) return { ok: false, reason: "confirm-email", user: user };
    return { ok: true, reason: "session", user: user };
  }
  function usernameFromUser(user) {
    if (!user) return "";
    const meta = user.user_metadata || user.raw_user_meta_data || {};
    const metaName = normalizeUsername(meta.username);
    if (USERNAME_RE.test(metaName)) return metaName;
    const email = String(user.email || "");
    const low = email.toLowerCase();
    if (low.length > PLAYER_EMAIL_DOMAIN.length && low.slice(-PLAYER_EMAIL_DOMAIN.length) === PLAYER_EMAIL_DOMAIN) {
      const local = email.slice(0, email.length - PLAYER_EMAIL_DOMAIN.length);
      if (USERNAME_RE.test(local)) return local;
    }
    return "";
  }
  function careerRank(c) {
    if (!c || typeof c !== "object") return -1;
    const season = Number(c.season) || 0;
    const division = Number(c.division);
    const divScore = isFinite(division) ? (2 - division) : 0;
    const matchday = Number(c.matchday) || 0;
    const history = Array.isArray(c.history) ? c.history.length : 0;
    return season * 1000 + divScore * 100 + matchday + history * 50;
  }
  function mergeCoins(a, b) {
    if (!a && !b) return null;
    const coins = Math.max(Number(a && a.coins) || 0, Number(b && b.coins) || 0);
    const earned = Math.max(Number(a && a.earned) || 0, Number(b && b.earned) || 0, coins);
    if (!coins && !earned && !a && !b) return null;
    return { coins: coins, earned: earned };
  }
  function mergeUpgrades(a, b) {
    if (!a && !b) return null;
    const out = {};
    ["sprint", "shot", "pass", "stamina"].forEach(function (k) {
      out[k] = Math.max(0, Math.min(5, Math.round(Math.max(Number(a && a[k]) || 0, Number(b && b[k]) || 0))));
    });
    return out;
  }
  function mergeTrophies(a, b) {
    if (!a && !b) return null;
    const wins = [];
    const seen = {};
    [a, b].forEach(function (t) {
      const list = t && Array.isArray(t.wins) ? t.wins : [];
      list.forEach(function (w) {
        const key = w && (w.cupId || JSON.stringify(w));
        if (seen[key]) return;
        seen[key] = 1;
        wins.push(w);
      });
    });
    const base = {};
    Object.keys(b || {}).forEach(function (k) { if (k !== "wins") base[k] = b[k]; });
    Object.keys(a || {}).forEach(function (k) { if (k !== "wins") base[k] = a[k]; });
    base.wins = wins;
    return base;
  }
  function mergeChallenges(a, b) {
    if (!a && !b) return null;
    const aDate = String((a && a.date) || "");
    const bDate = String((b && b.date) || "");
    const primary = aDate >= bDate ? (a || {}) : (b || {});
    const other = primary === a ? (b || {}) : (a || {});
    const badges = [];
    const seen = {};
    [primary.badges, other.badges].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (badge) {
        const key = badge && (badge.date || JSON.stringify(badge));
        if (seen[key]) return;
        seen[key] = 1;
        badges.push(badge);
      });
    });
    const lastA = String(primary.lastComplete || "");
    const lastB = String(other.lastComplete || "");
    return {
      date: primary.date || other.date || "",
      ids: Array.isArray(primary.ids) ? primary.ids : (Array.isArray(other.ids) ? other.ids : []),
      progress: primary.progress || other.progress || {},
      paid: primary.paid || other.paid || {},
      streak: Math.max(Number(primary.streak) || 0, Number(other.streak) || 0),
      lastComplete: lastA >= lastB ? (primary.lastComplete || other.lastComplete || "") : other.lastComplete,
      badges: badges,
    };
  }
  function mergeRecord(a, b) {
    if (!a && !b) return null;
    const out = {};
    Object.keys(b || {}).forEach(function (k) { out[k] = b[k]; });
    Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
    ["wins", "draws", "losses", "played", "goals"].forEach(function (k) {
      if ((a && a[k] != null) || (b && b[k] != null)) {
        out[k] = Math.max(Number(a && a[k]) || 0, Number(b && b[k]) || 0);
      }
    });
    return out;
  }
  function mergeKit(localKit, cloudKit, preferLocal) {
    const a = localKit && localKit.touched ? localKit : null;
    const b = cloudKit && cloudKit.touched ? cloudKit : null;
    if (a && b) return preferLocal ? a : b;
    return a || b || (preferLocal ? (localKit || cloudKit) : (cloudKit || localKit)) || null;
  }
  function mergeProgress(local, cloud, mode) {
    local = local || {};
    cloud = cloud || {};
    mode = mode === "load" || mode === "merge" ? mode : "keep";
    const counts = {
      coins: mergeCoins(local.coins, cloud.coins),
      upgrades: mergeUpgrades(local.upgrades, cloud.upgrades),
      trophies: mergeTrophies(local.trophies, cloud.trophies),
      challenges: mergeChallenges(local.challenges, cloud.challenges),
      record: mergeRecord(local.record, cloud.record),
    };
    let base;
    if (mode === "merge") {
      const preferLocal = careerRank(local.career) >= careerRank(cloud.career);
      const career = (preferLocal ? local.career : cloud.career) || local.career || cloud.career || null;
      const localWins = local.trophies && Array.isArray(local.trophies.wins) ? local.trophies.wins.length : 0;
      const cloudWins = cloud.trophies && Array.isArray(cloud.trophies.wins) ? cloud.trophies.wins.length : 0;
      const nameSide = cloudWins > localWins ? cloud : local;
      const named = clipName((nameSide.player && nameSide.player.name) || nameSide.name, 16);
      base = Object.assign({}, cloud, local, {
        career: career,
        kit: mergeKit(local.kit, cloud.kit, preferLocal),
        player: nameSide.player || local.player || cloud.player || null,
        name: named || clipName(local.name, 16) || clipName(cloud.name, 16),
        settings: local.settings || cloud.settings || null,
        options: local.options || cloud.options || null,
        playAsMe: local.playAsMe || cloud.playAsMe || null,
        minutes: local.minutes || cloud.minutes || null,
        renames: local.renames || cloud.renames || null,
        team100: local.team100 || cloud.team100 || null,
        camera: local.camera || cloud.camera || null,
        bans: local.bans || cloud.bans || null,
        cup: (local.cup && Object.keys(local.cup).length) ? local.cup : (cloud.cup || null),
      });
    } else if (mode === "load") {
      base = Object.assign({}, local, cloud);
    } else {
      base = Object.assign({}, cloud, local);
    }
    base.coins = counts.coins;
    base.upgrades = counts.upgrades;
    base.trophies = counts.trophies;
    base.challenges = counts.challenges;
    base.record = counts.record;
    return base;
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
    usernameError: usernameError,
    normalizeUsername: normalizeUsername,
    playerEmail: playerEmail,
    passwordStrength: passwordStrength,
    rateLimitAllow: rateLimitAllow,
    authReason: authReason,
    signupOutcome: signupOutcome,
    usernameFromUser: usernameFromUser,
    mergeProgress: mergeProgress,
    confirmEmailMessage: confirmEmailMessage,
    paint: function () {},
    signOut: function () {},
    open: function () {},
  };
  root.CloudAccount = api;

  if (typeof document === "undefined") return;

  const state = {
    email: "",
    code: "",
    tab: "login",
    loginName: "",
    loginPassword: "",
    createName: "",
    createPassword: "",
    createConfirm: "",
    currentPassword: "",
    newPassword: "",
    newConfirm: "",
    shown: {},
    parentOpen: false,
    username: "",
    nameNote: "",
    tries: [],
    choosing: false,
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
    const nodes = document.querySelectorAll(".acctStatus, #accountStatus");
    if (!nodes.length) {
      const el = document.getElementById("accountStatus");
      if (el) el.textContent = text;
      return;
    }
    nodes.forEach(function (el) { el.textContent = text; });
  }
  function labelMenu() {
    const btn = document.getElementById("accountMenuBtn");
    if (!btn) return;
    const signed = !!(state.session && state.session.user);
    btn.textContent = signed ? "Account" : "Sign in";
  }
  function signedUsername() {
    return state.username || usernameFromUser(state.session && state.session.user) || "";
  }
  function offlineNow() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }
  function allowTry() {
    let stamps = state.tries || [];
    try {
      const raw = sessionStorage.getItem("soccerAuthTries");
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) stamps = parsed;
    } catch (e) { /* keep the memory list */ }
    const gate = rateLimitAllow(Date.now(), stamps, TRY_LIMIT, TRY_WINDOW_MS);
    state.tries = gate.stamps;
    try { sessionStorage.setItem("soccerAuthTries", JSON.stringify(gate.stamps)); } catch (e) { /* private mode */ }
    return gate.ok;
  }
  function isMissingRelation(error) {
    if (isMissingTable(error)) return true;
    const code = String(error && error.code || "");
    const msg = String((error && (error.message || error.details)) || "").toLowerCase();
    if (code === "PGRST205" || code === "42P01") return true;
    return msg.indexOf("schema cache") >= 0 || msg.indexOf("does not exist") >= 0 || msg.indexOf("could not find") >= 0;
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
    try { if (typeof KickoffProgress !== "undefined" && KickoffProgress.refresh) KickoffProgress.refresh(); } catch (e) { /* ignore */ }
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
      const uname = signedUsername();
      if (uname) row.username = uname;
      let saved = await client.from("profiles").upsert(row, { onConflict: "id" }).select("updated_at").maybeSingle();
      if (saved.error && row.username && /username|column|schema cache/i.test(String(saved.error.message || saved.error.details || ""))) {
        delete row.username;
        saved = await client.from("profiles").upsert(row, { onConflict: "id" }).select("updated_at").maybeSingle();
      }
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
  function applyChoiceSnap(row, mode) {
    const local = readLocal(storageOf());
    const merged = mergeProgress(local, snapFromRow(row), mode);
    const next = toRow(merged, userId() || "local");
    if (row && row.updated_at) next.updated_at = row.updated_at;
    downloadRow(next);
  }
  function chooseProgress(action) {
    if (state.choosing) return Promise.resolve("wait");
    state.choosing = true;
    const mergeAsk = action === "ask-merge";
    return new Promise(function (resolve) {
      const done = function (value) {
        state.choosing = false;
        const box = document.getElementById("progressChoice");
        if (box && box.parentNode) box.parentNode.removeChild(box);
        resolve(value);
      };
      const wrap = document.createElement("div");
      wrap.id = "progressChoice";
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-modal", "true");
      const title = mergeAsk
        ? "This phone has a saved game, and the account has one too. Keep this device's progress or load your account's?"
        : "This phone already has a saved game. Keep this device's progress on the account?";
      let buttons = "<button type='button' data-choice='keep'>Keep this device's progress</button>";
      if (mergeAsk) {
        buttons += "<button type='button' data-choice='load'>Load your account's</button>";
        buttons += "<button type='button' data-choice='merge'>Merge the higher counts</button>";
      } else {
        buttons += "<button type='button' data-choice='skip'>Not now</button>";
      }
      wrap.innerHTML = "<div class='choiceCard'><p>" + esc(title) + "</p><div class='choiceButtons'>" + buttons + "</div></div>";
      document.body.appendChild(wrap);
      wrap.querySelectorAll("[data-choice]").forEach(function (btn) {
        btn.addEventListener("click", function () { done(btn.dataset.choice); });
      });
    });
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
    } else if (plan.action === "ask-upload" || plan.action === "ask-merge") {
      const pick = await chooseProgress(plan.action);
      if (pick === "wait") return true;
      if (pick === "skip") {
        state.choice = { userId: id, mode: "keep" };
        saveBook(id);
        setStatus("Nothing was uploaded. This phone keeps its game.");
        api.paint();
      } else if (pick === "load" && got.row) {
        applyChoiceSnap(got.row, "load");
        state.choice = { userId: id, mode: "sync" };
        saveBook(id);
        await push();
        setStatus("This phone is using the saved game from the account.");
        api.paint();
      } else if (pick === "merge" && got.row) {
        applyChoiceSnap(got.row, "merge");
        state.choice = { userId: id, mode: "sync" };
        saveBook(id);
        await push();
        setStatus("Merged. This phone kept the higher coin, upgrade and trophy counts.");
        api.paint();
      } else if (pick === "keep") {
        if (plan.action === "ask-merge" && got.row) applyChoiceSnap(got.row, "keep");
        state.choice = { userId: id, mode: "sync" };
        saveBook(id);
        await push();
      }
    } else if (plan.action === "keep") {
      setStatus("Signed in. This phone is not copying its game to the account.");
      api.paint();
    } else {
      const who = signedUsername();
      const email = state.session.user && state.session.user.email;
      if (who) setStatus("Signed in as " + who + ".");
      else if (email && email.toLowerCase().indexOf(PLAYER_EMAIL_DOMAIN) < 0) setStatus("Signed in as " + email + ".");
      else setStatus("Signed in.");
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
    state.username = "";
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
  let nameTimer = 0;
  async function rememberUsername(client, name) {
    const id = userId();
    if (!client || !id || !USERNAME_RE.test(name || "")) return { ok: true, skipped: true };
    let existing = null;
    try {
      existing = await client.from("usernames").select("username").eq("user_id", id).maybeSingle();
    } catch (e) {
      return { ok: true, skipped: true };
    }
    if (!existing || existing.error) {
      if (existing && existing.error && !isMissingRelation(existing.error)) return { ok: true, skipped: true };
      if (existing && existing.error) return { ok: true, skipped: true };
    }
    if (existing && existing.data && existing.data.username) {
      state.username = existing.data.username;
      return { ok: true };
    }
    let saved = null;
    try {
      saved = await client.from("usernames").insert({
        username_key: name.toLowerCase(),
        username: name,
        user_id: id,
      });
    } catch (e) {
      return { ok: true, skipped: true };
    }
    if (saved && saved.error) {
      if (isMissingRelation(saved.error)) return { ok: true, skipped: true };
      if (authReason(saved.error) === "taken") return { ok: false, reason: "taken" };
      return { ok: true, skipped: true };
    }
    state.username = name;
    return { ok: true };
  }
  async function checkUsername(name, box) {
    if (normalizeUsername(state.createName) !== name) return;
    const note = box && box.querySelector ? box.querySelector(".acctNameNote") : null;
    if (offlineNow()) {
      state.nameNote = "Sign-in needs the internet. You can keep playing on this phone.";
      if (note) note.textContent = state.nameNote;
      return;
    }
    const client = await clientOrNull();
    if (!client || !client.rpc) {
      state.nameNote = "";
      if (note) note.textContent = "";
      return;
    }
    try {
      const res = await client.rpc("username_available", { p_name: name });
      if (normalizeUsername(state.createName) !== name) return;
      if (res.error) {
        state.nameNote = authReason(res.error) === "offline"
          ? "Sign-in needs the internet. You can keep playing on this phone."
          : "";
      } else if (res.data === false) state.nameNote = "That username is taken.";
      else if (res.data === true) state.nameNote = "That username is free.";
      else state.nameNote = "";
    } catch (e) {
      state.nameNote = "Sign-in needs the internet. You can keep playing on this phone.";
    }
    if (note) note.textContent = state.nameNote;
  }
  function scheduleNameCheck(box, value) {
    const note = box.querySelector(".acctNameNote");
    const err = usernameError(value);
    state.nameNote = err;
    if (note) note.textContent = err;
    if (err) return;
    if (note) note.textContent = "Checking that username...";
    clearTimeout(nameTimer);
    const asked = normalizeUsername(value);
    nameTimer = setTimeout(function () { checkUsername(asked, box); }, 400);
  }
  async function logIn() {
    const name = normalizeUsername(state.loginName);
    const err = usernameError(name);
    if (err) { setStatus(err); return; }
    if (!state.loginPassword) { setStatus("Type your password."); return; }
    if (!allowTry()) { setStatus("Too many tries. Wait a minute, then try again."); return; }
    if (offlineNow()) { setStatus("Sign-in needs the internet. You can keep playing on this phone."); return; }
    state.busy = true;
    api.paint();
    try {
      const client = await clientOrNull();
      if (!client) {
        setStatus("Sign-in needs the internet. You can keep playing on this phone.");
        return;
      }
      const result = await client.auth.signInWithPassword({
        email: playerEmail(name),
        password: state.loginPassword,
      });
      if (result.error) { setStatus(friendlyAuthError(result.error, "password")); return; }
      state.username = name;
      state.loginPassword = "";
      await rememberUsername(client, name);
      setStatus("Signed in as " + (state.username || name) + ". Checking the saved game...");
    } catch (e) {
      setStatus("Sign-in needs the internet. You can keep playing on this phone.");
    } finally {
      state.busy = false;
      api.paint();
    }
  }
  async function createAccount() {
    const name = normalizeUsername(state.createName);
    const err = usernameError(name);
    if (err) { setStatus(err); return; }
    const pw = String(state.createPassword || "");
    const hint = passwordStrength(pw);
    if (!hint.ok) { setStatus(hint.label); return; }
    if (pw !== String(state.createConfirm || "")) { setStatus("Those passwords do not match."); return; }
    if (!allowTry()) { setStatus("Too many tries. Wait a minute, then try again."); return; }
    if (state.nameNote === "That username is taken.") { setStatus("That username is taken. Try another."); return; }
    if (offlineNow()) { setStatus("Sign-in needs the internet. You can keep playing on this phone."); return; }
    state.busy = true;
    api.paint();
    try {
      const client = await clientOrNull();
      if (!client) {
        setStatus("Sign-in needs the internet. You can keep playing on this phone.");
        return;
      }
      try {
        const avail = await client.rpc("username_available", { p_name: name });
        if (!avail.error && avail.data === false) {
          setStatus("That username is taken. Try another.");
          return;
        }
      } catch (e) { /* the sign-up itself still rejects a used name */ }
      const result = await client.auth.signUp({
        email: playerEmail(name),
        password: pw,
        options: { data: { username: name } },
      });
      const outcome = signupOutcome(result);
      if (!outcome.ok) {
        if (outcome.reason === "confirm-email") setStatus(confirmEmailMessage());
        else if (outcome.reason === "taken") setStatus("That username is taken. Try another.");
        else if (outcome.reason === "rate") setStatus("Too many tries. Wait a minute, then try again.");
        else if (outcome.reason === "offline") setStatus("Sign-in needs the internet. You can keep playing on this phone.");
        else setStatus(friendlyAuthError(result.error || { message: "sign up failed" }, "password"));
        return;
      }
      state.username = name;
      state.createPassword = "";
      state.createConfirm = "";
      const claimed = await rememberUsername(client, name);
      if (!claimed.ok && claimed.reason === "taken") {
        try { await client.auth.signOut(); } catch (e2) { /* show taken either way */ }
        state.session = null;
        state.username = "";
        setStatus("That username is taken. Try another.");
        return;
      }
      setStatus("Account created. Signed in as " + name + ".");
    } catch (e) {
      setStatus("Sign-in needs the internet. You can keep playing on this phone.");
    } finally {
      state.busy = false;
      api.paint();
    }
  }
  async function changePassword() {
    const next = String(state.newPassword || "");
    const hint = passwordStrength(next);
    if (!state.currentPassword) { setStatus("Type your current password."); return; }
    if (!hint.ok) { setStatus(hint.label); return; }
    if (next !== String(state.newConfirm || "")) { setStatus("Those passwords do not match."); return; }
    if (!allowTry()) { setStatus("Too many tries. Wait a minute, then try again."); return; }
    if (offlineNow()) { setStatus("Sign-in needs the internet. You can keep playing on this phone."); return; }
    const user = state.session && state.session.user;
    const email = user && user.email;
    if (!email) { setStatus("Could not change the password. You can keep playing on this phone."); return; }
    state.busy = true;
    api.paint();
    try {
      const client = await clientOrNull();
      if (!client) {
        setStatus("Sign-in needs the internet. You can keep playing on this phone.");
        return;
      }
      const check = await client.auth.signInWithPassword({ email: email, password: state.currentPassword });
      if (check.error) { setStatus(friendlyAuthError(check.error, "password")); return; }
      const updated = await client.auth.updateUser({ password: next });
      if (updated.error) { setStatus(friendlyAuthError(updated.error, "password")); return; }
      state.currentPassword = "";
      state.newPassword = "";
      state.newConfirm = "";
      setStatus("Password changed.");
    } catch (e) {
      setStatus("Sign-in needs the internet. You can keep playing on this phone.");
    } finally {
      state.busy = false;
      api.paint();
    }
  }
  function passRow(labelText, field, autocomplete) {
    const shown = !!state.shown[field];
    return "<label>" + labelText + "</label><div class='acctPass'>"
      + "<input class='acctField' data-field='" + field + "' type='" + (shown ? "text" : "password") + "' autocomplete='" + autocomplete + "' maxlength='72'>"
      + "<button type='button' class='acctPeek' data-peek='" + field + "' aria-pressed='" + (shown ? "true" : "false") + "'>" + (shown ? "Hide" : "Show") + "</button></div>";
  }
  function bindBox(box, signedIn) {
    box.querySelectorAll("[data-field]").forEach(function (input) {
      const key = input.dataset.field;
      input.value = state[key] == null ? "" : state[key];
      input.disabled = !!state.busy;
      input.addEventListener("input", function () {
        state[key] = input.value;
        if (key === "createPassword" || key === "newPassword") {
          const hint = box.querySelector(".acctStrength");
          if (hint) hint.textContent = input.value ? passwordStrength(input.value).label : "";
        }
        if (key === "createName") scheduleNameCheck(box, input.value);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (key === "loginName" || key === "loginPassword") logIn();
        else if (key === "createName" || key === "createPassword" || key === "createConfirm") createAccount();
        else if (key === "email") sendLink();
        else if (key === "code") verifyCode();
        else if (key === "currentPassword" || key === "newPassword" || key === "newConfirm") changePassword();
      });
    });
    box.querySelectorAll(".acctPeek").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const field = btn.dataset.peek;
        state.shown[field] = !state.shown[field];
        const input = box.querySelector("[data-field='" + field + "']");
        if (input) input.type = state.shown[field] ? "text" : "password";
        btn.textContent = state.shown[field] ? "Hide" : "Show";
        btn.setAttribute("aria-pressed", state.shown[field] ? "true" : "false");
      });
    });
    box.querySelectorAll("[data-acct-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.tab = btn.dataset.acctTab;
        api.paint();
      });
    });
    const login = box.querySelector(".acctLogin");
    const create = box.querySelector(".acctCreate");
    const change = box.querySelector(".acctChange");
    const out = box.querySelector(".acctSignOut");
    const save = box.querySelector(".acctSavePhone");
    const cloud = box.querySelector(".acctUseCloud");
    const parentBtn = box.querySelector(".acctParentToggle");
    const send = box.querySelector(".acctSend");
    const use = box.querySelector(".acctUseCode");
    if (login) { login.disabled = !!state.busy; login.addEventListener("click", function () { logIn(); }); }
    if (create) { create.disabled = !!state.busy; create.addEventListener("click", function () { createAccount(); }); }
    if (change) { change.disabled = !!state.busy; change.addEventListener("click", function () { changePassword(); }); }
    if (out) out.addEventListener("click", function () { signOut(); });
    if (save) save.addEventListener("click", function () { savePhone(); });
    if (cloud) cloud.addEventListener("click", function () { useAccount(); });
    if (send) { send.disabled = !!state.busy; send.addEventListener("click", function () { sendLink(); }); }
    if (use) { use.disabled = !!state.busy; use.addEventListener("click", function () { verifyCode(); }); }
    if (parentBtn) parentBtn.addEventListener("click", function () {
      state.parentOpen = !state.parentOpen;
      api.paint();
    });
    if (typeof KickoffLeaderboard !== "undefined" && KickoffLeaderboard.mountAccount) {
      KickoffLeaderboard.mountAccount(box, { signedIn: signedIn });
    }
  }
  function accountHtml() {
    const signedIn = !!(state.session && state.session.user);
    const email = signedIn && state.session.user.email ? state.session.user.email : "";
    const who = signedUsername();
    const parentMail = !!(email && email.toLowerCase().indexOf(PLAYER_EMAIL_DOMAIN) < 0);
    const shown = playerLabel();
    const native = inNativeApp(typeof location !== "undefined" ? location : null);
    let html = "";
    if (!signedIn) {
      html += "<p>Make a username and a password, then use them on another phone to get the same game. Kickoff does not ask for your real email.</p>";
      html += "<div class='acctTabs' role='tablist' aria-label='Account'>";
      html += "<button type='button' data-acct-tab='login' role='tab'" + (state.tab === "login" ? " class='on' aria-selected='true'" : " aria-selected='false'") + ">Log in</button>";
      html += "<button type='button' data-acct-tab='create' role='tab'" + (state.tab === "create" ? " class='on' aria-selected='true'" : " aria-selected='false'") + ">Create account</button>";
      html += "</div>";
      if (state.tab === "create") {
        html += "<label>Username</label><input class='acctField' data-field='createName' autocomplete='username' autocapitalize='off' spellcheck='false' maxlength='16' placeholder='3 to 16 characters'>";
        html += "<p class='hint acctNameNote'>" + esc(state.nameNote || "") + "</p>";
        html += passRow("Password", "createPassword", "new-password");
        html += "<p class='hint acctStrength'>" + esc(state.createPassword ? passwordStrength(state.createPassword).label : "Use at least 8 characters.") + "</p>";
        html += passRow("Confirm password", "createConfirm", "new-password");
        html += "<div class='accountRow'><button type='button' class='acctCreate'>Create account</button></div>";
      } else {
        html += "<label>Username</label><input class='acctField' data-field='loginName' autocomplete='username' autocapitalize='off' spellcheck='false' maxlength='16'>";
        html += passRow("Password", "loginPassword", "current-password");
        html += "<div class='accountRow'><button type='button' class='acctLogin'>Log in</button></div>";
        html += "<p class='privacy'>Forgot the password? Ask a grown-up to reset it. Kickoff cannot email a reset, because this account has no real email.</p>";
      }
      html += "<div class='accountRow'><button type='button' class='acctParentToggle'>Sign in with a parent's email instead</button></div>";
      html += "<div class='acctParent'" + (state.parentOpen ? "" : " hidden") + ">";
      if (native) {
        html += "<p>A parent email does not use a password. We email a code. Type that code here. The link should open this app. If it opens the website, type the code.</p>";
      } else {
        html += "<p>A parent email does not use a password. We email a link. If the email has a code, type it here.</p>";
      }
      html += "<label>Parent email</label><input class='acctField' data-field='email' type='email' autocomplete='email' inputmode='email' placeholder='name@email.com'>";
      html += native
        ? "<div class='accountRow'><button type='button' class='acctSend'>Email me a code</button></div>"
        : "<div class='accountRow'><button type='button' class='acctSend'>Email me a sign-in link</button></div>";
      html += "<label>Code from the email</label><input class='acctField' data-field='code' inputmode='numeric' autocomplete='one-time-code' maxlength='12' placeholder='6 digit code'>";
      html += "<div class='accountRow'><button type='button' class='acctUseCode'>Use this code</button></div></div>";
    } else {
      html += who
        ? "<p>Signed in as <b>" + esc(who) + "</b>.</p>"
        : "<p>Signed in as <b>" + esc(parentMail ? email : "your email") + "</b>.</p>";
      html += shown
        ? "<p>Friends in a room see <b>" + esc(shown) + "</b>.</p>"
        : "<p>Friends in a room see your player name once you pick one.</p>";
      html += "<p class='privacy'>What is saved: your player name, team, colour, trophies, career, coins, upgrades, challenges and kit. Signing out keeps the game on this phone. A parent can delete the account in Supabase.</p>";
      if (who) {
        html += "<h3>Change password</h3>";
        html += passRow("Current password", "currentPassword", "current-password");
        html += passRow("New password", "newPassword", "new-password");
        html += "<p class='hint acctStrength'>" + esc(state.newPassword ? passwordStrength(state.newPassword).label : "Use at least 8 characters.") + "</p>";
        html += passRow("Confirm new password", "newConfirm", "new-password");
        html += "<div class='accountRow'><button type='button' class='acctChange'>Change password</button></div>";
        html += "<p class='privacy'>Forgot the password? Ask a grown-up to reset it.</p>";
      }
      if (state.choice && state.choice.mode === "keep") {
        html += "<div class='accountRow'><button type='button' class='acctSavePhone'>Save this phone's game to the account</button></div>";
        html += "<div class='accountRow'><button type='button' class='acctUseCloud'>Use the account game on this phone</button></div>";
      }
      html += "<div class='accountRow'><button type='button' class='acctSignOut'>Log out</button></div>";
    }
    html += "<p class='acctStatus' aria-live='polite'></p>";
    return html;
  }
  function paint(panel) {
    try {
      if (panel && panel.classList) panel.classList.add("kickoffAccount");
      const boxes = [];
      if (panel && boxes.indexOf(panel) < 0) boxes.push(panel);
      document.querySelectorAll(".kickoffAccount").forEach(function (el) {
        if (boxes.indexOf(el) < 0) boxes.push(el);
      });
      if (!boxes.length) {
        const one = document.getElementById("accountPanel");
        if (one) boxes.push(one);
      }
      const signedIn = !!(state.session && state.session.user);
      boxes.forEach(function (box) {
        box.innerHTML = accountHtml();
        const status = box.querySelector(".acctStatus");
        if (status) status.textContent = state.status;
        bindBox(box, signedIn);
      });
      labelMenu();
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
  function ensureAccountScreen() {
    let el = document.getElementById("accountScreen");
    if (el) {
      const inner = el.querySelector("[data-kickoff-account], #accountScreenPanel");
      if (inner && inner.classList) inner.classList.add("kickoffAccount");
      return el;
    }
    el = document.createElement("div");
    el.id = "accountScreen";
    el.className = "overlay hidden";
    el.innerHTML = "<div class='panel'><h1 style='font-size:28px'>Account</h1><div id='accountScreenPanel' class='kickoffAccount' data-kickoff-account='screen'></div><div class='row'><button type='button' id='accountBack'>Back</button></div></div>";
    document.body.appendChild(el);
    return el;
  }
  function openAccount() {
    const el = ensureAccountScreen();
    if (typeof showScreen === "function") showScreen("accountScreen");
    else el.classList.remove("hidden");
    api.paint();
  }
  function closeAccount() {
    if (typeof goToMenu === "function") goToMenu();
    else if (typeof showScreen === "function") showScreen("menu");
    else {
      const el = document.getElementById("accountScreen");
      if (el) el.classList.add("hidden");
    }
  }
  function wireAccount() {
    ensureAccountScreen();
    const menuBtn = document.getElementById("accountMenuBtn");
    if (menuBtn && !menuBtn.__kickoffAccount) {
      menuBtn.__kickoffAccount = true;
      menuBtn.addEventListener("click", function () { openAccount(); });
    }
    const back = document.getElementById("accountBack");
    if (back && !back.__kickoffAccount) {
      back.__kickoffAccount = true;
      back.addEventListener("click", function () { closeAccount(); });
    }
    labelMenu();
  }
  function boot() {
    if (state.booted) return;
    state.booted = true;
    const style = document.createElement("style");
    style.textContent = ""
      + ".kickoffAccount { text-align: left; margin: 8px 0 12px; max-width: 100%; }"
      + ".kickoffAccount h3 { margin: 4px 0 8px; font-size: 18px; overflow-wrap: break-word; }"
      + ".kickoffAccount p { margin: 0 0 8px; font-size: 15px; line-height: 1.4; color: #d5dbe6; overflow-wrap: break-word; }"
      + ".kickoffAccount .privacy, .kickoffAccount .hint { color: #ffd27a; }"
      + ".kickoffAccount label { display: block; font-weight: 700; margin: 8px 0 4px; }"
      + ".kickoffAccount input { width: 100%; box-sizing: border-box; min-height: 44px; border-radius: 10px; border: 1px solid rgba(255,255,255,.35); background: #fff; color: #111; font: inherit; font-size: 16px; padding: 8px 10px; user-select: text; -webkit-user-select: text; }"
      + ".kickoffAccount .accountRow { margin: 8px 0; }"
      + ".kickoffAccount button { min-height: 44px; max-width: 100%; padding: 8px 14px; border-radius: 10px; border: 0; background: #e8c547; color: #1a1404; font: inherit; font-weight: 800; white-space: normal; }"
      + ".kickoffAccount .acctTabs { display: flex; gap: 6px; margin: 8px 0; }"
      + ".kickoffAccount .acctTabs button { flex: 1 1 0; background: #243044; color: #fff; }"
      + ".kickoffAccount .acctTabs button.on { background: #e8c547; color: #1a1404; }"
      + ".kickoffAccount .acctPass { display: flex; gap: 6px; align-items: center; }"
      + ".kickoffAccount .acctPass input { flex: 1 1 auto; min-width: 0; width: auto; }"
      + ".kickoffAccount .acctPeek, .kickoffAccount .acctSignOut, .kickoffAccount .acctUseCloud, .kickoffAccount .acctParentToggle { background: #243044; color: #fff; }"
      + ".kickoffAccount .acctStatus { font-weight: 700; color: #fff; }"
      + ".kickoffAccount .acctParent { margin-top: 8px; }"
      + "#accountScreen { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; background: rgba(4,8,16,.72); padding: 12px; box-sizing: border-box; }"
      + "#accountScreen.hidden { display: none !important; }"
      + "#accountScreen .panel { width: min(520px, 94vw); max-height: 94vh; overflow: auto; text-align: left; background: #121a2b; color: #fff; border-radius: 18px; padding: 16px; box-sizing: border-box; }"
      + "#progressChoice { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; background: rgba(4,8,16,.72); padding: 16px; box-sizing: border-box; }"
      + "#progressChoice .choiceCard { width: min(440px, 100%); background: #121a2b; color: #fff; border: 1px solid rgba(232,197,71,.45); border-radius: 16px; padding: 16px; box-sizing: border-box; }"
      + "#progressChoice p { margin: 0 0 12px; font-size: 16px; line-height: 1.4; }"
      + "#progressChoice .choiceButtons { display: flex; flex-direction: column; gap: 8px; }"
      + "#progressChoice button { min-height: 44px; border: 0; border-radius: 10px; background: #e8c547; color: #1a1404; font: inherit; font-weight: 800; }";
    document.head.appendChild(style);
    loadBook();
    watchStorage();
    showUrlError();
    listenForAppLinks();
    api.paint = paint;
    api.signOut = signOut;
    api.open = openAccount;
    wireAccount();
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
          state.username = "";
          api.paint();
          return;
        }
        const named = usernameFromUser(session.user);
        if (named && !state.username) state.username = named;
        api.paint();
        if (named) rememberUsername(client, state.username).then(function () { api.paint(); }).catch(function () {});
        runPlan();
      });
      client.auth.getSession().then(function (res) {
        const session = res && res.data && res.data.session;
        if (!session) return;
        state.session = session;
        state.mode = "signed-in";
        const named = usernameFromUser(session.user);
        if (named) state.username = named;
        api.paint();
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
