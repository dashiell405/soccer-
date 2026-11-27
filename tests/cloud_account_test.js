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
assert.ok(cloudSrc.indexOf("signInWithPassword") >= 0);
assert.ok(cloudSrc.indexOf("exchangeCodeForSession") >= 0);
assert.ok(cloudSrc.indexOf("username_available") >= 0);
assert.ok(cloudSrc.indexOf("players.kickoff.invalid") >= 0);
assert.ok(cloudSrc.indexOf("Sign in with a parent's email instead") >= 0);
assert.ok(cloudSrc.indexOf("Ask a grown-up to reset it") >= 0);
assert.ok(cloudSrc.indexOf("Confirm email") >= 0);
assert.ok(cloudSrc.indexOf("Log out") >= 0);
assert.ok(cloudSrc.indexOf("Change password") >= 0);
assert.ok(cloudSrc.indexOf("kickoff://login") >= 0);
assert.ok(cfg.indexOf("kickoff://login") >= 0);

const sw = fs.readFileSync(path.join(root, "tools/build_pages.py"), "utf8");
assert.ok(sw.indexOf("floodlight-kickoff-pages-v46") >= 0);
assert.ok(sw.indexOf("floodlight-kickoff-pages-v45") < 0);
assert.ok(sw.indexOf('includes("/help/")') >= 0);
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

assert.strictEqual(Cloud.usernameError(""), "Type a username.");
assert.strictEqual(Cloud.usernameError("ab"), "Use 3 to 16 letters, numbers, or underscores.");
assert.strictEqual(Cloud.usernameError("has space"), "Use 3 to 16 letters, numbers, or underscores.");
assert.strictEqual(Cloud.usernameError("no-dash"), "Use 3 to 16 letters, numbers, or underscores.");
assert.strictEqual(Cloud.usernameError("Good_Name1"), "");
assert.strictEqual(Cloud.playerEmail("Good_Name1"), "good_name1@players.kickoff.invalid");
assert.strictEqual(Cloud.passwordStrength("short").ok, false);
assert.strictEqual(Cloud.passwordStrength("longpass").ok, true);
assert.ok(Cloud.passwordStrength("longpass").label.indexOf("Weak") >= 0);
assert.ok(Cloud.passwordStrength("Longerpass1").label.indexOf("Okay") >= 0);
assert.ok(Cloud.passwordStrength("Longer-pass1").label.indexOf("Strong") >= 0);

const stamps = [];
let clock = 1000;
for (let i = 0; i < 5; i++) {
  const gate = Cloud.rateLimitAllow(clock, stamps.slice(), 5, 60000);
  assert.strictEqual(gate.ok, true);
  stamps.splice(0, stamps.length, ...gate.stamps);
  clock += 1000;
}
assert.strictEqual(Cloud.rateLimitAllow(clock, stamps, 5, 60000).ok, false);
assert.strictEqual(Cloud.rateLimitAllow(clock + 60000, stamps, 5, 60000).ok, true);

assert.strictEqual(Cloud.friendlyAuthError({ message: "Invalid login credentials" }, "password"), "That username or password is not right.");
assert.ok(Cloud.friendlyAuthError({ message: "User already registered" }, "password").indexOf("taken") >= 0);
assert.ok(Cloud.friendlyAuthError({ message: "Failed to fetch" }, "password").indexOf("internet") >= 0);
assert.ok(Cloud.friendlyAuthError({ status: 429, message: "too many requests" }, "password").indexOf("Too many tries") >= 0);
assert.ok(Cloud.friendlyAuthError({ message: "email rate limit exceeded" }).indexOf("another email") >= 0);
assert.ok(Cloud.confirmEmailMessage().indexOf("Confirm email") >= 0);
assert.strictEqual(Cloud.signupOutcome({ data: { user: { id: "u" }, session: { access_token: "tok" } } }).ok, true);
assert.strictEqual(Cloud.signupOutcome({ data: { user: { identities: [] }, session: null } }).reason, "taken");
assert.strictEqual(Cloud.signupOutcome({
  data: { user: { email_confirmed_at: null, identities: [{ id: "i" }] }, session: null },
}).reason, "confirm-email");
assert.strictEqual(Cloud.usernameFromUser({
  email: "good_name1@players.kickoff.invalid",
  user_metadata: { username: "Good_Name1" },
}), "Good_Name1");

const deviceCoins = { coins: 12, earned: 20 };
const accountCoins = { coins: 40, earned: 30 };
const deviceUp = { sprint: 3, shot: 0, pass: 1, stamina: 0 };
const accountUp = { sprint: 1, shot: 2, pass: 0, stamina: 4 };
const merged = Cloud.mergeProgress({
  name: "Device Kid",
  player: { name: "Device Kid", team: "blue", color: "#e6b325" },
  coins: deviceCoins,
  upgrades: deviceUp,
  trophies: { wins: [{ cupId: "c-device" }] },
  career: { season: 2, division: 2, matchday: 3, clubName: "Harbor Hawks" },
  challenges: { date: "2026-11-20", ids: ["win"], progress: {}, paid: {}, streak: 1, lastComplete: "2026-11-20", badges: [{ date: "2026-11-20", name: "Full set" }] },
}, {
  name: "Account Kid",
  player: { name: "Account Kid", team: "red", color: "#d62828" },
  coins: accountCoins,
  upgrades: accountUp,
  trophies: { wins: [{ cupId: "c-account" }] },
  career: { season: 1, division: 1, matchday: 6, clubName: "Amber Athletic" },
  challenges: { date: "2026-11-21", ids: ["clean"], progress: {}, paid: {}, streak: 4, lastComplete: "2026-11-21", badges: [{ date: "2026-11-21", name: "Full set" }] },
}, "merge");
assert.strictEqual(merged.coins.coins, 40);
assert.strictEqual(merged.coins.earned, 30);
const gifted = Cloud.mergeProgress({
  coins: { coins: 500, earned: 40 },
}, {
  coins: { coins: 10, earned: 80 },
}, "merge");
assert.strictEqual(gifted.coins.coins, 500);
assert.strictEqual(gifted.coins.earned, 80);
const legacyCoins = Cloud.mergeProgress({
  coins: { coins: 15 },
}, {
  coins: { coins: 4, earned: 9 },
}, "merge");
assert.strictEqual(legacyCoins.coins.coins, 15);
assert.strictEqual(legacyCoins.coins.earned, 15);
assert.strictEqual(merged.upgrades.sprint, 3);
assert.strictEqual(merged.upgrades.shot, 2);
assert.strictEqual(merged.upgrades.stamina, 4);
assert.strictEqual(merged.trophies.wins.length, 2);
assert.strictEqual(merged.career.clubName, "Harbor Hawks");
assert.strictEqual(merged.challenges.streak, 4);
assert.strictEqual(merged.challenges.badges.length, 2);
const loaded = Cloud.mergeProgress({
  name: "Device Kid",
  coins: deviceCoins,
  career: { season: 2, division: 2, matchday: 1, clubName: "Harbor Hawks" },
}, {
  name: "Account Kid",
  player: { name: "Account Kid", team: "red", color: "#111111" },
  coins: accountCoins,
  career: { season: 1, division: 1, matchday: 1, clubName: "Amber Athletic" },
}, "load");
assert.strictEqual(loaded.name, "Account Kid");
assert.strictEqual(loaded.career.clubName, "Amber Athletic");
assert.strictEqual(loaded.coins.coins, 40);
assert.ok(Cloud.askMergeMessage().indexOf("Keep this device's progress or load your account's?") >= 0);

const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261121220000_usernames.sql"), "utf8");
assert.ok(sql.indexOf("username_available") >= 0);
assert.ok(sql.indexOf("grant execute on function public.username_available(text) to anon, authenticated") >= 0);
assert.ok(sql.indexOf("enable row level security") >= 0);
assert.ok(sql.indexOf("profiles_username_lower_key") >= 0);
assert.ok(sql.indexOf("players.kickoff.invalid") >= 0);
assert.ok(sql.toLowerCase().indexOf("service_role") < 0);
const menuHtml = fs.readFileSync(path.join(root, "src/offline_template.html"), "utf8");
assert.ok(menuHtml.indexOf('id="accountMenuBtn"') >= 0);
assert.ok(menuHtml.indexOf('id="accountScreen"') >= 0);
assert.ok(fs.readFileSync(path.join(root, "src/offline_shell.js"), "utf8").indexOf('"accountScreen"') >= 0);
assert.ok(fs.readFileSync(path.join(root, "src/admin.js"), "utf8").indexOf("const ITERATIONS = 310000") >= 0);

console.log("cloud account sync checks passed");
