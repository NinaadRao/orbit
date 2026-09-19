'use strict';
// Checks the food database: the builder's diet tags and parsing, the app's loader and search, and the shipped data file itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Foods = require('../js/foods.js');

const DATA = path.join(__dirname, '..', 'data', 'foods.json');
const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const build = () => import('../scripts/build-foods.mjs');

test('diet tags: plants are veg, eggs are egg, meat, fish and gelatin are non-veg', async () => {
  const { classifyUsda } = await build();
  const veg = ['Lentils, raw', 'Cheese, cheddar', 'Tofu, raw, firm, prepared with calcium sulfate', 'Bread, chapati or roti, plain', 'Almonds', 'Bacon, meatless', 'Egg substitute, powder', 'Sausage, meatless', 'Beans, black turtle, mature seeds, raw', 'Squash, summer, scallop, raw', 'Nuts, coconut meat, raw', 'Pickle relish, hot dog', 'Rolls, hamburger or hotdog, plain', 'Cereals, QUAKER, Instant Oatmeal, DINOSAUR EGGS, Brown Sugar', 'Pasta, homemade, made without egg, cooked', 'Snacks, rice cakes, brown rice, buckwheat'];
  for (const n of veg) assert.equal(classifyUsda(n, ''), 0, n);
  const egg = ['Egg, whole, raw, fresh', 'Egg, duck, whole, fresh, raw', 'Cake, white, prepared from recipe with coconut frosting', 'Noodles, egg, cooked', 'Mayonnaise, regular', 'Custard, dry mix', 'Cookies, molasses'];
  for (const n of egg) assert.equal(classifyUsda(n, ''), 1, n);
  const meat = ['Beef, ground, 85% lean meat / 15% fat, raw', 'Pork, fresh, loin, raw', 'Chicken, broilers or fryers, breast, raw', 'Fish, salmon, Atlantic, farmed, raw', 'Shrimp, mixed species, raw', 'Gelatin desserts, dry mix', 'Gelatins, dry powder, unsweetened', 'Lard', 'Sauce, worcestershire', 'Soup, chicken mushroom, canned, prepared with equal volume water', 'Restaurant, Chinese, fried rice, with pork', 'Hamburger, single, regular patty', 'Salisbury steak with gravy, frozen'];
  for (const n of meat) assert.equal(classifyUsda(n, ''), 2, n);
  assert.equal(classifyUsda('Anything at all', 'Liha ja linnuliha'), 2, 'the meat category wins');
  assert.equal(classifyUsda('Whatever', 'Munad'), 1, 'the egg category is egg');
});

test('diet tags: restaurant food, canned soup and ready meals are "check the label"', async () => {
  const { classifyUsda } = await build();
  for (const n of ['PIZZA HUT 14" Cheese Pizza, Pan Crust', "WENDY'S, French Fries", 'Fast foods, breadstick, soft', 'Restaurant, Italian, spaghetti with marinara sauce', 'Gravy, dry', 'Soup, onion, canned, condensed', 'Macaroni and Cheese, canned entree']) assert.equal(classifyUsda(n, n.startsWith('Soup') ? 'Supid' : ''), 3, n);
  assert.equal(classifyUsda('SILK Blueberry soy yogurt', ''), 0, 'plant milks and tofu with a brand are fine');
});

test('IFCT groups decide their tag, so a mushroom called chicken mushroom stays veg', async () => {
  const { classifyIfct } = await build();
  assert.equal(classifyIfct('Mushrooms'), 0);
  assert.equal(classifyIfct('Milk and Milk Products'), 0);
  assert.equal(classifyIfct('Egg and Egg Products'), 1);
  for (const g of ['Poultry', 'Animal Meat', 'Marine Fish', 'Fresh Water Fish and Shellfish', 'Marine Shellfish', 'Marine Mollusks']) assert.equal(classifyIfct(g), 2, g);
});

test('CSV parser handles quotes, commas and newlines inside fields', async () => {
  const { parseCsv } = await build();
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\n1,2,3\r\n'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('x,"line1\nline2"\n'), [['x', 'line1\nline2']]);
});

test('IFCT local names keep only English and Hindi', async () => {
  const { localNames } = await build();
  assert.equal(localNames('A. Moricha guti; E. Pearl millet; H. Ramdana; Kan. Danthu beeja; Tam. Thandu keerai'), 'pearl millet ramdana');
  assert.equal(localNames('A., Kash. Baajra; H. Bajra'), 'bajra');
});

test('builders skip rows that are unsourced, impossible, or baby food', async () => {
  const { buildFromUsda } = await build();
  const r = buildFromUsda([
    { name: 'Egg, whole', category: 'Munad', kcal_per_100g: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5, fiber_g: 0, source: 'usda_sr_legacy' },
    { name: 'Curated dish', category: 'Eesti toidud', kcal_per_100g: 100, protein_g: 5, carbs_g: 10, fat_g: 3, source: null },
    { name: 'Impossible', category: 'x', kcal_per_100g: 5000, protein_g: 5, carbs_g: 10, fat_g: 3, source: 'usda_sr_legacy' },
    { name: 'Babyfood, apples', category: 'x', kcal_per_100g: 50, protein_g: 0, carbs_g: 12, fat_g: 0, source: 'usda_sr_legacy' },
    { name: 'No macros', category: 'x', kcal_per_100g: 50, source: 'usda_sr_legacy' },
  ]);
  assert.deepEqual(r.map((x) => x[0]), ['Egg, whole']);
  assert.equal(r[0][1], 1);
});

test('the loader rejects damaged data and skips bad rows instead of trusting them', () => {
  assert.throws(() => Foods.parseDb({ v: 2, foods: [] }));
  assert.throws(() => Foods.parseDb({ v: 1, foods: [['x']] }), /empty/);
  const good = Array.from({ length: 120 }, (_, i) => ['Food ' + i, 0, 100, 5, 10, 3, 1, 0, '']);
  const list = Foods.parseDb({ v: 1, foods: good.concat([['Bad kcal', 0, 99999, 1, 1, 1, 0, 0, ''], ['Bad diet', 9, 100, 1, 1, 1, 0, 0, ''], [123, 0, 1, 1, 1, 1, 0, 0, ''], ['Neg', 0, 100, -1, 1, 1, 0, 0, ''], null, 'text'])});
  assert.equal(list.length, 120);
});

test('the shipped food file loads completely and covers what a lifter eats', () => {
  const list = Foods.parseDb(raw);
  assert.equal(list.length, raw.foods.length, 'no row was rejected');
  assert.ok(list.length > 7000, 'thousands of foods: ' + list.length);
  const by = [0, 0, 0, 0]; for (const f of list) by[f.diet]++;
  assert.ok(by[0] > 3000 && by[1] > 200 && by[2] > 2000, 'vegetarian, egg and non-veg all present: ' + by);
  const find = (n) => list.find((f) => f.name === n);
  const egg = find('Egg, whole, raw, fresh'); assert.deepEqual([egg.kcal, egg.protein, egg.carbs, egg.fat], [143, 12.6, 0.7, 9.5]); // USDA reference values
  const lentil = find('Lentils, raw'); assert.deepEqual([lentil.kcal, lentil.protein, lentil.fat], [352, 24.6, 1.1]);
  const paneer = find('Paneer'); assert.ok(paneer && paneer.src === 1 && paneer.diet === 0 && Math.abs(paneer.protein - 18.9) < 0.1);
  assert.equal(find('Ghee').kcal, 900, 'oils get an energy value');
});

test('no vegetarian-tagged food names meat, fish or gelatin, apart from the plant-based ones', () => {
  const meaty = /\b(beef|veal|pork|bacon|ham|lamb|chicken|turkey|duck|sausage|salami|pepperoni|fish|salmon|tuna|shrimp|prawn|crab|lobster|oyster|clam|squid|gelatin\w*|lard|tallow)\b/i;
  const plant = /(meatless|vegetarian|vegan|substitute|mushroom|analog|veggie|imitation|crabapple|oyster mushroom|vegetable oyster|hamburger (roll|bun)|hot ?dog (roll|bun)|rolls?, ham|fish-shaped|pickle relish|goldfish|fishing|sausage, meatless)/i;
  const bad = raw.foods.filter((f) => f[1] === 0 && meaty.test(f[0]) && !plant.test(f[0])).map((f) => f[0]);
  assert.deepEqual(bad, []);
});

test('search ranks the food you meant first', () => {
  Foods.useDb(Foods.parseDb(raw));
  const top = (q, opts) => Foods.search(q, Object.assign({ limit: 3 }, opts)).map((f) => f.name);
  assert.equal(top('almonds')[0], 'Almonds'); // the short home-style entry first
  assert.ok(top('almonds').includes('Nuts, almonds'));
  assert.ok(top('mutton', { limit: 10 }).some((n) => /^(Goat|Sheep|Lamb)/.test(n)), 'everyday Indian word finds goat and sheep');
  assert.ok(top('bhindi').some((n) => /okra|ladies finger/i.test(n)));
  assert.ok(top('atta')[0].includes('atta'));
  assert.ok(top('moong dal').some((n) => /green gram|mung/i.test(n)));
  assert.equal(Foods.search('zzzzzz', { limit: 5 }).length, 0);
  assert.equal(Foods.search('', { limit: 5 }).length, 0);
});

test('the diet filters: Veg hides meat and egg, Veg + egg keeps egg, Non-veg shows only meat and fish', () => {
  Foods.useDb(Foods.parseDb(raw));
  const kinds = (q, diet) => new Set(Foods.search(q, { diet, limit: 200 }).map((f) => f.diet));
  assert.deepEqual([...kinds('egg', 'veg')].sort(), [0]);
  assert.deepEqual([...kinds('egg', 'egg')].sort(), [0, 1]);
  assert.deepEqual([...kinds('chicken', 'nonveg')].sort(), [2]);
  assert.equal(Foods.search('salmon', { diet: 'veg' }).length, 0);
  assert.ok(Foods.search('salmon', { diet: 'nonveg' }).length > 5);
  assert.ok(Foods.search('salmon', { diet: 'all' }).length > 5);
  assert.ok(Foods.search('pizza', { diet: 'all', limit: 100 }).some((f) => f.diet === 3), 'ready-made pizza is marked check the label');
  assert.equal(Foods.search('pizza', { diet: 'veg', limit: 100 }).filter((f) => f.diet === 3).length, 0, 'and hidden from Veg');
  assert.equal(Foods.dietFor('Vegetarian'), 'veg');
  assert.equal(Foods.dietFor('Eggetarian'), 'egg');
  assert.equal(Foods.dietFor('Anything'), 'all');
  assert.equal(Foods.dietFor(''), 'all');
});

test('amounts scale from per 100 g', () => {
  assert.deepEqual(Foods.scale({ kcal: 208, protein: 20.4, carbs: 0, fat: 13.4 }, 150), { kcal: 312, protein: 30.6, carbs: 0, fat: 20.1 });
  assert.deepEqual(Foods.scale({ kcal: 100, protein: 10, carbs: 10, fat: 1 }, 0), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});

test('the loader fetches once and keeps the result', async () => {
  let calls = 0;
  const fetcher = () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }); };
  // a fresh module instance so earlier tests have not already loaded the list
  delete require.cache[require.resolve('../js/foods.js')];
  const F2 = require('../js/foods.js');
  assert.equal(F2.ready(), false);
  const a = await F2.load(fetcher), b = await F2.load(fetcher);
  assert.equal(calls, 1); assert.equal(a, b); assert.equal(F2.ready(), true);
  delete require.cache[require.resolve('../js/foods.js')];
  const F3 = require('../js/foods.js');
  await assert.rejects(() => F3.load(() => Promise.resolve({ ok: false })), /could not be loaded/);
  assert.equal(F3.ready(), false, 'a failure can be retried');
});
