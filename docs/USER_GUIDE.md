# User guide

How the bigger features work, in more detail than the README. For installing, see [INSTALL.md](INSTALL.md); for backups, see [BACKUP.md](BACKUP.md).

## Your photo trend

Take the same five angles at your weekly check-in. The day is yours to set in **Profile** (Friday to begin with); Today asks for it that day, stays on it until all five are saved, and flags any week you missed. Check-ins are named by their date (Fri, 18 Sep), never "week 5": the Photos screen has one list of dates, and the trend, compare and downloads all show dates. Then:

1. Progress, then **Open** on Progress photos, then **See trend** in the Your photo trend card. Pick an angle and drag along the check-in dots, or press play. The weight and measurements from around each photo's date sit under it, and green means the change is toward your goal.
2. **Compare two dates** lets you pick any two check-ins and view them side by side, with a slider, or as an overlay that helps you line up your pose. The table underneath shows the change.
3. **Download time-lapse** makes a short video (Story, Square or Original shape) and **Download image** makes a comparison picture (JPEG or PNG). Both are built on your device. When one is ready, tap **Save or share** and choose Save to Photos or Files.

Two things to know about downloads. The saved file shows your photos **unblurred** and is **not encrypted**, so it is as private as wherever you put it. Orbit says so in each sheet. And a video is recorded in real time, so keep Orbit open on screen until it finishes. Videos are always MP4 (H.264), so they play on any phone or laptop and post to Instagram. A browser that cannot record MP4 hides the video option and you can still save the comparison image.

## The food database

Fuel's **Find** tab searches about 7,800 foods, each with calories, protein, carbs, fat and fibre per 100 g, and asks for the amount in grams. A filter under the search box shows **All**, **Veg**, **Veg + egg** or **Non-veg**; it starts from the diet you gave in Profile and remembers your choice. Type a word or the start of one ("paneer", "chick", "dal"). Many foods also answer to their Indian names.

Where it comes from, and what to watch for:

- About 7,200 rows are from the US **USDA SR Legacy** database (public domain), and about 540 from India's **IFCT 2017** tables (National Institute of Nutrition, Hyderabad). They are bundled as one static file, `data/foods.json`, that the app fetches from its own address. Nothing is looked up online. See [data/SOURCES.md](../data/SOURCES.md) for the exact packages, licences and how the file is built (`scripts/build-foods.mjs`).
- The vegetarian and non-vegetarian tags are worked out from the food's name and category by rules, and checked by tests, but they are a **filter, not a guarantee**. Cheese is tagged vegetarian even though some is made with animal rennet, and anything unclear (restaurant items, canned soups, branded products) is tagged "check the label" and appears only under All.
- Neither source measures home-cooked Indian dishes, so a plate of rajma chawal is not in it. The short starter list of common dishes is labelled approximate, and the **Describe** and **Ingredients** tabs are for everything else.
- USDA carbohydrates include fibre; IFCT lists available carbohydrate. Orbit shows each as the source gives it.

## Library, form check and reel

Progress, then **Open** on Workout photos and videos. **Add photos or videos** takes any number of them, tagged Workout, Form check, Personal best or Other, with an optional exercise and note.

**Nothing is copied.** Orbit stores only a preview picture (about 15 KB), the date, your tag and note, and the file's name and size. The original stays in Photos or Files, so your phone does not hold everything twice. What that means where:

- **iPhone (Safari or the Home Screen app):** a web app cannot keep a link into your photo library, so to watch an original again, or to use it in a form check or reel, you pick it again. Orbit uses it in memory and lets go. This is the price of not copying it.
- **Chrome or Edge on a computer, and recent Chrome on Android:** Orbit can keep a real link to each file, so it opens without asking again. If you move or rename the file, the link stops working and you pick it again. If a link cannot be made, Orbit uses the normal file picker instead.

A backup includes the entries and their previews, never the originals. Removing an item from Orbit does not touch the photo or video.

**Ask the coach about form.** Open an item and tap it. For a video Orbit takes six still frames spread across it (one for a photo), shows them to you, and names the provider they will go to. Nothing is sent until you tap Send. They go with your own key, are not saved, and can show your face and surroundings. The coach says what it can see and suggests up to four cues; it cannot judge speed or feel, and it can be wrong. You can save the written review with the item.

**Make a reel.** Choose items from the library, optionally add your weekly check-in photos (already in Orbit), pick Story, Square or Wide, and how long each photo and video part lasts (long videos are trimmed to their middle). Orbit finds the originals (through saved links, or you pick them all at once and it matches them by name and size), then records the reel on your device as an MP4 with a title card, date and tag on each item, and no sound. It is recorded in real time, so keep Orbit open until it finishes. The result exists only until you save or share it. Like the time-lapse, it shows your photos unblurred and is not encrypted.

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
