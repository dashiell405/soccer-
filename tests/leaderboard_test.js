/* Leaderboard rules, friend codes, and the anonymous player count SQL. No network. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

const context = { console: console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(read("src/progress.js"), context, { filename: "progress.js" });
vm.runInContext(read("src/leaderboard.js"), context, { filename: "leaderboard.js" });
const Board = context.KickoffLeaderboard;
const Progress = context.KickoffProgress;
assert.ok(Board && Board.renderModel && Board.localStats, "KickoffLeaderboard did not load");

function mem(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

assert.strictEqual(Board.nickname("parent@email.com"), "Player");
assert.strictEqual(Board.nickname("https://secret.example/a"), "Player");
assert.strictEqual(Board.nickname("<b>Mina</b>"), "Mina");
assert.strictEqual(Board.nickname("Mina P"), "Mina P");
assert.strictEqual(Board.nickname("Christopher Jonathan"), "Christopher Jona");
assert.strictEqual(Board.nickname("12345"), "Player");
assert.strictEqual(Board.normalizeColor("red"), "#1f5fd6");
assert.strictEqual(Board.normalizeColor("#E6B325"), "#e6b325");
assert.strictEqual(Board.clampStat("wins", -4), 0);
assert.strictEqual(Board.clampStat("wins", 999999), 20000);
assert.strictEqual(Board.clampStat("cups", 9000), 5000);
assert.strictEqual(Board.clampStat("coins", 50000000), 20000000);
assert.strictEqual(Board.cleanCode("k7mp-2qx4"), "K7MP2QX4");
assert.strictEqual(Board.formatCode("k7mp2qx4"), "K7MP-2QX4");
assert.strictEqual(Board.cleanCode("OOOO"), "");
assert.strictEqual(Board.friendMessage("missing").indexOf("code") >= 0, true);
assert.ok(Board.isMissingRpc({ code: "PGRST202", message: "Could not find the function public.leaderboard_top" }));
assert.ok(!Board.isMissingRpc({ code: "42501", message: "permission denied" }));
assert.strictEqual(Board.gateMessage("signed-out").indexOf("Settings") >= 0, true);
assert.strictEqual(Board.gateMessage("offline").indexOf("internet") >= 0, true);
assert.strictEqual(Board.gateMessage("soon").indexOf("coming soon") >= 0, true);

const store = mem({
  soccerPlayer: JSON.stringify({ name: "Mina P", team: "blue", color: "#e6b325", deviceId: "0123456789abcdef0123456789abcdef" }),
  soccerName: "Mina P",
  soccerTrophies: JSON.stringify({ wins: [{ id: "c1" }, { id: "c2" }] }),
  soccerCoins: JSON.stringify({ coins: 20, earned: 80 }),
  soccerRecord: JSON.stringify({ wins: 4 }),
});
let stats = Board.localStats(store);
assert.strictEqual(stats.name, "Mina P");
assert.strictEqual(stats.color, "#e6b325");
assert.strictEqual(stats.wins, 4);
assert.strictEqual(stats.cups, 2);
assert.strictEqual(stats.coins, 80);
assert.strictEqual(stats.show, false);
assert.strictEqual(Board.noteWin(store), 5);
assert.strictEqual(Board.localStats(store).wins, 5);
assert.ok(!JSON.stringify(Board.localStats(store)).includes("0123456789abcdef"));
assert.ok(!JSON.stringify(Board.localStats(store)).includes("@"));

const hidden = mem({ soccerCoins: JSON.stringify({ coins: 12 }) });
assert.strictEqual(Progress.loadCoinsEarned(hidden), 12);
assert.strictEqual(Board.localStats(hidden).show, false);
assert.strictEqual(Board.localStats(hidden).coins, 12);
Board.writeOpt(true, hidden);
assert.strictEqual(Board.readOpt(hidden), true);
Board.writeOpt(false, hidden);
assert.strictEqual(Board.readOpt(hidden), false);

const html = Board.renderModel({
  board: "wins",
  signedIn: true,
  optIn: true,
  rows: [
    { rank: 1, display_name: "Kit Fox", favorite_color: "#d62828", wins: 18, cups: 3, coins_earned: 420, is_me: false },
    { rank: 2, display_name: "Mina P", favorite_color: "#e6b325", wins: 12, cups: 1, coins_earned: 260, is_me: true },
    { rank: 60, display_name: "parent@email.com", favorite_color: "nope", wins: 1, cups: 0, coins_earned: 1, is_me: false },
  ],
});
assert.ok(html.indexOf("class='me'") >= 0);
assert.ok(html.indexOf(">You<") >= 0);
assert.ok(html.indexOf("Mina P") >= 0);
assert.ok(html.indexOf("Kit Fox") >= 0);
assert.ok(html.indexOf("@") < 0);
assert.ok(html.indexOf("email") < 0);
assert.ok(html.indexOf("Player") >= 0);
const outside = Board.splitTop(Board.prepareRows([
  { rank: 1, display_name: "Kit Fox", wins: 3, is_me: false },
  { rank: 51, display_name: "Mina P", wins: 1, is_me: true },
]));
assert.strictEqual(outside.top.length, 1);
assert.strictEqual(outside.mine.name, "Mina P");
assert.strictEqual(outside.mine.is_me, true);

const friends = Board.renderModel({
  board: "friends",
  signedIn: true,
  optIn: false,
  friendCode: "K7MP2QX4",
  rows: [
    { rank: 1, display_name: "Mina P", favorite_color: "#e6b325", wins: 2, cups: 0, coins_earned: 10, is_me: true, friend_code: "K7MP2QX4" },
    { rank: 2, display_name: "Jo 7", favorite_color: "#1f5fd6", wins: 1, cups: 0, coins_earned: 4, is_me: false, friend_code: "H4WK9R2M" },
  ],
});
assert.ok(friends.indexOf("K7MP-2QX4") >= 0);
assert.ok(friends.indexOf("Add friend") >= 0);
assert.ok(friends.indexOf("data-remove='H4WK-9R2M'") >= 0);
assert.ok(friends.indexOf("class='me'") >= 0);
assert.strictEqual((friends.match(/data-remove/g) || []).length, 1);

const signedOut = Board.renderModel({ gate: Board.gateMessage("signed-out") });
assert.ok(signedOut.indexOf("Sign in") >= 0);
assert.ok(signedOut.indexOf("<table") < 0);
const soon = Board.renderModel({ gate: Board.gateMessage("soon") });
assert.ok(soon.indexOf("coming soon") >= 0);

const accountOff = Board.accountHtml(true, false);
assert.ok(accountOff.indexOf("Show me on the leaderboard") >= 0);
assert.ok(accountOff.indexOf("checked") < 0);
const accountOn = Board.accountHtml(true, true);
assert.ok(accountOn.indexOf("checked") >= 0);
const accountOut = Board.accountHtml(false, true);
assert.ok(accountOut.indexOf("disabled") >= 0);
assert.ok(accountOut.indexOf("checked") < 0);

const sql = read("supabase/migrations/20261121210000_leaderboard_and_player_count.sql");
assert.ok(sql.indexOf("create table if not exists public.devices") >= 0);
assert.ok(sql.indexOf("create table if not exists public.leaderboard") >= 0);
assert.ok(sql.indexOf("show_on_board boolean not null default false") >= 0);
assert.ok(sql.indexOf("on conflict (device_id) do nothing") >= 0);
assert.ok(sql.indexOf("function public.record_device(device_id uuid)") >= 0);
assert.ok(sql.indexOf("function public.players_ever()") >= 0);
assert.ok(sql.indexOf("returns bigint") >= 0);
assert.ok(sql.indexOf("function public.players_new_today()") >= 0);
assert.ok(sql.indexOf("security definer") >= 0);
assert.ok(sql.indexOf("leaderboard_public") >= 0);
assert.ok(sql.indexOf("security_invoker = true") >= 0);
assert.ok(sql.indexOf("using (show_on_board)") >= 0);
assert.ok(sql.indexOf("revoke all on table public.devices") >= 0);
assert.ok(sql.indexOf("grant execute on function public.record_device(uuid) to anon, authenticated") >= 0);
assert.ok(sql.indexOf("grant execute on function public.players_ever() to anon, authenticated") >= 0);
assert.ok(sql.indexOf("grant execute on function public.save_my_leaderboard") >= 0);
assert.ok(sql.indexOf("to authenticated") >= 0);
assert.ok(sql.indexOf("auth.uid()") >= 0);
assert.ok(sql.indexOf("service_role") < 0);
assert.ok(sql.indexOf("sb_secret") < 0);
["devices", "leaderboard", "leaderboard_friends"].forEach(function (name) {
  const start = sql.indexOf("create table if not exists public." + name);
  const open = sql.indexOf("(", start);
  const close = sql.indexOf("\n);", open);
  const body = sql.slice(open, close);
  assert.ok(body.indexOf("email") < 0, name + " must not store an email");
});

const src = read("src/leaderboard.js");
const crowd = read("src/crowd.js");
const admin = read("src/admin.js");
const build = read("build.py");
assert.ok(src.indexOf("service_role") < 0);
assert.ok(src.indexOf("sb_secret") < 0);
assert.ok(src.indexOf("Show me on the leaderboard") >= 0);
assert.ok(src.indexOf("soccerBoardOptIn") >= 0);
assert.ok(crowd.indexOf('rpc("record_device"') >= 0);
assert.ok(crowd.indexOf('rpc("players_ever")') >= 0);
assert.ok(crowd.indexOf('rpc("players_new_today")') >= 0);
assert.ok(crowd.indexOf("device_id: id") >= 0);
assert.ok(admin.indexOf('id="adminCrowdEver"') >= 0);
assert.ok(admin.indexOf("Players ever") >= 0);
assert.ok(admin.indexOf('id="adminCrowdToday"') >= 0);
assert.strictEqual(admin.indexOf('const SALT_HEX = "fe808f2b1f2e360cdd5f2ff64165b2cc"') >= 0, true);
assert.strictEqual(admin.indexOf('const KEY_HEX = "8eea0e9cc49077e93cf3e7b6c95e26cfe00d92f335100dc61a9899b68ffcd56d"') >= 0, true);
assert.strictEqual(admin.indexOf("const ITERATIONS = 310000") >= 0, true);
assert.ok(build.indexOf('read("leaderboard.js")') >= 0);
assert.ok(read("src/offline_shell.js").indexOf('"leaderboardScreen"') >= 0);
assert.ok(read("src/cloud_account.js").indexOf("KickoffLeaderboard.mountAccount") >= 0);
assert.ok(read("tools/build_pages.py").indexOf("floodlight-kickoff-pages-v44") >= 0);

const pages = read("index.html");
assert.ok(pages.indexOf("Leaderboard") >= 0);
assert.ok(pages.indexOf("Show me on the leaderboard") >= 0);
assert.ok(pages.indexOf("record_device") >= 0);
assert.ok(pages.indexOf("service_role") < 0);
assert.ok(read("sw.js").indexOf("floodlight-kickoff-pages-v44") >= 0);
assert.ok(read("soccer.html").indexOf("id=\"boardBtn\"") >= 0 || read("soccer.html").indexOf("Leaderboard") >= 0);

console.log("leaderboard checks passed");
