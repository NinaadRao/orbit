# Where the food data comes from

`data/foods.json` is the offline food list behind Fuel's Find tab. It is built by `scripts/build-foods.mjs` from two open datasets, both per 100 g. Nothing in it is personal, and nothing in it was written from memory.

| Part | Rows | Source | Licence |
|---|---|---|---|
| USDA | 7,225 | U.S. Department of Agriculture, FoodData Central, **SR Legacy** (Standard Reference, April 2018 release, the last one). Taken from the `usda_sr_legacy` rows of `tempo-food-db` 1.0.0 by TempoLife (Probyte OÜ). | The USDA values are public domain. The TempoLife compilation is CC-BY-4.0. Attribution: "Food nutrition data from TempoLife (tempolife.app), CC-BY-4.0." |
| India | 542 | **Indian Food Composition Tables 2017** (IFCT 2017), National Institute of Nutrition, Hyderabad (ICMR). Taken from `@ifct2017/compositions` 2.0.9 by Subhajit Sahu. | The npm package's MIT licence is the packager's and cannot grant rights to the Institute's data. The book is copyright the National Institute of Nutrition (ICMR); see "Permission to keep and share this data" below. |

Rows in `tempo-food-db` with no public source (562 curated rows, mostly Estonian dishes) are **not** used, because their values cannot be checked. Baby foods and infant formula are dropped.

## Permission to keep and share this data

This is what the sources themselves say. It is not legal advice.

- **USDA rows: free to use.** FoodData Central data is public domain, published under CC0 1.0, and no permission is needed. USDA asks users to acknowledge it: "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov."
- **TempoLife compilation: keep the attribution above** (CC-BY-4.0). It only covers their arrangement of the USDA rows, but the attribution costs nothing.
- **IFCT 2017 rows: personal use only, unless you get permission.** The book is copyright the National Institute of Nutrition, Hyderabad. It says the data may be reproduced for personal use with full acknowledgement of the source, and that no part may be stored or reproduced in any electronic format to create a product without the Institute's prior written permission. Keeping the file in your own private repository for your own app fits the personal-use wording. **Making the repository public, or putting the app on a public address (README Option B, or anything you hand to other people), goes beyond it.** Before doing that, either write to the National Institute of Nutrition for permission, or rebuild `data/foods.json` without the India rows.
- The `@ifct2017/compositions` npm package is MIT-licensed at the version used here (the main ifct2017 repository moved to AGPL-3.0 in April 2025). That licence covers the packager's code. It does not replace the Institute's permission.
- The measurements themselves are facts, and copyright over bare facts is narrow in many countries, but the Institute's book states its terms, so treat them as binding unless a lawyer tells you otherwise.

## How the numbers are prepared

- USDA: kcal, protein, carbohydrate (by difference, so it includes fibre), fat and fibre, rounded to one decimal.
- IFCT: energy converted from kJ to kcal; carbohydrate is *available* carbohydrate; protein is `protcnt`, fat is `fatce`. Oils and fats have no energy value in IFCT, so it is calculated as 4 x protein + 4 x carbohydrate + 9 x fat. One row whose energy disagreed with its own macros by more than 40% (chicken leg) also uses that calculation.
- IFCT foods are listed as **raw** unless the name says otherwise. Cooked rice, dal and so on are lighter per 100 g because they hold water; look for the "cooked" USDA entry or weigh the food raw.
- Names and Hindi/English aliases from IFCT are kept so "atta", "dahi", "kela" and "chawal" find things.

## The diet tag

Each food carries one of four tags, decided by the food group and the words in its name:

- **Veg**: no meat, fish, egg or gelatin found. Cheese is tagged veg even though some cheeses use animal rennet.
- **Egg**: is egg, or very likely contains it (cakes, cookies, egg noodles, mayonnaise, custard).
- **Non-veg**: meat, poultry, fish, shellfish, animal fat, or gelatin.
- **Check**: restaurant and fast-food items, canned soups, gravies, ready meals and anything with a brand at the front. Their ingredients are unclear, so the Veg filter hides them and only "All" shows them.

This is a filter, not a guarantee. Read labels if it matters to you.

## Rebuilding

```
npm pack tempo-food-db@1.0.0 @ifct2017/compositions@2.0.9
tar xzf tempo-food-db-1.0.0.tgz -C tempo && tar xzf ifct2017-compositions-2.0.9.tgz -C ifct
node scripts/build-foods.mjs --usda tempo/package/data/tempolife-foods.json --ifct ifct/package/index.csv
```

Package integrity (from the npm registry):

- `tempo-food-db@1.0.0`: `sha512-wALzOQ7yFjiuvXvKLase8nf1rXj39Ws1QfcL2kemdpZOBlWI0yqfYRHp/h/odaCH1VEB7E1eSdPXfZ9+mg92/w==`
- `@ifct2017/compositions@2.0.9`: `sha512-ir8tb2r9k8OWAOWBDiljLuB5MD6dy4/ct+kLuNgyRGqH0PVpI+totq+NCkvP7+gX12O3qp0uPPbuHGzwgN2uLA==`

## Not in it

Home-cooked Indian dishes (a katori of dal, a phulka, an idli, a plate of poha) are not measured in either dataset in a cooked, portioned form. Orbit keeps a short list of typical values for those, labelled "approximate", and the Describe and Ingredients tabs cover the rest.
