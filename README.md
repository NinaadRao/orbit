# Orbit

A private, local-first tracker for lifts, food, body weight, measurements and progress photos, built around a 26-week plan (build, recomp or cut). No account, no server, no analytics. Your data lives in your browser and leaves only when you make a backup file.

- **Plan**: answer a few questions, get calories, macros, a weekly split, week-by-week lift targets (with deloads) and six-month measurement goals.
- **Log**: sets (with effort and rest timer), weigh-ins, measurements, food, and five-angle photos in a weekly check-in on the day you pick (Friday by default).
- **Photo trend**: scrub or play through your weekly check-ins with the weight and measurements of each day under the photo, compare any two dates (side by side, slider or overlay), and save a time-lapse video or a comparison image. Photos stay blurred until you tap.
- **Fuel**: search a database of about 7,800 foods (vegetarian, egg and non-vegetarian, with a filter), describe a meal to your own AI, type raw ingredients, or enter macros by hand. AI results always show an editable confirmation card and nothing is saved until you tap "Looks right".
- **Library and reel**: keep gym photos and clips without copying them (Orbit stores a small preview, your originals stay where you took them), ask your coach about form on a set, and stitch clips and check-in photos into one shareable MP4.
- **Coach**: a chat that runs on *your* model with *your* key. It can suggest changes; you tap Apply; every change has Undo.
- **Backup**: one encrypted file saved on your own device. Orbit never uploads it; where you keep the file afterwards is up to you.

Everything is plain HTML, CSS and JavaScript. There is nothing to build and no runtime dependency.

<p align="center">
  <img src="docs/img/today.png" width="200" alt="Today: the plan, this week and today's workout">
  <img src="docs/img/lifts.png" width="200" alt="Lifts: weekly targets with Hit, Partial and Todo">
  <img src="docs/img/fuel-confirm.png" width="200" alt="Fuel: an AI food estimate you check and edit before it is saved">
</p>
<p align="center">
  <img src="docs/img/progress.png" width="200" alt="Progress: weight trend and measurements against goals">
  <img src="docs/img/coach.png" width="200" alt="Coach: proposed changes need your tap">
  <img src="docs/img/backup.png" width="200" alt="Privacy and backup: one encrypted file, restore from a file">
</p>

<p align="center">
  <img src="docs/img/checkin.png" width="200" alt="Weekly photo check-in: pick a check-in by its date, then add the five angles">
  <img src="docs/img/photo-trend.png" width="200" alt="Photo trend: scrub through check-ins with the numbers of each day under the photo">
  <img src="docs/img/photo-compare.png" width="200" alt="Compare: any two check-ins with a slider, and a button to download the image">
  <img src="docs/img/profile.png" width="200" alt="Profile: your basics, your plan, and the weekly check-in day">
</p>

<p align="center">
  <img src="docs/img/fuel-find.png" width="200" alt="Fuel: search the food database with a Veg, Veg + egg or Non-veg filter">
  <img src="docs/img/library.png" width="200" alt="Library: workout photos and videos kept where you took them, with small previews">
  <img src="docs/img/reel.png" width="200" alt="Make a reel: choose clips and photos, shape and timing">
</p>

<p align="center"><sub>Screenshots use a made-up lifter, stand-in silhouettes and a stand-in AI reply, not real data.</sub></p>

## Run it

You need a browser and, optionally, Node 20+.

```sh
node scripts/serve.mjs        # then open http://localhost:8080
```

You can also just open `index.html` from the folder. That works for trying it out, but the offline cache and encrypted backups need `http://localhost` or `https`.

### On your iPhone

An iPhone can only install and cache the app from an **https** address, so the app files need to be served over https. There are two ways. The first keeps everything private to your own devices, and it is the one to use if you do not want an address anyone else can open.

#### Option A: private, only your own devices (Tailscale, free)

Tailscale links your Mac and iPhone into a private network. With `tailscale serve`, the app gets an https address that only devices signed in to your Tailscale account can reach. Nothing is put on the public internet and nothing is uploaded anywhere.

1. Install Tailscale on your Mac and on your iPhone and sign in to the same account on both (the free personal plan is enough).
2. In the Tailscale admin console, under DNS, turn on **MagicDNS** and **HTTPS Certificates**. You do this once.
3. On your Mac, start Orbit's server: `node scripts/serve.mjs`. Leave it running.
4. In a second Terminal window run `tailscale serve --bg 8080`. It prints an address like `https://your-mac.your-tailnet.ts.net`. Use `serve`, never `funnel`: Funnel makes the address public. (If the `tailscale` command is not found, the Mac App Store version keeps it inside the app; see Tailscale's docs.)
5. On your iPhone, with Tailscale switched on, open that address in Safari.
6. Tap **Share**, then **Add to Home Screen**, then **Add**.
7. Open Orbit from the Home Screen icon, not from Safari, and do your setup there.

After the first load the app is cached on your phone and works without your Mac. You only need the Mac running and Tailscale connected to install or to pick up an update. If Safari cannot open the address, turn Tailscale off and on, and check Tailscale's docs: some people have reported TLS trouble on iPhone with `ts.net` addresses.

#### Option B: a public host (free, but the address is public)

Any static host works, for example Cloudflare Pages or Netlify Drop. The folder holds code only, so no data of yours is exposed, but anyone who knows the address can load the (empty) app. If you would rather not advertise it, use Option A or pick an unguessable project name.

1. Run `npm run site` (or `sh scripts/make-site.sh`). It creates `dist/` with only what a host needs, leaving out tests, docs and `.git`.
2. Put `dist/` online (menu names change now and then):
   - *Cloudflare Pages*: dashboard, Workers & Pages, Create, Pages, **Upload assets**. Name the project, drag in the `dist` folder, Deploy. You get an address like `https://your-name.pages.dev`.
   - *Netlify Drop*: open `app.netlify.com/drop` and drag the `dist` folder onto the page.
3. Open the address in Safari on your iPhone, tap **Share**, then **Add to Home Screen**, then **Add**.
4. Open Orbit from the Home Screen icon and do your setup there.

#### Then, with either option

- **Set up.** Answer the questions (about four minutes), or tap "I already have a backup or profile file" on the welcome screen to load one.
- **Make your first backup straight away.** On Today, tap the shield icon, then **Back up now**, then **Save or share**, then **Save to Files**. See [Backing up and restoring](#backing-up-and-restoring).
- **Optional:** Coach, then the key icon, to add your AI key. Skip it and everything else still works.

**Updating later.** With Option A, update the files in this folder (for example `git pull`); the server serves them as they are. With Option B, run `npm run site` again and upload the new `dist/` to the same project. Either way your data stays where it is, because it is stored under the same address. Close Orbit fully and open it twice to pick up the new version.

**Just want a quick look on the same Wi-Fi?** Run `node scripts/serve.mjs --lan` and open `http://<your-computer-ip>:8080` on the phone. Over plain http the app works, but encrypted backups and offline mode are switched off by the browser, so treat it as a preview only.

If something looks wrong:

- *No "Add to Home Screen" in the share sheet*: you are not in Safari, or the page is not https.
- *Old version keeps showing*: close the app from the app switcher and open it again, twice.
- *Backup button says it needs a secure page*: the address is http, not https.

Two things worth knowing:

1. **The address is your data's identity.** Browsers keep data per address, and the Home Screen app keeps its own copy separate from Safari. Do your first-run setup in the place you will actually use, or restore a backup into it. If you ever move hosts, make a backup first and restore it at the new address.
2. **Safari can erase site data** for sites you have not opened in about a week. Home Screen apps are treated more kindly, and Orbit asks the browser to keep its data, but the only real safety net is a backup file.

## Your photo trend

Take the same five angles at your weekly check-in. The day is yours to set in **Profile** (Friday to begin with); Today asks for it that day, stays on it until all five are saved, and flags any week you missed. Check-ins are named by their date (Fri, 18 Sep), never "week 5": the Photos screen has one list of dates, and the trend, compare and downloads all show dates. Then:

1. Progress, then **Open** on Progress photos, then **See trend** in the Your photo trend card. Pick an angle and drag along the check-in dots, or press play. The weight and measurements from around each photo's date sit under it, and green means the change is toward your goal.
2. **Compare two dates** lets you pick any two check-ins and view them side by side, with a slider, or as an overlay that helps you line up your pose. The table underneath shows the change.
3. **Download time-lapse** makes a short video (Story, Square or Original shape) and **Download image** makes a comparison picture (JPEG or PNG). Both are built on your device. When one is ready, tap **Save or share** and choose Save to Photos or Files.

Two things to know about downloads. The saved file shows your photos **unblurred** and is **not encrypted**, so it is as private as wherever you put it. Orbit says so in each sheet. And a video is recorded in real time, so keep Orbit open on screen until it finishes. Videos are always MP4 (H.264), so they play on any phone or laptop and post to Instagram. A browser that cannot record MP4 hides the video option and you can still save the comparison image.

## The food database

Fuel's **Find** tab searches about 7,800 foods, each with calories, protein, carbs, fat and fibre per 100 g, and asks for the amount in grams. A filter under the search box shows **All**, **Veg**, **Veg + egg** or **Non-veg**; it starts from the diet you gave in Profile and remembers your choice. Type a word or the start of one ("paneer", "chick", "dal"). Many foods also answer to their Indian names.

Where it comes from, and what to watch for:

- About 7,200 rows are from the US **USDA SR Legacy** database (public domain), and about 540 from India's **IFCT 2017** tables (National Institute of Nutrition, Hyderabad). They are bundled as one static file, `data/foods.json`, that the app fetches from its own address. Nothing is looked up online. See `data/SOURCES.md` for the exact packages, licences and how the file is built (`scripts/build-foods.mjs`).
- The vegetarian and non-vegetarian tags are worked out from the food's name and category by rules, and checked by tests, but they are a **filter, not a guarantee**. Cheese is tagged vegetarian even though some is made with animal rennet, and anything unclear (restaurant items, canned soups, branded products) is tagged "check the label" and appears only under All.
- Neither source measures home-cooked Indian dishes, so a plate of rajma chawal is not in it. The short starter list of common dishes is labelled approximate, and the **Describe** and **Ingredients** tabs are for everything else.
- USDA carbohydrates include fibre; IFCT lists available carbohydrate. Orbit shows each as the source gives it.

## Library, form check and reel

Progress, then **Open** on Workout photos and videos. **Add photos or videos** takes any number of them, tagged Workout, Form check, Personal best or Other, with an optional exercise and note.

**Nothing is copied.** Orbit stores only a preview picture (about 15 KB), the date, your tag and note, and the file's name and size. The original stays in Photos or Files, so your phone does not hold everything twice. What that means where:

- **iPhone (Safari or the Home Screen app):** a web app cannot keep a link into your photo library, so to watch an original again, or to use it in a form check or reel, you pick it again. Orbit uses it in memory and lets go. This is the price of not copying it.
- **Chrome or Edge on a computer:** Orbit can keep a real link to each file, so it opens without asking again. If you move or rename the file, the link stops working and you pick it again.

A backup includes the entries and their previews, never the originals. Removing an item from Orbit does not touch the photo or video.

**Ask the coach about form.** Open an item and tap it. For a video Orbit takes six still frames spread across it (one for a photo), shows them to you, and names the provider they will go to. Nothing is sent until you tap Send. They go with your own key, are not saved, and can show your face and surroundings. The coach says what it can see and suggests up to four cues; it cannot judge speed or feel, and it can be wrong. You can save the written review with the item.

**Make a reel.** Choose items from the library, optionally add your weekly check-in photos (already in Orbit), pick Story, Square or Wide, and how long each photo and video part lasts (long videos are trimmed to their middle). Orbit finds the originals (through saved links, or you pick them all at once and it matches them by name and size), then records the reel on your device as an MP4 with a title card, date and tag on each item, and no sound. It is recorded in real time, so keep Orbit open until it finishes. The result exists only until you save or share it. Like the time-lapse, it shows your photos unblurred and is not encrypted.

## Backing up and restoring

A backup is one file, always named `orbit-backup.orbitbackup`, so a new one replaces the old one. It holds your plan, every log and your settings, plus your progress photos if you tick **Include progress photos** (that makes the file much larger). It never holds your AI key.

**Make one**

1. Today, then the shield icon (Privacy and backup).
2. Under Backup, tap **Back up now**.
3. Leave **Encrypt with a passphrase** on and type a passphrase (8 or more characters) twice. A forgotten passphrase cannot be recovered, by design. Decide whether to include progress photos.
4. Tap **Prepare file**, then **Save or share**. On iPhone choose **Save to Files**, then **On My iPhone**. On a computer, Chrome or Edge can use a folder you pick once (see below); other browsers save to Downloads. Orbit only ever writes this file on your device. It does not connect to iCloud, Google Drive or any other service.

**Restore one** (new phone, cleared browser data, moved to a new address, or starting over)

1. Get the file where the device can reach it. On iPhone that means the Files app; on a computer, the folder it was saved to.
2. Open Orbit at the address you want to use. Install it to the Home Screen first if you use it that way, then open it from the icon.
3. On a fresh install the welcome screen shows **I already have a backup or profile file**. Tap it. If Orbit already has data, go to Today, the shield icon, then **Restore from a file**.
4. Pick the `.orbitbackup` file. If it is encrypted, enter the passphrase you chose when you made it.
5. Check the summary (how many entries and photos it holds) and tap **Restore**.

Good to know when restoring:

- Restoring **replaces** what is on the device, so Orbit warns you first when there is already data. If in doubt, make a backup of the current data first.
- A wrong passphrase or a damaged file is refused and nothing changes.
- Keep more than one backup, for example one per month. Each file is a snapshot; restoring an old one takes you back to that day.
- There is a lighter **profile file** (just your answers, no history). It builds a fresh 26-week plan starting today. It is handy for a clean start with the same setup.
- Photos come back only if you included them when you made the backup.
- Your AI key is never in a backup. After restoring, add it again under Coach if you want the AI features.

## Keeping the app if you do not use it every day

- Make a backup every week or two. Orbit nudges you on the Today screen. The steps are above.
- Encrypt backups with a passphrase (the default). Without the passphrase the file cannot be opened by anyone, including you.
- Gaps are fine. The plan is anchored to dates, so after a break you land on the current week and can skip or catch up. Missed weeks show as Behind, not as an error.
- To move to a new phone: back up, install at the same address, then restore as described above.

## The AI features and your key

Nothing in Orbit needs AI. If you want the coach or food estimates, Coach settings lets you choose Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter). The browser talks straight to that provider with your key, so it costs Orbit nothing and there is no shared AI.

Where the key can live:

| Mode | What happens |
| --- | --- |
| Just this session (default) | Held in memory. Closing the app forgets it. |
| Encrypted here | Stored encrypted with a passphrase (AES-256) on this device. |
| From a key file | Read into memory from a file you pick. Never copied or stored. |

The key is never included in backups, never written to logs and never put in the repository. Model names change over time; the default is a starting point, so use one from your provider's docs.

What the AI sees: the coach gets a summary of your numbers (weight, measurements, lift status, food totals), not your name and not your photos. The photo trend, downloads and reel never call any AI. A food estimate gets only the text you typed. A form check sends the few frames you confirmed, and nothing else.

Using another endpoint: the Content Security Policy in `index.html` lists the only places the app may connect to. Add your endpoint's origin to `connect-src` once (for example `https://openrouter.ai`) and reload. `http://localhost` is already allowed for local models.

## Privacy and security in short

No account or server. No third-party scripts, fonts or requests. A strict Content Security Policy plus Trusted Types means injected script cannot run and text is never interpreted as HTML. Backups are encrypted with PBKDF2 and AES-256-GCM. An optional passcode gates the screen. Read [SECURITY.md](SECURITY.md) for what is and is not protected.

## Keep your data out of git

This repository is for code. The `.gitignore` blocks photos, backups and profile files, and a pre-commit and pre-push check refuses anything that looks like personal data or a key.

```sh
sh scripts/install-hooks.sh
```

Optionally list words you never want committed (your name, measurements) in `~/.orbit-private-terms`, one per line. The check reports matches by line number without printing the terms.

## Develop

```sh
npm test          # plan engine and food database unit tests, no dependencies
npm run e2e       # browser tests (needs Playwright: npm i -g playwright && npx playwright install chromium)
```

The end-to-end tests use fictional numbers, a fake AI provider, and check the security claims above (CSP, Trusted Types, hostile input, encrypted round trips, file:// and localhost).

Layout:

```
index.html            page, security policy
js/engine.js          pure plan, progression and validation logic (also runs in Node)
js/store.js           IndexedDB event log, media, backup and restore
js/crypto.js          passphrase encryption and passcode hashing
js/llm.js             provider adapters (Anthropic, OpenAI-compatible, Gemini)
js/coach.js           coach tools, proposals and safety limits
js/foods.js           food database search (data/foods.json) and the starter list
js/library.js         workout photos and videos: previews, links to originals, frames for form checks
js/reel.js            stitches clips and photos into one MP4 on a canvas
js/foodai.js          AI nutrition estimates (suggest only)
js/mediaexport.js     comparison image and time-lapse video, drawn on a canvas on your device
data/foods.json       the food database (built by scripts/build-foods.mjs; sources in data/SOURCES.md)
js/screens-*.js       screens
tests/                unit and end-to-end tests
docs/ARCHITECTURE.md  how it fits together and why
```

## Roadmap

Part 2 is in: the reel and the coach's form check follow the same rule as everything else and run on your device and your key. Ideas not built: audio or music in the reel, choosing the exact section of a clip, and cooked Indian dishes measured in the food database.

## License

MIT. Fonts (Big Shoulders Display, DM Sans) are under the SIL Open Font License; see `fonts/`.
