/* Helpers coin section: spendable balance only, and a host gift a guest can apply. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

const admin = read("src/admin.js");
const progressSrc = read("src/progress.js");
const client = read("src/client_net.js");
const p2p = read("src/p2p_net.js");

assert.strictEqual(admin.indexOf('const SALT_HEX = "fe808f2b1f2e360cdd5f2ff64165b2cc"') >= 0, true);
assert.strictEqual(admin.indexOf('const KEY_HEX = "8eea0e9cc49077e93cf3e7b6c95e26cfe00d92f335100dc61a9899b68ffcd56d"') >= 0, true);
assert.strictEqual(admin.indexOf("const ITERATIONS = 310000") >= 0, true);
assert.ok(admin.indexOf('id="adminCoins"') >= 0);
assert.ok(admin.indexOf("<h3>Coins</h3>") >= 0);
assert.ok(admin.indexOf('id="adminCoinBalance"') >= 0);
assert.ok(admin.indexOf('data-coin="10"') >= 0);
assert.ok(admin.indexOf('data-coin="100"') >= 0);
assert.ok(admin.indexOf('data-coin="1000">+1,000') >= 0);
assert.ok(admin.indexOf('data-coin="10000">+10,000') >= 0);
assert.ok(admin.indexOf('id="adminCoinGive">Give') >= 0);
assert.ok(admin.indexOf('id="adminCoinTake">Take away') >= 0);
assert.ok(admin.indexOf('id="adminCoinZero">Set to 0') >= 0);
assert.ok(admin.indexOf('id="adminCoinResetYes">Yes, set to 0') >= 0);
assert.ok(admin.indexOf("Set your coins to 0?") >= 0);
assert.ok(admin.indexOf('id="adminCoinWho"') >= 0);
assert.ok(admin.indexOf("Guests can't use the helpers.") >= 0);
assert.ok(admin.indexOf("The host gave you ") >= 0);
assert.ok(admin.indexOf("kickoffAcceptGift") >= 0);
assert.ok(admin.indexOf("giveCoins(btn.dataset.coin, false)") >= 0);
assert.ok(admin.indexOf('giveCoins(document.getElementById("adminCoinAmount").value, true)') >= 0);
assert.ok(admin.indexOf("paintCoins") >= 0);

const coinPart = admin.slice(admin.indexOf("const COIN_CAP"), admin.indexOf("function peopleText"));
assert.ok(coinPart.indexOf("grantCoins") >= 0);
assert.ok(coinPart.indexOf("setCoinBalance") >= 0);
assert.ok(coinPart.indexOf("addCoins") < 0, "helper coins must not use addCoins");
assert.ok(coinPart.indexOf("schedulePush") < 0, "helper coins must not push the leaderboard");
assert.ok(coinPart.indexOf("earned") >= 0);

const giftFn = p2p.slice(p2p.indexOf("function hostGift"), p2p.indexOf("function hostUnban"));
assert.ok(giftFn.indexOf('netRole === "guest"') >= 0);
assert.ok(giftFn.indexOf("netIsHost()") >= 0);
assert.ok(giftFn.indexOf("n > 1000000") >= 0);
assert.ok(giftFn.indexOf('t: "gift"') >= 0);
assert.ok(giftFn.indexOf("m.local") >= 0);
assert.ok(p2p.indexOf('case "gift":') >= 0);
assert.ok(p2p.indexOf("gift: hostGift") >= 0);

const giftCase = client.slice(client.indexOf('case "gift":'), client.indexOf('case "removed":'));
assert.ok(giftCase.indexOf('netRole !== "guest"') >= 0);
assert.ok(giftCase.indexOf("n > 1000000") >= 0);
assert.ok(giftCase.indexOf("kickoffAcceptGift") >= 0);
assert.ok(giftCase.indexOf("The host gave you ") >= 0);

const context = { console: console };
context.globalThis = context;
let pushes = 0;
context.KickoffLeaderboard = { schedulePush() { pushes += 1; } };
vm.createContext(context);
vm.runInContext(progressSrc, context, { filename: "progress.js" });
const P = context.KickoffProgress;

function mem() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}
const box = mem();
assert.strictEqual(P.grantCoins(100, box), 100);
assert.strictEqual(P.loadCoinsEarned(box), 0);
assert.strictEqual(pushes, 0);
assert.strictEqual(P.addCoins(40, box), 140);
assert.strictEqual(P.loadCoinsEarned(box), 40);
assert.strictEqual(pushes, 1);
assert.strictEqual(P.grantCoins(10, box), 150);
assert.strictEqual(P.loadCoinsEarned(box), 40);
assert.strictEqual(P.setCoinBalance(0, box), 0);
assert.strictEqual(P.loadCoinsEarned(box), 40);

const localSrc = admin.slice(admin.indexOf("  const COIN_CAP = 10000000;"), admin.indexOf("  function walletCoins()"));
const local = { localStorage: mem() };
local.globalThis = local;
vm.createContext(local);
vm.runInContext(localSrc + "\nthis.api = { readLocalCoins, writeLocalCoins, applyLocalCoins, setLocalCoins, coinLabel };", local);
const L = local.api;
assert.strictEqual(L.coinLabel(100), "100");
assert.strictEqual(L.coinLabel(1000), "1,000");
assert.strictEqual(L.coinLabel(10000), "10,000");
local.localStorage.setItem("soccerCoins", JSON.stringify({ coins: 20, earned: 80 }));
assert.strictEqual(L.applyLocalCoins(100), 120);
assert.strictEqual(L.readLocalCoins().earned, 80);
assert.strictEqual(L.applyLocalCoins(5000000), 120 + 1000000);
assert.strictEqual(L.readLocalCoins().earned, 80);
assert.strictEqual(L.applyLocalCoins(-50), 120 + 1000000 - 50);
assert.strictEqual(L.setLocalCoins(0), 0);
assert.strictEqual(L.readLocalCoins().earned, 80);
assert.strictEqual(L.setLocalCoins(-4), 0);
assert.strictEqual(L.readLocalCoins().earned, 80);
local.localStorage.setItem("soccerCoins", JSON.stringify({ coins: 48 }));
assert.strictEqual(L.applyLocalCoins(10), 58);
assert.strictEqual(L.readLocalCoins().earned, 48);

const storeP = mem();
const storeL = mem();
storeP.setItem("soccerCoins", JSON.stringify({ coins: 48 }));
storeL.setItem("soccerCoins", JSON.stringify({ coins: 48 }));
const mirror = { localStorage: storeL };
mirror.globalThis = mirror;
vm.createContext(mirror);
vm.runInContext(localSrc + "\nthis.api = { applyLocalCoins, setLocalCoins, readLocalCoins };", mirror);
[10, 1000001, -1000001, -40].forEach((n) => {
  assert.strictEqual(mirror.api.applyLocalCoins(n), P.grantCoins(n, storeP));
  assert.strictEqual(mirror.api.readLocalCoins().coins, P.loadCoins(storeP));
  assert.strictEqual(mirror.api.readLocalCoins().earned, P.loadCoinsEarned(storeP));
});
assert.strictEqual(mirror.api.setLocalCoins(0), P.setCoinBalance(0, storeP));
assert.strictEqual(mirror.api.readLocalCoins().earned, P.loadCoinsEarned(storeP));
assert.strictEqual(P.loadCoinsEarned(storeP), 48);

console.log("admin coin checks passed");
