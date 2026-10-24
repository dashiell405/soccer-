# Stadium Soccer

A 5-a-side soccer game you can play in the browser.

- **1 player** against the computer
- **2 players** on the same device
- **Cup** (8-team knockout), **penalty shootout**, and a **team picker**

## Play the game

Open this link on a computer, iPhone, or iPad:

**https://dashiell405.github.io/soccer-/**

Hold a phone sideways. The green **KICK OFF** button starts a match. Every match is **5 minutes**. The team with more goals when the clock hits 0:00 wins. In the Cup, a draw goes to penalties. If you open it upright, a yellow note asks you to turn the phone. You can still play upright.

One player: left thumb on the stick, right thumb on **SHOOT**, **PASS**, **RUN** and **SKILL**. Two players on one phone each get a stick and those four buttons, P1 on the left and P2 on the right. The crowd starts after the first tap (phones block sound until then). Tap the **II** button to pause. You do not need a keyboard.

**Play a friend online.** Tap **Play online**. One person taps **Host a game** and reads the short code (like `K7MP`). Friends tap **Join** and type it. 2 people (1 vs 1) or 4 people (2 vs 2) can play from different phones, iPads and computers. No account, and we don't run a game server.

The host's screen has to stay open, because their device runs the match. If it can't connect, both of you need internet. Some school or shop Wi-Fi blocks this. Try again, or play on one device. After the first visit, the one-device game also works with no internet.

## Add it to your iPhone Home Screen

1. Open the link above in **Safari** (the compass icon). On iPhone, Chrome cannot add this game to the Home Screen.
2. Tap the **Share** button. It is a square with an arrow pointing up.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.

A soccer-ball icon named **Soccer** shows up on your Home Screen. Tap it. The game opens full screen, like an app. Open it once while you have internet. After that it still opens when you are offline.

## Turn GitHub Pages on (only if the link does not work yet)

The game files are already in this repository. Pages is not always switched on. A grown-up who can open the repository settings does this once:

1. Open **https://github.com/dashiell405/soccer-**
2. Click **Settings**
3. Click **Pages** in the left sidebar
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**
5. Set **Branch** to **none** and the folder to **/ (root)**
6. Click **Save**

Wait about a minute, then open **https://dashiell405.github.io/soccer-/** again.

The repository is **public**, which is what the free GitHub Pages plan needs. Do not delete the empty file named `.nojekyll`. It tells GitHub to show the game (`index.html`) instead of turning this README into the website.

## What the folders are

| File or folder | What it is |
|---|---|
| `index.html` | The game website. This is the page GitHub Pages shows. |
| `online.html`, `online.js`, `game.js` | Play with friends. The host's browser runs the match and sends it directly to the other players (WebRTC + PeerJS). |
| `vendor/peerjs.min.js` | A saved copy of PeerJS, used if the CDN is blocked. |
| `manifest.webmanifest`, `sw.js`, `pwa.js`, `icons/` | The Home Screen app pieces (name, icon, and offline saving). |
| `src/` and `build.py` | The source. After you edit those, run `python3 build.py`. |
| `soccer.html` | The same offline game as one file you can double-click. |
| `multiplayer/` | An optional Node.js server for the same game on a home Wi-Fi. The website does not need it. See `multiplayer/README.md`. |

Do not commit a `node_modules` folder. If you run the server, `npm install` creates it on your computer only.
