# Stadium Soccer

A 5-a-side soccer game you can play in the browser.

- **1 player** against the computer
- **2 players** on the same device
- **Cup** (8-team knockout), **penalty shootout**, and a **team picker**

## Play the game

Open this link on a computer, iPhone, or iPad:

**https://dashiell405.github.io/soccer-/**

Hold a phone sideways. The green **KICK OFF** button starts a match.

**Online play coming soon.** This website does not connect to a server. Friends on other phones are not in this version yet. Everything else works, and after the first visit it also works with no internet.

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
5. Set **Branch** to **main** and the folder to **/ (root)**
6. Click **Save**

Wait about a minute, then open **https://dashiell405.github.io/soccer-/** again.

The repository is **public**, which is what the free GitHub Pages plan needs. Do not delete the empty file named `.nojekyll`. It tells GitHub to show the game (`index.html`) instead of turning this README into the website.

## What the folders are

| File or folder | What it is |
|---|---|
| `index.html` | The game website. This is the page GitHub Pages shows. |
| `manifest.webmanifest`, `sw.js`, `pwa.js`, `icons/` | The Home Screen app pieces (name, icon, and offline saving). |
| `src/` and `build.py` | The source. After you edit those, run `python3 build.py`. |
| `soccer.html` | The same offline game as one file you can double-click. |
| `multiplayer/` | The Node.js server for online play later. See `multiplayer/README.md`. |

Do not commit a `node_modules` folder. If you run the server, `npm install` creates it on your computer only.
