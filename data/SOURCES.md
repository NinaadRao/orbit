# Where the food data comes from

`data/foods.json` is the offline food list behind Fuel's Find tab. It is built by `scripts/build-foods.mjs` from one open dataset, per 100 g. Nothing in it is personal, and nothing in it was written from memory.

| Rows | Source | Licence |
|---|---|---|
| 7,225 | U.S. Department of Agriculture, FoodData Central, **SR Legacy** (Standard Reference, April 2018 release, the last one). Taken from the `usda_sr_legacy` rows of `tempo-food-db` 1.0.0 by TempoLife (Probyte OÜ). | The USDA values are public domain (CC0 1.0). The TempoLife compilation is CC-BY-4.0. |

**Attribution that must stay with the data** (the app shows it on the Find screen and the README repeats it):

- "Food nutrition data from TempoLife (tempolife.app), CC-BY-4.0."
- "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov."

Rows in `tempo-food-db` with no public source (562 curated rows, mostly Estonian dishes) are **not** used, because their values cannot be checked. Baby foods and infant formula are dropped.

The short "typical home-style" list in `js/foods.js` (labelled approximate in the app) is a hand-entered set of round numbers for common dishes, not copied from any table.

## Permission to keep and share this data

This is what the sources themselves say. It is not legal advice.

- **USDA rows: free to use**, including in a public repository. FoodData Central data is public domain under CC0 1.0. USDA asks users to acknowledge it, which the attribution above does.
- **TempoLife compilation: keep the attribution** (CC-BY-4.0). It only covers their arrangement of the USDA rows, but the attribution costs nothing.

## Indian Food Composition Tables (not bundled)

Earlier builds of Regoal also carried 542 rows from **IFCT 2017**, National Institute of Nutrition, Hyderabad (ICMR). They were removed, and the repository's history was rewritten to drop them, because the book's terms allow reproduction for personal use with acknowledgement and do not allow storing it in any electronic format to create a product without the Institute's prior written permission. A public repository or a public app is beyond that. The `@ifct2017/compositions` npm package is MIT-licensed at the version used (the main ifct2017 repository moved to AGPL-3.0 in April 2025), but that licence is the packager's and cannot grant rights to the Institute's data.

You can still use IFCT in your own copy of Regoal for yourself: Fuel, Add food, Find, **Add my own food list** loads a CSV or JSON file that stays on your device (see [the user guide](../docs/USER_GUIDE.md#your-own-food-list)), and `scripts/ifct-to-import.mjs` converts a copy of the IFCT compositions table into that format. The converted file is yours alone; do not publish it or put it in a repository unless the Institute has given permission. If you want IFCT in the shipped app, write to the National Institute of Nutrition for permission first.

## How the numbers are prepared

- USDA: kcal, protein, carbohydrate (by difference, so it includes fibre), fat and fibre, rounded to one decimal.
- Everyday names ("atta", "dahi", "bhindi", "mutton", "ghee") are hand-written vocabulary in `scripts/build-foods.mjs`, added so a search finds the USDA row. No numbers come from there.
- For a converted IFCT file: energy is converted from kJ to kcal; carbohydrate is *available* carbohydrate; protein is `protcnt` and fat is `fatce`. Oils and fats have no energy value in IFCT, so it is calculated as 4 x protein + 4 x carbohydrate + 9 x fat. IFCT foods are raw unless the name says otherwise.

## The diet tag

Each food carries one of four tags, decided by the food group and the words in its name:

- **Veg**: no meat, fish, egg or gelatin found. Cheese is tagged veg even though some cheeses use animal rennet.
- **Egg**: is egg, or very likely contains it (cakes, cookies, egg noodles, mayonnaise, custard).
- **Non-veg**: meat, poultry, fish, shellfish, animal fat, or gelatin.
- **Check**: restaurant and fast-food items, canned soups, gravies, ready meals and anything with a brand at the front. Their ingredients are unclear, so the Veg filter hides them and only "All" shows them.

This is a filter, not a guarantee. Read labels if it matters to you.

## Rebuilding

```
npm pack tempo-food-db@1.0.0
mkdir tempo && tar xzf tempo-food-db-1.0.0.tgz -C tempo
node scripts/build-foods.mjs --usda tempo/package/data/tempolife-foods.json
```

Package integrity (from the npm registry):

- `tempo-food-db@1.0.0`: `sha512-wALzOQ7yFjiuvXvKLase8nf1rXj39Ws1QfcL2kemdpZOBlWI0yqfYRHp/h/odaCH1VEB7E1eSdPXfZ9+mg92/w==`

## Not in it

Home-cooked Indian dishes (a katori of dal, a phulka, an idli, a plate of poha) are not measured in USDA data in a cooked, portioned form. Regoal keeps a short list of typical values for those, labelled "approximate", and the Describe and Ingredients tabs cover the rest.
