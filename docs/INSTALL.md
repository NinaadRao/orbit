# Install and update Orbit

Orbit is a web app that stores everything in your browser. You can run it on your computer, or install it on an iPhone or Android phone so it opens like any other app and works offline.

- [On your computer](#on-your-computer)
- [Get an https address for your phone](#get-an-https-address-for-your-phone) (needed for iPhone and Android)
- [Install on an iPhone](#install-on-an-iphone)
- [Install on Android](#install-on-android)
- [After you install](#after-you-install)
- [Updating later](#updating-later)
- [If something looks wrong](#if-something-looks-wrong)

## On your computer

You need a browser and, optionally, Node 20+.

```sh
node scripts/serve.mjs        # then open http://localhost:8080
```

You can also just open `index.html` from the folder. That works for trying it out, but the offline cache and encrypted backups need `http://localhost` or `https`.

## Get an https address for your phone

A phone can only install and cache the app from an **https** address, so the app files need to be served over https. There are two ways. The first keeps everything private to your own devices, and it is the one to use if you do not want an address anyone else can open.

### Option A: private, only your own devices (Tailscale, free)

Tailscale links your computer and phone into a private network. With `tailscale serve`, the app gets an https address that only devices signed in to your Tailscale account can reach. Nothing is put on the public internet and nothing is uploaded anywhere.

1. Install Tailscale on your computer and on your phone (App Store on iPhone, Google Play on Android) and sign in to the same account on both. The free personal plan is enough.
2. In the Tailscale admin console, under DNS, turn on **MagicDNS** and **HTTPS Certificates**. You do this once.
3. On your computer, start Orbit's server: `node scripts/serve.mjs`. Leave it running.
4. In a second Terminal window run `tailscale serve --bg 8080`. It prints an address like `https://your-computer.your-tailnet.ts.net`. Use `serve`, never `funnel`: Funnel makes the address public. (If the `tailscale` command is not found, the Mac App Store version keeps it inside the app; see Tailscale's docs.)
5. On your phone, with Tailscale switched on, open that address in Safari (iPhone) or Chrome (Android), then follow the install steps below.

After the first load the app is cached on your phone and works without your computer. You only need the computer running and Tailscale connected to install or to pick up an update. If the browser cannot open the address, turn Tailscale off and on, and check Tailscale's docs: some people have reported TLS trouble on iPhone with `ts.net` addresses, and DNS trouble with MagicDNS on some Android versions.

### Option B: a public host (free, but the address is public)

Any static host works, for example Cloudflare Pages or Netlify Drop. The folder holds code and the food list only, so no data of yours is exposed, but anyone who knows the address can load the (empty) app. If you would rather not advertise it, use Option A or pick an unguessable project name. The food list has its own terms; read [data/SOURCES.md](../data/SOURCES.md) before putting it on a public address.

1. Run `npm run site` (or `sh scripts/make-site.sh`). It creates `dist/` with only what a host needs, leaving out tests, docs and `.git`.
2. Put `dist/` online (menu names change now and then):
   - *Cloudflare Pages*: dashboard, Workers & Pages, Create, Pages, **Upload assets**. Name the project, drag in the `dist` folder, Deploy. You get an address like `https://your-name.pages.dev`.
   - *Netlify Drop*: open `app.netlify.com/drop` and drag the `dist` folder onto the page.
3. Open the address on your phone and follow the install steps below.

## Install on an iPhone

1. Open the https address in **Safari** (not another browser or an in-app viewer).
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open Orbit from the Home Screen icon, not from Safari, and do your setup there.

Notes for iPhone:

- The Home Screen app keeps its own copy of your data, separate from Safari. Do your first-run setup in the Home Screen app.
- Safari can erase site data for sites you have not opened in about a week. Home Screen apps are treated more kindly, and Orbit asks the browser to keep its data, but the only real safety net is a backup file.
- Safari cannot keep a link into your photo library, so Orbit asks you to pick a workout photo or video again when you want to watch or use the original. Nothing is copied. See [the user guide](USER_GUIDE.md#library-form-check-and-reel).
- Save backups with **Save or share**, then **Save to Files**. Saving under the same name offers **Replace**.

## Install on Android

1. Open the https address in **Chrome**.
2. Tap the **⋮** menu, then **Install app** (some versions say **Add to Home screen**, then **Install**).
3. Open Orbit from the new icon on your home screen or app drawer, and do your setup there.

Notes for Android:

- Use a current version of Chrome. Other Chromium browsers (Edge, Brave, Samsung Internet) can install it too, with slightly different menu names.
- Orbit only uses standard web features and picks whichever the browser offers, so it should behave the same as on a computer, but it has not been tested on a real Android phone yet. If something does not work, note the phone model and Chrome version when you report it.
- **Backups.** Recent Chrome for Android can let you pick a backup folder once, after which each backup replaces the old file. Android does not allow apps to use a top-level folder such as Downloads itself, so make a folder (for example "Orbit backups") and choose that. If the folder option is missing or fails, Orbit falls back to the share sheet, where you choose Files or Drive, and to a normal download.
- **Workout photos and videos.** Recent Chrome for Android can also link to the original file so it opens without asking again. If the link cannot be made, Orbit uses the normal file picker and you pick the original again. Either way nothing is copied.
- **Time-lapse and reel** are recorded on the phone in real time and saved as MP4. Keep Orbit open on screen until they finish. A browser that cannot record MP4 hides the video option, and you can still save the comparison image.
- Chrome on Android can clear site data when the phone is very short of storage or when you clear browsing data. Installing the app makes that less likely, but keep a backup.

## After you install

- **Set up.** Answer the questions (about four minutes), or tap "I already have a backup or profile file" on the welcome screen to load one.
- **Make your first backup straight away.** On Today, tap the shield icon, then **Back up now**. See [Backing up and restoring](BACKUP.md).
- **Optional:** Coach, then the key icon, to add your AI key. Skip it and everything else still works.

Two things worth knowing:

1. **The address is your data's identity.** Browsers keep data per address, and an installed app keeps its own copy separate from the browser tab. Do your first-run setup in the place you will actually use, or restore a backup into it. If you ever move hosts, make a backup first and restore it at the new address.
2. **Back up more than once.** Browsers can lose site data (cleared history, low storage, a long time unused). A backup file is the safety net.

## Updating later

With Option A, update the files in this folder (for example `git pull`); the server serves them as they are. With Option B, run `npm run site` again and upload the new `dist/` to the same project. Either way your data stays where it is, because it is stored under the same address.

Then close Orbit fully (on iPhone, from the app switcher; on Android, swipe it away from recent apps) and open it twice to pick up the new version.

**Just want a quick look on the same Wi-Fi?** Run `node scripts/serve.mjs --lan` and open `http://<your-computer-ip>:8080` on the phone. Over plain http the app works, but encrypted backups and offline mode are switched off by the browser, so treat it as a preview only.

## If something looks wrong

- *No "Add to Home Screen" on iPhone*: you are not in Safari, or the page is not https.
- *No "Install app" on Android*: the page is not https, or you are not in Chrome. Reload once after the first visit.
- *Old version keeps showing*: close the app fully and open it again, twice.
- *Backup button says it needs a secure page*: the address is http, not https.
