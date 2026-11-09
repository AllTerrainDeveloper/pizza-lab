// The recipe for whatever pizza is on the table: a shopping list scaled to its size (and how many you make) and a
// method that adapts to the oven, the doneness you picked and the toppings on it (anything that would burn in a long
// home-oven bake goes on afterwards). Rendered as two tickable checklists that also print as a clean recipe card.

// Neapolitan-style dough by baker's percentages: everything relative to the flour weight.
const HYDRATION = 0.65, SALT = 0.028, YEAST_DRY = 0.0025;
const BALL_33 = 260; // g of dough for a 33 cm pizza; scales with the area
const AREA_33 = Math.PI * 16.5 * 16.5;

// what one piece on the pizza is in the kitchen: grams per piece, and how to name the amount you buy
const PIECES = {
	pep: { g: 2.4, name: 'Pepperoni', unit: 'slices', prep: 'Lay the slices straight on top: their edges cup and crisp in the heat.' },
	salami: { g: 3, name: 'Spicy salami (salame piccante)', unit: 'slices', prep: 'Thin slices on top, so the fat renders into the cheese.' },
	ham: { g: 8, name: 'Cooked ham (prosciutto cotto)', unit: 'pieces', prep: 'Tear into pieces.', late: 'home', after: true },
	mush: { g: 4, name: 'Mushrooms', unit: 'slices', per: 6, whole: 'mushroom', prep: 'Slice 3 mm thin and toss with a little oil and salt so they roast instead of steaming.' },
	olive: { g: 0.7, name: 'Black olives', unit: 'rings', per: 4, whole: 'olive', prep: 'Pit and slice into rings.' },
	tomato: { g: 7, name: 'Cherry tomatoes', unit: 'halves', per: 2, whole: 'tomato', prep: 'Halve them and lay them cut side up, so they roast instead of leaking.' },
	onion: { g: 2, name: 'Red onion', unit: 'rings', per: 30, whole: 'onion', prep: 'Slice paper-thin; thick rings stay raw.' },
	pepper: { g: 3, name: 'Bell peppers', unit: 'strips', per: 24, whole: 'pepper', prep: 'Cut into strips about 1 cm wide.' },
	jalapeno: { g: 1, name: 'Jalapeño', unit: 'slices', per: 12, whole: 'jalapeño', prep: 'Slice into rings (seeds out for less heat).' },
	pineapple: { g: 8, name: 'Pineapple', unit: 'chunks', prep: 'Cut into small chunks and pat dry: wet fruit makes the base soggy.' },
	corn: { g: 0.35, name: 'Sweetcorn', unit: 'kernels', prep: 'Drain well and pat dry.' },
	basil: { g: 0.5, name: 'Fresh basil', unit: 'leaves', late: 'home', after: true },
	flake: { g: 0.02, name: 'Chili flakes', unit: 'flakes', pinch: true },
	chili: { g: 0.02, name: 'Chili flakes', unit: 'flakes', pinch: true },
	mozz: { g: 12, name: 'Mozzarella', unit: 'pieces', cheese: true, prep: 'Tear into pieces and leave them to drain for 30 minutes: wet cheese floods the pizza.' },
	shred: { g: 0.6, name: 'Shredded low-moisture mozzarella', unit: 'shreds', cheese: true },
	gorgo: { g: 4, name: 'Gorgonzola', unit: 'pieces', cheese: true, prep: 'Crumble into small pieces.', late: 'home' },
};

const SCANS = {
	scan1: [['Tuna in olive oil, drained', 80], ['Red onion, thinly sliced', 40], ['Mozzarella', 100]],
	scan2: [['Spinach (wilted and squeezed dry)', 120], ['Mozzarella', 90], ['Parmesan, grated', 20]],
	scan3: [['Courgette, grilled slices', 60], ['Aubergine, grilled slices', 60], ['Bell pepper, roasted strips', 50], ['Mozzarella', 100]],
	scan4: [['Spinach (wilted and squeezed dry)', 120], ['Ricotta', 80], ['Mozzarella', 80]],
};

const round = (v, step) => Math.max(step, Math.round(v / step) * step);

export function buildRecipe(o) {
	// o: { type, recipe, toppings, D (cm), slices, done (0..160), oven ('home'|'wood'), pizzas, sauce (0..1 coverage),
	//      imperial, fahrenheit }
	const s = (Math.PI * (o.D / 2) ** 2) / AREA_33, n = Math.max(1, o.pizzas | 0);
	const ball = Math.max(140, BALL_33 * s);
	const flour = (ball / (1 + HYDRATION + SALT + YEAST_DRY)) * n;
	const g = (v) => (o.imperial ? `${round(v, v < 20 ? 1 : 5)} g (${(v / 28.35).toFixed(v < 57 ? 1 : 0)} oz)` : `${round(v, v < 20 ? 1 : 5)} g`);
	const T = (c) => (o.fahrenheit ? `${Math.round(((c * 9) / 5 + 32) / 5) * 5}°F` : `${c}°C`);

	// --- what's on it
	const count = {};
	for (const t of o.toppings || []) count[t.kind] = (count[t.kind] || 0) + 1;
	if (o.type === 'diavola') count.chili = (count.chili || 0) + 1;
	const cheeseBase = o.recipe?.cheese || 'none';
	const scan = SCANS[o.type];

	const dough = [
		{ id: 'flour', label: 'Flour (Italian “00” or bread flour)', qty: g(flour) },
		{ id: 'water', label: 'Water, cool', qty: g(flour * HYDRATION) },
		{ id: 'salt', label: 'Fine sea salt', qty: g(flour * SALT) },
		{ id: 'yeast', label: 'Instant dry yeast', qty: `${(flour * YEAST_DRY).toFixed(1)} g`, note: `or ${(flour * YEAST_DRY * 3).toFixed(1)} g fresh yeast` },
	];
	const top = [];
	const sauceG = 80 * s * n * (o.sauce ?? 1);
	if (sauceG > 5) top.push({ id: 'sauce', label: 'Tomato passata or crushed San Marzano tomatoes', qty: g(sauceG), note: 'with a pinch of salt; no need to cook it' });
	if (cheeseBase === 'fior') top.push({ id: 'fior', label: 'Fior di latte mozzarella', qty: g(110 * s * n), note: 'torn and drained' });
	if (cheeseBase === 'shred') top.push({ id: 'shredbase', label: 'Low-moisture mozzarella, grated', qty: g(120 * s * n) });
	if (scan) for (const [label, grams] of scan) top.push({ id: 'scan-' + label, label, qty: g(grams * s * n) });
	const keys = Object.keys(count).filter((k) => PIECES[k]);
	const seen = new Set();
	for (const k of keys) {
		const P = PIECES[k];
		if (seen.has(P.name)) continue;
		seen.add(P.name);
		const pcs = keys.filter((q) => PIECES[q].name === P.name).reduce((a, q) => a + count[q], 0) * n;
		let qty;
		if (P.pinch) qty = o.type === 'diavola' ? 'a good pinch' : 'a pinch';
		else if (P.whole) qty = `${pcs} ${P.unit} · about ${Math.max(1, Math.ceil(pcs / P.per))} ${P.whole}${Math.ceil(pcs / P.per) > 1 && !/s$/.test(P.whole) ? 's' : ''}`;
		else qty = `${pcs} ${P.unit} · ${g(pcs * P.g)}`;
		top.push({ id: 'top-' + k, label: P.name, qty });
	}
	top.push({ id: 'oil', label: 'Extra-virgin olive oil', qty: 'to finish' });

	// --- timing
	const done = o.done ?? 100;
	const f = 0.55 + 0.45 * (done / 100);
	const wood = o.oven === 'wood';
	const bakeS = wood ? Math.round(75 * f) : Math.round(8 * 60 * f);
	const fmt = (sec) => (sec < 120 ? `${sec} s` : `${Math.floor(sec / 60)}${sec % 60 >= 30 ? '½' : ''} min`);
	const doneWord = done < 60 ? 'pale and soft' : done < 85 ? 'lightly golden' : done < 115 ? 'golden with leopard spots' : done < 140 ? 'well done and crisp' : 'deeply charred';

	// toppings that would burn or dry out in a long home bake go on later
	const present = (k) => (count[k] || 0) > 0;
	const after = [], half = [];
	if (!wood && present('basil')) after.push('basil');
	if (present('ham')) after.push('ham');
	if (present('flake') || present('chili')) after.push('chili flakes');
	if (!wood && cheeseBase === 'fior') half.push('the fior di latte');
	if (!wood && present('gorgo')) half.push('the gorgonzola');
	const listify = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

	const steps = [];
	steps.push({ id: 'mix', title: 'Mix the dough', time: '15 min', text: `Stir the yeast into the water, add it to the flour and mix until no dry flour is left. Rest it 20 minutes, add the salt, then knead for 8–10 minutes until smooth and springy.` });
	steps.push({ id: 'rise', title: 'Let it rise', time: '24 h', text: `Cover and leave it 2 hours at room temperature, then shape ${n > 1 ? `${n} balls of about ${g(ball)}` : `a ball of about ${g(ball)}`} and keep ${n > 1 ? 'them' : 'it'} in a covered box in the fridge for 24 hours (up to 48). In a hurry: 6–8 hours at room temperature works too.` });
	steps.push({ id: 'temper', title: 'Bring the dough to room temperature', time: '2 h', text: 'Take the dough out of the fridge two hours before baking. Cold dough tears and doesn’t puff.' });
	steps.push(wood
		? { id: 'heat', title: 'Fire the oven', time: '1–2 h', text: `Build the fire until the dome turns from black to white and the floor reads about ${T(450)}. Push the fire to one side and brush the floor clean.` }
		: { id: 'heat', title: 'Preheat the oven', time: '45 min', text: `Put a pizza steel or stone on the top shelf and heat the oven to its maximum (${T(250)}–${T(290)}) for at least 45 minutes. The hot surface is what cooks the base.` });
	const preps = keys.map((k) => PIECES[k]).filter((P, i, a) => P.prep && a.findIndex((q) => q.name === P.name) === i).map((P) => `<li><b>${P.name}:</b> ${P.prep}</li>`);
	if (cheeseBase === 'fior') preps.unshift('<li><b>Fior di latte:</b> tear it into pieces and let it drain in a sieve for 30 minutes. Wet cheese floods the pizza.</li>');
	if (preps.length) steps.push({ id: 'prep', title: 'Prepare the toppings', time: '15 min', html: `<ul>${preps.join('')}</ul>` });
	steps.push({ id: 'shape', title: 'Shape the base', time: '2 min', text: `On a floured counter, press the ball out from the middle with your fingertips, leaving a 1.5–2 cm rim untouched (that becomes the puffy crust). Stretch it gently to ⌀ ${Math.round(o.D)} cm${o.imperial ? ` (${Math.round(o.D / 2.54)}″)` : ''}. No rolling pin: it squeezes out the air.` });
	const layer = [];
	if (sauceG > 5) layer.push(`spread about ${g(sauceG / n)} of tomato in a spiral with the back of a spoon, leaving the rim bare`);
	if (cheeseBase === 'shred') layer.push('scatter the grated mozzarella');
	if (cheeseBase === 'fior' && wood) layer.push('dot the drained fior di latte');
	const onTop = keys.filter((k) => !['basil', 'ham', 'flake', 'chili'].includes(k) && !(k === 'gorgo' && !wood)).map((k) => PIECES[k].name.toLowerCase());
	if (onTop.length) layer.push(`add the ${listify([...new Set(onTop)])}${present('pep') || present('salami') ? ' (cured meats on top, so they crisp)' : ''}`);
	if (wood && present('basil')) layer.push('tuck in a few basil leaves (the short bake keeps them green)');
	steps.push({ id: 'top', title: 'Top it', time: '3 min', text: layer.length ? `Work quickly so the dough doesn’t stick: ${listify(layer)}. Give the peel a shake to check it slides.` : 'Brush with a little olive oil and a pinch of salt (a pizza bianca). Give the peel a shake to check it slides.' });
	const bakeText = wood
		? `Slide it onto the hot floor near the fire. Turn it a quarter every 20 seconds with the peel. It’s ready in about ${fmt(bakeS)}, ${doneWord}.`
		: `Slide it onto the steel and bake for about ${fmt(bakeS)} in total, turning it halfway${half.length ? `. At ${fmt(Math.round(bakeS / 2))}, pull it out, add ${listify(half)}, and slide it back in (it would overcook and go watery if it went in at the start)` : ''}. Take it out when it’s ${doneWord}.`;
	steps.push({ id: 'bake', title: 'Bake', time: fmt(bakeS), text: bakeText, action: { id: 'bake', label: 'Bake it in 3D' }, warn: done >= 140 ? 'Charred is a style, but watch it closely: past this point it turns bitter.' : null });
	const fin = ['drizzle with olive oil'];
	if (after.length) fin.unshift(`add the ${listify(after)} now${!wood && present('basil') ? ': basil turns black in a long oven bake' : ''}${present('ham') ? ', and the ham stays juicy instead of drying out' : ''}`);
	steps.push({ id: 'finish', title: 'Finish and rest', time: '1 min', text: `${fin.join(', then ').replace(/^./, (c) => c.toUpperCase())}. Let it rest for a minute so the cheese sets and the toppings don’t slide.` });
	steps.push({ id: 'slice', title: `Cut into ${o.slices} slice${o.slices > 1 ? 's' : ''}`, time: '1 min', text: 'Use a pizza wheel, pressing through in one confident roll from edge to edge.', action: { id: 'cut', label: 'Cut it in 3D' } });

	const area = Math.PI * (o.D / 2) ** 2;
	const serves = Math.max(1, Math.round((area * n) / 420));
	return {
		title: o.type === 'custom' ? 'Your pizza' : o.recipe?.name || 'Pizza',
		meta: `⌀ ${Math.round(o.D)} cm${o.imperial ? ` (${Math.round(o.D / 2.54)}″)` : ''} · ${o.slices} slice${o.slices > 1 ? 's' : ''} · serves about ${serves}`,
		groups: [{ title: `Dough (${n > 1 ? `${n} balls` : '1 ball'})`, items: dough }, { title: 'Toppings', items: top }],
		steps,
	};
}

// --- rendering --------------------------------------------------------------------------------------------------
const TICKS = 'pizzalab-ticks';
const loadTicks = () => { try { return JSON.parse(localStorage.getItem(TICKS) || '{}'); } catch { return {}; } };
const saveTicks = (t) => { try { localStorage.setItem(TICKS, JSON.stringify(t)); } catch { /* private mode */ } };

export function renderRecipe(root, r, opts) {
	const ticks = loadTicks();
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
	const box = (id) => `<input type="checkbox" data-tick="${id}"${ticks[id] ? ' checked' : ''}>`;
	root.querySelector('.rc-title').textContent = r.title;
	root.querySelector('.rc-meta').textContent = r.meta;
	root.querySelector('.rc-list').innerHTML = r.groups.map((gr) => `<h4>${esc(gr.title)}</h4><ul class="checks">${gr.items.map((it) =>
		`<li><label>${box('i-' + it.id)}<span class="ck"></span><span class="it">${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ''}</span><b class="q">${esc(it.qty)}</b></label></li>`).join('')}</ul>`).join('');
	root.querySelector('.rc-steps').innerHTML = r.steps.map((st, i) =>
		`<li class="step"><label>${box('s-' + st.id)}<span class="num">${i + 1}</span><span class="st"><b>${esc(st.title)}</b>${st.time ? `<em class="time">${esc(st.time)}</em>` : ''}</span></label>` +
		`<div class="body">${st.html || `<p>${esc(st.text)}</p>`}${st.warn ? `<p class="warn">${esc(st.warn)}</p>` : ''}${st.action ? `<button class="act-btn" data-act="${st.action.id}">${esc(st.action.label)}</button>` : ''}</div></li>`).join('');
	const total = root.querySelectorAll('[data-tick]').length, done = root.querySelectorAll('[data-tick]:checked').length;
	root.querySelector('.rc-progress').style.setProperty('--p', total ? done / total : 0);
	root.querySelector('.rc-count').textContent = `${done} / ${total} done`;
	root.querySelectorAll('[data-tick]').forEach((c) => c.addEventListener('change', () => {
		const t = loadTicks();
		if (c.checked) t[c.dataset.tick] = 1; else delete t[c.dataset.tick];
		saveTicks(t);
		const d = root.querySelectorAll('[data-tick]:checked').length;
		root.querySelector('.rc-progress').style.setProperty('--p', d / total);
		root.querySelector('.rc-count').textContent = `${d} / ${total} done`;
	}));
	root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => opts.onAction?.(b.dataset.act)));
}

export function clearTicks() { saveTicks({}); }
