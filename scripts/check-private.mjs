// Refuses to let personal data or secrets into the repository.
//   node scripts/check-private.mjs --staged   (used by the pre-commit hook)
//   node scripts/check-private.mjs            (checks every tracked file; used by pre-push)
// Extra terms you never want committed (your measurements, your name, an email) can go, one per line, in
// ~/.regoal-private-terms (or the older ~/.orbit-private-terms), or in the file named by REGOAL_PRIVATE_TERMS or ORBIT_PRIVATE_TERMS. That file is never part of the repo,
// and matches are reported by line number only, so the terms themselves never reach a log.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const staged = process.argv.includes('--staged');
const git = (args, opts) => execFileSync('git', args, Object.assign({ encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }, opts));

const BAD_EXT = /\.(heic|heif|jpe?g|mov|mp4|m4v|webm|3gp|orbitbackup|orbitprofile|regoalbackup|regoalprofile)$/i;
const BAD_FOODS = /\.orbitfoods\.(json|csv)$/i; // a person's own food list, which may carry someone else's copyright
const IMG_EXT = /\.(png|gif|webp|svg)$/i;
const IMG_OK = /^(icons|docs\/img)\//;
const BAD_DIR = /(^|\/)(private|exports|backups|photos|media)\//i;
const BAD_NAME = /(^|\/)(\.env(\..*)?|.*\.pem|id_rsa.*|profile[-_.a-z0-9]*\.json)$/i;
const SECRETS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'], [/\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, 'an OpenAI-style API key'], [/AIza[0-9A-Za-z_-]{35}/, 'a Google API key'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/^\s*\{\s*"orbit"\s*:\s*1\b/, 'a Regoal backup, encrypted backup or profile file'],
];

function terms() {
  const files = [process.env.REGOAL_PRIVATE_TERMS, process.env.ORBIT_PRIVATE_TERMS, path.join(os.homedir(), '.regoal-private-terms'), path.join(os.homedir(), '.orbit-private-terms')].filter(Boolean);
  const out = [];
  for (const f of files) { try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) if (l.trim() && !l.startsWith('#')) out.push(l.trim().toLowerCase()); } catch (e) { /* no such file */ } }
  return out;
}

let files;
try {
  files = staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean) : git(['ls-files', '-z']).split('\0').filter(Boolean);
} catch (e) { console.error('check-private: not a git repository.'); process.exit(2); }

const T = terms();
const problems = [];
for (const f of files) {
  if (BAD_EXT.test(f)) problems.push(f + ': photos, videos and Regoal backups must never be committed');
  else if (IMG_EXT.test(f) && !IMG_OK.test(f)) problems.push(f + ': images are only allowed in icons/ and docs/img/');
  if (BAD_DIR.test(f)) problems.push(f + ': this folder name is reserved for personal data');
  if (BAD_FOODS.test(f)) problems.push(f + ': a personal food list may carry someone else\'s copyright (for example IFCT), so it must not be committed');
  if (BAD_NAME.test(f)) problems.push(f + ': looks like a secret or personal profile file');
  let buf;
  try { buf = staged ? execFileSync('git', ['show', ':' + f], { maxBuffer: 512 * 1024 * 1024 }) : fs.readFileSync(f); } catch (e) { continue; }
  if (buf.length > 3 * 1024 * 1024 || buf.includes(0)) continue; // large or binary: judged by name only
  const text = buf.toString('utf8');
  for (const [re, what] of SECRETS) if (re.test(text)) problems.push(f + ': contains ' + what);
  if (T.length) {
    const lines = text.toLowerCase().split('\n');
    lines.forEach((l, i) => T.forEach((t, k) => { if (l.includes(t)) problems.push(f + ':' + (i + 1) + ': matches your private term #' + (k + 1)); }));
  }
}
if (problems.length) {
  console.error('\nRegoal privacy check failed. Nothing was committed.\n');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nFix or unstage these files, then try again. This repository must hold code only, never your data.\n');
  process.exit(1);
}
console.log('Regoal privacy check passed (' + files.length + ' file' + (files.length === 1 ? '' : 's') + (T.length ? ', ' + T.length + ' private terms' : '') + ').');
