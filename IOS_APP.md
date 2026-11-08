# Put Kickoff on your iPhone

This builds the game as an iPhone app. The website stays the same:

**https://dashiell405.github.io/soccer-/**

The app does not open that website. The game files are copied into the app, so a match on one phone still works with no internet.

You need the Mac for this. The iPhone is only for playing.

## 1. Install Xcode

1. On the Mac, open the **App Store**.
2. Search for **Xcode**.
3. Click **Get**, then **Install**. It is a very big download.
4. Open **Xcode** once. If it asks to install extra pieces, click **Install** and wait.
5. Open **Terminal** (search for Terminal in Spotlight). Paste this and press Return:

```bash
xcode-select --install
```

6. If a window pops up, click **Install**. If it says the tools are already installed, that is fine.

Kickoff uses Capacitor 8. That needs **Xcode 26** or newer. The App Store installs the current Xcode.

## 2. Install Node

1. On the Mac, open **https://nodejs.org**
2. Download the **LTS** installer (the big green button). It must be Node **22** or newer.
3. Open the downloaded file and click through the installer.
4. Quit Terminal if it is open, then open Terminal again.
5. Paste this and press Return:

```bash
node --version
```

You should see `v22` or a higher number. If the command is not found, restart the Mac and try again.

## 3. Get the game folder

If you already have the `soccer-` folder on the Mac, skip the clone. In Terminal, `cd` into that folder.

If you do not have it yet, paste this:

```bash
git clone https://github.com/dashiell405/soccer-.git
cd soccer-
```

The folder name ends with a hyphen: `soccer-`

## 4. Copy the game into the iPhone project

Paste these two lines, one at a time. Wait for each one to finish.

```bash
npm install
npm run ios:sync
```

`npm install` downloads the app tools. It only happens on this Mac. It does not change the website.

`npm run ios:sync` copies the game into `www/`, then into the iPhone project at `ios/App/App/public`.

When you change the game later, run `python3 build.py` and then `npm run ios:sync` again.

## 5. Open the project

Paste this:

```bash
npm run ios:open
```

Xcode opens. The first time, the top of the window may say it is resolving packages. That is Xcode downloading pieces. Leave it on Wi-Fi until that finishes.

If the command cannot find Xcode, open Finder, go into the `soccer-` folder, then `ios`, then `App`, and double-click **App.xcodeproj**.

## 6. Try it in the simulator

This does not need the iPhone plugged in.

1. At the top of Xcode, next to the play button, click the device name.
2. Pick an **iPhone** simulator.
3. Press the **play** triangle (or press Command-R).
4. The Kickoff splash appears, then the game. Turn the simulator sideways with the **Device → Rotate** menu. Upright still works too.

## 7. Run it on your iPhone (free Apple ID)

A free Apple ID is enough to play on your own phone. It is not enough for the App Store. The app expires after about 7 days. Run it from Xcode again when it expires.

1. Plug the iPhone into the Mac with a cable.
2. On the iPhone, tap **Trust**, then enter the phone passcode.
3. On the Mac, open **Xcode → Settings → Accounts**.
4. Click **+**, choose **Apple ID**, and sign in.
5. In the left file list, click the blue **App** icon at the top.
6. Click the **App** target. Open **Signing & Capabilities**.
7. Tick **Automatically manage signing**.
8. Set **Team** to your name with **(Personal Team)** after it.
9. At the top of Xcode, pick your real iPhone, not a simulator.
10. Press the **play** triangle.
11. If the iPhone says **Untrusted Developer**: open **Settings → General → VPN & Device Management**, tap the Apple ID, and tap **Trust**.

If Xcode says the bundle id is already used, change it before pressing play again. See the next section. Use the same new id in both places.

## 8. Where the name and the bundle id live

The name under the icon is **Kickoff**.

The placeholder bundle id is **`com.dashiellgreen.kickoff`**. Change it before the first App Store upload. Pick something you own, like `com.yourfamily.kickoff`. It cannot have spaces.

Change it in **both** places, then run `npm run ios:sync` again:

1. **`capacitor.config.json`** in the project folder. The line is `"appId": "com.dashiellgreen.kickoff"`.
2. **Xcode → App target → Signing & Capabilities → Bundle Identifier.**

The display name is `"appName": "Kickoff"` in that same config file, and **CFBundleDisplayName** in `ios/App/App/Info.plist`.

## 9. What a parent does later for the App Store

Playing on your own phone does not need a paid account. Selling or giving the app to other people through the App Store does.

1. Enroll in the **Apple Developer Program** at **https://developer.apple.com/programs/** . It costs money each year and an adult has to agree.
2. In Xcode, Signing & Capabilities, set **Team** to that paid team. Keep **Automatically manage signing** on.
3. Change the bundle id first if `com.dashiellgreen.kickoff` is still the placeholder. Do this before the first upload. After Apple accepts an upload, the bundle id is stuck.
4. In Xcode choose **Product → Archive**. Wait until it finishes.
5. Open **Window → Organizer**. Select the archive. Click **Distribute App → App Store Connect → Upload**.
6. On **https://appstoreconnect.apple.com**, create the app with the **same** bundle id. Add the name Kickoff, screenshots, an age rating, and a privacy questionnaire. The app does not use ads or tracking. Sign-in is optional and only sends the parent email to Supabase.
7. Submit for review when the archive is attached to the version.

The export-compliance question is already answered in the project (`ITSAppUsesNonExemptEncryption` is false). The app only uses normal HTTPS.

## 10. Parent email sign-in inside the app

Settings → Account can email a code to a parent. Type the code in the app. That works without any new Supabase setting.

The email also has a link. To make that link open **Kickoff** instead of the website, a parent adds one redirect URL:

1. Open **https://supabase.com/dashboard/project/vjlibzagprrygmlsvxib/auth/url-configuration**
2. Under **Redirect URLs**, add exactly:

```text
kickoff://login
```

3. Save.

The website addresses should stay allowed too:

```text
https://dashiell405.github.io/soccer-/
https://dashiell405.github.io/soccer-/online.html
```

No secret key goes in the app. The publishable key is already in `src/supabase_config.js`. Do not add a service role key or a secret key.

If `kickoff://login` is not on the list yet, the app still emails a code. The screen tells you to type the code. The link opens the website until the redirect URL is saved.

The app keeps its own saved game. It does not see the game saved in Safari. Sign in with the same parent email on both if you want the same player name and trophies.

## 11. What this computer could not try

A Linux computer can build the project files. It cannot install Xcode, so nobody has yet:

- pressed Play in Xcode
- run Kickoff on a real iPhone or the iPhone Simulator
- felt the buzz on a goal
- finished a parent-email sign-in inside the iOS app
- uploaded to the App Store

Those steps need the Mac.
