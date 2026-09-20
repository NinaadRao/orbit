# Backing up and restoring

A backup is one file, always named `regoal-backup.regoalbackup`, so a new one replaces the old one. It holds your plan, every log and your settings, plus your progress photos if you tick **Include progress photos** (that makes the file much larger). It never holds your AI key.

**Make one**

1. Today, then the shield icon (Privacy and backup).
2. Under Backup, tap **Back up now**.
3. Leave **Encrypt with a passphrase** on and type a passphrase (8 or more characters) twice. A forgotten passphrase cannot be recovered, by design. Decide whether to include progress photos.
4. Tap **Prepare file**, then **Save or share**. On iPhone choose **Save to Files**, then **On My iPhone**; saving under the same name offers **Replace**. On Android choose Files or Drive from the share sheet; recent Chrome can also use a folder you pick once (make a folder such as "Regoal backups", because Android does not allow the top-level Downloads folder). On a computer, Chrome or Edge can use a folder you pick once, and Regoal then replaces the old file and removes older Regoal backups there; other browsers save to Downloads. Regoal only ever writes this file on your device. It does not connect to iCloud, Google Drive or any other service.

**Restore one** (new phone, cleared browser data, moved to a new address, or starting over)

1. Get the file where the device can reach it. On iPhone that means the Files app; on a computer, the folder it was saved to.
2. Open Regoal at the address you want to use. Install it to the Home Screen first if you use it that way, then open it from the icon.
3. On a fresh install the welcome screen shows **I already have a backup or profile file**. Tap it. If Regoal already has data, go to Today, the shield icon, then **Restore from a file**.
4. Pick the `.regoalbackup` file (older `.orbitbackup` files open too). If it is encrypted, enter the passphrase you chose when you made it.
5. Check the summary (how many entries and photos it holds) and tap **Restore**.

Good to know when restoring:

- Restoring **replaces** what is on the device, so Regoal warns you first when there is already data. If in doubt, make a backup of the current data first.
- A wrong passphrase or a damaged file is refused and nothing changes.
- Keep more than one backup, for example one per month. Each file is a snapshot; restoring an old one takes you back to that day.
- There is a lighter **profile file** (just your answers, no history). It builds a fresh 26-week plan starting today. It is handy for a clean start with the same setup.
- Photos come back only if you included them when you made the backup.
- Your AI key is never in a backup. After restoring, add it again under Coach if you want the AI features.

## Keeping the app if you do not use it every day

- Make a backup every week or two. Regoal nudges you on the Today screen. The steps are above.
- Encrypt backups with a passphrase (the default). Without the passphrase the file cannot be opened by anyone, including you.
- Gaps are fine. The plan is anchored to dates, so after a break you land on the current week and can skip or catch up. Missed weeks show as Behind, not as an error.
- To move to a new phone: back up, install at the same address, then restore as described above.
