/* Pure checks for the optional account sync. No network. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const context = { console: console, URLSearchParams: URLSearchParams };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "src/supabase_config.js"), "utf8"), context, { filename: "supabase_config.js" });
vm.runInContext(fs.readFileSync(path.join(root, "src/cloud_account.js"), "utf8"), context, { filename: "cloud_account.js" });
const Cloud = context.CloudAccount;
assert.ok(Cloud && Cloud.toRow, "CloudAccount did not load");

function same(actual, expected) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
}
function mem(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    dump() { return Object.fromEntries(m); },
  };
}

const deviceId = "0123456789abcdef0123456789abcdef";
const trophies = { wins: [{ cupId: "c1", teamId: "blue", name: "Blues" }] };
const cup = { id: "c1", round: 1, over: false, champion: null, teams: [{ id: "blue", name: "Blues" }] };
const renames = { "blue:9": "Sam" };
const team100 = { blue: true };
const bans = { bans: [{ name: "Jo", deviceId: "aaa", until: null, message: "" }] };
const menu = { kind: "quick", mode: "1p", difficulty: "normal", blue: "blue", red: "red", minutes: 10, muted: false };
const options = { camDefault: "tv", mute: false, difficulty: "normal" };
const store = mem({
  soccerPlayer: JSON.stringify({ name: "Alex Kid", team: "blue", color: "#e6b325", deviceId: deviceId }),
  soccerName: "Alex Kid",
  soccerPlayAsMe: JSON.stringify({ on: true, name: "Dashiell G." }),
  soccerTrophies: JSON.stringify(trophies),
  soccerCup: JSON.stringify(cup),
  soccerSettings: JSON.stringify(menu),
  soccerOptions: JSON.stringify(options),
  soccerMatchMinutes: JSON.stringify({ minutes: 10, custom: true }),
  soccerRenames: JSON.stringify(renames),
  soccerTeam100: JSON.stringify(team100),
  soccerCamera: "fp",
  soccerHostBans: JSON.stringify(bans),
  soccerAdminUnlock2: "yes",
  soccerAdminPlace: JSON.stringify({ secret: "nope" }),
  soccerDeviceId: deviceId,
});

const snap = Cloud.readLocal(store);
const row = Cloud.toRow(snap, "11111111-1111-1111-1111-111111111111");
const packed = JSON.stringify(row);
assert.strictEqual(row.display_name, "Alex Kid");
assert.strictEqual(row.favorite_team, "blue");
assert.strictEqual(row.favorite_color, "#e6b325");
assert.strictEqual(row.play_as_me, true);
assert.strictEqual(row.settings.soccerPlayAsMe.name, "Dashiell G.");
assert.strictEqual(row.settings.soccerPlayAsMe.on, true);
same(row.trophies, trophies);
same(row.cup, cup);
same(row.settings.soccerSettings, menu);
same(row.settings.soccerOptions, options);
same(row.settings.soccerMatchMinutes, { minutes: 10, custom: true });
assert.strictEqual(row.match_minutes, 10);
same(row.renames, renames);
same(row.team_100, team100);
assert.strictEqual(row.camera_choice, "fp");
same(row.host_bans, bans);
assert.ok(!packed.includes(deviceId), "device id must stay on the phone");
assert.ok(!packed.includes("soccerAdminUnlock2"), "admin unlock must not be synced");
assert.ok(!packed.includes("soccerAdminPlace"));
assert.ok(!packed.includes("nope"));
assert.ok(!Object.prototype.hasOwnProperty.call(row, "email"));

const fresh = mem();
Cloud.applyWrites(fresh, Cloud.writesFromRow(row, {}));
const back = Cloud.readLocal(fresh);
assert.strictEqual(back.player.name, "Alex Kid");
assert.ok(!back.player.deviceId, "a new phone does not inherit another device id");
assert.strictEqual(back.name, "Alex Kid");
same(back.playAsMe, { on: true, name: "Dashiell G." });
same(back.trophies, trophies);
same(back.cup, cup);
same(back.settings, menu);
same(back.options, options);
same(back.minutes, { minutes: 10, custom: true });
same(back.renames, renames);
same(back.team100, team100);
assert.strictEqual(back.camera, "fp");
same(back.bans, bans);
assert.strictEqual(fresh.getItem("soccerAdminUnlock2"), null);
assert.strictEqual(fresh.dump().soccerCamera, "fp");
assert.strictEqual(fresh.dump().soccerName, "Alex Kid");

const kept = mem({ soccerPlayer: JSON.stringify({ name: "Local", team: "red", color: "#111111", deviceId: deviceId }) });
Cloud.applyWrites(kept, Cloud.writesFromRow(row, { player: Cloud.readLocal(kept).player, deviceId: deviceId }));
assert.strictEqual(JSON.parse(kept.getItem("soccerPlayer")).deviceId, deviceId);
assert.strictEqual(JSON.parse(kept.getItem("soccerPlayer")).name, "Alex Kid");

const userId = "11111111-1111-1111-1111-111111111111";
const empty = Cloud.readLocal(mem());
const rich = row;
assert.strictEqual(Cloud.shouldUpload(empty, rich), false);
assert.strictEqual(Cloud.planSync({ local: empty, cloud: rich, choice: { userId: userId, mode: "sync" }, userId: userId }).action, "download");
assert.strictEqual(Cloud.planSync({ local: snap, cloud: null, userId: userId }).action, "ask-upload");
assert.strictEqual(Cloud.planSync({
  local: snap,
  cloud: null,
  choice: { userId: userId, mode: "keep" },
  userId: userId,
}).action, "keep");
assert.strictEqual(Cloud.planSync({
  local: snap,
  cloud: rich,
  userId: userId,
}).action, "ask-merge");
const sameHash = Cloud.hashSnap(snap);
assert.strictEqual(Cloud.planSync({
  local: snap,
  cloud: rich,
  choice: { userId: userId, mode: "sync" },
  userId: userId,
  syncedAt: "2026-11-06T00:00:00.000Z",
  baseHash: sameHash,
  localHash: sameHash,
}).action, "noop");
assert.strictEqual(Cloud.planSync({
  local: snap,
  cloud: Object.assign({}, rich, { updated_at: "2026-11-06T00:00:00.000Z" }),
  choice: { userId: userId, mode: "sync" },
  userId: userId,
  syncedAt: "2026-11-06T00:00:00.000Z",
  baseHash: "older",
  localHash: sameHash,
}).action, "upload");
assert.strictEqual(Cloud.planSync({
  local: snap,
  cloud: Object.assign({}, rich, { updated_at: "2026-11-06T00:00:05.000Z" }),
  choice: { userId: userId, mode: "sync" },
  userId: userId,
  syncedAt: "2026-11-06T00:00:00.000Z",
  baseHash: sameHash,
  localHash: sameHash,
}).action, "download");

assert.strictEqual(Cloud.emailRedirectTo(null), "https://dashiell405.github.io/soccer-/");
assert.strictEqual(
  Cloud.emailRedirectTo({ origin: "https://dashiell405.github.io", pathname: "/soccer-/online.html" }),
  "https://dashiell405.github.io/soccer-/online.html"
);
assert.strictEqual(Cloud.emailRedirectTo({ origin: "http://127.0.0.1:8000", pathname: "/" }), "https://dashiell405.github.io/soccer-/");
assert.strictEqual(
  Cloud.emailRedirectTo({ protocol: "capacitor:", origin: "capacitor://localhost", pathname: "/" }),
  "kickoff://login"
);
assert.strictEqual(Cloud.inNativeApp({ protocol: "capacitor:", origin: "capacitor://localhost" }), true);
assert.strictEqual(Cloud.inNativeApp({ protocol: "https:", origin: "https://dashiell405.github.io" }), false);
assert.ok(Cloud.askUploadMessage().indexOf("OK") >= 0 && Cloud.askUploadMessage().indexOf("Cancel") >= 0);
assert.ok(Cloud.askMergeMessage().indexOf("Cancel") >= 0);
assert.ok(Cloud.isMissingTable({ code: "PGRST205", message: "Could not find the table 'public.profiles' in the schema cache" }));
assert.ok(!Cloud.isMissingTable({ code: "42501", message: "permission denied for table profiles" }));
assert.strictEqual(Cloud.friendlyAuthError({ message: "redirect not allowed" }).indexOf("Supabase") >= 0, true);

const career = { version: 1, clubId: "hawks", clubName: "Harbor Hawks", season: 1, division: 2, matchday: 1 };
const coins = { coins: 48 };
const upgrades = { sprint: 2, shot: 1, pass: 0, stamina: 3 };
const challenges = { date: "2026-11-21", ids: ["outside", "clean", "curl"], progress: { outside: 1 }, paid: { outside: true }, streak: 2, lastComplete: "2026-11-21", badges: [{ date: "2026-11-20", name: "Full set" }] };
const kit = { primary: "#1f5fd6", secondary: "#ffffff", pattern: "stripes", shorts: "#111111", number: 7, badge: { shape: "shield", color: "#e6b325", initials: "FK" }, touched: true };
const richStore = mem({
  soccerPlayer: JSON.stringify({ name: "Alex Kid", team: "blue", color: "#e6b325", deviceId: deviceId }),
  soccerName: "Alex Kid",
  soccerCareer: JSON.stringify(career),
  soccerCoins: JSON.stringify(coins),
  soccerUpgrades: JSON.stringify(upgrades),
  soccerChallenges: JSON.stringify(challenges),
  soccerKit: JSON.stringify(kit),
});
const richSnap = Cloud.readLocal(richStore);
const richRow = Cloud.toRow(richSnap, userId);
same(richRow.settings.soccerCareer, career);
same(richRow.settings.soccerCoins, coins);
same(richRow.settings.soccerUpgrades, upgrades);
same(richRow.settings.soccerChallenges, challenges);
same(richRow.settings.soccerKit, kit);
assert.ok(!JSON.stringify(richRow).includes(deviceId));
const restored = mem({ soccerCareer: JSON.stringify({ version: 1, clubName: "Keep me", clubId: "you" }) });
const oldRow = Cloud.toRow(snap, userId);
delete oldRow.settings.soccerCareer;
delete oldRow.settings.soccerCoins;
delete oldRow.settings.soccerUpgrades;
delete oldRow.settings.soccerChallenges;
delete oldRow.settings.soccerKit;
Cloud.applyWrites(restored, Cloud.writesFromRow(oldRow, {}));
assert.strictEqual(JSON.parse(restored.getItem("soccerCareer")).clubName, "Keep me");
const round = mem();
Cloud.applyWrites(round, Cloud.writesFromRow(richRow, {}));
same(JSON.parse(round.getItem("soccerCareer")), career);
same(JSON.parse(round.getItem("soccerCoins")), coins);
same(JSON.parse(round.getItem("soccerUpgrades")), upgrades);
same(JSON.parse(round.getItem("soccerKit")), kit);
const richer = JSON.parse(JSON.stringify(snap));
richer.career = career;
richer.coins = coins;
richer.upgrades = upgrades;
richer.challenges = challenges;
richer.kit = kit;
assert.ok(Cloud.richness(richer) > Cloud.richness(snap));

const cfg = fs.readFileSync(path.join(root, "src/supabase_config.js"), "utf8");
const cloudSrc = fs.readFileSync(path.join(root, "src/cloud_account.js"), "utf8");
assert.ok(cfg.indexOf("sb_publishable_") >= 0);
assert.ok(cfg.indexOf("service_role") < 0);
assert.ok(cfg.indexOf("sb_secret") < 0);
assert.ok(cfg.indexOf("eyJ") < 0);
assert.ok(cloudSrc.indexOf("service_role") < 0);
assert.ok(cloudSrc.indexOf("sb_secret") < 0);
assert.ok(!/getItem\(\s*["']soccerAdminUnlock2/.test(cloudSrc));
assert.ok(!/setItem\(\s*["']soccerAdminUnlock2/.test(cloudSrc));
assert.ok(!/getItem\(\s*["']soccerAdminPlace/.test(cloudSrc));
assert.ok(!/setItem\(\s*["']soccerAdminPlace/.test(cloudSrc));
assert.ok(cloudSrc.indexOf("signInWithOtp") >= 0);
assert.ok(cloudSrc.indexOf("verifyOtp") >= 0);
assert.ok(cloudSrc.indexOf("exchangeCodeForSession") >= 0);
assert.ok(cloudSrc.indexOf("kickoff://login") >= 0);
assert.ok(cfg.indexOf("kickoff://login") >= 0);

const sw = fs.readFileSync(path.join(root, "tools/build_pages.py"), "utf8");
assert.ok(sw.indexOf("floodlight-kickoff-pages-v43") >= 0);
assert.ok(sw.indexOf("floodlight-kickoff-pages-v42") < 0);
const settingsSrc = fs.readFileSync(path.join(root, "src/settings.js"), "utf8");
assert.ok(settingsSrc.indexOf("touch-action: pan-y") >= 0);
assert.ok(settingsSrc.indexOf("overscroll-behavior: contain") >= 0);
assert.ok(settingsSrc.indexOf("min-height: 0") >= 0);
assert.ok(settingsSrc.indexOf("settingsStick") >= 0);
const playerSrc = fs.readFileSync(path.join(root, "src/player.js"), "utf8");
assert.ok(playerSrc.indexOf("touch-action: pan-y") >= 0);
assert.ok(playerSrc.indexOf("safe-area-inset-left") >= 0);
const pwaSrc = fs.readFileSync(path.join(root, "multiplayer/public/pwa.js"), "utf8");
assert.ok(pwaSrc.indexOf("#settingsCard") >= 0);
assert.ok(pwaSrc.indexOf("#playerCard") >= 0);
assert.ok(pwaSrc.indexOf("e.touches.length > 1") >= 0);
assert.ok(pwaSrc.indexOf('location.protocol === "capacitor:"') >= 0);
const settingsHaptic = fs.readFileSync(path.join(root, "src/settings.js"), "utf8");
assert.ok(settingsHaptic.indexOf("Capacitor.Plugins.Haptics") >= 0);
assert.ok(settingsHaptic.indexOf("nativeAppShell") >= 0);

console.log("cloud account sync checks passed");
