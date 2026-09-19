# Architecture

A short tour of how Orbit is put together and why. It is written so you can explain each choice in a design discussion.

## Shape of the system

```
 UI screens (imperative shell)         Engine (functional core)
 js/screens-*.js, app.js  ─────────►   js/engine.js  pure functions, no I/O
        │                                    ▲
        ▼                                    │ project(events)
 Store (js/store.js) ── append-only event log in IndexedDB ── media blobs (photos)
        │
        ├── Crypt: PBKDF2 → AES-GCM (backups, key vault, passcode hash)
        └── LLM adapters → provider APIs (only when you trigger a request)
```

## Key decisions

**Local-first.** All state is on the device. There is no sync service to run, secure or pay for, and the app works offline. The cost is that durability is your responsibility, so backup is a first-class feature, not an afterthought.

**Event sourcing with a projection.** Every change is an appended event (`weight_logged`, `set_logged`, `food_logged`, `plan_revised`, `event_voided`...). Current state is `Engine.project(events)`. Benefits: undo is just a void event, the coach's changes are auditable (`src: 'coach'`), import and export are the log itself, and bugs in derived views can be fixed without migrating data. At this scale (thousands of events) folding the whole log on every change is fast enough, so there are no snapshots. If the log grew large, the next step would be periodic snapshots plus events after the snapshot.

**Functional core, imperative shell.** `engine.js` has no DOM, storage or network access. It computes the plan (Mifflin-St Jeor maintenance, goal-adjusted macros, block-periodised lift targets with deloads), validates changes and projects state. It runs unchanged in Node, so the maths is unit-tested without a browser.

**Canonical units.** Weights are stored in kg and lengths in cm; units are a display concern. Switching units never loses precision.

**Human in the loop for AI.** The model gets a read-only summary and a small tool set. Write-like tools only create *proposals*. Each proposal is validated against hard bounds and then shown to the person, who must tap Apply. Food estimates follow the same principle: the model returns a suggestion, the app sanity-checks it, the person edits and confirms, and only then is an event appended. This limits the blast radius of a wrong or manipulated model to "a suggestion was ignored".

**Bring your own key.** The browser calls the provider directly, so the app has no server cost and no central copy of anyone's data. Provider differences (Anthropic, OpenAI-compatible, Gemini) live behind one internal message format in `llm.js`, with streaming, retry with exponential backoff and jitter on 429 and 5xx, and cancellation through `AbortController`.

**Defence in depth on the client.** A strict CSP and Trusted Types, no `innerHTML`, no inline styles, an allow-listed `connect-src`, and a service worker that ignores cross-origin traffic. Each layer assumes the one before it might fail.

**Zero runtime dependencies, no build.** Classic scripts, one file per concern. Less supply-chain surface, nothing to rot, and it runs from a folder. The trade-off is manual module wiring and no tree-shaking, which is acceptable for a few thousand lines.

**Photos are derived views, not new state.** The photo trend and compare screens add no events. `Engine.checkIns` joins each photo to the numbers around its date (a 3-day mean of weigh-ins, the closest measurement within 10 days) and `Engine.goalDir` says which direction counts as progress, so the "green means toward your goal" colouring comes from the plan and is unit-tested. Exports are drawn on a canvas (`js/mediaexport.js`): a comparison image is a single draw, and a time-lapse is recorded from the canvas with `MediaRecorder` in real time and always saved as MP4 (H.264), which iPhones, laptops and Instagram all accept. A browser that can only record WebM gets no video option, and the image export still works. Redrawing the pixels drops all camera and location data, nothing is uploaded, and the finished file is only handed to the OS share sheet or a download on a fresh tap, because browsers require a user gesture for that and a long recording would have used it up.

**Offline through a service worker.** Cache the app shell, serve stale-while-revalidate. It never caches or reads user data: that lives in IndexedDB.

**Weekly check-in is derived too.** Every plan week is a photo week, and the weekday it lands on is one setting (`checkinDay`, Friday by default). `Engine.checkinDate` finds that day inside each plan week and `Engine.checkinStatus` says whether this week is upcoming, due, overdue or done (all five angles saved) and lists earlier weeks left unfinished. Nothing new is stored: the status is computed from the photo events, so it also survives a restore. The web cannot force anything, so "mandatory" means Today keeps a card up until the week is done and flags the ones you missed.

**One backup file, replaced each time.** A backup always uses the same name (`orbit-backup.orbitbackup`). A browser cannot delete files it did not just create, so replacing the old copy depends on where you save: in Chrome or Edge on a computer you can pick a folder once (the folder handle is kept in the local meta store), and each backup then overwrites that file and removes older `orbit-*.orbitbackup` files there, after the new one is fully written and touching nothing else in the folder. The iPhone and iPad Files sheet offers Replace for a same-named file, and Safari on a Mac downloads a numbered copy.

## Failure modes considered

| Failure | Behaviour |
| --- | --- |
| IndexedDB unavailable (private mode) | Falls back to memory and warns loudly. |
| Browser evicts site data | Backup nudges, persistent-storage request, restore flow. |
| Corrupt or hostile import | Validated and rejected before anything is applied. |
| Provider outage or bad key | Readable error, retries with backoff, manual entry always available. |
| Model returns junk numbers | Clamped, cross-checked and shown for confirmation. |
| Browser cannot record video, or the tab is hidden mid-recording | The video option says so and points to the image export; a hidden tab pauses drawing, so the sheet asks you to keep Orbit open. |
| Two tabs open | Events are appended atomically; reload to see the other tab's changes. A multi-tab lock is a possible improvement. |

## Testing

`tests/engine.test.js` checks the plan maths against published tables, validators, projection and import safety. `tests/e2e.mjs` drives real Chromium against a local server with a fake AI provider: onboarding, logging, the food tracker's confirmation flow, coach proposals, backup round trips, the passcode, hostile input, CSP and Trusted Types, and both `file://` and `localhost`.
