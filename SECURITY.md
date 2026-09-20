# Security and privacy

Orbit holds sensitive things: body measurements, photos, health-adjacent logs and possibly an AI API key. This page says what is protected, how, and where the limits are.

## Design rules

1. **No server, no account.** There is no backend to breach. Data lives in the browser's IndexedDB on your device.
2. **No third parties.** No analytics, no CDN scripts, no remote fonts. The only requests the app makes are AI calls you trigger, straight to the provider you chose (or localhost).
3. **Least authority for the AI.** The coach and food estimator can only read a summary and *propose*. Every change is validated against hard limits and needs your tap. Every change can be undone.
4. **Data is data.** Text from you or from a model is always inserted as plain text. The app contains no `innerHTML`.

## What is enforced

| Threat | Defence |
| --- | --- |
| Injected script (XSS) | No `innerHTML` anywhere; `script-src 'self'`; `style-src 'self'` (no inline styles); Trusted Types required for DOM sinks. Tests push hostile strings through typed and model-returned food names, set notes and coach replies. |
| Data sent somewhere unexpected | `connect-src` is an allow-list: the three provider origins and localhost. `default-src 'none'`. The service worker never touches cross-origin requests. |
| Clickjacking / base tag tricks | `base-uri 'none'`, `form-action 'none'`. (Framing protection needs an HTTP header, so set `Content-Security-Policy: frame-ancestors 'none'` on your host if it lets you.) |
| Stolen backup file | AES-256-GCM with a key from PBKDF2-SHA256 (250,000 iterations), random salt and IV per file. Wrong passphrase or tampering fails to decrypt. |
| Malicious or corrupted import | Size limit, event type allow-list, rejection of `__proto__`/`constructor`/`prototype` keys, profile fields range-checked and re-built from a whitelist. Imports are never applied without confirmation. |
| API key leakage | Held in memory by default; optional passphrase-encrypted vault; never in backups or exports; sent only as a request header to the provider origin. |
| Runaway or manipulated AI | Prompt tells the model that stored text is data. Tools are read-only or "propose". Calories change at most 300 per step, protein stays within 1.4 to 3.0 g/kg, lift changes at most 10 percent. Estimates go through a confirmation card and a sanity check (calories vs macros) before anything is saved. |
| Photos and videos duplicated in storage | The library stores only a small preview and the file's name and size, never the original. Links to files (Chrome, Edge) are read-only handles kept on this device and are not in backups. |
| Video frames leaving without consent | A coach form check shows the exact frames and the provider's host first, and nothing is sent until you tap Send. The frames are never saved. |
| Hostile library entries in a backup | Every entry is rebuilt from a whitelist on load: ids, preview ids and exercise ids must be plain identifiers, text is length-limited and numbers are clamped. |
| Food database tampering | It is a static file served from the app's own address, validated row by row before use, and it never runs as code. |
| A hostile own-list file | It is size-limited (15 MB, 30,000 rows), parsed as data, every row range-checked and control characters removed, and shown only as text. Nothing is stored until you confirm, and it is never uploaded or put in a backup. |
| Personal data in the repository | `.gitignore` plus a pre-commit and pre-push scan for photos, backups, profile files, keys and your own private terms. |
| Location data in photos | Photos are decoded and re-encoded as JPEG, which drops all metadata. Downloaded comparison images and time-lapse videos are redrawn on a canvas, so they carry none either. |

## What is not protected (be honest with yourself)

- **Data at rest is not encrypted.** IndexedDB is readable by anyone who can use your unlocked browser profile or device. Use a device passcode and full-disk encryption. The optional Orbit passcode only gates the screen; it is not encryption.
- **A compromised device or browser extension can read anything** the page can. Orbit cannot defend against that.
- **AI providers see what you send them.** The coach summary, food text and any form-check frames you confirm go to the provider you choose, under that provider's terms. Use a local model if that matters.
- **Hosting is part of your trust.** Whoever serves the files could serve different code. Host it yourself, pin what you deploy, and review updates as you would any app you trust with health data.
- **The food database is a filter, not medical advice.** Vegetarian and non-vegetarian tags come from rules over names and categories. Check labels if it matters for allergy, religion or health.
- **Downloaded photos, images, videos and reels are unblurred and not encrypted.** Orbit builds them on your device and warns you before each one; where they go after you tap Save or share (Photos, iCloud, a chat app) is up to you.
- **Backups you choose not to encrypt are readable text.** Orbit warns you when you turn encryption off.
- **A forgotten backup passphrase cannot be recovered.** That is the point.

## Reporting a problem

This is a personal project. If you find a security issue, open a private report with the maintainer of your copy, or email them directly rather than posting details publicly.
