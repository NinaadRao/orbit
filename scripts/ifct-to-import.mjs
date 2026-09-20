#!/usr/bin/env node
/*
 * Turns a copy of the Indian Food Composition Tables 2017 (IFCT) into a food list you can load into your own Regoal:
 * Fuel, Add food, Find, "Add my own food list".
 *
 *   node scripts/ifct-to-import.mjs <index.csv> --out ~/Documents/orbit-private/ifct.orbitfoods.json
 *
 * <index.csv> is the compositions table of the npm package @ifct2017/compositions (npm pack @ifct2017/compositions).
 *
 * READ THIS FIRST. The tables are copyright the National Institute of Nutrition, Hyderabad (ICMR). Their terms allow personal
 * use with acknowledgement and do not allow storing them electronically to create a product without written permission.
 * Regoal therefore does not ship this data. This script makes a file for YOUR OWN use. Do not commit it, publish it or hand it
 * to other people unless the Institute has given permission. The output path is refused if it is inside this repository,
 * and *.orbitfoods.json is in .gitignore.
 *
 * Values are per 100 g, and IFCT lists foods as raw unless the name says otherwise. Nothing is sent anywhere.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFromIfct } from './build-foods.mjs';

const DIET = ['veg', 'egg', 'nonveg', 'check'];
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// rows are the internal [name, diet, kcal, protein, carbs, fat, fibre, source, aliases] arrays from buildFromIfct
export function toImport(rows, name) {
  return {
    orbitFoods: 1,
    name: name || 'IFCT 2017 (my copy)',
    note: 'For personal use only. Source: Indian Food Composition Tables 2017, National Institute of Nutrition (ICMR), Hyderabad. Do not publish or share without the Institute\'s permission.',
    foods: rows.map((r) => ({ name: r[0], diet: DIET[r[1]] || 'check', kcal: r[2], protein: r[3], carbs: r[4], fat: r[5], fibre: r[6], aliases: r[8] || '' })),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const out = oi >= 0 ? args[oi + 1] : null;
  const input = args.find((a, i) => !a.startsWith('--') && i !== oi + 1);
  if (!input || !out) { console.error('Usage: node scripts/ifct-to-import.mjs <index.csv> --out <file>.orbitfoods.json\nSee the note at the top of this script about the terms of the IFCT data.'); process.exit(2); }
  const outPath = path.resolve(out.replace(/^~(?=$|\/)/, os.homedir()));
  const rel = path.relative(repo, outPath);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) { console.error('Refusing to write inside the Regoal repository (' + rel + '). Choose a folder outside it, such as your private folder.'); process.exit(2); }
  const rows = buildFromIfct(fs.readFileSync(input, 'utf8'));
  if (!rows.length) { console.error('No foods found. Is that the IFCT compositions index.csv?'); process.exit(1); }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(toImport(rows), null, 1) + '\n');
  const by = [0, 0, 0, 0]; for (const r of rows) by[r[1]]++;
  console.log('Wrote ' + outPath + ': ' + rows.length + ' foods (veg ' + by[0] + ', egg ' + by[1] + ', non-veg ' + by[2] + ').');
  console.log('In Regoal: Fuel, Add food, Find, "Add my own food list", then choose that file. Keep it out of git.');
}
