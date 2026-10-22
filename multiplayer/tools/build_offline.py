"""Makes public/offline.html (the single-device game for the app) from ../soccer.html
and adds the Home Screen app bits to public/index.html.  Safe to run again.
Run:  python3 tools/build_offline.py"""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, "..", "public")
SRC = os.path.join(HERE, "..", "..", "soccer.html")   # the standalone offline game

def head_tags(title):
    return f'''<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>{title}</title>
<!-- Home Screen app ("PWA") settings -->
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0c2816">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Soccer">
<meta name="application-name" content="Stadium Soccer">
<meta name="format-detection" content="telephone=no">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">'''

def pwa_css(menu_id):
    return f'''
  /* ---- Home Screen app: no bounce, keep clear of the iPhone notch ---- */
  html, body {{
    position: fixed; inset: 0; width: 100%; overscroll-behavior: none;
    -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%;
  }}
  .overlay {{
    box-sizing: border-box;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }}
  .panel {{ overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }}
  #joyBase   {{ left: calc(20px + env(safe-area-inset-left)); bottom: calc(20px + env(safe-area-inset-bottom)); }}
  #shootBtn  {{ right: calc(18px + env(safe-area-inset-right)); bottom: calc(22px + env(safe-area-inset-bottom)); }}
  #passBtn   {{ right: calc(28px + min(96px, 24vh) + env(safe-area-inset-right)); bottom: calc(14px + env(safe-area-inset-bottom)); }}
  #sprintBtn {{ right: calc(30px + env(safe-area-inset-right)); bottom: calc(34px + min(96px, 24vh) + env(safe-area-inset-bottom)); }}
  #skillBtn  {{ right: calc(40px + min(96px, 24vh) + min(72px, 18vh) + env(safe-area-inset-right)); bottom: calc(18px + env(safe-area-inset-bottom)); }}
  #{menu_id} {{ top: calc(8px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right)); }}
  #rotateHint {{ top: calc(6px + env(safe-area-inset-top)); }}
  a.btnlink {{
    display: inline-block; text-decoration: none; font-size: 16px; padding: 8px 15px; margin: 3px;
    border-radius: 10px; border: 2px solid #fff; background: #245c38; color: #fff;
  }}
  a.btnlink.big {{ font-size: 20px; padding: 10px 28px; background: #1f5fd6; }}
'''

PWA_SCRIPT = '<script src="pwa.js"></script>\n'

def patch_head(s, title, menu_id):
    s = re.sub(r'<meta name="viewport"[^>]*>\n<title>[^<]*</title>\n(<link rel="icon" href="data:,">\n)?', head_tags(title) + "\n", s, count=1)
    s = s.replace("</style>", pwa_css(menu_id) + "</style>", 1)
    return s

# ---------- offline.html ----------
s = open(SRC, encoding="utf-8").read()
assert "<!-- Home Screen app" not in s, "soccer.html should stay the plain standalone file"
s = patch_head(s, "Stadium Soccer - Offline", "pauseBtn")
s = s.replace('<div class="row"><button id="startBtn" class="big">KICK OFF</button></div>',
              '<div class="row"><button id="startBtn" class="big">KICK OFF</button></div>\n'
              '    <div class="row"><a class="btnlink" href="./" id="onlineLink">&#127760; Play online with friends</a></div>', 1)
assert 'id="onlineLink"' in s
s = s.replace('<h1><span class="b">SOCCER</span> <span class="r">SHOWDOWN</span> 2</h1>', '<h1><span class="b">STADIUM</span> <span class="r">SOCCER</span></h1>', 1)
s = s.replace("</body>", PWA_SCRIPT + "</body>", 1)
open(os.path.join(PUB, "offline.html"), "w", encoding="utf-8").write(s)

# ---------- index.html ----------
p = os.path.join(PUB, "index.html")
s = open(p, encoding="utf-8").read()
if "<!-- Home Screen app" not in s:
    s = patch_head(s, "Stadium Soccer", "menuBtn")
    s = s.replace('#pingBox {\n    position: fixed; top: 14px; right: 84px;',
                  '#pingBox {\n    position: fixed; top: calc(14px + env(safe-area-inset-top)); right: calc(84px + env(safe-area-inset-right));', 1)
    s = s.replace('''    <div class="row"><div class="label">Your name</div>''',
                  '''    <div class="box">
      <div class="label">No internet? No problem</div>
      <a id="offlineBtn" class="btnlink big" href="offline.html">Offline vs Computer</a>
      <div class="help">1 player vs the computer, or 2 players on one keyboard &ndash; works without the server</div>
    </div>
    <div class="row"><div class="label">Your name (for online play)</div>''', 1)
    assert 'id="offlineBtn"' in s
    s = s.replace('<h1><span class="b">SOCCER</span> <span class="r">SHOWDOWN</span> 2</h1>', '<h1><span class="b">STADIUM</span> <span class="r">SOCCER</span></h1>', 1)
    s = s.replace('<script src="game.js"></script>', PWA_SCRIPT + '<script src="game.js"></script>', 1)
    open(p, "w", encoding="utf-8").write(s)
print("offline.html + index.html ready")
