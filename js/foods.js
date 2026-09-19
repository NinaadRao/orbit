/*
 * A small built-in list of common foods (per the serving shown) and the search over it.
 * The numbers are typical values for plain, home-style versions and are approximate.
 * Anything that is not listed can be typed as raw ingredients, or entered by hand.
 */
(function (root) {
  'use strict';

  // [name, serving, kcal, protein, carbs, fat, aliases]
  const RAW = [
    ['Paneer, full fat', '100 g', 290, 18, 3, 23, 'cottage cheese indian'],
    ['Paneer, high protein', '50 g', 95, 12.5, 1.5, 4.5, 'low fat paneer'],
    ['Whey protein', '1 scoop (30 g)', 120, 25, 3, 1.5, 'protein powder shake'],
    ['Greek yogurt, plain', '170 g', 100, 17, 6, 0.7, 'yoghurt yogurt'],
    ['Curd / dahi', '200 g', 130, 8, 9, 6, 'yogurt indian'],
    ['Milk, 2%', '240 ml', 122, 8, 12, 5, 'doodh'],
    ['Milk tea (chai) with sugar', '1 cup', 90, 3, 12, 3, 'chai tea'],
    ['Tofu, extra firm', '100 g', 145, 16, 3, 8, 'soy'],
    ['Soya chunks, dry', '30 g', 100, 15, 10, 0.5, 'nutrela soy chunks'],
    ['Chana, cooked', '1 cup (165 g)', 270, 14.5, 45, 4, 'chickpeas chole'],
    ['Rajma, cooked', '1 cup (177 g)', 225, 15, 40, 1, 'kidney beans'],
    ['Dal, cooked', '1 katori (150 g)', 150, 8, 22, 3, 'lentils toor moong masoor'],
    ['Sprouts, moong', '100 g', 30, 3, 6, 0.2, 'mung sprouts'],
    ['Sattu', '30 g', 105, 6, 18, 1, 'roasted gram flour'],
    ['Roti / chapati', '1 (40 g)', 120, 3.5, 20, 3, 'phulka wheat'],
    ['Rice, cooked', '1 cup (160 g)', 205, 4.3, 45, 0.4, 'white rice chawal'],
    ['Brown rice, cooked', '1 cup (195 g)', 215, 5, 45, 1.8, ''],
    ['Oats, dry', '40 g', 150, 5, 27, 2.5, 'oatmeal porridge'],
    ['Poha, cooked', '1 plate (200 g)', 270, 5, 45, 8, 'flattened rice'],
    ['Idli', '1 piece', 58, 2, 12, 0.4, 'south indian'],
    ['Dosa, plain', '1 medium', 130, 3, 25, 2, 'south indian'],
    ['Bread, whole wheat', '1 slice', 80, 4, 14, 1, 'toast'],
    ['Potato, boiled', '150 g', 130, 3, 30, 0.2, 'aloo'],
    ['Mixed vegetable sabzi', '1 katori (150 g)', 100, 2.5, 10, 5.5, 'curry veg'],
    ['Egg', '1 large', 72, 6, 0.4, 5, 'boiled omelette'],
    ['Cheese slice', '20 g', 70, 4, 0.5, 6, ''],
    ['Peanut butter', '32 g (2 tbsp)', 190, 8, 6, 16, ''],
    ['Almonds', '28 g', 165, 6, 6, 14, 'badam nuts'],
    ['Mixed nuts', '30 g', 175, 5, 6, 15, ''],
    ['Chia seeds', '10 g', 49, 1.7, 4.2, 3.1, ''],
    ['Banana', '1 medium', 105, 1.3, 27, 0.4, ''],
    ['Apple', '1 medium', 95, 0.5, 25, 0.3, ''],
    ['Ghee', '1 tsp (5 g)', 45, 0, 0, 5, 'clarified butter'],
    ['Olive oil', '1 tbsp', 119, 0, 0, 13.5, 'oil'],
  ];

  const CATALOG = RAW.map((r, i) => ({ id: 'c' + i, name: r[0], serving: r[1], kcal: r[2], protein: r[3], carbs: r[4], fat: r[5], alias: r[6] || '' }));

  function tokens(q) { return String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }

  // Every word typed has to appear in the name or alias. Names that start with the query rank first.
  function search(q, limit) {
    const t = tokens(q);
    if (!t.length) return [];
    const out = [];
    for (const f of CATALOG) {
      const hay = (f.name + ' ' + f.alias).toLowerCase();
      if (!t.every((w) => hay.includes(w))) continue;
      out.push({ f, score: (f.name.toLowerCase().startsWith(t[0]) ? 0 : 1) + (hay.includes(' ' + t[0]) ? 0 : 0.5) });
    }
    out.sort((a, b) => a.score - b.score || a.f.name.localeCompare(b.f.name));
    return out.slice(0, limit || 8).map((x) => x.f);
  }

  // Foods the person has logged before, most recent first, deduplicated by name (so their own dishes are one tap away).
  function recents(foods, limit) {
    const seen = new Set(), out = [];
    for (let i = foods.length - 1; i >= 0 && out.length < (limit || 8); i--) {
      const f = foods[i];
      const k = String(f.name || '').toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ id: 'r' + f.seq, name: f.name, serving: f.serving || 'as logged', kcal: f.kcal, protein: f.protein || 0, carbs: f.carbs || 0, fat: f.fat || 0, recent: true, meal: f.meal });
    }
    return out;
  }
  function searchRecents(foods, q, limit) {
    const t = tokens(q);
    return recents(foods, 200).filter((f) => t.every((w) => f.name.toLowerCase().includes(w))).slice(0, limit || 5);
  }

  const api = { CATALOG, search, recents, searchRecents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Foods = api;
})(typeof self !== 'undefined' ? self : this);
