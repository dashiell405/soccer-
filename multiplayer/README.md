# Stadium Soccer ⚽ (Soccer Showdown 2 – Online)

The free website is **https://dashiell405.github.io/soccer-/**. Friends can play online from that page with a room code. No account, and nobody has to run this folder. How to turn GitHub Pages on is in the README at the top of the repository.

This folder is an **optional** home Wi-Fi server (a computer on the same network runs `npm start`). The website itself does not use it. On the website, the host's browser runs the match and the devices talk directly.

Play soccer on **2 or 4 different devices** (phones, tablets or computers) at the same time!

- **1 vs 1:** 2 players, one on Blue and one on Red.
- **2 vs 2:** 4 players, two on each team.
- The computer plays the goalies and everyone else. First to **5 goals** wins.
- The host picks the **teams** (16 countries / made-up teams), **offside** and **cards** on/off, and **Match** or **Penalty shootout**.

**New in version 1.2:** penalties, yellow and red cards, offside, team picker with home/away kits, skill moves, goal celebrations, and online penalty shootouts. The offline game (Offline vs Computer, or `soccer.html`) also has a **Cup** mode (8-team knockout with a trophy) and a **Penalty shootout** mode.

One computer runs a small **server** program. Everybody else just opens a web page.

---

## 📱 Make it an app on your iPhone or Mac

Stadium Soccer is a **Home Screen app** (a "PWA"). Once it's hosted on an **https://** address (see "Put it online" below), you can add it like an app:

- **iPhone / iPad:**
  1. Open the link in **Safari**.
  2. Tap the **Share** button (the square with an arrow).
  3. Tap **Add to Home Screen**, then **Add**.
  4. Open it from the green soccer-ball icon. It runs full screen, sideways.
- **Mac:**
  1. Open the link in **Safari**.
  2. Click **File → Add to Dock**, then **Add**.

**Offline vs Computer** works even with no internet, once you've opened the app one time while online. That mode plays 1 player vs the computer, or 2 players on one keyboard.

**Online rooms in this folder** need the server to be running. The GitHub Pages site does not: friends use a room code and the host's device runs the game.

**Tip:** Over plain `http://` (like `http://192.168.x.x:3000` on your Wi-Fi), you can still add it to the Home Screen. But the no-internet part only works over **https://** — that's a rule of Safari.

## 1. Install Node.js (only once)

You need Node.js on the computer that will run the server.

1. Go to **https://nodejs.org**.
2. Download the **LTS** version (the big green button).
3. Run the installer and click *Next* until it finishes. The normal settings are fine.

To check it worked, open a terminal and type `node -v`. You should see a number like `v22.x.x`.

- **Windows:** open the Start menu and type **cmd**, or **PowerShell**.
- **Mac:** press `Cmd + Space`, type **Terminal**, then press Enter.

## 2. Start the server

1. Unzip `soccer-multiplayer.zip` somewhere easy, like your Desktop.
2. Open a terminal **in that folder**:
   - **Windows:** open the unzipped `multiplayer` folder in File Explorer. Click the address bar, type `cmd`, and press Enter.
   - **Mac:** in Terminal, type `cd `, with a space after it. Drag the `multiplayer` folder into the Terminal window, then press Enter.
3. Type these two commands:

```
npm install
npm start
```

`npm install` downloads the one helper library the game needs (`ws`). You only need to run it the first time.

`npm start` prints something like:

```
 On THIS computer open:   http://localhost:3000
 On phones / other computers on the same Wi-Fi open:
      http://192.168.1.23:3000
```

Keep the terminal window open while you play. To stop the server, press `Ctrl + C`.

### ⚠️ Firewall pop-up

The first time, **Windows** or **Mac** may ask if Node.js can accept network connections. Click **Allow**.

On Windows, tick **Private networks**. If you clicked "Cancel" by mistake, other devices won't be able to connect.

- **Windows:** open *Windows Security → Firewall → Allow an app*, then tick Node.js.
- **Mac:** open *System Settings → Network → Firewall → Options*.

### 📶 Everyone must be on the same Wi-Fi

Phones using mobile data (4G/5G) can't reach your computer. Turn on Wi-Fi and join the **same network** as the server computer.

## 3. Play!

1. Everyone opens the `http://192.168.x.x:3000` address that the server printed. On the server computer, `http://localhost:3000` also works.
2. Everyone types their name.
3. One person picks **1 vs 1** or **2 vs 2** and the computer level, then presses **Create room**. They get a 4-letter **room code**, like `SZKH`.
4. Everybody else types the code and presses **Join**. You can also send them the "Copy link" link.
5. In the lobby, click **Join** under a team to switch sides.
6. The host (the person who made the room) picks the two teams, the rules (offside, fouls and cards) and **Match** or **Penalty shootout**. If both teams' shirts look alike, the right-hand team wears its **away kit**.
7. The host presses **Start match**. If someone is missing, the computer plays for them.
8. After the match, the host can press **Rematch**, or **Back to lobby** to change teams.

**In 2 vs 2,** you control whichever of your team's players is closest to the ball. Your teammate controls a different one, never the same one.

**Name labels:** every human player has their name above them. Yours is **yellow**, with a yellow ring.

**Ping:** the number in the top-right corner is your ping. Green means fast, yellow is okay, and red means slow Wi-Fi.

**If someone's connection drops,** the computer plays for them right away. To come back, they open the page again and join the same code **with the same name**.

## Controls

| Action | Keyboard | Phone / tablet |
|---|---|---|
| Move | W A S D or arrow keys | Left joystick (drag anywhere on the left side) |
| Sprint | Shift (uses stamina) | RUN |
| Shoot | Space: hold to power up, let go to shoot | SHOOT (hold) |
| Slide tackle | Space when you don't have the ball | SHOOT |
| Pass | E: tap for a ground pass, hold for a lob | PASS |
| Switch player | Q, or E without the ball | PASS without the ball |
| Skill move | R (push sideways = roulette spin, pull back = rainbow flick, hold Shift = knock-on burst, otherwise step-over) | SKILL |
| Rainbow flick | F | SKILL while pulling the joystick back |
| Take a penalty | up/down = aim, hold Space = power (too much = over the bar!) | joystick up/down, hold SHOOT |
| Save a penalty | press up or down to pick your dive (left/right = stay in the middle) | joystick up/down |
| Skip a goal celebration | any key | tap |
| Sound on/off | M | Menu → Sound |
| Menu | Esc or P | Menu button |

Online games don't pause, because everyone else keeps playing.

**Offline with 2 players on one keyboard:** Player 1 uses W A S D, Left Shift, Space, E, Q, **R** (skill) and **F** (flick). Player 2 uses the arrow keys, `/` (sprint), Enter (shoot), Right Shift (pass), `.` (switch), **'** (skill) and **;** (flick).

## Rules

- **Fouls and cards:** a slide that hits the player instead of the ball is a foul. A slide from behind, or a player's third foul, gets a **yellow card**. A second yellow, or a really bad foul (stopping a clear run at goal as the last defender), is a **red card**: the player is sent off and the team plays with one player less.
- **Penalty:** a foul inside your own penalty box gives the other team a penalty kick.
- **Offside:** if you are in the other team's half, past their second-to-last defender and past the ball when a teammate passes, it's offside. The assistant referee raises the flag and the other team gets an *indirect* free kick (a goal can't be scored straight from it). There is no offside from throw-ins, corners or goal kicks.
- You can switch offside and cards off in the menu (offline) or the lobby (online).

## What works online, and what's offline only

| Feature | Offline (`soccer.html` / Offline vs Computer) | Online rooms |
|---|---|---|
| Penalties, cards, offside, indirect free kicks | ✅ | ✅ (the host can switch offside / cards off) |
| Team picker with home / away kits | ✅ (16 teams + your own custom team) | ✅ (16 teams, the host picks; no custom team) |
| Skill moves, goal celebrations, confetti | ✅ | ✅ |
| Penalty shootout mode | ✅ 1 player vs CPU or 2 players on one device | ✅ (the host chooses "Penalty shootout") |
| Cup mode (8-team knockout, bracket, trophy) | ✅ (saved on the device) | ❌ offline only |

## Put it online (play from different houses + Home Screen app)

**Ask a parent or guardian first.** Each option needs an account on a website, and they decide about accounts. Nothing has been put online for you.

### ⭐ Best free option: Render (permanent link)

You need a free **GitHub** account and a free **Render** account (sign in to Render *with GitHub*). Render normally doesn't ask for a card on the free plan, but sometimes it asks for one to check for fraud.

The settings are already in this folder (`render.yaml`), so it's mostly clicking.

1. On github.com, make a new repository, e.g. `stadium-soccer`. Upload **everything inside this `multiplayer` folder** to it. `render.yaml` and `package.json` must be at the top level. Do not upload `node_modules`.
2. On render.com, click **New → Blueprint** and pick your repository. Then click **Apply**.
3. After a few minutes you get a permanent link like `https://stadium-soccer.onrender.com`. Open it in Safari and add it to your Home Screen.

**Free-plan catches:**
- When nobody has played for 15 minutes, it goes to sleep. The next visit takes about **1 minute** to wake up, so wait on the loading page.
- There's a monthly data limit. One hour of 4-player online play is roughly 0.3 GB.
- The offline mode doesn't use any data.

### Other choices

| Service | Account needed | Card? | Notes |
|---|---|---|---|
| **Railway** (railway.com) | Railway (sign in with GitHub) | No | $5 free trial credit, then $1/month free credit. Uses `railway.json`. |
| **Fly.io** | Fly.io | **Yes** | No free plan for new users anymore. Uses `fly.toml` + `Dockerfile`. |
| **Koyeb** | Koyeb | **Yes** (temporary hold) | One free service. Use the `Dockerfile`. |

### Quick temporary link from a computer running the server (Cloudflare, no account)

1. On a computer that has Node.js and is running `npm start`, install `cloudflared` from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. In a second terminal, run:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
3. It prints a random `https://….trycloudflare.com` link.

That link stops working when you close the terminal, and you get a new one every time. So it's fine for one evening, but no good for a Home Screen icon.

## For curious coders 🧑‍💻

| File | What it is |
|---|---|
| `server.js` | The server. It runs the real game 60 times a second and sends everybody the positions 30 times a second. Each device only sends which buttons are pressed. This is called *server-authoritative*: no one can cheat, and everyone sees the same game. |
| `public/game.js` | The rules, physics and computer AI, shared with the offline game. It's a copy of `../src/sim.js`. |
| `public/client.js` | Runs in the browser: lobby, controls, drawing, sound. It smoothly blends between server updates (100 ms behind) so movement isn't jumpy. |
| `public/index.html` | The online page: home screen, lobby, buttons. |
| `public/offline.html` | The single-device game used by "Offline vs Computer". It's made from `../soccer.html` by `tools/build_offline.py`. |
| `../src/` + `../build.py` | **The source files.** `sim.js` (game logic), `sound.js`, `render.js` (drawing) and `offline_shell.js` (menus, Cup, shootout) are shared, so each feature is only written once. Run `python3 build.py` in the folder above to rebuild `soccer.html`, `public/game.js`, `public/client.js`, `public/offline.html`, and the GitHub Pages files at the repository root (`index.html`, `sw.js`, `manifest.webmanifest`, `icons/`). |
| `public/manifest.webmanifest` | Tells phones the app's name, icon, colours and to open sideways. |
| `public/sw.js` | The service worker. It saves the app on the device so it opens without internet. Change `VERSION` when you add files. |
| `public/pwa.js` | Registers the service worker, and stops pinch-zoom and bouncing. |
| `public/icons/` | App icons, drawn by `tools/make_icons.py`. |
| `render.yaml`, `railway.json`, `fly.toml`, `Dockerfile` | Ready-made settings for the hosting sites. |
| `tests/multiplayer_test.js`, `tests/pwa_test.js` | Automatic tests. One opens 2 and then 4 fake browsers; the other checks the app, the icons and offline mode. They need `playwright-core` and Chrome. |
| `tests/sim_test.js`, `tests/offline_features_test.js`, `tests/online_features_test.js` | Tests for penalties, cards, offside, the team picker, the cup, shootouts, skill moves and celebrations. `sim_test.js` only needs Node. |

**Debug mode:** run `npm run debug`, or set `DEBUG=1`. This adds `/debug/rooms` and test commands for autoplay, speed-up, forcing goals, fouls, cards, offside, skill moves and shootouts. Don't use it for real games.

**Change the port:** run `PORT=8080 npm start` on Mac, or `set PORT=8080 && npm start` on Windows cmd.

The offline single-file version (`soccer.html`, one computer only) still works by itself. Just double-click it.
