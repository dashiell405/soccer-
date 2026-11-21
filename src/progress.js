/* Career, coins, daily challenges, and the kit creator.
   Saved on this phone. The account sync copies the same keys onto the
   player's own profile row. Online matches do not read upgrades. */
(function (root) {
  const KEY_CAREER = "soccerCareer";
  const KEY_COINS = "soccerCoins";
  const KEY_UPGRADES = "soccerUpgrades";
  const KEY_CHALLENGES = "soccerChallenges";
  const KEY_KIT = "soccerKit";
  const UPGRADE_CAP = 5;
  const UPGRADE_COST = [40, 70, 110, 160, 220];
  const COIN_WIN = 40, COIN_DRAW = 18, COIN_GOAL = 8, COIN_CLEAN = 15;
  const PATTERNS = ["plain", "stripes", "hoops", "halves", "sash"];
  const SHAPES = ["shield", "circle", "diamond", "square"];
  const DIV_NAMES = ["Division 1", "Division 2", "Division 3"];
  const STATS = [
    { id: "sprint", name: "Sprint speed", blurb: "A little faster when you hold RUN. +2% each level, up to +10%." },
    { id: "shot", name: "Shot power", blurb: "Shots fly a bit harder. +2.5% each level, up to +12.5%." },
    { id: "pass", name: "Passing accuracy", blurb: "Passes stay closer to your aim. Misses shrink by 5% each level." },
    { id: "stamina", name: "Stamina", blurb: "Sprinting tires you more slowly. Drain drops by 5% each level." },
  ];
  const CHALLENGES = [
    { id: "outside", title: "Score from outside the box", detail: "Score from outside the penalty area.", reward: 30, kind: "outside" },
    { id: "clean", title: "Win with a clean sheet", detail: "Win without letting a goal in.", reward: 35, kind: "clean" },
    { id: "curl", title: "Score with a curl shot", detail: "Score with the CURL finesse shot.", reward: 30, kind: "curl" },
    { id: "rain", title: "Win in the rain", detail: "Win while it is raining. Pick Rain in Settings, or get it from random weather.", reward: 35, kind: "rain" },
    { id: "hattrick", title: "Score 3 goals", detail: "Score 3 goals in one match.", reward: 40, kind: "goals", target: 3 },
    { id: "brace", title: "Score 2 goals", detail: "Score 2 goals in one match.", reward: 25, kind: "goals", target: 2 },
    { id: "win", title: "Win the match", detail: "Win an offline or career match.", reward: 20, kind: "win" },
  ];
  // Made-up clubs only. No real club names and no real crests.
  const CLUBS = [
    club("crownvale", "Crownvale", "CRV", 4, 0, 0),
    club("starling", "Starling Athletic", "STA", 4, 0, 1),
    club("marble", "Marblehouse", "MBH", 4, 0, 2),
    club("westwind", "Westwind", "WWD", 4, 0, 3),
    club("goldfinch", "Goldfinch", "GLD", 4, 0, 4),
    club("highmarket", "Highmarket", "HMK", 4, 0, 5),
    club("silverbrook", "Silverbrook", "SLB", 4, 0, 6),
    club("kingswell", "Kingswell", "KGW", 4, 0, 7),
    club("amber", "Amber Athletic", "AMB", 3, 1, 0),
    club("quartz", "Quartz County", "QRZ", 3, 1, 1),
    club("willow", "Willow Park", "WIL", 3, 1, 2),
    club("bramble", "Bramble", "BRM", 3, 1, 3),
    club("redkettle", "Redkettle", "RKT", 3, 1, 4),
    club("summit", "Summit Wanderers", "SUM", 3, 1, 5),
    club("wharf", "Little Wharf", "WHR", 3, 1, 6),
    club("papermill", "Papermill", "PML", 3, 1, 7),
    club("hawks", "Harbor Hawks", "HWK", 2, 2, 0),
    club("badgers", "Pine Badgers", "BAD", 2, 2, 1),
    club("larks", "Meadow Larks", "LRK", 2, 2, 2),
    club("lantern", "Lantern Town", "LNT", 2, 2, 3),
    club("kites", "Cobalt Kites", "KIT", 2, 2, 4),
    club("oakfield", "Oakfield", "OAK", 2, 2, 5),
    club("otters", "River Otters", "OTT", 2, 2, 6),
    club("northbridge", "Northbridge", "NBR", 2, 2, 7),
  ];

  function club(id, name, short, rating, div, n) {
    const home = [
      ["#1f5fd6", "#ffffff", "#1f5fd6"],
      ["#c23b4a", "#1b1b1b", "#f4f4f4"],
      ["#2f8f5b", "#f4f4f4", "#2f8f5b"],
      ["#e0a106", "#3d2b1f", "#e0a106"],
      ["#6b3fa0", "#f4f4f4", "#6b3fa0"],
      ["#e07a3d", "#203040", "#e07a3d"],
      ["#1a8a8a", "#f4f4f4", "#1a8a8a"],
      ["#c45c26", "#f6e7c1", "#c45c26"],
    ][n % 8];
    const away = home[0] === "#f4f4f4" || home[0] === "#e0a106" || home[0] === "#f6e7c1"
      ? ["#222222", "#222222", "#f4f4f4"]
      : ["#f4f4f4", "#222222", "#f4f4f4"];
    return { id: id, name: name, short: short, rating: rating, div: div, home: home, away: away };
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function defaultStore() {
    try { if (typeof localStorage !== "undefined") return localStorage; } catch (e) { /* private */ }
    return null;
  }
  function readRaw(storage, key) {
    const box = storage || defaultStore();
    if (!box) return null;
    try {
      const raw = JSON.parse(box.getItem(key) || "null");
      return raw && typeof raw === "object" ? raw : null;
    } catch (e) { return null; }
  }
  function writeRaw(storage, key, value) {
    const box = storage || defaultStore();
    if (!box) return;
    try {
      if (value == null) box.removeItem(key);
      else box.setItem(key, JSON.stringify(value));
    } catch (e) { /* private mode */ }
  }
  function hash32(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function isHex(c) { return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c); }
  function hexLight(h) {
    const n = parseInt(String(h).slice(1, 7), 16) || 0;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return r * 0.3 + g * 0.59 + b * 0.11 > 150;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clubNameError(name) {
    const n = String(name || "").replace(/[<>]/g, "").trim();
    if (n.length < 3 || n.length > 16) return "Use 3 to 16 characters.";
    if (!/^[A-Za-z0-9 ]+$/.test(n) || !/[A-Za-z]/.test(n)) return "Use letters and numbers only.";
    const flat = n.toLowerCase().replace(/[^a-z0-9]/g, "");
    const bad = ["fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "retard"];
    if (bad.some(function (w) { return flat.indexOf(w) >= 0; })) return "Pick a different name.";
    return "";
  }
  function shortCode(name) {
    const letters = String(name || "").replace(/[^A-Za-z]/g, "").toUpperCase();
    return (letters.slice(0, 3) || "YOU").padEnd(3, "X");
  }
  function roundRobin(ids) {
    const list = ids.slice();
    const n = list.length;
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const pairs = [];
      for (let i = 0; i < n / 2; i++) {
        const a = list[i];
        const b = list[n - 1 - i];
        const swap = (r + i) % 2 === 1;
        pairs.push({ home: swap ? b : a, away: swap ? a : b, hg: 0, ag: 0, played: false });
      }
      rounds.push(pairs);
      const tail = list.pop();
      list.splice(1, 0, tail);
    }
    return rounds;
  }
  function findClub(career, id) {
    if (!career) return null;
    for (let d = 0; d < career.divisions.length; d++) {
      const hit = career.divisions[d].teams.find(function (t) { return t.id === id; });
      if (hit) return hit;
    }
    return null;
  }
  function table(teams, fixtures) {
    const rows = teams.map(function (t) {
      return { id: t.id, name: t.name, short: t.short, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
    });
    const byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    (fixtures || []).forEach(function (round) {
      (round || []).forEach(function (m) {
        if (!m || !m.played || !byId[m.home] || !byId[m.away]) return;
        const h = byId[m.home], a = byId[m.away];
        h.p++; a.p++;
        h.gf += m.hg; h.ga += m.ag;
        a.gf += m.ag; a.ga += m.hg;
        if (m.hg > m.ag) { h.w++; h.pts += 3; a.l++; }
        else if (m.hg < m.ag) { a.w++; a.pts += 3; h.l++; }
        else { h.d++; a.d++; h.pts++; a.pts++; }
      });
    });
    rows.forEach(function (r) { r.gd = r.gf - r.ga; });
    rows.sort(function (a, b) {
      return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || String(a.name).localeCompare(String(b.name));
    });
    return rows;
  }
  function makeReview(c) {
    const rows = table(c.divisions[c.division].teams, c.fixtures[c.division]);
    const pos = rows.findIndex(function (r) { return r.id === c.clubId; }) + 1;
    const div = c.division;
    return {
      season: c.season,
      division: div,
      divisionName: DIV_NAMES[div],
      position: pos,
      total: rows.length,
      promoted: div > 0 && pos > 0 && pos <= 2,
      relegated: div < 2 && pos >= rows.length - 1,
      champion: div === 0 && pos === 1,
      paid: false,
    };
  }
  function placeWord(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function summaryText(r) {
    const place = placeWord(r.position);
    if (r.champion) return "Champions! You finished " + place + " in " + r.divisionName + ".";
    if (r.promoted) return "Promoted! You finished " + place + " in " + r.divisionName + ".";
    if (r.relegated) return "Relegated. You finished " + place + " in " + r.divisionName + ".";
    return "You finished " + place + " in " + r.divisionName + " and stay there.";
  }
  function reviewCoins(r) {
    const parts = [{ label: "Season finished", coins: 25 }];
    if (r && r.promoted) parts.push({ label: "Promoted", coins: 80 });
    if (r && r.champion) parts.push({ label: "Champions", coins: 120 });
    return { coins: parts.reduce(function (a, p) { return a + p.coins; }, 0), parts: parts };
  }
  function validCareer(c) {
    if (!c || c.version !== 1 || typeof c.clubId !== "string" || typeof c.clubName !== "string") return false;
    if (!Array.isArray(c.divisions) || c.divisions.length !== 3) return false;
    if (!Array.isArray(c.fixtures) || c.fixtures.length !== 3) return false;
    for (let i = 0; i < 3; i++) {
      const d = c.divisions[i];
      if (!d || !Array.isArray(d.teams) || d.teams.length !== 8) return false;
      if (!Array.isArray(c.fixtures[i]) || c.fixtures[i].length !== 7) return false;
    }
    return c.division >= 0 && c.division <= 2;
  }
  function createCareer(choice) {
    const custom = choice && String(choice.name || "").trim();
    let clubId = choice && choice.clubId;
    if (custom) {
      const error = clubNameError(custom);
      if (error) return { ok: false, error: error };
      clubId = "you";
    }
    const known = CLUBS.some(function (c) { return c.id === clubId; });
    if (!known && clubId !== "you") return { ok: false, error: "Pick a club." };
    if (clubId !== "you" && CLUBS.some(function (c) { return c.id === clubId && c.div !== 2; })) {
      return { ok: false, error: "New careers start in Division 3." };
    }
    const divisions = [0, 1, 2].map(function (div) {
      return {
        name: DIV_NAMES[div],
        teams: CLUBS.filter(function (c) { return c.div === div; }).map(function (c) { return clone(c); }),
      };
    });
    if (clubId === "you") {
      const slot = divisions[2].teams[0];
      slot.id = "you";
      slot.name = custom.replace(/[<>]/g, "").trim();
      slot.short = shortCode(slot.name);
      slot.rating = 3;
    } else {
      const mine = divisions[2].teams.find(function (t) { return t.id === clubId; });
      if (mine) mine.rating = 3;
    }
    const career = {
      version: 1,
      season: 1,
      clubId: clubId,
      clubName: clubId === "you" ? divisions[2].teams[0].name : divisions[2].teams.find(function (t) { return t.id === clubId; }).name,
      division: 2,
      matchday: 0,
      divisions: divisions,
      fixtures: divisions.map(function (d) { return roundRobin(d.teams.map(function (t) { return t.id; })); }),
      history: [],
      review: null,
    };
    return { ok: true, career: career };
  }
  function loadCareer(storage) {
    const raw = readRaw(storage, KEY_CAREER);
    return validCareer(raw) ? raw : null;
  }
  function saveCareer(career, storage) {
    writeRaw(storage, KEY_CAREER, career || null);
  }
  function simScore(home, away, seed) {
    const h = hash32(String(seed) + "|" + (home && home.id) + "|" + (away && away.id));
    const edge = ((home && home.rating) || 3) - ((away && away.rating) || 3);
    function goals(base, rnd) {
      const roll = (rnd >>> 0) % 100 / 100;
      let g = roll < 0.22 ? 0 : roll < 0.55 ? 1 : roll < 0.82 ? 2 : roll < 0.95 ? 3 : 4;
      if (base >= 1 && g < 4 && rnd % 3 === 0) g += 1;
      if (base <= -1 && g > 0 && rnd % 2 === 0) g -= 1;
      if (g < 0) g = 0;
      if (g > 5) g = 5;
      return g;
    }
    return { hg: goals(edge + 0.4, h), ag: goals(-edge, (Math.imul(h, 3) ^ (h >>> 11)) >>> 0) };
  }
  function playMatchday(career, goalsFor, goalsAgainst) {
    const c = clone(career);
    if (!c || c.review) return c;
    const round = c.fixtures[c.division][c.matchday];
    if (!round) return c;
    const gf = Math.max(0, goalsFor | 0);
    const ga = Math.max(0, goalsAgainst | 0);
    round.forEach(function (m) {
      if (m.home !== c.clubId && m.away !== c.clubId) return;
      if (m.played) return;
      if (m.home === c.clubId) { m.hg = gf; m.ag = ga; }
      else { m.hg = ga; m.ag = gf; }
      m.played = true;
    });
    c.fixtures.forEach(function (rounds, di) {
      const matches = rounds[c.matchday];
      if (!matches) return;
      matches.forEach(function (m) {
        if (m.played) return;
        const sc = simScore(findClub(c, m.home), findClub(c, m.away), c.season + ":" + di + ":" + c.matchday + ":" + m.home + ":" + m.away);
        m.hg = sc.hg;
        m.ag = sc.ag;
        m.played = true;
      });
    });
    c.matchday += 1;
    if (c.matchday >= c.fixtures[c.division].length) c.review = makeReview(c);
    return c;
  }
  function fillSeason(career, spec) {
    spec = spec || {};
    const gf = spec.goalsFor == null ? 1 : spec.goalsFor;
    const ga = spec.goalsAgainst == null ? 0 : spec.goalsAgainst;
    const oh = spec.otherHome == null ? 1 : spec.otherHome;
    const oa = spec.otherAway == null ? 1 : spec.otherAway;
    const c = clone(career);
    c.fixtures.forEach(function (rounds, di) {
      rounds.forEach(function (round) {
        round.forEach(function (m) {
          const mine = di === c.division && (m.home === c.clubId || m.away === c.clubId);
          if (mine) {
            if (m.home === c.clubId) { m.hg = gf; m.ag = ga; }
            else { m.hg = ga; m.ag = gf; }
          } else { m.hg = oh; m.ag = oa; }
          m.played = true;
        });
      });
    });
    c.matchday = c.fixtures[c.division].length;
    c.review = makeReview(c);
    return c;
  }
  function grantReview(career) {
    const c = clone(career);
    if (!c || !c.review || c.review.paid) return { career: c, coins: 0, parts: [] };
    const bonus = reviewCoins(c.review);
    c.review.paid = true;
    return { career: c, coins: bonus.coins, parts: bonus.parts };
  }
  function moveClubs(c) {
    const ups = [];
    const downs = [];
    for (let i = 0; i < 3; i++) {
      const rows = table(c.divisions[i].teams, c.fixtures[i]);
      ups[i] = i > 0 ? [rows[0].id, rows[1].id] : [];
      downs[i] = i < 2 ? [rows[rows.length - 1].id, rows[rows.length - 2].id] : [];
    }
    function pull(div, id) {
      const arr = c.divisions[div].teams;
      const idx = arr.findIndex(function (t) { return t.id === id; });
      if (idx < 0) return null;
      return arr.splice(idx, 1)[0];
    }
    const up3 = ups[2].map(function (id) { return pull(2, id); }).filter(Boolean);
    const down2 = downs[1].map(function (id) { return pull(1, id); }).filter(Boolean);
    c.divisions[1].teams = c.divisions[1].teams.concat(up3);
    c.divisions[2].teams = c.divisions[2].teams.concat(down2);
    const up2 = ups[1].map(function (id) { return pull(1, id); }).filter(Boolean);
    const down1 = downs[0].map(function (id) { return pull(0, id); }).filter(Boolean);
    c.divisions[0].teams = c.divisions[0].teams.concat(up2);
    c.divisions[1].teams = c.divisions[1].teams.concat(down1);
  }
  function startNextSeason(career) {
    const c = clone(career);
    if (!c || !c.review) return { career: c, coins: 0, parts: [] };
    const note = summaryText(c.review);
    c.history = (c.history || []).concat([{
      season: c.season, division: c.review.divisionName, position: c.review.position, note: note,
    }]).slice(-12);
    moveClubs(c);
    c.season += 1;
    c.matchday = 0;
    c.review = null;
    c.fixtures = c.divisions.map(function (d) { return roundRobin(d.teams.map(function (t) { return t.id; })); });
    const found = c.divisions.findIndex(function (d) { return d.teams.some(function (t) { return t.id === c.clubId; }); });
    c.division = found < 0 ? 2 : found;
    return { career: c, coins: 0, parts: [] };
  }
  function nextFixture(career) {
    if (!career || career.review) return null;
    const round = career.fixtures[career.division][career.matchday];
    if (!round) return null;
    return round.find(function (m) { return m.home === career.clubId || m.away === career.clubId; }) || null;
  }
  function asTeamDef(club) {
    return {
      id: club.id, name: club.name, short: club.short, rating: club.rating || 3,
      home: club.home.slice(), away: (club.away || club.home).slice(),
    };
  }
  function clampCoins(n) {
    const v = Math.round(Number(n) || 0);
    if (v < 0) return 0;
    if (v > 10000000) return 10000000;
    return v;
  }
  function clampEarned(n) {
    const v = Math.round(Number(n) || 0);
    if (v < 0) return 0;
    if (v > 20000000) return 20000000;
    return v;
  }
  function coinBag(storage) {
    const raw = readRaw(storage, KEY_COINS) || {};
    const coins = clampCoins(raw.coins);
    let earned = clampEarned(raw.earned);
    if (earned < coins) earned = clampEarned(coins);
    return { coins: coins, earned: earned };
  }
  function writeCoins(bag, storage) {
    const coins = clampCoins(bag.coins);
    let earned = clampEarned(bag.earned);
    if (earned < coins) earned = clampEarned(coins);
    writeRaw(storage, KEY_COINS, { coins: coins, earned: earned });
  }
  function loadCoins(storage) { return coinBag(storage).coins; }
  function loadCoinsEarned(storage) { return coinBag(storage).earned; }
  function saveCoins(n, storage) {
    const bag = coinBag(storage);
    bag.coins = clampCoins(n);
    writeCoins(bag, storage);
  }
  function addCoins(n, storage) {
    const bag = coinBag(storage);
    const delta = Math.round(Number(n) || 0);
    bag.coins = clampCoins(bag.coins + delta);
    if (delta > 0) bag.earned = clampEarned(bag.earned + delta);
    writeCoins(bag, storage);
    if (delta > 0 && typeof KickoffLeaderboard !== "undefined" && KickoffLeaderboard.schedulePush) KickoffLeaderboard.schedulePush();
    return bag.coins;
  }
  function normalizeUpgrades(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const out = { sprint: 0, shot: 0, pass: 0, stamina: 0 };
    STATS.forEach(function (s) {
      let n = Math.floor(Number(src[s.id]) || 0);
      if (n < 0) n = 0;
      if (n > UPGRADE_CAP) n = UPGRADE_CAP;
      out[s.id] = n;
    });
    return out;
  }
  function loadUpgrades(storage) { return normalizeUpgrades(readRaw(storage, KEY_UPGRADES)); }
  function saveUpgrades(up, storage) { writeRaw(storage, KEY_UPGRADES, normalizeUpgrades(up)); }
  function buyUpgrade(state, stat) {
    const known = { sprint: 1, shot: 1, pass: 1, stamina: 1 };
    const upgrades = normalizeUpgrades(state && state.upgrades);
    const coins = clampCoins(state && state.coins);
    if (!known[stat] || upgrades[stat] >= UPGRADE_CAP) return { coins: coins, upgrades: upgrades };
    const cost = UPGRADE_COST[upgrades[stat]];
    if (coins < cost) return { coins: coins, upgrades: upgrades };
    upgrades[stat] += 1;
    return { coins: coins - cost, upgrades: upgrades };
  }
  function matchCoins(report) {
    const parts = [];
    if (report && report.won) parts.push({ label: "Win", coins: COIN_WIN });
    else if (report && report.draw) parts.push({ label: "Draw", coins: COIN_DRAW });
    const goals = Math.max(0, report && report.userGoals | 0);
    if (goals) parts.push({ label: goals === 1 ? "1 goal" : goals + " goals", coins: goals * COIN_GOAL });
    if (report && (report.oppGoals | 0) === 0 && (report.won || report.draw)) parts.push({ label: "Clean sheet", coins: COIN_CLEAN });
    return { coins: parts.reduce(function (a, p) { return a + p.coins; }, 0), parts: parts };
  }
  function todayKey(date) {
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = date ? new Date(date) : new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function prevDate(iso) {
    const parts = String(iso || "").split("-");
    const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  function challengeIds(dateStr) {
    let x = hash32("kickoff-challenges|" + dateStr) || 1;
    const ids = [];
    let guard = 0;
    while (ids.length < 3 && guard < 40) {
      const id = CHALLENGES[x % CHALLENGES.length].id;
      if (ids.indexOf(id) < 0) ids.push(id);
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      if (!x) x = 1;
      guard++;
    }
    return ids;
  }
  function challengeById(id) { return CHALLENGES.find(function (c) { return c.id === id; }) || null; }
  function ensureToday(state, today) {
    const src = state && typeof state === "object" ? state : null;
    const y = prevDate(today);
    let streak = src && src.streak || 0;
    const last = src && src.lastComplete || "";
    if (!src || (last !== today && last !== y)) streak = 0;
    if (src && src.date === today && Array.isArray(src.ids) && src.ids.length === 3) {
      return {
        date: today,
        ids: src.ids.slice(),
        progress: Object.assign({}, src.progress || {}),
        paid: Object.assign({}, src.paid || {}),
        streak: streak,
        lastComplete: last,
        badges: Array.isArray(src.badges) ? src.badges.slice(-60) : [],
      };
    }
    return {
      date: today,
      ids: challengeIds(today),
      progress: {},
      paid: {},
      streak: streak,
      lastComplete: last,
      badges: src && Array.isArray(src.badges) ? src.badges.slice(-60) : [],
    };
  }
  function met(ch, report, prev) {
    const target = ch.target || 1;
    let value = prev || 0;
    report = report || {};
    if (ch.kind === "outside") value = Math.max(value, report.outside > 0 ? 1 : 0);
    else if (ch.kind === "curl") value = Math.max(value, report.curl > 0 ? 1 : 0);
    else if (ch.kind === "clean") value = Math.max(value, report.won && (report.oppGoals | 0) === 0 ? 1 : 0);
    else if (ch.kind === "rain") value = Math.max(value, report.won && report.weather === "rain" ? 1 : 0);
    else if (ch.kind === "win") value = Math.max(value, report.won ? 1 : 0);
    else if (ch.kind === "goals") value = Math.max(value, report.userGoals | 0);
    if (value > target) value = target;
    return { value: value, done: value >= target, target: target };
  }
  function applyChallenges(state, report, today) {
    const base = ensureToday(state, today);
    const progress = Object.assign({}, base.progress);
    const paid = Object.assign({}, base.paid);
    const payouts = [];
    base.ids.forEach(function (id) {
      const ch = challengeById(id);
      if (!ch) return;
      const m = met(ch, report, progress[id] || 0);
      progress[id] = m.value;
      if (m.done && !paid[id]) {
        paid[id] = true;
        payouts.push({ id: id, title: ch.title, coins: ch.reward });
      }
    });
    let streak = base.streak || 0;
    let lastComplete = base.lastComplete || "";
    let badges = (base.badges || []).slice();
    const allPaid = base.ids.every(function (id) { return paid[id]; });
    if (allPaid && lastComplete !== today) {
      streak = lastComplete === prevDate(today) ? streak + 1 : 1;
      lastComplete = today;
      if (!badges.some(function (b) { return b && b.date === today; })) badges.push({ date: today, name: "Full set" });
      badges = badges.slice(-60);
    }
    return {
      state: { date: today, ids: base.ids, progress: progress, paid: paid, streak: streak, lastComplete: lastComplete, badges: badges },
      payouts: payouts,
      coins: payouts.reduce(function (a, p) { return a + p.coins; }, 0),
    };
  }
  function loadChallenges(storage) {
    const today = todayKey();
    const raw = readRaw(storage, KEY_CHALLENGES);
    const next = ensureToday(raw, today);
    const changed = !raw || raw.date !== next.date || raw.streak !== next.streak;
    if (changed) writeRaw(storage, KEY_CHALLENGES, next);
    return next;
  }
  function saveChallenges(state, storage) { writeRaw(storage, KEY_CHALLENGES, state); }
  function defaultKit() {
    return {
      primary: "#1f5fd6", secondary: "#ffffff", pattern: "plain", shorts: "#ffffff",
      number: 10, badge: { shape: "shield", color: "#e6b325", initials: "FK" }, touched: false,
    };
  }
  function normalizeKit(raw) {
    const d = defaultKit();
    const src = raw && typeof raw === "object" ? raw : {};
    const badgeIn = src.badge && typeof src.badge === "object" ? src.badge : {};
    let number = Math.round(Number(src.number));
    if (!isFinite(number)) number = d.number;
    if (number < 1) number = 1;
    if (number > 99) number = 99;
    let initials = String(badgeIn.initials == null ? d.badge.initials : badgeIn.initials).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (!initials) initials = "FK";
    return {
      primary: isHex(src.primary) ? src.primary.toLowerCase() : d.primary,
      secondary: isHex(src.secondary) ? src.secondary.toLowerCase() : d.secondary,
      pattern: PATTERNS.indexOf(src.pattern) >= 0 ? src.pattern : "plain",
      shorts: isHex(src.shorts) ? src.shorts.toLowerCase() : d.shorts,
      number: number,
      badge: {
        shape: SHAPES.indexOf(badgeIn.shape) >= 0 ? badgeIn.shape : "shield",
        color: isHex(badgeIn.color) ? badgeIn.color.toLowerCase() : d.badge.color,
        initials: initials,
      },
      touched: !!src.touched,
    };
  }
  function loadKit(storage) { return normalizeKit(readRaw(storage, KEY_KIT) || null); }
  function saveKit(kit, storage) { writeRaw(storage, KEY_KIT, normalizeKit(kit)); }
  function dressTeam(team) {
    if (!team) return team;
    const saved = readRaw(null, KEY_KIT);
    if (!saved || !saved.touched) return team;
    const kit = normalizeKit(saved);
    const copy = {};
    Object.keys(team).forEach(function (k) { copy[k] = team[k]; });
    copy.home = [kit.primary, kit.shorts, kit.primary];
    return copy;
  }
  function paintKit() {
    if (typeof TEAMS === "undefined" || !TEAMS.blue || !TEAMS.blue.kit) return;
    const saved = readRaw(null, KEY_KIT);
    if (!saved || !saved.touched) return;
    const design = normalizeKit(saved);
    const kit = TEAMS.blue.kit;
    kit.shirt = design.primary;
    kit.shorts = design.shorts;
    kit.socks = design.primary;
    kit.number = hexLight(design.primary) ? "#111111" : "#ffffff";
    kit.pattern = design.pattern;
    kit.secondary = design.secondary;
    kit.badge = { shape: design.badge.shape, color: design.badge.color, initials: design.badge.initials };
    if (typeof uiColor === "function") TEAMS.blue.ui = uiColor(design.primary);
  }
  function applyUpgrades() {
    if (typeof players === "undefined" || !players) return;
    const levels = loadUpgrades();
    const any = levels.sprint || levels.shot || levels.pass || levels.stamina;
    for (let i = 0; i < players.length; i++) {
      if (players[i].team !== "blue") continue;
      players[i].upgrades = any ? { sprint: levels.sprint, shot: levels.shot, pass: levels.pass, stamina: levels.stamina } : null;
    }
  }
  function applyShirtNumber() {
    const saved = readRaw(null, KEY_KIT);
    if (!saved || !saved.touched || typeof players === "undefined" || !players) return;
    const want = normalizeKit(saved).number;
    const mine = players.find(function (p) { return p.team === "blue" && p.me && p.role !== "GK"; })
      || players.find(function (p) { return p.team === "blue" && p.role === "FWD"; })
      || players.find(function (p) { return p.team === "blue" && p.role !== "GK"; });
    if (!mine || mine.num === want) return;
    const clash = players.find(function (p) { return p.team === "blue" && p !== mine && p.num === want; });
    if (clash) clash.num = mine.num;
    mine.num = want;
  }

  let matchSerial = 0;
  let settledSerial = 0;
  let lastKind = "quick";
  let resetArmed = false;

  function reportFromGame(g) {
    const gf = g.score.blue | 0;
    const ga = g.score.red | 0;
    let outside = 0, curl = 0;
    const list = g.stats && g.stats.scorers || [];
    list.forEach(function (s) {
      if (!s || s.team !== "blue" || s.og) return;
      if (s.outside) outside++;
      if (s.curl) curl++;
    });
    return {
      userGoals: gf, oppGoals: ga, won: g.winner === "blue", draw: !g.winner,
      weather: g.weather || "clear", outside: outside, curl: curl,
    };
  }
  function onMatchStart(opts) {
    matchSerial += 1;
    settledSerial = 0;
    lastKind = opts && opts.kind || "quick";
    paintKit();
    applyUpgrades();
    applyShirtNumber();
  }
  function paintReward(parts, balance, careerNote) {
    const line = document.getElementById("rewardLine");
    if (!line) return;
    if (!parts.length && !careerNote) {
      line.textContent = "No coins this time. Coins: " + balance + ".";
      return;
    }
    const bits = parts.map(function (p) { return p.label + " +" + p.coins; });
    line.textContent = (careerNote ? careerNote + " " : "") + (bits.length ? bits.join(", ") + ". " : "") + "You earned " + parts.reduce(function (a, p) { return a + p.coins; }, 0) + " coins. Coins: " + balance + ".";
  }
  function onFullTime() {
    if (typeof game === "undefined" || !game || !game.score) return;
    if (!matchSerial || settledSerial === matchSerial) return;
    settledSerial = matchSerial;
    const report = reportFromGame(game);
    if (report.won && (typeof settings === "undefined" || settings.mode !== "2p")) {
      if (typeof KickoffLeaderboard !== "undefined" && KickoffLeaderboard.noteWin) KickoffLeaderboard.noteWin();
    }
    const parts = [];
    let gained = 0;
    const purse = matchCoins(report);
    gained += purse.coins;
    purse.parts.forEach(function (p) { parts.push(p); });
    let careerNote = "";
    if (lastKind === "career") {
      let career = loadCareer();
      if (career && !career.review) {
        career = playMatchday(career, report.userGoals, report.oppGoals);
        const bonus = grantReview(career);
        career = bonus.career;
        saveCareer(career);
        gained += bonus.coins;
        bonus.parts.forEach(function (p) { parts.push(p); });
        if (career.review) careerNote = summaryText(career.review);
        else careerNote = "The league table is updated.";
      }
      const again = document.getElementById("againBtn");
      const back = document.getElementById("careerBackBtn");
      if (again) again.classList.add("hidden");
      if (back) back.classList.remove("hidden");
    }
    const today = todayKey();
    const ch = applyChallenges(loadChallenges(), report, today);
    saveChallenges(ch.state);
    gained += ch.coins;
    ch.payouts.forEach(function (p) { parts.push({ label: p.title, coins: p.coins }); });
    if (gained) addCoins(gained);
    paintReward(parts, loadCoins(), careerNote);
    paintMenu();
  }
  function paintMenu() {
    const el = document.getElementById("coinBalance");
    if (el) el.textContent = "Coins: " + loadCoins();
  }
  function careerKickoff() {
    const c = loadCareer();
    const fix = nextFixture(c);
    if (!c || !fix) return null;
    const home = findClub(c, fix.home);
    const away = findClub(c, fix.away);
    if (!home || !away) return null;
    const userHome = fix.home === c.clubId;
    return {
      user: asTeamDef(userHome ? home : away),
      opp: asTeamDef(userHome ? away : home),
      userHome: userHome,
      opponentName: userHome ? away.name : home.name,
      round: c.matchday + 1,
      rounds: c.fixtures[c.division].length,
    };
  }
  function playCareer() {
    const info = careerKickoff();
    if (!info || typeof newMatch !== "function") return;
    if (typeof settings !== "undefined") settings.mode = "1p";
    newMatch({ kind: "career", blue: info.user, red: info.opp });
  }
  function tableHtml(career) {
    const rows = table(career.divisions[career.division].teams, career.fixtures[career.division]);
    let html = "<table class='league'><thead><tr><th></th><th class='club'>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>";
    rows.forEach(function (r, i) {
      const me = r.id === career.clubId;
      const gd = (r.gd > 0 ? "+" : "") + r.gd;
      html += "<tr" + (me ? " class='me'" : "") + "><td>" + (i + 1) + "</td><td class='club'>" + esc(r.name) + "</td><td>" + r.p + "</td><td>" + r.w + "</td><td>" + r.d + "</td><td>" + r.l + "</td><td>" + gd + "</td><td>" + r.pts + "</td></tr>";
    });
    return html + "</tbody></table>";
  }
  function paintCareer() {
    const body = document.getElementById("careerBody");
    if (!body) return;
    let career = loadCareer();
    if (career && career.review && !career.review.paid) {
      const bonus = grantReview(career);
      if (bonus.coins) addCoins(bonus.coins);
      career = bonus.career;
      saveCareer(career);
      paintMenu();
    }
    if (!career) {
      const picks = CLUBS.filter(function (c) { return c.div === 2; }).map(function (c) {
        return "<button type='button' data-act='pick' data-club='" + esc(c.id) + "'>" + esc(c.name) + "</button>";
      }).join("");
      body.innerHTML = "<p>Start in <b>Division 3</b>. Play a season, then the top 2 go up and the bottom 2 go down.</p>" +
        "<p class='label'>Pick a club</p><div class='choiceGrid'>" + picks + "</div>" +
        "<form id='careerCreate' class='stackForm'><label for='careerName'>Or make one up</label>" +
        "<input id='careerName' maxlength='16' placeholder='Club name' autocomplete='off'>" +
        "<button type='submit'>Create club</button><p id='careerNameMsg' class='warn'></p></form>";
      return;
    }
    const divName = DIV_NAMES[career.division];
    let html = "<p><b>" + esc(career.clubName) + "</b> · Season " + career.season + " · " + esc(divName) + "</p>";
    if (career.history && career.history.length) {
      const last = career.history[career.history.length - 1];
      html += "<p class='note'>" + esc(last.note) + "</p>";
    }
    if (career.review) {
      html += "<p class='review'>" + esc(summaryText(career.review)) + "</p>";
      html += "<div class='row'><button type='button' class='big' data-act='next'>Start next season</button></div>";
    } else {
      const info = careerKickoff();
      if (info) {
        const where = info.userHome ? "Home" : "Away";
        html += "<div class='nextMatch'><b>Next match</b><br>Matchday " + info.round + " of " + info.rounds +
          " · " + where + " vs " + esc(info.opponentName) + "</div>";
        html += "<div class='row'><button type='button' class='big' data-act='play'>Play match</button></div>";
      }
    }
    const rule = career.division === 0 ? "Bottom 2 go down. Finish 1st and you are the champions."
      : career.division === 2 ? "Top 2 go up. The bottom league has no drop."
      : "Top 2 go up. Bottom 2 go down.";
    html += "<p class='note'>" + rule + "</p>" + tableHtml(career);
    if (resetArmed) {
      html += "<p class='warn'>This erases the saved season on this phone.</p><div class='row'><button type='button' data-act='reset-yes'>Yes, start over</button> <button type='button' data-act='reset-no'>Keep it</button></div>";
    } else {
      html += "<div class='row'><button type='button' data-act='reset'>New career</button></div>";
    }
    body.innerHTML = html;
  }
  function paintShop() {
    const body = document.getElementById("shopBody");
    if (!body) return;
    const coins = loadCoins();
    const up = loadUpgrades();
    let html = "<p>Coins: <b>" + coins + "</b></p><p class='note'>These help the team you control in offline and career matches. Online games leave them off so both sides stay even. Each one stops at level " + UPGRADE_CAP + ".</p>";
    STATS.forEach(function (s) {
      const level = up[s.id];
      const capped = level >= UPGRADE_CAP;
      const cost = capped ? 0 : UPGRADE_COST[level];
      const dots = "●".repeat(level) + "○".repeat(UPGRADE_CAP - level);
      html += "<div class='shopRow'><b>" + esc(s.name) + "</b> <span class='dots'>" + dots + "</span><br><span class='note'>" + esc(s.blurb) + "</span><br>" +
        (capped ? "<button type='button' disabled>Max</button>" : "<button type='button' data-act='buy' data-stat='" + s.id + "'" + (coins < cost ? " disabled" : "") + ">Buy level " + (level + 1) + " · " + cost + " coins</button>") +
        "</div>";
    });
    body.innerHTML = html;
  }
  function paintChallenges() {
    const body = document.getElementById("challengeBody");
    if (!body) return;
    const state = loadChallenges();
    let html = "<p>Today · " + esc(state.date) + "</p><p class='streak'>Streak: " + (state.streak || 0) + " " + ((state.streak || 0) === 1 ? "day" : "days") + "</p>";
    html += "<p class='note'>Three challenges, the same ones all day. They count in offline and career matches. Finish all 3 to keep the streak and earn a trophy.</p>";
    state.ids.forEach(function (id) {
      const ch = challengeById(id);
      if (!ch) return;
      const m = met(ch, {}, state.progress[id] || 0);
      const shown = state.progress[id] || 0;
      const done = !!state.paid[id] || shown >= (ch.target || 1);
      html += "<div class='chal" + (done ? " done" : "") + "'><b>" + (done ? "✓ " : "") + esc(ch.title) + "</b><br>" + esc(ch.detail) +
        "<br><span class='note'>" + shown + " / " + (ch.target || 1) + " · " + ch.reward + " coins</span></div>";
    });
    const badges = state.badges || [];
    html += "<h2>Trophies</h2>";
    if (!badges.length) html += "<p class='note'>Finish all 3 in one day to earn a trophy.</p>";
    else {
      html += "<div class='badgeGrid'>";
      badges.slice().reverse().forEach(function (b) {
        html += "<div class='badge'><span>🏆</span><b>" + esc(b.name || "Full set") + "</b><small>" + esc(b.date) + "</small></div>";
      });
      html += "</div>";
    }
    body.innerHTML = html;
  }
  function kitFromForm() {
    const cur = loadKit();
    const badgeShape = document.querySelector("#kitShapes button.selected");
    const pattern = document.querySelector("#kitPatterns button.selected");
    return normalizeKit({
      primary: document.getElementById("kitPrimary").value,
      secondary: document.getElementById("kitSecondary").value,
      shorts: document.getElementById("kitShorts").value,
      pattern: pattern ? pattern.dataset.pattern : cur.pattern,
      number: document.getElementById("kitNumber").value,
      badge: {
        shape: badgeShape ? badgeShape.dataset.shape : cur.badge.shape,
        color: document.getElementById("kitBadgeColor").value,
        initials: document.getElementById("kitInitials").value,
      },
      touched: true,
    });
  }
  function drawPreview(canvas, kit) {
    if (!canvas || !canvas.getContext) return;
    const g = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#102033";
    g.fillRect(0, 0, w, h);
    const x = w * 0.28, y = h * 0.12, sw = w * 0.44, sh = h * 0.42;
    g.fillStyle = kit.primary;
    roundPreview(g, x, y, sw, sh, 16);
    g.fill();
    g.save();
    g.beginPath();
    roundPreview(g, x, y, sw, sh, 16);
    g.clip();
    g.fillStyle = kit.secondary;
    if (kit.pattern === "stripes") { for (let i = 0; i < 5; i += 2) g.fillRect(x + i * sw / 5, y, sw / 5, sh); }
    else if (kit.pattern === "hoops") { for (let i = 0; i < 5; i += 2) g.fillRect(x, y + i * sh / 5, sw, sh / 5); }
    else if (kit.pattern === "halves") g.fillRect(x, y, sw / 2, sh);
    else if (kit.pattern === "sash") {
      g.translate(x + sw / 2, y + sh / 2);
      g.rotate(-0.7);
      g.fillRect(-sw, -sh * 0.1, sw * 2, sh * 0.22);
    }
    g.restore();
    const b = kit.badge;
    const cx = x + sw * 0.3, cy = y + sh * 0.62, s = sw * 0.28;
    g.fillStyle = b.color;
    g.beginPath();
    if (b.shape === "circle") g.arc(cx, cy, s / 2, 0, Math.PI * 2);
    else if (b.shape === "diamond") { g.moveTo(cx, cy - s / 2); g.lineTo(cx + s / 2, cy); g.lineTo(cx, cy + s / 2); g.lineTo(cx - s / 2, cy); g.closePath(); }
    else if (b.shape === "square") g.rect(cx - s / 2, cy - s / 2, s, s);
    else { g.moveTo(cx - s / 2, cy - s / 2); g.lineTo(cx + s / 2, cy - s / 2); g.lineTo(cx + s / 2, cy); g.quadraticCurveTo(cx, cy + s * 0.7, cx - s / 2, cy); g.closePath(); }
    g.fill();
    g.fillStyle = hexLight(b.color) ? "#1a1404" : "#fff";
    g.font = "bold 16px Arial";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(b.initials, cx, cy);
    g.fillStyle = hexLight(kit.primary) ? "#111" : "#fff";
    g.font = "bold 28px Arial";
    g.fillText(String(kit.number), x + sw / 2, y + sh * 0.42);
    g.fillStyle = kit.shorts;
    roundPreview(g, x + sw * 0.12, y + sh + 8, sw * 0.76, h * 0.16, 8);
    g.fill();
  }
  function roundPreview(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function paintKitForm() {
    const kit = loadKit();
    const primary = document.getElementById("kitPrimary");
    if (!primary) return;
    primary.value = kit.primary;
    document.getElementById("kitSecondary").value = kit.secondary;
    document.getElementById("kitShorts").value = kit.shorts;
    document.getElementById("kitNumber").value = String(kit.number);
    document.getElementById("kitBadgeColor").value = kit.badge.color;
    document.getElementById("kitInitials").value = kit.badge.initials;
    document.querySelectorAll("#kitPatterns button").forEach(function (b) { b.classList.toggle("selected", b.dataset.pattern === kit.pattern); });
    document.querySelectorAll("#kitShapes button").forEach(function (b) { b.classList.toggle("selected", b.dataset.shape === kit.badge.shape); });
    drawPreview(document.getElementById("kitPreview"), kit);
  }
  function previewLive() {
    const kit = kitFromForm();
    kit.touched = false;
    drawPreview(document.getElementById("kitPreview"), kit);
  }
  function commitKit() {
    const kit = kitFromForm();
    saveKit(kit);
    paintKit();
    if (typeof renderBackground === "function") renderBackground();
    paintKitForm();
  }
  function show(id) {
    if (typeof showScreen === "function") showScreen(id);
  }
  function refresh() {
    paintMenu();
    const career = document.getElementById("careerScreen");
    if (career && !career.classList.contains("hidden")) paintCareer();
    const shop = document.getElementById("shopScreen");
    if (shop && !shop.classList.contains("hidden")) paintShop();
    const chal = document.getElementById("challengeScreen");
    if (chal && !chal.classList.contains("hidden")) paintChallenges();
  }

  root.KickoffProgress = {
    CLUBS: CLUBS,
    DIV_NAMES: DIV_NAMES,
    CHALLENGES: CHALLENGES,
    UPGRADE_CAP: UPGRADE_CAP,
    UPGRADE_COST: UPGRADE_COST,
    createCareer: createCareer,
    loadCareer: loadCareer,
    saveCareer: saveCareer,
    roundRobin: roundRobin,
    table: table,
    playMatchday: playMatchday,
    fillSeason: fillSeason,
    grantReview: grantReview,
    startNextSeason: startNextSeason,
    nextFixture: nextFixture,
    simScore: simScore,
    summaryText: summaryText,
    loadCoins: loadCoins,
    loadCoinsEarned: loadCoinsEarned,
    saveCoins: saveCoins,
    addCoins: addCoins,
    loadUpgrades: loadUpgrades,
    saveUpgrades: saveUpgrades,
    buyUpgrade: buyUpgrade,
    matchCoins: matchCoins,
    challengeIds: challengeIds,
    ensureToday: ensureToday,
    applyChallenges: applyChallenges,
    todayKey: todayKey,
    prevDate: prevDate,
    normalizeKit: normalizeKit,
    defaultKit: defaultKit,
    loadKit: loadKit,
    saveKit: saveKit,
    dressTeam: dressTeam,
    paintKit: paintKit,
    onMatchStart: onMatchStart,
    onFullTime: onFullTime,
    paintMenu: paintMenu,
    refresh: refresh,
    clubNameError: clubNameError,
  };

  if (typeof document === "undefined") return;

  const style = document.createElement("style");
  style.textContent = ""
    + "#coinBalance { font-weight: 800; color: #ffe27a; letter-spacing: .4px; }"
    + "#extraMenu { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }"
    + "#extraMenu button { margin: 0; }"
    + ".choiceGrid, .badgeGrid { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }"
    + ".stackForm { text-align: left; margin-top: 8px; }"
    + ".stackForm input, #kitNumber, #kitInitials { font: inherit; font-size: 16px; width: 100%; box-sizing: border-box; min-height: 44px; padding: 8px; border-radius: 8px; border: 1px solid #fff; color: #111; background: #fff; }"
    + ".stackForm label, .kitGrid label { display: block; font-weight: 700; margin: 8px 0 4px; text-align: left; }"
    + ".warn { color: #ffb4b4; font-weight: 700; min-height: 1.2em; }"
    + ".note { font-size: 13px; opacity: .85; }"
    + ".review, .nextMatch { margin: 8px 0; padding: 8px; border-radius: 10px; background: rgba(255,255,255,.08); }"
    + ".league { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }"
    + ".league th, .league td { padding: 4px 3px; text-align: center; border-bottom: 1px solid rgba(255,255,255,.12); }"
    + ".league th.club, .league td.club { text-align: left; max-width: 34vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }"
    + ".league tr.me { background: rgba(255,211,61,.22); }"
    + ".shopRow, .chal { text-align: left; margin: 8px 0; padding: 8px; border-radius: 10px; background: rgba(255,255,255,.06); }"
    + ".chal.done { outline: 2px solid #7dffb3; }"
    + ".dots { letter-spacing: 2px; color: #ffe27a; }"
    + ".streak { font-size: 20px; font-weight: 800; color: #ffe27a; }"
    + ".badge { width: 92px; min-height: 72px; border-radius: 12px; background: rgba(255,211,61,.16); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 6px; }"
    + ".badge small { opacity: .8; }"
    + ".kitGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; text-align: left; }"
    + ".kitGrid input[type=color] { width: 100%; height: 44px; padding: 0; border: 0; background: transparent; }"
    + "#kitPreview { position: relative; left: auto; top: auto; width: min(220px, 70vw); height: auto; background: #102033; border-radius: 12px; margin: 8px auto; display: block; }"
    + "#rewardLine { font-weight: 700; color: #ffe27a; }";
  document.head.appendChild(style);

  function screen(id, title, inner) {
    const el = document.createElement("div");
    el.id = id;
    el.className = "overlay hidden";
    el.innerHTML = "<div class='panel'><h1 style='font-size:28px'>" + title + "</h1>" + inner + "<div class='row'><button type='button' class='progressBack'>Back</button></div></div>";
    document.body.appendChild(el);
    return el;
  }
  screen("careerScreen", "Career", "<div id='careerBody'></div>");
  screen("shopScreen", "Upgrades", "<div id='shopBody'></div>");
  screen("challengeScreen", "Challenges", "<div id='challengeBody'></div>");
  const patternBtns = PATTERNS.map(function (p) { return "<button type='button' data-pattern='" + p + "'>" + p + "</button>"; }).join("");
  const shapeBtns = SHAPES.map(function (p) { return "<button type='button' data-shape='" + p + "'>" + p + "</button>"; }).join("");
  screen("kitScreen", "Kit", "<canvas id='kitPreview' width='220' height='220'></canvas>"
    + "<div class='row'><button type='button' id='kitSave' class='big'>Use this kit</button></div>"
    + "<div class='kitGrid'><label>Shirt colour <input id='kitPrimary' type='color'></label>"
    + "<label>Second colour <input id='kitSecondary' type='color'></label>"
    + "<label>Shorts <input id='kitShorts' type='color'></label>"
    + "<label>Badge colour <input id='kitBadgeColor' type='color'></label></div>"
    + "<p class='label'>Pattern</p><div id='kitPatterns' class='choiceGrid'>" + patternBtns + "</div>"
    + "<p class='label'>Badge</p><div id='kitShapes' class='choiceGrid'>" + shapeBtns + "</div>"
    + "<label for='kitInitials'>Initials</label><input id='kitInitials' maxlength='3' autocomplete='off'>"
    + "<label for='kitNumber'>Shirt number</label><input id='kitNumber' type='number' min='1' max='99' inputmode='numeric'>"
    + "<p class='note'>Your team wears this in offline and career matches. The badge is a simple shape, not a real crest.</p>");

  const start = document.getElementById("startBtn");
  if (start && start.parentNode && !document.getElementById("coinBalance")) {
    const coin = document.createElement("div");
    coin.className = "row";
    coin.innerHTML = "<span id='coinBalance'>Coins: 0</span>";
    start.parentNode.parentNode.insertBefore(coin, start.parentNode);
    const extra = document.createElement("div");
    extra.className = "row";
    extra.id = "extraMenu";
    extra.innerHTML = "<button type='button' id='careerBtn'>Career</button><button type='button' id='shopBtn'>Upgrades</button><button type='button' id='challengeBtn'>Challenges</button><button type='button' id='kitBtn'>Kit</button>";
    start.parentNode.parentNode.insertBefore(extra, start.parentNode);
  }
  const win = document.getElementById("winScreen");
  const winPanel = win && win.querySelector(".panel");
  if (winPanel && !document.getElementById("rewardLine")) {
    const hold = document.createElement("div");
    hold.innerHTML = "<p id='rewardLine'></p><div class='row'><button type='button' id='careerBackBtn' class='big hidden'>Back to career</button></div>";
    const again = document.getElementById("againBtn");
    if (again) winPanel.insertBefore(hold, again);
    else winPanel.appendChild(hold);
  }

  document.getElementById("careerBtn").addEventListener("click", function () { resetArmed = false; paintCareer(); show("careerScreen"); });
  document.getElementById("shopBtn").addEventListener("click", function () { paintShop(); show("shopScreen"); });
  document.getElementById("challengeBtn").addEventListener("click", function () { paintChallenges(); show("challengeScreen"); });
  document.getElementById("kitBtn").addEventListener("click", function () { paintKitForm(); show("kitScreen"); });
  document.querySelectorAll(".progressBack").forEach(function (b) {
    b.addEventListener("click", function () {
      if (typeof goToMenu === "function") goToMenu();
      else if (typeof showScreen === "function") showScreen("menu");
    });
  });
  const careerBack = document.getElementById("careerBackBtn");
  if (careerBack) careerBack.addEventListener("click", function () { paintCareer(); show("careerScreen"); });

  document.getElementById("careerScreen").addEventListener("click", function (e) {
    const btn = e.target.closest ? e.target.closest("button") : null;
    if (!btn || !btn.dataset.act) return;
    const act = btn.dataset.act;
    if (act === "pick") {
      const made = createCareer({ clubId: btn.dataset.club });
      if (!made.ok) return;
      saveCareer(made.career);
      resetArmed = false;
      paintCareer();
    } else if (act === "play") playCareer();
    else if (act === "next") {
      let career = loadCareer();
      const bonus = grantReview(career);
      if (bonus.coins) addCoins(bonus.coins);
      const next = startNextSeason(bonus.career);
      saveCareer(next.career);
      paintCareer();
      paintMenu();
    } else if (act === "reset") { resetArmed = true; paintCareer(); }
    else if (act === "reset-no") { resetArmed = false; paintCareer(); }
    else if (act === "reset-yes") { saveCareer(null); resetArmed = false; paintCareer(); }
  });
  document.getElementById("careerScreen").addEventListener("submit", function (e) {
    const form = e.target;
    if (!form || form.id !== "careerCreate") return;
    e.preventDefault();
    const made = createCareer({ name: document.getElementById("careerName").value });
    const msg = document.getElementById("careerNameMsg");
    if (!made.ok) { if (msg) msg.textContent = made.error; return; }
    saveCareer(made.career);
    paintCareer();
  });
  document.getElementById("shopScreen").addEventListener("click", function (e) {
    const btn = e.target.closest ? e.target.closest("button") : null;
    if (!btn || btn.dataset.act !== "buy") return;
    const next = buyUpgrade({ coins: loadCoins(), upgrades: loadUpgrades() }, btn.dataset.stat);
    saveCoins(next.coins);
    saveUpgrades(next.upgrades);
    paintShop();
    paintMenu();
  });
  ["kitPrimary", "kitSecondary", "kitShorts", "kitBadgeColor", "kitNumber", "kitInitials"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", previewLive);
  });
  document.getElementById("kitPatterns").addEventListener("click", function (e) {
    const btn = e.target.closest ? e.target.closest("button") : null;
    if (!btn) return;
    document.querySelectorAll("#kitPatterns button").forEach(function (b) { b.classList.toggle("selected", b === btn); });
    previewLive();
  });
  document.getElementById("kitShapes").addEventListener("click", function (e) {
    const btn = e.target.closest ? e.target.closest("button") : null;
    if (!btn) return;
    document.querySelectorAll("#kitShapes button").forEach(function (b) { b.classList.toggle("selected", b === btn); });
    previewLive();
  });
  document.getElementById("kitSave").addEventListener("click", commitKit);
  paintMenu();
})(typeof globalThis !== "undefined" ? globalThis : this);
