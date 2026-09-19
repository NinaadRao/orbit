# Orbit

A private, local-first tracker for lifts, food, body weight, measurements and progress photos, built around a 26-week plan (build, recomp or cut). No account, no server, no analytics. Your data lives in your browser and leaves only when you make a backup file.

- **Plan**: answer a few questions, get calories, macros, a weekly split, week-by-week lift targets (with deloads) and six-month measurement goals.
- **Log**: sets (with effort and rest timer), weigh-ins, measurements, food, and five-angle photos at check-in weeks.
- **Fuel**: find a listed food, describe a meal to your own AI, type raw ingredients, or enter macros by hand. AI results always show an editable confirmation card and nothing is saved until you tap "Looks right".
- **Coach**: a chat that runs on *your* model with *your* key. It can suggest changes; you tap Apply; every change has Undo.
- **Backup**: one encrypted file you can drop into iCloud Drive, Google Drive or anywhere else.

Everything is plain HTML, CSS and JavaScript. There is nothing to build and no runtime dependency.

## Run it

You need a browser and, optionally, Node 20+.

```sh
node scripts/serve.mjs        # then open http://localhost:8080
```

You can also just open `index.html` from the folder. That works for trying it out, but the offline cache and encrypted backups need `http://localhost` or `https`.

### On your iPhone

iPhones can only install and cache the app from an **https** address. The folder holds only code, so hosting it is safe: your data is never in it. Any static host works (Cloudflare Pages, Netlify Drop, Vercel, GitHub Pages, your own server). Then in Safari: Share, **Add to Home Screen**.

Two things worth knowing:

1. **The address is your data's identity.** Browsers keep data per address, and the Home Screen app keeps its own copy separate from Safari. Do your first-run setup in the place you will actually use, or restore a backup into it. If you ever move hosts, make a backup first and restore it at the new address.
2. **Safari can erase site data** for sites you have not opened in about a week. Home Screen apps are treated more kindly, and Orbit asks the browser to keep its data, but the only real safety net is a backup file.

## Keeping the app if you do not use it every day

- Make a backup every week or two. Orbit nudges you on the Today screen. Privacy and backup, then Back up now, then Save or share.
- On iPhone, the share sheet's **Save to Files** lets you pick iCloud Drive. Pick the Google Drive app to send it there. On a computer, choose a folder your cloud drive syncs.
- Encrypt backups with a passphrase (the default). Without the passphrase the file cannot be opened by anyone, including you.
- Gaps are fine. The plan is anchored to dates, so after a break you land on the current week and can skip or catch up. Missed weeks show as Behind, not as an error.
- To move to a new phone: back up, install at the same address, tap "I already have a backup or profile file" on the welcome screen.

## The AI features and your key

Nothing in Orbit needs AI. If you want the coach or food estimates, Coach settings lets you choose Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter). The browser talks straight to that provider with your key, so it costs Orbit nothing and there is no shared AI.

Where the key can live:

| Mode | What happens |
| --- | --- |
| Just this session (default) | Held in memory. Closing the app forgets it. |
| Encrypted here | Stored encrypted with a passphrase (AES-256) on this device. |
| From a key file | Read into memory from a file you pick. Never copied or stored. |

The key is never included in backups, never written to logs and never put in the repository. Model names change over time; the default is a starting point, so use one from your provider's docs.

What the AI sees: the coach gets a summary of your numbers (weight, measurements, lift status, food totals), not your name and not your photos. A food estimate gets only the text you typed.

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
npm test          # plan engine unit tests, no dependencies
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
js/foods.js           built-in food list and search
js/foodai.js          AI nutrition estimates (suggest only)
js/screens-*.js       screens
tests/                unit and end-to-end tests
docs/ARCHITECTURE.md  how it fits together and why
```

## Roadmap

Part 2: an automated progress reel you can download and share, and form feedback where you upload a video of a set and the coach reviews it. Both will follow the same rule as everything else: they run on your device and your key.

## License

MIT. Fonts (Big Shoulders Display, DM Sans) are under the SIL Open Font License; see `fonts/`.
