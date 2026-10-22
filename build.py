#!/usr/bin/env python3
"""
Build script: makes the playable files from the source files in src/.

  src/sim.js              game logic (shared: offline game AND online server)
  src/sound.js            sound effects (shared)
  src/render.js           drawing (shared)
  src/offline_shell.js    offline menus, cup, shootout, keyboard/touch
  src/offline_template.html   HTML + CSS of the offline game
  src/client_head.js, client_net.js, client_tail.js   online client parts

Outputs:
  soccer.html                         single-file offline game
  multiplayer/public/game.js          = src/sim.js  (server + browsers)
  multiplayer/public/client.js        online client
  multiplayer/public/offline.html     (via multiplayer/tools/build_offline.py)
  index.html, sw.js, manifest, icons  GitHub Pages site (via tools/build_pages.py)
                                      offline game only, no WebSocket

Run:  python3 build.py
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
MP = os.path.join(HERE, "multiplayer")

def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()

def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote", os.path.relpath(path, HERE), len(text), "bytes")

banner = lambda title: "\n// " + "=" * 69 + "\n// " + title + "\n// " + "=" * 69 + "\n"

# 1) offline single file
scripts = ('"use strict";\n' + banner("GAME LOGIC (same code as the online server: multiplayer/public/game.js)")
           + read("sim.js") + banner("SOUND") + read("sound.js") + banner("DRAWING") + read("render.js")
           + banner("OFFLINE SHELL") + read("offline_shell.js"))
html = read("offline_template.html").replace("/*__SCRIPTS__*/", scripts)
write(os.path.join(HERE, "soccer.html"), html)

# 2) online files
write(os.path.join(MP, "public", "game.js"), read("sim.js"))
client = read("client_head.js") + "\n" + read("sound.js") + "\n" + read("client_net.js") + "\n" + read("render.js") + "\n" + read("client_tail.js")
write(os.path.join(MP, "public", "client.js"), client)

# 3) offline copy inside the multiplayer project (PWA)
subprocess.check_call([sys.executable, os.path.join(MP, "tools", "build_offline.py")], cwd=MP)

# 4) static GitHub Pages site at the repo root (offline game, no server)
subprocess.check_call([sys.executable, os.path.join(HERE, "tools", "build_pages.py")], cwd=HERE)
