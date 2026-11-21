/* Career, coins, daily challenges, and kit rules. No network and no browser. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const context = { console: console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "src/progress.js"), "utf8"), context, { filename: "progress.js" });
const P = context.KickoffProgress;
assert.ok(P && P.createCareer, "KickoffProgress did not load");

const banned = ["barcelona", "madrid", "liverpool", "chelsea", "arsenal", "manchester", "juventus", "milan", "bayern", "dortmund", "ajax", "porto", "benfica", "celtic"];
P.CLUBS.forEach((c) => {
  const flat = c.name.toLowerCase();
  assert.ok(!banned.some((w) => flat.indexOf(w) >= 0), "club name looks real: " + c.name);
  assert.strictEqual(P.CLUBS.filter((x) => x.id === c.id).length, 1);
});
assert.strictEqual(P.CLUBS.filter((c) => c.div === 2).length, 8);

function pairsOk(career) {
  for (let d = 0; d < 3; d++) {
    const ids = career.divisions[d].teams.map((t) => t.id);
    assert.strictEqual(new Set(ids).size, 8);
    const seen = {};
    assert.strictEqual(career.fixtures[d].length, 7);
    career.fixtures[d].forEach((round) => {
      assert.strictEqual(round.length, 4);
      const used = {};
      round.forEach((m) => {
        assert.notStrictEqual(m.home, m.away);
        assert.ok(!used[m.home] && !used[m.away]);
        used[m.home] = 1;
        used[m.away] = 1;
        const key = [m.home, m.away].sort().join("|");
        assert.ok(!seen[key], key);
        seen[key] = 1;
      });
      assert.strictEqual(Object.keys(used).length, 8);
    });
    assert.strictEqual(Object.keys(seen).length, 28);
  }
}

const made = P.createCareer({ clubId: "hawks" });
assert.strictEqual(made.ok, true);
assert.strictEqual(made.career.division, 2);
assert.strictEqual(made.career.divisions[2].name, "Division 3");
assert.strictEqual(made.career.clubName, "Harbor Hawks");
assert.ok(made.career.divisions[2].teams.some((t) => t.id === "hawks" && t.rating === 3));
pairsOk(made.career);
assert.strictEqual(P.createCareer({ clubId: "crownvale" }).ok, false);
assert.strictEqual(P.createCareer({ name: "ab" }).ok, false);
const custom = P.createCareer({ name: "My Otters" });
assert.strictEqual(custom.ok, true);
assert.strictEqual(custom.career.clubId, "you");
assert.strictEqual(custom.career.clubName, "My Otters");
assert.strictEqual(custom.career.division, 2);
pairsOk(custom.career);

const top = P.fillSeason(made.career, { goalsFor: 1, goalsAgainst: 0, otherHome: 1, otherAway: 1 });
const rows = P.table(top.divisions[2].teams, top.fixtures[2]);
assert.strictEqual(rows[0].id, "hawks");
assert.strictEqual(rows[0].pts, 21);
assert.strictEqual(rows[0].w, 7);
assert.strictEqual(rows[0].gd, 7);
assert.deepStrictEqual(Object.keys(rows[0]).filter((k) => ["p", "w", "d", "l", "gd", "pts"].indexOf(k) >= 0).sort(), ["d", "gd", "l", "p", "pts", "w"]);
assert.strictEqual(top.review.position, 1);
assert.strictEqual(top.review.promoted, true);
assert.strictEqual(top.review.champion, false);
const bonus = P.grantReview(top);
assert.strictEqual(bonus.coins, 105);
assert.strictEqual(bonus.career.review.paid, true);
assert.strictEqual(P.grantReview(bonus.career).coins, 0);
const next = P.startNextSeason(bonus.career);
assert.strictEqual(next.coins, 0);
assert.strictEqual(next.career.season, 2);
assert.strictEqual(next.career.division, 1);
assert.strictEqual(next.career.divisions[1].teams.length, 8);
assert.strictEqual(next.career.divisions[0].teams.length, 8);
assert.strictEqual(next.career.divisions[2].teams.length, 8);
assert.ok(next.career.divisions[1].teams.some((t) => t.id === "hawks"));
pairsOk(next.career);

const stayed = P.fillSeason(made.career, { goalsFor: 0, goalsAgainst: 3, otherHome: 1, otherAway: 1 });
assert.strictEqual(stayed.review.position, 8);
assert.strictEqual(stayed.review.relegated, false);
assert.strictEqual(stayed.review.promoted, false);

const div1 = P.startNextSeason(P.grantReview(P.fillSeason(next.career, { goalsFor: 2, goalsAgainst: 0 })).career).career;
assert.strictEqual(div1.division, 0);
const champs = P.fillSeason(div1, { goalsFor: 3, goalsAgainst: 0 });
assert.strictEqual(champs.review.champion, true);
assert.strictEqual(champs.review.promoted, false);
assert.strictEqual(P.grantReview(champs).coins, 145);
const down = P.fillSeason(div1, { goalsFor: 0, goalsAgainst: 4 });
assert.strictEqual(down.review.relegated, true);
const back = P.startNextSeason(down);
assert.strictEqual(back.career.division, 1);

const one = P.simScore({ id: "a", rating: 4 }, { id: "b", rating: 2 }, "seed");
assert.deepStrictEqual(one, P.simScore({ id: "a", rating: 4 }, { id: "b", rating: 2 }, "seed"));
assert.ok(one.hg >= 0 && one.hg <= 5 && one.ag >= 0 && one.ag <= 5);

assert.deepStrictEqual(JSON.parse(JSON.stringify(P.matchCoins({ won: true, draw: false, userGoals: 2, oppGoals: 0 }))), {
  coins: 71,
  parts: [{ label: "Win", coins: 40 }, { label: "2 goals", coins: 16 }, { label: "Clean sheet", coins: 15 }],
});
assert.strictEqual(P.matchCoins({ won: false, draw: true, userGoals: 1, oppGoals: 1 }).coins, 26);
assert.strictEqual(P.matchCoins({ won: false, draw: false, userGoals: 1, oppGoals: 2 }).coins, 8);
assert.strictEqual(P.matchCoins({ won: false, draw: true, userGoals: 0, oppGoals: 0 }).coins, 33);

let shop = { coins: 100, upgrades: { sprint: 0, shot: 0, pass: 0, stamina: 0 } };
shop = P.buyUpgrade(shop, "sprint");
assert.strictEqual(shop.upgrades.sprint, 1);
assert.strictEqual(shop.coins, 60);
const poor = P.buyUpgrade({ coins: 10, upgrades: { sprint: 0, shot: 0, pass: 0, stamina: 0 } }, "shot");
assert.strictEqual(poor.coins, 10);
assert.strictEqual(poor.upgrades.shot, 0);
const maxed = P.buyUpgrade({ coins: 99999, upgrades: { sprint: 5, shot: 5, pass: 5, stamina: 5 } }, "sprint");
assert.strictEqual(maxed.upgrades.sprint, 5);
assert.strictEqual(maxed.coins, 99999);
assert.strictEqual(P.buyUpgrade(shop, "nope").upgrades.sprint, 1);

const day = "2026-11-21";
const ids = P.challengeIds(day);
assert.deepStrictEqual(ids, P.challengeIds(day));
assert.strictEqual(ids.length, 3);
assert.strictEqual(new Set(ids).size, 3);
ids.forEach((id) => assert.ok(P.CHALLENGES.some((c) => c.id === id)));
let differ = false;
for (let n = 1; n <= 20; n++) {
  const other = P.challengeIds("2026-11-" + String(n).padStart(2, "0"));
  if (other.join() !== ids.join()) differ = true;
}
assert.ok(differ, "the date should change which challenges are picked");

const report = { userGoals: 3, oppGoals: 0, won: true, draw: false, weather: "rain", outside: 1, curl: 1 };
let first = P.applyChallenges(null, report, day);
assert.ok(first.coins > 0);
assert.ok(first.payouts.length >= 1 && first.payouts.length <= 3);
const again = P.applyChallenges(first.state, report, day);
assert.strictEqual(again.coins, 0);
assert.strictEqual(again.state.streak >= 1, true);

function finishAll(date, prev) {
  const state = P.ensureToday(prev, date);
  const huge = { userGoals: 5, oppGoals: 0, won: true, draw: false, weather: "rain", outside: 2, curl: 2 };
  return P.applyChallenges(state, huge, date);
}
const d1 = finishAll("2026-11-01", null);
assert.strictEqual(d1.state.streak, 1);
assert.ok(d1.state.badges.some((b) => b.date === "2026-11-01"));
const d2 = finishAll("2026-11-02", d1.state);
assert.strictEqual(d2.state.streak, 2);
const skipped = P.ensureToday(d2.state, "2026-11-04");
assert.strictEqual(skipped.streak, 0);

const kit = P.normalizeKit({ primary: "red", pattern: "polka", number: 200, badge: { shape: "crest", initials: "<script>", color: "#fff" } });
assert.strictEqual(kit.primary, "#1f5fd6");
assert.strictEqual(kit.pattern, "plain");
assert.strictEqual(kit.number, 99);
assert.ok(["shield", "circle", "diamond", "square"].indexOf(kit.badge.shape) >= 0);
assert.strictEqual(kit.badge.initials, "SCR");
assert.strictEqual(P.normalizeKit({ badge: { initials: "ok" } }).badge.initials, "OK");
assert.strictEqual(P.normalizeKit(null).touched, false);
assert.deepStrictEqual(P.dressTeam({ id: "bra", name: "Brazil", home: ["#ffd500", "#1d4fb8", "#ffffff"] }), { id: "bra", name: "Brazil", home: ["#ffd500", "#1d4fb8", "#ffffff"] });

const simSrc = fs.readFileSync(path.join(root, "src/sim.js"), "utf8");
const boost = simSrc.split("function boosts")[1].split("function adminMine")[0];
assert.ok(boost.indexOf("upgradeMultipliers") >= 0);
assert.ok(boost.indexOf("localStorage") < 0);
assert.ok(boost.indexOf("soccerUpgrades") < 0);
const build = fs.readFileSync(path.join(root, "build.py"), "utf8");
const gameBundle = build.split("game = read")[1].split("write")[0];
assert.ok(gameBundle.indexOf("progress.js") < 0, "online and the server must not run the career shop");

function memCoins() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    raw(k) { return JSON.parse(m.get(k)); },
  };
}
const purse = memCoins();
assert.strictEqual(P.addCoins(40, purse), 40);
assert.strictEqual(P.loadCoinsEarned(purse), 40);
assert.strictEqual(P.addCoins(18, purse), 58);
assert.strictEqual(P.loadCoinsEarned(purse), 58);
P.saveCoins(20, purse);
assert.strictEqual(P.loadCoins(purse), 20);
assert.strictEqual(P.loadCoinsEarned(purse), 58);
const oldPurse = memCoins();
oldPurse.setItem("soccerCoins", JSON.stringify({ coins: 48 }));
assert.strictEqual(P.loadCoinsEarned(oldPurse), 48);

let boardPushes = 0;
context.KickoffLeaderboard = { schedulePush() { boardPushes += 1; } };
const gift = memCoins();
gift.setItem("soccerCoins", JSON.stringify({ coins: 20, earned: 80 }));
assert.strictEqual(P.grantCoins(1000, gift), 1020);
assert.strictEqual(P.loadCoinsEarned(gift), 80);
assert.strictEqual(boardPushes, 0);
assert.strictEqual(P.grantCoins(5000000, gift), 1020 + P.COIN_ACTION_MAX);
assert.strictEqual(P.loadCoinsEarned(gift), 80);
assert.strictEqual(P.grantCoins(-100000000, gift), 1020 + P.COIN_ACTION_MAX - P.COIN_ACTION_MAX);
assert.strictEqual(P.loadCoins(gift), 1020);
assert.strictEqual(P.loadCoinsEarned(gift), 80);
assert.strictEqual(P.grantCoins(-20, gift), 1000);
assert.strictEqual(P.loadCoinsEarned(gift), 80);
assert.strictEqual(P.grantCoins(-999999, gift), 0);
assert.strictEqual(P.loadCoinsEarned(gift), 80);
assert.strictEqual(P.setCoinBalance(0, gift), 0);
assert.strictEqual(P.loadCoinsEarned(gift), 80);
assert.strictEqual(P.setCoinBalance(25000000, gift), 10000000);
assert.strictEqual(P.loadCoinsEarned(gift), 80);
const fresh = memCoins();
assert.strictEqual(P.grantCoins(100, fresh), 100);
assert.strictEqual(P.loadCoinsEarned(fresh), 0);
assert.strictEqual(P.addCoins(18, fresh), 118);
assert.strictEqual(P.loadCoinsEarned(fresh), 18);
assert.strictEqual(boardPushes, 1);
const legacyGift = memCoins();
legacyGift.setItem("soccerCoins", JSON.stringify({ coins: 48 }));
assert.strictEqual(P.grantCoins(10, legacyGift), 58);
assert.strictEqual(P.loadCoinsEarned(legacyGift), 48);

console.log("career, coins, challenges and kit checks passed");
