/* Pure checks for the helpers "Players" count. No network. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const context = { console: console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "src/crowd.js"), "utf8"), context, { filename: "crowd.js" });
const Crowd = context.KickoffCrowd;
assert.ok(Crowd && Crowd.tally && Crowd.lines, "KickoffCrowd did not load");

function same(actual, expected) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected);
}

const empty = Crowd.tally(null);
same(empty, { total: 0, match: 0, menu: 0, online: 0, solo: 0 });

const mixed = Crowd.tally({
  a: [{ place: "menu", kind: "solo" }, { place: "match", kind: "online" }],
  b: [{ place: "menu", kind: "solo" }],
  c: [{ place: "<script>", kind: "nope", name: "Sam", email: "a@b.c" }],
});
same(mixed, { total: 3, match: 1, menu: 2, online: 1, solo: 2 });
assert.strictEqual(Crowd.tally({ blank: [] }).total, 0);

same(Crowd.readActivity({}), { place: "menu", kind: "solo" });
same(Crowd.readActivity({ inMatch: true }), { place: "match", kind: "solo" });
same(Crowd.readActivity({ inMatch: true, atMenu: true }), { place: "menu", kind: "solo" });
same(
  Crowd.readActivity({ netRole: "host", room: { code: "K7MP", state: "playing" }, inMatch: true }),
  { place: "match", kind: "online" }
);
same(
  Crowd.readActivity({ netRole: "guest", room: { code: "K7MP", state: "lobby" }, inMatch: true }),
  { place: "menu", kind: "online" }
);
assert.deepStrictEqual(Object.keys(Crowd.readActivity({ inMatch: true, netRole: "host", room: { code: "AB" } })).sort(), ["kind", "place"]);

assert.strictEqual(Crowd.roomTally({}), null);
const room = Crowd.roomTally({
  hostedMembers: [{ connected: true }, { connected: false }, { connected: true }],
});
same(room, { here: 2, away: 1, total: 3 });

const live = Crowd.lines({
  status: "live",
  totals: { total: 2, match: 1, menu: 1, online: 0, solo: 2 },
  peak: 4,
  room: null,
});
assert.strictEqual(live.now, "Playing right now: 2 people");
assert.strictEqual(live.split, "In a match: 1 · On menus: 1");
assert.strictEqual(live.kind, "Online games: 0 · Solo: 2");
assert.strictEqual(live.peak, "Most at once this session: 4 people");
assert.strictEqual(live.room, "In this online game: Not online");
assert.strictEqual(live.hint, "");

const off = Crowd.lines({ status: "offline", totals: { total: 9 }, peak: 4, room: { total: 1, away: 0, here: 1 } });
assert.strictEqual(off.now, "Playing right now: Offline");
assert.ok(off.hint.indexOf("internet") >= 0);
assert.strictEqual(off.split, "");
assert.strictEqual(off.room, "In this online game: 1 person");
assert.ok(off.now.indexOf("9") < 0);

const away = Crowd.lines({ status: "checking", room: { total: 3, away: 1, here: 2 } });
assert.strictEqual(away.now, "Playing right now: Checking…");
assert.strictEqual(away.room, "In this online game: 3 people (1 away)");
assert.strictEqual(away.peak, "");

const src = fs.readFileSync(path.join(root, "src/crowd.js"), "utf8");
assert.ok(src.indexOf('channel("kickoff-playing"') >= 0);
assert.ok(src.indexOf("sharedClient") >= 0);
assert.ok(src.indexOf("soccerCrowdPeak") >= 0);
assert.ok(!/track\(\s*\{[^}]*email/.test(src));
assert.ok(src.indexOf("display_name") < 0);
assert.ok(src.indexOf("service_role") < 0);
assert.ok(src.indexOf("sb_secret") < 0);
const admin = fs.readFileSync(path.join(root, "src/admin.js"), "utf8");
assert.ok(admin.indexOf('id="adminCrowd"') >= 0);
assert.ok(admin.indexOf("<h3>Players</h3>") >= 0);
assert.ok(admin.indexOf("<h3>Guests</h3>") >= 0);

console.log("crowd count checks passed");
