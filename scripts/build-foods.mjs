#!/usr/bin/env node
/*
 * Builds data/foods.json, the offline food database used by Fuel, from the public-domain USDA SR Legacy data.
 *
 *   node scripts/build-foods.mjs --usda <tempolife-foods.json> [--out data/foods.json]
 *
 * The input comes from the npm package listed in data/SOURCES.md (npm pack tempo-food-db@1.0.0).
 * Only rows whose own source field says USDA SR Legacy are kept. The rest of that file (curated
 * rows without a public source) is left out on purpose. Nothing here touches the network, and nothing personal is read or written.
 *
 * The Indian Food Composition Tables 2017 are NOT bundled: their publisher does not allow electronic redistribution without
 * written permission. buildFromIfct() below is used only by scripts/ifct-to-import.mjs, which turns a copy that YOU obtained
 * into a file you can load into your own Orbit (Fuel, Find, "Add my own food list"). See data/SOURCES.md.
 *
 * Each food is stored per 100 g as [name, diet, kcal, protein, carbs, fat, fibre, source, aliases]
 *   diet: 0 vegetarian, 1 contains egg (or very likely does), 2 meat, poultry, fish, shellfish or gelatin, 3 ingredients unclear (restaurant, canned soup, ready meal)
 *   source: 0 USDA SR Legacy (1 is used in the app for a person's own list and never appears in this file)
 * The diet tag is worked out from the food group and the words in the name. It is a helpful filter, not a guarantee.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------- diet classification ----------
// 0 vegetarian, 1 egg, 2 meat / poultry / fish / gelatin, 3 check the ingredients (restaurant, canned soup, ready meal ...)
const MEAT = /\b(beef|veal|pork|ham|bacon|lamb|mutton|goat|venison|bison|rabbit|elk|moose|boar|chicken|turkey|duck|goose|quail|pheasant|poultry|squab|emu|ostrich|sausage|salami|pepperoni|bologna|frankfurter|hot dog|hotdog|bratwurst|kielbasa|chorizo|pastrami|corned beef|jerky|meatball|meatloaf|meat|liver|giblets|gizzard|tripe|tongue|oxtail|lard|tallow|suet|gelatins?|gelatine|fish|salmon|tuna|cod|haddock|halibut|tilapia|trout|bass|catfish|carp|mackerel|herring|sardine|anchov\w*|pollock|perch|snapper|mullet|flounder|sole|swordfish|shark|eel|roe|caviar|shrimp|prawn|crab|lobster|crayfish|crawfish|oyster|clam|mussel|scallop|squid|octopus|abalone|whelk|snail|conch|turtle|frog|shellfish|seafood|surimi|escargot|foie gras|scrapple|spam|hamburger|cheeseburger|steak|gyro|worcestershire|big mac|whopper|mcrib|quarter pounder|mcnuggets?|filet-o-fish)\b/i;
const VEGGIE = /\b(meatless|meat[- ]free|vegetarian|vegan|meat substitute|meat analog\w*|egg substitute|substitute|plant[- ]based|veggie|textured vegetable protein)\b/i;
const STRIP = /(steak fries|steak cut|sauce, steak|steak sauce|without meat|no meat|meatless|dinosaur eggs|without egg|egg[- ]free|eggless|black turtle|squash, summer, scallop|oyster mushrooms?|mushrooms?, oyster|vegetable oyster|coconut meat|coconut milk|coconut cream|grated meat|fish-shaped|pickle relish, hot dog|pickle relish, hamburger|rolls?, hamburger or hot ?dog|buns?, hamburger or hot ?dog|hamburger or hot ?dog|rolls?, hamburger|rolls?, hot ?dog|buns?, hamburger|buns?, hot ?dog|hot ?dog (rolls?|buns?)|hamburger (rolls?|buns?)|poultry seasoning)/gi;
const EGGLESS = /(without egg|egg[- ]free|eggless)/i;
const PLANT = /\b(soy|soymilk|tofu|almond|oat ?milk|coconut milk)\b/i;
const EGGY = /\b(egg|eggs|omelet|omelette|eggnog|meringue|quiche|custard|mayonnaise|mayo|aioli|hollandaise|cake|cupcake|muffin|cookie|cookies|brownie|doughnut|donut|pastry|waffle|pancake|pancakes|french toast|crepe|cream puff|eclair|macaroon|ladyfinger|challah|brioche|egg noodle|angel food|flan|tiramisu|souffle|lasagna|ravioli|tortellini|gnocchi)\b/i;
const NOT_EGGY_CAKE = /\b(rice|corn|oat|popcorn|potato|quinoa|multigrain) cakes?\b/i;
const UNCLEAR_NAME = /\b(broth|bouillon|stock|gravy|au jus|marshmallows?|gumm(y|ies|i)|pot pie|stuffing|dumplings?|pierogi|empanada|tamale|burrito|taco|enchilada|pizza|sandwich(?!-type)|burger|hot dog|nugget|casserole|entree|stew|frozen meal|frozen dinner)\b/i;
const BRAND = /^([A-Z][A-Z0-9'’&.-]{2,}\b|McDONALD'S|Fast foods?\b|Restaurant\b|School lunch\b|Carl's\b)/;
const NONVEG_CATEGORIES = new Set(['Liha ja linnuliha', 'Kala ja mereannid']);
const EGG_CATEGORIES = new Set(['Munad']);
const UNCLEAR_CATEGORIES = new Set(['Supid', 'Valmistoidud']);

export function classifyUsda(name, category) {
  const n = String(name || '');
  const t = n.replace(STRIP, ' ');
  if (VEGGIE.test(n)) return 0;
  if (/^Eggs?, /.test(n)) return 1;
  if (MEAT.test(t) || NONVEG_CATEGORIES.has(category)) return 2;
  if (BRAND.test(n)) return PLANT.test(n) ? 0 : 3;
  if ((EGGY.test(t) && !NOT_EGGY_CAKE.test(n)) || EGG_CATEGORIES.has(category)) return EGGLESS.test(n) ? 0 : 1;
  if (UNCLEAR_NAME.test(t) && !/ice cream sandwich/i.test(n) || UNCLEAR_CATEGORIES.has(category)) return 3;
  return 0;
}
const IFCT_GROUP_DIET = {
  'Egg and Egg Products': 1,
  'Poultry': 2, 'Animal Meat': 2, 'Marine Fish': 2, 'Fresh Water Fish and Shellfish': 2, 'Marine Shellfish': 2, 'Marine Mollusks': 2,
};
export function classifyIfct(group) { return IFCT_GROUP_DIET[group] != null ? IFCT_GROUP_DIET[group] : 0; }

// ---------- small helpers ----------
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const num = (x) => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };
const r1 = (x) => Math.round(x * 10) / 10;
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const SEEDS = ['Babyfood', 'Infant formula', 'Formula, '];

// English and Hindi names from the IFCT "Local Name" column, e.g. "A. Moricha guti; E. Pearl millet; H. Ramdana; Kan. Danthu beeja".
// Other Indian languages are left out so a search for a short word does not hit unrelated foods.
export function localNames(lang) {
  const out = new Set();
  for (const part of String(lang || '').split(';')) {
    const m = part.trim().match(/^((?:[A-Za-z]{1,4}\.,?\s*)+)(.*)$/);
    if (!m) continue;
    const codes = m[1].split(/[\s,]+/).filter(Boolean);
    if (!codes.includes('H.') && !codes.includes('E.')) continue;
    for (const w of m[2].split(/[,/]/)) { const t = w.replace(/\(.*?\)/g, ' ').trim().toLowerCase(); if (t && t.length < 40 && /^[a-z0-9 '-]+$/.test(t)) out.add(t); }
  }
  return Array.from(out).slice(0, 6).join(' ');
}

// Everyday Indian words for foods the datasets name in English or Latin, so a search for "mutton", "dahi" or "bhindi" finds them.
// This is vocabulary only. No numbers come from here.
const ALIAS_RULES = [
  [/^(Lamb|Goat|Sheep|Mutton)\b/i, 'mutton'], [/^Yogurt\b/i, 'curd dahi'], [/^Buttermilk\b/i, 'chaas chhaas'], [/clarified butter|butter oil|\bghee\b/i, 'ghee desi'],
  [/^(Chickpeas|Bengal gram)\b/i, 'chana chole kabuli'], [/^(Lentils?|Lentil)\b/i, 'masoor dal'], [/^(Pigeon peas?|Red gram)\b/i, 'toor tur arhar dal'],
  [/^(Mung beans?|Green gram)\b/i, 'moong dal'], [/^(Black gram)\b/i, 'urad dal'], [/kidney beans?/i, 'rajma'], [/^Rice\b/i, 'chawal'],
  [/^Wheat flour, (white|refined)/i, 'maida'], [/^Wheat flour, whole/i, 'atta'], [/^Spinach\b/i, 'palak'], [/^Cauliflower\b/i, 'gobi phool gobhi'],
  [/^Okra\b/i, 'bhindi ladyfinger lady finger'], [/^Eggplant\b/i, 'brinjal baingan aubergine'], [/^Potatoes?\b/i, 'aloo'], [/^Onions?\b/i, 'pyaz pyaaz'],
  [/^Tomatoes?\b/i, 'tamatar'], [/^Peas, green/i, 'matar'], [/^Cabbage\b/i, 'patta gobi'], [/^Carrots?\b/i, 'gajar'], [/^Cucumber\b/i, 'kheera'],
  [/^Bananas?\b/i, 'kela'], [/^Mango(s|es)?\b/i, 'aam'], [/^Coconut\b|^Nuts, coconut/i, 'nariyal'], [/^Milk, (whole|reduced|lowfat|nonfat)/i, 'doodh'],
  [/^Sugars?, granulated/i, 'sugar cheeni shakkar'], [/^Cheese, cottage/i, 'chhena'], [/^Soybeans?\b|^Tofu\b/i, 'soya soy'], [/^Peanuts?\b/i, 'moongfali groundnut'],
  [/^Cashew/i, 'kaju'], [/^Walnuts?\b/i, 'akhrot'], [/^Dates?\b/i, 'khajur'], [/^Raisins?\b/i, 'kishmish'], [/^Semolina|^Wheat, semolina/i, 'suji rava sooji'],
  [/^Cornmeal\b/i, 'makai'], [/^Millet\b|^Pearl millet/i, 'bajra'], [/^Sorghum\b/i, 'jowar'], [/^Fenugreek/i, 'methi'], [/^Turmeric/i, 'haldi'],
  [/^Lemons?\b/i, 'nimbu'], [/^Ginger\b/i, 'adrak'], [/^Garlic\b/i, 'lahsun'], [/^Radishes?\b/i, 'mooli'], [/^Beets?\b/i, 'chukandar'],
  [/^Pumpkin\b/i, 'kaddu'], [/^Bottle gourd|^Gourd, /i, 'lauki ghiya doodhi'], [/^Bitter (gourd|melon)/i, 'karela'], [/^Cilantro|^Coriander \(cilantro\)/i, 'dhania coriander'],
  [/^Chicken\b(?! mushroom)/i, 'murgh'], [/^Fish\b/i, 'machli'], [/^Eggs?, whole/i, 'anda ande'],
];
function withAliases(name, existing) {
  const extra = [];
  for (const [re, words] of ALIAS_RULES) if (re.test(name)) extra.push(words);
  return [existing, ...extra].filter(Boolean).join(' ').slice(0, 120);
}

export function buildFromUsda(json) {
  const out = [];
  for (const x of json) {
    if (!x || x.source !== 'usda_sr_legacy') continue;
    const name = clean(x.name);
    if (!name || SEEDS.some((s) => name.startsWith(s))) continue;
    const kcal = num(x.kcal_per_100g), p = num(x.protein_g), c = num(x.carbs_g), f = num(x.fat_g);
    if (kcal == null || p == null || c == null || f == null) continue;
    if (kcal < 0 || kcal > 900 || p < 0 || p > 100 || c < 0 || c > 100 || f < 0 || f > 100) continue;
    out.push([name, classifyUsda(name, x.category), Math.round(kcal), r1(p), r1(c), r1(f), num(x.fiber_g) == null ? 0 : r1(num(x.fiber_g)), 0, withAliases(name, '')]);
  }
  return out;
}

export function buildFromIfct(csvText) {
  const rows = parseCsv(csvText);
  const hdr = rows[0].map((h) => h.split('; ').pop().trim());
  const col = (k) => { const i = hdr.indexOf(k); if (i < 0) throw new Error('IFCT file has no column ' + k); return i; };
  const iName = col('name'), iGrp = col('grup'), iLang = col('lang'), iKj = col('enerc'), iP = col('protcnt'), iF = col('fatce'), iC = col('choavldf'), iFib = col('fibtg');
  const out = [];
  for (const r of rows.slice(1)) {
    if (r.length < 10) continue;
    const name = clean(r[iName]);
    const kj = num(r[iKj]), p = num(r[iP]), f = num(r[iF]), c = num(r[iC]);
    if (!name || kj == null || p == null || f == null || c == null) continue;
    let kcal = Math.round(kj / 4.184);
    if (kcal === 0 && (p > 0 || c > 0 || f > 0)) kcal = Math.round(4 * p + 4 * c + 9 * f); // IFCT leaves energy blank for oils and fats
    const atwater = Math.round(4 * p + 4 * c + 9 * f);
    if (kcal > 60 && atwater > 0 && Math.abs(kcal - atwater) / kcal > 0.4) kcal = atwater; // one IFCT row (chicken leg) has an energy value far from its own macros
    if (kcal < 0 || kcal > 900) continue;
    out.push([name, classifyIfct(clean(r[iGrp])), kcal, r1(p), r1(c), r1(f), num(r[iFib]) == null ? 0 : r1(num(r[iFib])), 1, withAliases(name, localNames(r[iLang]))]);
  }
  return out;
}

export function assemble(usda, built) {
  return {
    v: 1, built: built || new Date().toISOString().slice(0, 10),
    sources: [
      { id: 'usda', name: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, SR Legacy. fdc.nal.usda.gov', licence: 'Public domain, CC0 1.0', via: 'tempo-food-db 1.0.0 (CC-BY-4.0, TempoLife; Food nutrition data from TempoLife, tempolife.app)' },
    ],
    fields: ['name', 'diet', 'kcal', 'protein', 'carbs', 'fat', 'fibre', 'source', 'aliases'],
    foods: usda,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
  const uf = arg('usda'), out = arg('out') || path.join(here, '..', 'data', 'foods.json');
  if (process.argv.includes('--ifct')) { console.error('The IFCT tables are not bundled. Use scripts/ifct-to-import.mjs to make a file for your own Orbit.'); process.exit(2); }
  if (!uf) { console.error('Usage: node scripts/build-foods.mjs --usda <tempolife-foods.json> [--out data/foods.json]'); process.exit(2); }
  const usda = buildFromUsda(JSON.parse(fs.readFileSync(uf, 'utf8')));
  const db = assemble(usda);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '{"v":1,"built":' + JSON.stringify(db.built) + ',"sources":' + JSON.stringify(db.sources) + ',"fields":' + JSON.stringify(db.fields) + ',"foods":[\n' + db.foods.map((f) => JSON.stringify(f)).join(',\n') + '\n]}\n');
  const by = [0, 0, 0]; for (const f of db.foods) by[f[1]]++;
  console.log('Wrote ' + out + ': ' + db.foods.length + ' foods (USDA); vegetarian ' + by[0] + ', egg ' + by[1] + ', meat or fish ' + by[2] + '.');
}
