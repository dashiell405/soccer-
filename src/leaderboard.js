/* Leaderboard for signed-in players.
   The public list shows a nickname and a favourite colour. It does not
   show an email. "Show me on the leaderboard" stays off until the player
   turns it on in Settings, then Account.
   If the database functions are not there yet, the screen says coming soon. */
(function (root) {
  const OPT_KEY = "soccerBoardOptIn";
  const RECORD_KEY = "soccerRecord";
  const COLORS = ["#e6b325", "#1f5fd6", "#d62828", "#0b6e4f", "#6b3e1e", "#7b2cbf", "#f4f4f4", "#111111"];
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CAPS = { wins: 20000, cups: 5000, coins: 20000000 };
  let optTouched = false;

  function storageOf(storage) {
    if (storage) return storage;
    try { if (typeof localStorage !== "undefined") return localStorage; } catch (e) { /* private */ }
    return null;
  }
  function readRaw(storage, key) {
    const box = storageOf(storage);
    try { return box ? box.getItem(key) : null; } catch (e) { return null; }
  }
  function readObj(storage, key) {
    const raw = readRaw(storage, key);
    if (raw == null || raw === "") return null;
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object") return v;
    } catch (e) { /* ignore */ }
    return null;
  }
  function writeObj(storage, key, value) {
    const box = storageOf(storage);
    if (!box) return;
    try { box.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clampStat(kind, n) {
    const cap = CAPS[kind] || CAPS.wins;
    let v = Math.round(Number(n) || 0);
    if (v < 0) v = 0;
    if (v > cap) v = cap;
    return v;
  }
  function nickname(name) {
    let s = String(name || "").replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
    if (!s || s.indexOf("@") >= 0 || /https?:\/\//i.test(s)) return "Player";
    s = s.replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
    if (!s || !/[A-Za-z]/.test(s)) return "Player";
    return s;
  }
  function normalizeColor(c) {
    const v = String(c || "").trim().toLowerCase();
    return COLORS.indexOf(v) >= 0 ? v : COLORS[1];
  }
  function cleanCode(raw) {
    const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    let out = "";
    for (let i = 0; i < s.length && out.length < 8; i++) {
      if (CODE_ALPHABET.indexOf(s.charAt(i)) >= 0) out += s.charAt(i);
    }
    return out;
  }
  function formatCode(code) {
    const c = cleanCode(code);
    if (c.length !== 8) return c;
    return c.slice(0, 4) + "-" + c.slice(4);
  }
  function boardKey(board) {
    if (board === "cups" || board === "coins" || board === "friends") return board;
    return "wins";
  }
  function readOpt(storage) {
    return readRaw(storage, OPT_KEY) === "yes";
  }
  function writeOpt(on, storage) {
    const box = storageOf(storage);
    if (!box) return;
    try {
      if (on) box.setItem(OPT_KEY, "yes");
      else box.removeItem(OPT_KEY);
    } catch (e) { /* private mode */ }
  }
  function loadWins(storage) {
    const raw = readObj(storage, RECORD_KEY);
    return clampStat("wins", raw && raw.wins);
  }
  function cupCount(storage) {
    const book = readObj(storage, "soccerTrophies");
    const wins = book && Array.isArray(book.wins) ? book.wins.length : 0;
    return clampStat("cups", wins);
  }
  function coinsEarned(storage) {
    if (typeof KickoffProgress !== "undefined" && KickoffProgress.loadCoinsEarned) {
      return clampStat("coins", KickoffProgress.loadCoinsEarned(storage));
    }
    const bag = readObj(storage, "soccerCoins") || {};
    const earned = bag.earned != null ? bag.earned : bag.coins;
    return clampStat("coins", earned);
  }
  function localStats(storage) {
    const player = readObj(storage, "soccerPlayer") || {};
    const loose = readRaw(storage, "soccerName") || "";
    return {
      name: nickname(player.name || loose),
      color: normalizeColor(player.color),
      wins: loadWins(storage),
      cups: cupCount(storage),
      coins: coinsEarned(storage),
      show: readOpt(storage),
    };
  }
  function noteWin(storage) {
    const n = clampStat("wins", loadWins(storage) + 1);
    writeObj(storage, RECORD_KEY, { wins: n });
    schedulePush(false);
    return n;
  }
  function statHash(s) {
    return [s.name, s.color, s.wins, s.cups, s.coins, s.show ? 1 : 0].join("|");
  }
  function isMissingRpc(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const msg = String(error.message || error.details || error.hint || "").toLowerCase();
    if (code === "PGRST202" || code === "42883" || code === "PGRST205") return true;
    return msg.indexOf("could not find the function") >= 0 || msg.indexOf("does not exist") >= 0 || msg.indexOf("schema cache") >= 0;
  }
  function gateMessage(kind) {
    if (kind === "offline") return "The leaderboard needs the internet. You can keep playing on this phone.";
    if (kind === "signed-out") return "Sign in from Settings, then Account, to see the leaderboard. You can keep playing with no account.";
    if (kind === "soon") return "The leaderboard is coming soon. You can keep playing.";
    return "";
  }
  function friendMessage(status) {
    if (status === "added") return "Added. This list is just you and your friends.";
    if (status === "already") return "That friend is already on your list.";
    if (status === "missing") return "That code did not match a player. Check it and try again.";
    if (status === "self") return "That is your own code. Share it with a friend.";
    if (status === "full") return "You can add up to 40 friends.";
    if (status === "bad") return "Type the 8 character code.";
    if (status === "need-save") return "Open this screen once, then try the code again.";
    if (status === "signed-out") return gateMessage("signed-out");
    if (status === "removed") return "Removed from your friends.";
    return "That did not work. Try again in a moment.";
  }
  function rowsOf(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") return [data];
    return [];
  }
  function prepareRows(rows) {
    return (rows || []).slice(0, 51).map(function (r) {
      r = r || {};
      return {
        rank: Math.max(0, Math.round(Number(r.rank) || 0)),
        name: nickname(r.display_name || r.name),
        color: normalizeColor(r.favorite_color || r.color),
        wins: clampStat("wins", r.wins),
        cups: clampStat("cups", r.cups),
        coins: clampStat("coins", r.coins_earned != null ? r.coins_earned : r.coins),
        is_me: !!r.is_me,
        code: r.friend_code ? formatCode(r.friend_code) : "",
      };
    });
  }
  function splitTop(rows) {
    const top = [];
    let mine = null;
    (rows || []).forEach(function (r) {
      if (r.rank > 50 && r.is_me) mine = r;
      else top.push(r);
    });
    return { top: top.slice(0, 50), mine: mine };
  }
  function emptyMessage(board) {
    if (board === "friends") return "Add a friend's code to see the two of you here.";
    return "Nobody is on this list yet. Turn on Show me on the leaderboard in Settings, then Account, if you want to appear.";
  }
  function tableHtml(rows, board) {
    const friends = board === "friends";
    let html = "<table class='boardTable'><thead><tr><th></th><th class='who'>Player</th>";
    if (friends) html += "<th>Wins</th><th>Cups</th><th>Coins</th><th></th>";
    else html += "<th>" + (board === "cups" ? "Cups" : board === "coins" ? "Coins" : "Wins") + "</th>";
    html += "</tr></thead><tbody>";
    rows.forEach(function (r) {
      const value = board === "cups" ? r.cups : board === "coins" ? r.coins : r.wins;
      html += "<tr" + (r.is_me ? " class='me'" : "") + "><td>" + (r.rank || "") + "</td>";
      html += "<td class='who'><i class='swatch' style='background:" + r.color + "' aria-label='Favourite colour'></i>" + esc(r.name);
      if (r.is_me) html += " <span class='you'>You</span>";
      html += "</td>";
      if (friends) {
        html += "<td>" + r.wins + "</td><td>" + r.cups + "</td><td>" + r.coins + "</td><td>";
        if (!r.is_me && r.code) html += "<button type='button' data-remove='" + esc(r.code) + "'>Remove</button>";
        html += "</td>";
      } else html += "<td>" + value + "</td>";
      html += "</tr>";
    });
    return html + "</tbody></table>";
  }
  function friendHead(model) {
    const code = model.friendCode ? formatCode(model.friendCode) : "";
    let html = "<p class='note'>Share your code with a friend. Adding their code shows just you and your friends.</p>";
    if (code) {
      html += "<p class='label'>Your friend code</p><p class='friendCode'>" + esc(code) + "</p>";
      html += "<div class='row'><button type='button' id='boardCopy'>Copy code</button></div>";
    } else html += "<p class='note'>Your code shows here once this list has loaded.</p>";
    html += "<form id='boardAddForm' class='stackForm'><label for='friendCodeInput'>Friend's code</label>";
    html += "<input id='friendCodeInput' maxlength='12' autocomplete='off' autocapitalize='characters' placeholder='H4WK-9R2M' aria-label=\"Friend's code\">";
    html += "<button type='submit'>Add friend</button></form>";
    html += "<p class='boardNote'>" + esc(model.friendNote || "") + "</p>";
    return html;
  }
  function renderModel(model) {
    model = model || {};
    const board = boardKey(model.board);
    if (model.gate) return "<p class='boardNote'>" + esc(model.gate) + "</p>";
    let html = "";
    if (model.sample) html += "<p class='note'>Sample scores, so you can see the board.</p>";
    if (board === "friends") html += friendHead(model);
    else html += "<p class='note'>Top 50 players who turned the leaderboard on. Your row is highlighted.</p>";
    const split = splitTop(prepareRows(model.rows));
    if (!split.top.length && !split.mine) html += "<p class='boardNote'>" + esc(emptyMessage(board)) + "</p>";
    else {
      if (split.top.length) html += tableHtml(split.top, board);
      if (split.mine) {
        html += "<p class='note'>Your place is outside the top 50.</p>";
        html += tableHtml([split.mine], board);
      }
    }
    if (model.signedIn && model.optIn === false && board !== "friends") {
      html += "<p class='note'>You are hidden. Turn on Show me on the leaderboard in Settings, then Account, if you want to appear.</p>";
    }
    return html;
  }
  function accountHtml(signedIn, on) {
    const disabled = signedIn ? "" : " disabled";
    const checked = signedIn && on ? " checked" : "";
    let html = "<label class='boardOpt' for='boardOptIn'><input id='boardOptIn' type='checkbox'" + checked + disabled + "> ";
    html += "<span>Show me on the leaderboard</span></label>";
    html += signedIn
      ? "<p class='note'>Off unless you turn it on. People see your player name and favourite colour, not your email.</p>"
      : "<p class='note'>Sign in with a parent email to choose this. It stays off until you turn it on.</p>";
    return html;
  }

  const ui = {
    board: "wins",
    rows: [],
    gate: "",
    friendCode: "",
    friendNote: "",
    signedIn: false,
    optIn: false,
    sample: false,
    loading: false,
    sent: "",
    missing: false,
    force: false,
  };
  let pushTimer = 0;

  function offlineNow() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }
  function withClient(fn) {
    if (typeof CloudAccount === "undefined" || !CloudAccount || !CloudAccount.sharedClient) return Promise.resolve(null);
    return Promise.resolve(CloudAccount.sharedClient()).then(function (client) {
      if (!client || !client.auth || !client.auth.getSession) return null;
      return client.auth.getSession().then(function (res) {
        const session = res && res.data && res.data.session;
        return fn(client, session || null);
      });
    });
  }
  function schedulePush(now) {
    if (typeof document === "undefined" || ui.missing) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = 0;
      if (offlineNow()) return;
      withClient(function (client, session) {
        if (!client || !session) return null;
        return pushStats(client, localStats());
      }).catch(function () { /* keep playing */ });
    }, now ? 40 : 1500);
  }
  function pushStats(client, stats) {
    stats = stats || localStats();
    const hash = statHash(stats);
    if (!ui.force && hash === ui.sent) return Promise.resolve();
    ui.force = false;
    return client.rpc("save_my_leaderboard", {
      p_name: stats.name,
      p_color: stats.color,
      p_wins: stats.wins,
      p_cups: stats.cups,
      p_coins: stats.coins,
      p_show: !!stats.show,
    }).then(function (res) {
      if (res && res.error) {
        if (isMissingRpc(res.error)) ui.missing = true;
        return;
      }
      ui.sent = hash;
      const row = rowsOf(res && res.data)[0];
      if (row && row.friend_code) ui.friendCode = row.friend_code;
      if (row && !optTouched) {
        writeOpt(!!row.show_on_board);
        ui.optIn = !!row.show_on_board;
      }
    });
  }
  function applyMine(row) {
    if (!row) return;
    if (row.friend_code) ui.friendCode = row.friend_code;
    if (!optTouched) {
      writeOpt(!!row.show_on_board);
      ui.optIn = !!row.show_on_board;
      syncCheckbox();
    }
  }
  function loadTop(client, board) {
    return client.rpc("leaderboard_top", { p_board: board }).then(function (res) {
      ui.loading = false;
      if (res.error && isMissingRpc(res.error)) {
        ui.missing = true;
        ui.rows = [];
        ui.gate = gateMessage("soon");
        paint();
        return null;
      }
      if (res.error) {
        ui.rows = [];
        ui.gate = "The leaderboard did not load. You can keep playing.";
        paint();
        return null;
      }
      ui.gate = "";
      ui.rows = rowsOf(res.data);
      paint();
      return client.rpc("my_leaderboard").then(function (mine) {
        if (mine && !mine.error) applyMine(rowsOf(mine.data)[0]);
        if (ui.board === "friends") paint();
      });
    });
  }
  function loadFriends(client) {
    return client.rpc("leaderboard_friends").then(function (res) {
      ui.loading = false;
      if (res.error && isMissingRpc(res.error)) {
        ui.missing = true;
        ui.rows = [];
        ui.gate = gateMessage("soon");
        paint();
        return;
      }
      if (res.error) {
        ui.rows = [];
        ui.gate = "The leaderboard did not load. You can keep playing.";
        paint();
        return;
      }
      ui.gate = "";
      ui.rows = rowsOf(res.data);
      const mine = ui.rows.filter(function (r) { return r && r.is_me; })[0];
      applyMine(mine);
      paint();
    });
  }
  function loadBoard() {
    const stats = localStats();
    ui.optIn = stats.show;
    ui.sample = false;
    if (offlineNow()) {
      ui.loading = false;
      ui.signedIn = false;
      ui.rows = [];
      ui.gate = gateMessage("offline");
      paint();
      return;
    }
    ui.loading = true;
    ui.gate = "";
    paint();
    withClient(function (client, session) {
      if (!client || !session) {
        ui.loading = false;
        ui.signedIn = false;
        ui.rows = [];
        ui.friendCode = "";
        ui.gate = gateMessage("signed-out");
        paint();
        return null;
      }
      ui.signedIn = true;
      ui.force = true;
      return pushStats(client, stats).then(function () {
        if (ui.missing) {
          ui.loading = false;
          ui.rows = [];
          ui.gate = gateMessage("soon");
          paint();
          return null;
        }
        if (ui.board === "friends") return loadFriends(client);
        return loadTop(client, ui.board);
      });
    }).catch(function () {
      ui.loading = false;
      ui.rows = [];
      ui.gate = gateMessage("offline");
      paint();
    });
  }
  function friendAct(kind, code) {
    const cleaned = cleanCode(code);
    if (ui.sample) {
      ui.friendNote = "This sample list is not saved. Sign in to add a real friend.";
      paint();
      return;
    }
    if (cleaned.length !== 8) {
      ui.friendNote = friendMessage("bad");
      paint();
      return;
    }
    if (offlineNow()) {
      ui.friendNote = gateMessage("offline");
      paint();
      return;
    }
    withClient(function (client, session) {
      if (!client || !session) {
        ui.friendNote = gateMessage("signed-out");
        paint();
        return null;
      }
      const rpc = kind === "remove" ? "remove_friend" : "add_friend";
      return client.rpc(rpc, { p_code: cleaned }).then(function (res) {
        if (res.error && isMissingRpc(res.error)) {
          ui.gate = gateMessage("soon");
          ui.rows = [];
          paint();
          return null;
        }
        if (res.error) {
          ui.friendNote = friendMessage("");
          paint();
          return null;
        }
        ui.friendNote = friendMessage(String(res.data || ""));
        paint();
        return loadFriends(client);
      });
    }).catch(function () {
      ui.friendNote = gateMessage("offline");
      paint();
    });
  }
  function copyCode() {
    const code = formatCode(ui.friendCode);
    if (!code) return;
    const done = function (ok) {
      ui.friendNote = ok ? "Copied. You can read it to a friend." : "Read this code to a friend.";
      paint();
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () { done(true); }, function () { done(false); });
        return;
      }
    } catch (e) { /* fall through */ }
    done(false);
  }
  function previewHost() {
    try {
      const host = location.hostname;
      return host === "localhost" || host === "127.0.0.1";
    } catch (e) { return false; }
  }
  function sampleRows() {
    return [
      { rank: 1, display_name: "Kit Fox", favorite_color: "#d62828", wins: 18, cups: 3, coins_earned: 420, is_me: false, friend_code: "M3QX7K4W" },
      { rank: 2, display_name: "Mina P", favorite_color: "#e6b325", wins: 12, cups: 1, coins_earned: 260, is_me: true, friend_code: "K7MP2QX4" },
      { rank: 3, display_name: "Jo 7", favorite_color: "#1f5fd6", wins: 9, cups: 0, coins_earned: 140, is_me: false, friend_code: "H4WK9R2M" },
      { rank: 4, display_name: "Sam K", favorite_color: "#0b6e4f", wins: 4, cups: 2, coins_earned: 80, is_me: false, friend_code: "Q8NP3V7L" },
    ];
  }
  function openPreview() {
    if (!previewHost()) return;
    ui.sample = true;
    ui.loading = false;
    ui.signedIn = true;
    ui.optIn = true;
    ui.gate = "";
    ui.friendNote = "";
    ui.friendCode = "K7MP2QX4";
    ui.rows = sampleRows();
    ui.board = ui.board || "wins";
    showBoard();
    paint();
  }

  root.KickoffLeaderboard = {
    COLORS: COLORS,
    clampStat: clampStat,
    nickname: nickname,
    normalizeColor: normalizeColor,
    cleanCode: cleanCode,
    formatCode: formatCode,
    localStats: localStats,
    noteWin: noteWin,
    readOpt: readOpt,
    writeOpt: writeOpt,
    isMissingRpc: isMissingRpc,
    gateMessage: gateMessage,
    friendMessage: friendMessage,
    prepareRows: prepareRows,
    splitTop: splitTop,
    renderModel: renderModel,
    accountHtml: accountHtml,
    schedulePush: schedulePush,
    openPreview: openPreview,
    mountAccount: function () {},
  };

  if (typeof document === "undefined") return;

  const style = document.createElement("style");
  style.textContent = ""
    + "#leaderboardScreen .panel { width: min(560px, 94vw); }"
    + "#boardTabs { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; }"
    + "#boardTabs button { margin: 0; }"
    + ".boardTable { width: 100%; border-collapse: collapse; font-size: 15px; margin-top: 8px; }"
    + ".boardTable th, .boardTable td { padding: 6px 4px; text-align: center; border-bottom: 1px solid rgba(255,255,255,.12); }"
    + ".boardTable th.who, .boardTable td.who { text-align: left; }"
    + ".boardTable tr.me { background: rgba(255,211,61,.28); }"
    + ".boardTable .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; margin-right: 6px; vertical-align: -2px; }"
    + ".you { font-size: 12px; font-weight: 800; color: #1a1404; background: #ffe27a; border-radius: 999px; padding: 1px 6px; }"
    + ".friendCode { font: 800 28px/1.2 ui-monospace, monospace; letter-spacing: 2px; color: #ffe27a; margin: 4px 0; }"
    + ".boardNote { font-weight: 700; min-height: 1.2em; }"
    + "#friendCodeInput { font: inherit; font-size: 16px; width: 100%; box-sizing: border-box; min-height: 44px; padding: 8px; border-radius: 8px; border: 1px solid #fff; color: #111; background: #fff; }"
    + "#accountPanel .boardOpt { display: flex; align-items: center; gap: 10px; font-weight: 800; margin: 10px 0 4px; }"
    + "#accountPanel .boardOpt input { width: 22px; height: 22px; min-height: 22px; flex: 0 0 auto; }";
  document.head.appendChild(style);

  function paint() {
    const body = document.getElementById("boardBody");
    if (!body) return;
    document.querySelectorAll("#boardTabs button").forEach(function (b) {
      const on = b.dataset.board === ui.board;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (ui.loading) {
      body.innerHTML = "<p class='boardNote'>Loading the board…</p>";
      return;
    }
    body.innerHTML = renderModel({
      board: ui.board,
      rows: ui.rows,
      gate: ui.gate,
      friendCode: ui.friendCode,
      friendNote: ui.friendNote,
      signedIn: ui.signedIn,
      optIn: ui.optIn,
      sample: ui.sample,
    });
  }
  function showBoard() {
    if (typeof showScreen === "function") showScreen("leaderboardScreen");
  }
  function syncCheckbox() {
    const input = document.getElementById("boardOptIn");
    if (!input || input.disabled || optTouched) return;
    input.checked = readOpt();
  }
  function mountAccount(box, info) {
    if (!box) return;
    const old = document.getElementById("boardOptWrap");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const wrap = document.createElement("div");
    wrap.id = "boardOptWrap";
    const signedIn = !!(info && info.signedIn);
    wrap.innerHTML = accountHtml(signedIn, signedIn && readOpt());
    const status = box.querySelector("#accountStatus");
    if (status) box.insertBefore(wrap, status);
    else box.appendChild(wrap);
    const input = document.getElementById("boardOptIn");
    if (input && signedIn) {
      input.addEventListener("change", function () {
        optTouched = true;
        writeOpt(input.checked);
        ui.optIn = input.checked;
        ui.force = true;
        schedulePush(true);
      });
    }
  }
  root.KickoffLeaderboard.mountAccount = mountAccount;
  root.KickoffLeaderboard.paint = paint;

  const menu = document.getElementById("menu");
  const extra = document.getElementById("extraMenu");
  if (menu && extra && !document.getElementById("boardBtn")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "boardBtn";
    btn.textContent = "Leaderboard";
    extra.appendChild(btn);
    btn.addEventListener("click", function () {
      ui.board = "wins";
      ui.friendNote = "";
      showBoard();
      if (previewHost() && /(?:\?|&)boardPreview=1(?:&|$)/.test(location.search || "")) openPreview();
      else loadBoard();
    });
  }
  if (menu && !document.getElementById("leaderboardScreen")) {
    const el = document.createElement("div");
    el.id = "leaderboardScreen";
    el.className = "overlay hidden";
    el.innerHTML = "<div class='panel'><h1 style='font-size:28px'>Leaderboard</h1>"
      + "<div class='row' id='boardTabs' role='tablist' aria-label='Leaderboard'>"
      + "<button type='button' data-board='wins' role='tab'>Wins</button>"
      + "<button type='button' data-board='cups' role='tab'>Cup trophies</button>"
      + "<button type='button' data-board='coins' role='tab'>Coins earned</button>"
      + "<button type='button' data-board='friends' role='tab'>Friends</button>"
      + "</div><div id='boardBody'></div>"
      + "<div class='row'><button type='button' id='boardRefresh'>Refresh</button> <button type='button' id='boardBack'>Back</button></div></div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t || !el.contains(t)) return;
      if (t.id === "boardBack") {
        if (typeof goToMenu === "function") goToMenu();
        else if (typeof showScreen === "function") showScreen("menu");
        return;
      }
      if (t.id === "boardRefresh") {
        if (ui.sample) openPreview();
        else loadBoard();
        return;
      }
      if (t.id === "boardCopy") { copyCode(); return; }
      if (t.dataset && t.dataset.remove) { friendAct("remove", t.dataset.remove); return; }
      if (t.dataset && t.dataset.board) {
        ui.board = boardKey(t.dataset.board);
        ui.friendNote = "";
        if (ui.sample) paint();
        else loadBoard();
      }
    });
    el.addEventListener("submit", function (e) {
      const form = e.target;
      if (!form || form.id !== "boardAddForm") return;
      e.preventDefault();
      const input = document.getElementById("friendCodeInput");
      friendAct("add", input ? input.value : "");
    });
  }

  setInterval(function () {
    if (ui.missing || offlineNow()) return;
    const stats = localStats();
    if (statHash(stats) === ui.sent) return;
    schedulePush(false);
  }, 8000);

  if (previewHost() && /(?:\?|&)boardPreview=1(?:&|$)/.test(location.search || "")) {
    setTimeout(openPreview, 300);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
