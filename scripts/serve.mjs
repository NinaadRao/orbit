// Tiny static file server for running Orbit locally. No dependencies.
//   node scripts/serve.mjs            -> http://localhost:8080  (this computer only)
//   PORT=9000 node scripts/serve.mjs  -> another port
//   node scripts/serve.mjs --lan      -> also reachable from your phone on the same Wi-Fi (see note)
// Note: browsers only allow encryption and offline mode on https or localhost. Over plain http on your LAN
// the app works, but encrypted backups and the offline cache do not. For a phone, host the folder over https
// (see README) or use a tunnel that gives you an https address.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const PUBLIC = new Set(['index.html', 'manifest.webmanifest', 'sw.js']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const rel = p.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  // Only the app itself is served: never the repo's tests, scripts, docs or .git folder.
  const ok = file.startsWith(ROOT + path.sep) && (PUBLIC.has(rel) || /^(js|css|icons|fonts)\//.test(rel));
  if (!ok || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, HOST, () => {
  console.log('Orbit is running at http://localhost:' + PORT + (HOST === '0.0.0.0' ? '  (and on your local network)' : ''));
  console.log('Press Ctrl+C to stop. Your data lives in your browser, not in this folder.');
});
