# Pizza Lab

A real-time 3D pizza you can build, bake, slice and pull apart, plus a size & price calculator and a recipe card. Three.js, no build step.

## Run it

```bash
python3 .claude/serve.py 5174
```

Then open http://localhost:5174.

## Layout

- `site/index.html` – page, styles and panels
- `site/js/main.js` – scene, UI, baking and cutting sequences
- `site/js/pizza.js` – pizza geometry, materials, toppings and slicing
- `site/js/cheese-pull.js` – the mozzarella strands between slices
- `site/js/ingredients.js`, `textures.js`, `sauce.js`, `oven.js` – toppings, procedural textures, poured sauce, the oven
- `site/js/calc.js`, `recipe.js` – calculator and recipe

## Credits

Textures and HDRI from Poly Haven (CC0), pizza scans from ambientCG (CC0), ingredient photos and sounds as listed in `site/assets/ingredients/credits.json` and `site/assets/sfx/credits.json` (some photos are CC BY-NC: non-commercial use only).
