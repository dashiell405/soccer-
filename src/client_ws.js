// =====================================================================
// NETWORK TRANSPORT  -  WebSocket to multiplayer/server.js
// The GitHub Pages game uses src/p2p_net.js instead of this file.
// =====================================================================
let ws = null;
let retryMs = 1500, retryTimer = null;
// Shown on the home screen when the online server can't be reached.
const NO_SERVER_MSG = "Can't reach the online server right now - you can still play Offline vs Computer!";

function netLinkUp() { return !!(ws && ws.readyState === 1); }
function netIsHost() { return false; }
function netReset() { /* the socket stays open so you can join another room */ }
function netMarkLeaving() {}
function netDebug() { return { type: "ws", link: netLinkUp() }; }

function connect() {
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  ws = new WebSocket(proto + location.host + "/ws");
  ws.onopen = () => {
    hideNotice();
    retryMs = 1500;
    if ($("homeMsg").textContent === NO_SERVER_MSG) $("homeMsg").textContent = "";
    if (pendingAction) { sendMsg(pendingAction); pendingAction = null; }
    else if (wantRoom && wantRoom.token) sendMsg({ t: "join", code: wantRoom.code, name: wantRoom.name, token: wantRoom.token });
  };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMessage(m); };
  ws.onclose = () => {
    ws = null;
    if (wantRoom) showNotice("Connection lost. Trying again...", false);
    else if (!$("homeMsg").textContent) $("homeMsg").textContent = NO_SERVER_MSG;
    retryTimer = setTimeout(connect, wantRoom || pendingAction ? 1500 : retryMs);
    retryMs = Math.min(retryMs * 1.5, 8000);
  };
  ws.onerror = () => { /* onclose will handle it */ };
}
function sendMsg(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function sendOrQueue(m) {
  if (ws && ws.readyState === 1) { sendMsg(m); return; }
  pendingAction = m;
  if (!ws) { clearTimeout(retryTimer); connect(); }
}
