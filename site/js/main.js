import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createLibrary, Pizza, U, makeCutter, CHEESE_Y, RECIPES, loadScan } from './pizza.js';
import { KINDS, PALETTE, loadPhotoIngredients } from './ingredients.js';
import { Oven } from './oven.js';
import { makeSoftSprite, makeFlour } from './textures.js';
import { sstep } from './noise.js';
import { TAU } from './geo.js';
import * as SFX from './audio.js';
import { SauceField, Ladle, setSauceGrid } from './sauce.js';
import { PRESETS, compute, render as renderCalc } from './calc.js';
import { buildRecipe, renderRecipe, clearTicks } from './recipe.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;
if (TOUCH) {
	document.documentElement.classList.add('touch');
	addEventListener('DOMContentLoaded', () => $$('.act').forEach((e) => { e.textContent = e.textContent === 'Click' ? 'Tap' : 'tap'; }));
}
const loadMsg = (m) => { $('#loadmsg').textContent = m; };
// Yield so the loading message can paint. Hidden tabs get no animation frames at all, so there a plain
// timeout is used: the pizza keeps preparing in a background tab instead of waiting to be looked at.
const frame = () => new Promise((r) => (document.hidden ? setTimeout(r, 0) : requestAnimationFrame(() => requestAnimationFrame(r))));

/* ---------------------------------------------------------------- renderer & scene */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('#stage').appendChild(renderer.domElement);

const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.className = 'labels';
$('#stage').appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120b08);
// Fog anchored to the pizza, not the camera: it starts just past the pizza at whatever zoom (see loop), so zooming
// out never sinks the pizza into darkness; only the far table fades away. (Camera-based exp fog hid the pizza at
// ~87% when zoomed all the way out.)
const tableFog = new THREE.Fog(0x120b08, 9.5, 25);
tableFog.span = 16;
const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.05, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = 1.32;
controls.minDistance = 1.4;
controls.maxDistance = 26;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.18, 0.5, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
key.position.set(4.5, 9, 3.5);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.bias = -0.00015;
key.shadow.normalBias = 0.004;
const setShadowBox = (h) => {
	const c = key.shadow.camera;
	c.left = c.bottom = -h; c.right = c.top = h; c.near = 1; c.far = 30;
	c.updateProjectionMatrix();
};
setShadowBox(2.6);
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xffc89a, 0.6);
rim.position.set(-6, 4, -5);
scene.add(rim);

/* ---------------------------------------------------------------- state */
const state = {
	mode: 'table', busy: false, type: 'pepperoni', size: 33, hot: 0.85, time: 0,
	bake: { running: false, turned: false, resolve: null },
};
const tweens = [];
const easeIO = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeSine = (k) => -(Math.cos(Math.PI * k) - 1) / 2;
const tween = (dur, fn, ease = easeIO) => new Promise((res) => tweens.push({ t: 0, dur, fn, ease, res }));
const wait = (s) => tween(s, () => {});
let toastTimer;
function toast(html, ms = 3200) {
	const t = $('#toast');
	t.innerHTML = html;
	t.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function lookFrom(x, y, z, target) {
	camera.position.set(x, y, z);
	controls.target.copy(target);
	controls.update();
}
function flyTo(position, target, dur) {
	const from = camera.position.clone(), targetFrom = controls.target.clone();
	return tween(dur, (k) => { camera.position.lerpVectors(from, position, k); controls.target.lerpVectors(targetFrom, target, k); });
}
const TABLE_VIEW = { position: new THREE.Vector3(0, 5.4, 6.6), target: new THREE.Vector3(0, 0.15, 0) };
// The table is lit by daylight and the room; inside the oven almost all the light comes from the fire.
function setAmbience(inOven) {
	scene.environmentIntensity = inOven ? 0.16 : 0.8;
	scene.fog = inOven ? null : tableFog;
	key.intensity = inOven ? 0.15 : 2.4;
	rim.intensity = inOven ? 0.1 : 0.6;
	Object.assign(bloom, inOven ? { strength: 0.55, threshold: 0.9, radius: 0.45 } : { strength: 0.18, threshold: 1.6, radius: 0.5 });
	state.table.visible = state.flour.visible = stage.visible = steam.visible = !inOven;
	oven.group.visible = inOven;
	controls.enabled = !inOven;
}
function fadeTo(v, dur) {
	const f = $('#fade');
	f.style.transition = `opacity ${dur}s ease`;
	f.style.opacity = v;
	return wait(dur);
}

/* ---------------------------------------------------------------- loading */
async function loadAssets() {
	const tl = new THREE.TextureLoader();
	const load = (u, srgb = true) => new Promise((res, rej) => tl.load(u, (t) => {
		if (srgb) t.colorSpace = THREE.SRGBColorSpace;
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.anisotropy = renderer.capabilities.getMaxAnisotropy();
		res(t);
	}, undefined, rej));
	const [boardDiff, boardNorm] = await Promise.all([load('assets/wooden_cutting_board_diff_1k.jpg'), load('assets/wooden_cutting_board_nor_gl_1k.jpg', false)]);
	const [woodDiff, woodNorm, woodRough, brickDiff, brickNorm, hdr] = await Promise.all([
		load('assets/wood_table_001_diff_1k.jpg'), load('assets/wood_table_001_nor_gl_1k.jpg', false),
		load('assets/wood_table_001_rough_1k.jpg', false), load('assets/red_brick_03_diff_1k.jpg'),
		load('assets/red_brick_03_nor_gl_1k.jpg', false),
		new RGBELoader().loadAsync('assets/kiara_interior_1k.hdr'),
	]);
	hdr.mapping = THREE.EquirectangularReflectionMapping;
	return { woodDiff, woodNorm, woodRough, brickDiff, brickNorm, hdr, boardDiff, boardNorm };
}

let lib, pizza, oven, cutter, stage, board, peel, steam, compare, T;
const grooveGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const grooveMat = new THREE.MeshBasicMaterial({ color: 0x2a0d06, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });


// The calculator needs none of the 3D: it is wired up first, so it answers while textures are still baking.
function bindCalc() {
	$$('[data-preset]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
	// Sizes are remembered in centimetres so switching units back and forth never drifts.
	const SIZE_IDS = ['#aD', '#bD', '#crustW'];
	const toCm = () => { const k = $('#unit').value === 'in' ? 2.54 : 1; for (const id of SIZE_IDS) canonCm[id] = (parseFloat($(id).value) || 0) * k; };
	toCm();
	SIZE_IDS.forEach((id) => $(id).addEventListener('input', toCm));
	$('#unit').dataset.prev = $('#unit').value;
	$('#unit').addEventListener('change', () => {
		const u = $('#unit').value;
		if (u === $('#unit').dataset.prev) return;
		for (const id of SIZE_IDS) $(id).value = u === 'in' ? +(canonCm[id] / 2.54).toFixed(2) : +canonCm[id].toFixed(2);
		$('#unit').dataset.prev = u;
		updateCalc();
		toast(`Converted sizes to ${u === 'in' ? 'inches' : 'centimetres'}`, 1800);
	});
	$$('#calc input, #calc select').forEach((i) => i.addEventListener('input', updateCalc));
	// someone using the calculator while the 3D loads keeps it open when the pizza is ready
	$$('#calc input, #calc select, #calc .presets button').forEach((i) => i.addEventListener(i.tagName === 'BUTTON' ? 'click' : 'input', () => { calcTouched = true; }));
	$('#result').addEventListener('click', (e) => {
		if (e.target.closest('.jump')) { e.preventDefault(); const d = $('.explain'); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
	});
	// first visit: the default comparison in the visitor's own currency (and inches where pizzas are sold in inches)
	applyPreset('familiar');
	$('#bk-temp').textContent = LOCALE.fahrenheit ? '878°F' : '470°C';
}

async function init() {
	bindCalc();
	document.body.classList.add('calc-early');
	if (panelInHash()) setPanel(panelInHash());
	else if (innerWidth > 1150) setPanel('calc');
	refreshRecipe(true);
	// start downloading the ingredient photos now; they are decoded later, after the textures are generated
	fetch('assets/ingredients/credits.json').then((r) => r.json()).then((cs) => cs.forEach((c) => {
		new Image().src = `assets/ingredients/${c.name}/color.jpg`;
		fetch(`assets/ingredients/${c.name}/outline.json`).catch(() => {});
	})).catch(() => {});
	loadMsg('Fetching wood, bricks & light');
	T = await loadAssets();
	scene.environment = T.hdr;

	const steps = ['Simmering the tomato sauce', 'Kneading the dough', 'Shredding mozzarella', 'Tearing fior di latte'];
	let si = 0;
	loadMsg(steps[0]);
	await frame();
	lib = createLibrary(() => { loadMsg(steps[Math.min(si++, steps.length - 1)]); });
	setSauceGrid(lib.quality > 1 ? 256 : 160);
	sauceField = new SauceField();
	lib.uSauce.value = sauceField.tex;
	loadMsg('Slicing the real ingredients');
	try {
		await loadPhotoIngredients(lib);
		const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
		const pretty = (n) => (n === 'pepperoni_real' ? 'pepperoni slice' : n === 'salami_slice' && !lib.photoUsed?.has('pepperoni_real') ? 'salami & pepperoni slice' : n.replace(/_/g, ' '));
		const items = (lib.photoCredits || []).filter((c) => lib.photoUsed?.has(c.name) && /^https:\/\//.test(c.source)); // Wikimedia Commons, Flickr…
		if (items.length) {
			const nc = items.some((c) => /NC/.test(c.license));
			$('.credits div').insertAdjacentHTML('beforeend', `<br><b>Ingredient photos</b>: ${items.map((c) => `<a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(pretty(c.name))}</a> by ${esc(c.author)} (${esc(c.license)})`).join(', ')}.${nc ? '<br>Pizza Lab is a free, non-commercial project, so photos licensed for non-commercial use (CC BY-NC) are used within their terms.' : ''}`);
		}
	} catch (e) { console.warn('photo ingredients unavailable', e); }
	loadMsg('Firing up the oven');
	await frame();

	// table
	const tableMat = (rep) => woodMat(rep, { color: 0xc9b097, roughness: 0.86, envMapIntensity: 0.14 });
	const table = new THREE.Mesh(new THREE.PlaneGeometry(44, 44).rotateX(-Math.PI / 2), tableMat(5));
	table.receiveShadow = true;
	scene.add(table);
	state.table = table;
	const flour = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
		new THREE.MeshStandardMaterial({ map: makeFlour(), transparent: true, depthWrite: false, roughness: 1 }));
	flour.position.y = 0.004;
	flour.receiveShadow = true;
	scene.add(flour);
	state.flour = flour;

	// board + pizza
	stage = new THREE.Group();
	scene.add(stage);
	board = makeBoard();
	stage.add(board);
	pizza = new Pizza(lib, state.type);
	pizza.sauceField = sauceField;
	pizza.stringParent = scene;
	stage.add(pizza.root);
	applySize();

	setupBuilder();
	cutter = makeCutter();
	scene.add(cutter);

	// steam
	steam = new THREE.Group();
	const soft = makeSoftSprite();
	for (let i = 0; i < 30; i++) {
		const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, transparent: true, depthWrite: false, opacity: 0, color: 0xffffff }));
		sp.userData = { ph: Math.random(), sp: 0.16 + Math.random() * 0.12, a: Math.random() * TAU, r: Math.sqrt(Math.random()) * 0.75, rot: (Math.random() - 0.5) * 0.6 };
		steam.add(sp);
	}
	scene.add(steam);
	applySize();

	// oven
	oven = new Oven(scene, T);
	oven.camera = camera;
	const ovenFloor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), tableMat(8));
	ovenFloor.position.set(0, -6, 0);
	ovenFloor.receiveShadow = true;
	oven.group.add(ovenFloor);
	peel = makePeel();
	oven.group.add(peel);

	setAmbience(false);
	lookFrom(0, 5.4, 6.6, TABLE_VIEW.target);

	window.pizzaLab = { state, get pizza() { return pizza; }, camera, controls, renderer, scene, get oven() { return oven; } };
	bindUI();
	buildPalette();
	applyViewOffset();
	renderer.setAnimationLoop(loop);
	await frame();
	$('#loader').classList.add('gone');
	document.body.classList.add('ready');
	// a link can open straight on a tab (#recipe, #calc); otherwise the calculator was only a stop-gap while loading
	if (panelInHash()) setPanel(panelInHash());
	else if (!calcTouched) setPanel('build');
	addEventListener('hashchange', () => { if (panelInHash()) setPanel(panelInHash()); });
	await wait(0.9);
	toast(`<b>Fresh out of the oven</b><span>${TOUCH ? 'Tap' : 'Press'} <b>Cut</b> to slice it, then ${TOUCH ? 'tap' : 'click'} a slice to lift it.</span>`, 5200);
}

function woodMat(rep, params) {
	const tiled = (t) => { const c = t.clone(); c.repeat.set(rep, rep); c.needsUpdate = true; return c; };
	return new THREE.MeshStandardMaterial({ map: tiled(T.woodDiff), normalMap: tiled(T.woodNorm), ...params });
}

let boardMat = null;
function makeBoard() {
	const g = new THREE.Group();
	if (!boardMat) {
		boardMat = new THREE.MeshStandardMaterial({ map: T.boardDiff, normalMap: T.boardNorm, color: 0xd9b08a, roughness: 0.88, envMapIntensity: 0.25 });
		// the texture is the UV atlas of a scanned board: use only a clean square of its flat face
		for (const t of [boardMat.map, boardMat.normalMap]) { t.repeat.set(0.36, 0.36); t.offset.set(0.61, 0.49); }
	}
	if (!makeBoard.side) {
		// long grain wrapping around the rim (table wood, tinted to match the board)
		const d = T.woodDiff.clone(); d.repeat.set(4, 0.35); d.needsUpdate = true;
		const n = T.woodNorm.clone(); n.repeat.copy(d.repeat); n.needsUpdate = true;
		makeBoard.side = new THREE.MeshStandardMaterial({ map: d, normalMap: n, color: 0xe0a46c, roughness: 0.88, envMapIntensity: 0.2 });
	}
	// cylinder groups: 0 = side, 1 = top, 2 = bottom
	const disk = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128), [makeBoard.side, boardMat, boardMat]);
	disk.position.y = 0.5;
	disk.castShadow = disk.receiveShadow = true;
	g.add(disk);
	g.userData.disk = disk;
	if (!makeBoard.contact) {
		const c = document.createElement('canvas'); c.width = c.height = 256;
		const x = c.getContext('2d');
		const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
		gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.78)');
		gr.addColorStop(0.78, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.9, 'rgba(0,0,0,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
		x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
		const tex = new THREE.CanvasTexture(c);
		makeBoard.contact = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
	}
	const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.9).rotateX(-Math.PI / 2), makeBoard.contact);
	contact.position.y = 0.004; // just above the table (the group's y scale is applied to this offset)
	contact.renderOrder = 1;
	g.add(contact);
	return g;
}

function makePeel() {
	const g = new THREE.Group();
	const mat = woodMat(0.5, { color: 0xd6b087, roughness: 0.7 });
	const blade = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.04, 96), mat);
	blade.scale.set(1.85, 1, 1.85);
	blade.position.y = 0.02;
	const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6, 16).rotateX(Math.PI / 2), mat);
	handle.position.set(0, 0.06, 4.8);
	g.add(blade, handle);
	g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
	g.visible = false;
	return g;
}

function applySize(final = true) {
	const s = state.size / 20;
	pizza.setRealSize(state.size / 33, final); // toppings keep their real size; the dough grows
	const boardH = 0.22;
	board.scale.set(s * 1.1, boardH, s * 1.1);
	if (pizza.root.parent === stage) {
		pizza.root.position.set(0, boardH + 0.002, 0);
	}
	pizza.root.scale.setScalar(s);
	if (!compare) setShadowBox(Math.max(2.6, s * 1.2 + 0.6));
	if (!steam) return;
	steam.position.set(0, boardH + 0.1, 0);
	steam.scale.setScalar(s);
}

/* ---------------------------------------------------------------- cutting */
async function doCut(N) {
	if (state.busy) return;
	state.busy = true;
	document.body.classList.add('busy');
	pizza.release();
	if (pizza.N > 1) { pizza.setExplode(0); await wait(0.45); }
	// stay whole while the wheel rolls; slices only exist once every cut is made
	pizza.build(1);
	if (N > 1) {
		const s = state.size / 20;
		const root = new THREE.Vector3();
		pizza.root.getWorldPosition(root);
		const lines = [];
		if (N % 2 === 0) for (let k = 0; k < N / 2; k++) lines.push([-1.08, 1.08, (k * TAU) / N]);
		else for (let k = 0; k < N; k++) lines.push([-0.02, 1.08, (k * TAU) / N]);
		const y = root.y + (CHEESE_Y + 0.02) * s + 0.4;
		const grooveY = root.y + (CHEESE_Y + 0.012) * s;
		const grooves = [];
		cutter.visible = true;
		const spin = cutter.userData.spin;
		for (const [t0, t1, a] of lines) {
			const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
			cutter.rotation.y = a;
			const from = root.clone().addScaledVector(dir, t0 * s), to = root.clone().addScaledVector(dir, t1 * s);
			from.y = to.y = y;
			cutter.position.copy(from).y += 0.5;
			const groove = new THREE.Mesh(grooveGeo, grooveMat);
			groove.rotation.y = a - Math.PI / 2;
			groove.visible = false;
			scene.add(groove);
			grooves.push(groove);
			await tween(0.14, (k) => { cutter.position.y = y + 0.5 * (1 - k); }, easeSine);
			SFX.crunch();
			const gs = Math.max(t0, -1), ge = Math.min(t1, 1);
			await tween(0.55 + 0.1 * s, (k) => {
				cutter.position.lerpVectors(from, to, k);
				spin.rotation.x = (k * (t1 - t0) * s) / 0.42;
				const cur = Math.min(ge, Math.max(gs, t0 + (t1 - t0) * k));
				const len = Math.max(0.0001, cur - gs);
				groove.visible = len > 0.01;
				groove.scale.set(len * s, 1, 0.012 * s);
				groove.position.copy(root).addScaledVector(dir, (gs + len / 2) * s);
				groove.position.y = grooveY;
			}, easeSine);
			await tween(0.12, (k) => { cutter.position.y = y + 0.5 * k; }, easeSine);
		}
		cutter.visible = false;
		pizza.build(N);
		grooves.forEach((g) => scene.remove(g));
		pizza.setExplode(0.006); // a hairline seam, as left by a real wheel
	}
	state.busy = false;
	document.body.classList.remove('busy');
}

/* ---------------------------------------------------------------- baking */
function doneLabel(b) {
	if (b < 0.12) return 'Raw dough';
	if (b < 0.55) return 'Setting';
	if (b < 0.88) return 'Lightly baked';
	if (b < 1.13) return 'Perfetto';
	if (b < 1.32) return 'Well done';
	return 'Carbonizzata';
}
function rating(b) {
	if (b < 0.6) return ['Underbaked', 'Still doughy in the middle. Back it goes!'];
	if (b < 0.88) return ['A little pale', 'Edible, but the cornicione wants more colour.'];
	if (b < 1.13) return ['Perfetto! 🤌', 'Leopard-spotted crust, bubbling cheese. A true pizzaiolo.'];
	if (b < 1.32) return ['Well done', 'Crispy and smoky. Some people like it this way.'];
	return ['Carbonizzata 🔥', 'Call the fire brigade. Maybe try again?'];
}
function setBake(b) {
	U.uBake.value = b;
	U.uRise.value = 0.8 + 0.2 * sstep(0.05, 0.6, b);
	pizza.updateHeights();
	if (compare) compare.pizzas.forEach((p) => p.updateHeights());
	$('#done').value = Math.round(b * 100);
	$('#doneOut').textContent = doneLabel(b);
}

async function bakeSequence() {
	if (state.busy || state.mode !== 'table') return;
	if (compare) toggleCompare(false);
	state.busy = true;
	document.body.classList.add('busy', 'baking');
	$('.credits').open = false;
	if (state.tool) selectTool(state.tool);
	pizza.release();
	if (pizza.N > 1) { pizza.setExplode(0); await wait(0.4); }
	await fadeTo(1, 0.5);
	pizza.build(1);
	setBake(0);
	state.hot = 0;
	state.mode = 'oven';
	applyViewOffset();
	setAmbience(true);
	oven.group.add(pizza.root);
	pizza.root.position.set(0, 0.045, 8.4);
	pizza.root.rotation.y = 0;
	peel.position.set(0, 0, 8.4);
	peel.scale.setScalar(state.size / 33);
	peel.visible = true;
	const O = oven.group.position;
	lookFrom(O.x, O.y + 3.4, O.z + 15.5, new THREE.Vector3(O.x, O.y + 0.9, O.z + 1.5));
	SFX.fire(true);
	await fadeTo(0, 0.7);
	await tween(1.8, (k) => { pizza.root.position.z = peel.position.z = 8.4 - 7.8 * k; });
	await tween(0.8, (k) => { peel.position.z = 0.6 + 9 * k; });
	peel.visible = false;
	$('#bakehud').classList.add('show');
	state.bake.running = true;
	state.bake.turned = false;
	await new Promise((res) => { state.bake.resolve = res; });
	state.bake.running = false;
	$('#bakehud').classList.remove('show');
	const b = U.uBake.value;
	peel.visible = true;
	peel.position.z = 9.6;
	await tween(0.7, (k) => { peel.position.z = 9.6 - 9 * k; });
	await tween(1.4, (k) => { pizza.root.position.z = peel.position.z = 0.6 + 7.8 * k; });
	await fadeTo(1, 0.5);
	SFX.fire(false);
	peel.visible = false;
	state.mode = 'table';
	applyViewOffset();
	setAmbience(false);
	stage.add(pizza.root);
	applySize();
	lookFrom(0, 4.4, 5.6, TABLE_VIEW.target);
	state.hot = b > 0.5 ? 1 : 0.3;
	await fadeTo(0, 0.6);
	const [t, d] = rating(b);
	SFX.chime();
	toast(`<b>${t}</b><span>${d}</span>`, 5200);
	state.busy = false;
	document.body.classList.remove('busy', 'baking');
}

function bakeTick(dt) {
	const B = state.bake;
	const cur = U.uBake.value;
	let b = cur + (dt / 8.5) * (cur > 0.85 && cur < 1.18 ? 0.38 : 1);
	setBake(b);
	SFX.sizzle(Math.min(1, b));
	const secs = b * 90;
	$('#bk-time').textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
	$('#bk-needle').style.left = `${Math.min(100, (b / 1.6) * 100)}%`;
	$('#bk-state').textContent = doneLabel(b);
	const tC = 470 + Math.sin(state.time * 3) * 8; // a Neapolitan floor runs ~430-480 °C
	$('#bk-temp').textContent = LOCALE.fahrenheit ? `${Math.round(tC * 9 / 5 + 32)}°F` : `${Math.round(tC)}°C`;
	if (b > 0.5 && !B.turned) {
		B.turned = true;
		const r0 = pizza.root.rotation.y;
		tween(0.9, (k) => { pizza.root.rotation.y = r0 + Math.PI * k; });
		toast('Turning the pizza so it bakes evenly', 1800);
	}
	if (b >= 1.6) B.resolve?.();
	// slow cinematic push-in
	const O = oven.group.position;
	camera.position.z += ((O.z + 11.5) - camera.position.z) * dt * 0.12;
	camera.position.y += ((O.y + 2.9) - camera.position.y) * dt * 0.12;
}

/* ---------------------------------------------------------------- compare on the table */
const templates = {};
function getTemplate(type) {
	return (templates[type] ||= new Pizza(lib, type));
}

function buildCompare(s, r) {
	clearCompare();
	const tpl = getTemplate(state.type === 'custom' && (pizza.custom || []).length < 3 ? 'margherita' : state.type);
	const g = new THREE.Group();
	const toCm = s.unit === 'in' ? 2.54 : 1;
	const placeGroup = (o) => {
		const d = (o.d * toCm) / 10; // units
		const cols = Math.ceil(Math.sqrt(o.q)), rows = Math.ceil(o.q / cols);
		const gap = d * 1.16;
		const grp = new THREE.Group();
		for (let i = 0; i < o.q; i++) {
			const c = i % cols, rr = Math.floor(i / cols);
			const item = new THREE.Group();
			const b = makeBoard();
			b.scale.set((d / 2) * 1.1, 0.22, (d / 2) * 1.1);
			const p = tpl.root.clone();
			p.scale.setScalar(d / 2);
			p.position.y = 0.222;
			item.add(b, p);
			item.position.set((c - (cols - 1) / 2) * gap, 0, (rr - (rows - 1) / 2) * gap);
			grp.add(item);
		}
		return { grp, w: cols * gap, h: rows * gap, d };
	};
	const A = placeGroup(r.A), B = placeGroup(r.B);
	const spread = (A.w + B.w) / 2 + 0.8;
	A.grp.position.x = -spread / 2 - (B.w - A.w) / 4;
	B.grp.position.x = spread / 2 - (B.w - A.w) / 4;
	g.add(A.grp, B.grp);
	// equivalence ring around single A
	if (r.A.q === 1 && isFinite(r.dEq)) {
		const rad = (r.dEq * toCm) / 20;
		const ring = new THREE.Mesh(new THREE.RingGeometry(rad - 0.035, rad, 160).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
		ring.position.y = 0.226;
		ring.renderOrder = 2;
		A.grp.add(ring);
		const el = document.createElement('div');
		el.className = 'tag tag-ring';
		el.textContent = `⌀ ${r.dEq.toFixed(1)} ${s.unit} to match B`;
		const lab = new CSS2DObject(el);
		lab.position.set(0, 0.05, rad + 0.25);
		A.grp.add(lab);
	}
	const per = s.unit === 'in' ? 10 : 100, ua = s.unit === 'in' ? 'in²' : 'cm²';
	for (const [o, P, k] of [[r.A, A, 'A'], [r.B, B, 'B']]) {
		const el = document.createElement('div');
		el.className = `tag ${r.winner === k ? 'win' : ''}`;
		el.innerHTML = `${r.winner === k ? '<span class="crown">♛</span>' : ''}<b>${o.q > 1 ? o.q + '× ' : ''}${o.name}</b>
			<span>⌀ ${o.d} ${s.unit} · ${Math.round(o.area).toLocaleString()} ${ua}</span>
			<span>${s.cur}${(o.ppa * per).toFixed(2)} per ${per} ${ua}</span>`;
		const lab = new CSS2DObject(el);
		lab.position.set(0, 1.4, -P.h / 2 - 0.2);
		P.grp.add(lab);
	}
	scene.add(g);
	const width = spread + Math.max(A.w, B.w) * 1.2 + 2;
	compare = { group: g, width, pizzas: [] };
	setShadowBox(Math.max(2.6, width / 2 + 1));
	return width;
}

function clearCompare() {
	if (!compare) return;
	compare.group.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
	scene.remove(compare.group);
	compare = null;
}

let calcState = null;
const canonCm = {};
function toggleCompare(on) {
	const btn = $('#show3d');
	if (on) {
		if (state.busy) return;
		const width = buildCompare(calcState, compute(calcState));
		stage.visible = steam.visible = false;
		document.body.classList.add('comparing');
		applyViewOffset();
		// fit the whole layout into the free area next to the calculator
		const free = Math.max(0.45, 1 - viewShift() * 2 / innerWidth);
		const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
		const dist = Math.max(6, (width / 2) / Math.tan(hfov / 2) / free * 0.98);
		tableFog.span = 40; // the comparison spreads wide: keep it all clear
		flyTo(new THREE.Vector3(0, dist * 0.9, dist * 0.46), new THREE.Vector3(), 1.2);
		controls.maxDistance = Math.max(26, dist * 2);
		btn.textContent = 'Back to my pizza';
		btn.classList.add('on');
	} else {
		clearCompare();
		setShadowBox(2.6);
		stage.visible = steam.visible = true;
		document.body.classList.remove('comparing');
		applyViewOffset();
		tableFog.span = 16;
		flyTo(TABLE_VIEW.position, TABLE_VIEW.target, 1);
		btn.textContent = 'See it on the table in 3D';
		btn.classList.remove('on');
	}
}

// Centre the scene in whatever space the visible side panels leave free.
function viewShift() {
	if (innerWidth <= 820) return 0;
	const d = $('#dock');
	const left = getComputedStyle(d).pointerEvents !== 'none' ? d.getBoundingClientRect().right : 0; // switches instantly, unlike the fading opacity
	return innerWidth / 2 - (left + innerWidth) / 2;
}
function sheetShift() {
	// phones: the bottom sheet covers the lower part of the screen, so lift the scene above it
	if (innerWidth > 820 || document.body.dataset.panel === 'view' || state.mode === 'oven') return 0;
	return innerHeight * 0.2;
}
function applyViewOffset() {
	camera.fov = camera.aspect < 0.8 ? 52 : camera.aspect < 1.2 ? 44 : 36;
	camera.updateProjectionMatrix();
	const sx = viewShift(), sy = sheetShift();
	if (sx || sy) camera.setViewOffset(innerWidth, innerHeight, sx, sy, innerWidth, innerHeight);
	else camera.clearViewOffset();
}


/* ---------------------------------------------------------------- dock: Make it · Recipe · Size & price */
let calcTouched = false;
const panelInHash = () => ['build', 'recipe', 'calc'].find((id) => id === location.hash.slice(1));
function setPanel(id) {
	document.body.dataset.panel = id;
	$$('.dtabs button').forEach((x) => { x.classList.toggle('on', x.dataset.panel === id); x.setAttribute('aria-selected', String(x.dataset.panel === id)); });
	if (id === 'recipe') refreshRecipe(true);
	applyViewOffset();
}

// The recipe follows the pizza on the table: it is rebuilt whenever what it depends on changes.
const recipeOpts = { pizzas: 1, oven: 'home' };
let recipeSig = '';
function sauceCoverage() {
	if (state.type !== 'custom' || !sauceField) return 1;
	let wet = 0, all = 0;
	for (let i = 0; i < sauceField.h.length; i++) if (sauceField.inside[i]) { all++; if (sauceField.h[i] > 0.08) wet++; }
	return all ? wet / all : 0;
}
function refreshRecipe(force) {
	// works before (or without) the 3D pizza too: then the toppings come from the recipe's own definition
	const recipe = pizza?.recipe || RECIPES[state.type] || RECIPES.margherita;
	const toppings = pizza ? pizza.toppings : (recipe.tops || []).flatMap(([kind, n]) => (kind === 'chili' ? [] : Array.from({ length: n }, () => ({ kind }))));
	const input = {
		type: state.type, recipe, toppings,
		D: +$('#size').value, slices: +$('#slices').value, done: +$('#done').value,
		oven: recipeOpts.oven, pizzas: recipeOpts.pizzas, sauce: sauceCoverage(),
		imperial: LOCALE.inches, fahrenheit: LOCALE.fahrenheit,
	};
	const counts = {};
	for (const t of toppings) counts[t.kind] = (counts[t.kind] || 0) + 1;
	const sig = JSON.stringify([input.type, recipe.cheese, !!pizza, input.D, input.slices, Math.round(input.done / 5), input.oven, input.pizzas, Math.round(input.sauce * 20), counts]);
	if (!force && sig === recipeSig) return;
	recipeSig = sig;
	renderRecipe($('#recipe'), buildRecipe(input), { onAction: recipeAction });
}
function recipeAction(id) {
	if (state.busy || state.mode !== 'table') return;
	if (id === 'bake') bakeSequence();
	if (id === 'cut') { setPanel(innerWidth <= 820 ? 'view' : 'recipe'); doCut(+$('#slices').value); }
}
function bindRecipe() {
	$('#recipe').querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
		recipeOpts.pizzas = Math.min(12, Math.max(1, recipeOpts.pizzas + +b.dataset.step));
		$('#rcN').textContent = recipeOpts.pizzas;
		refreshRecipe(true);
	}));
	$('#rcOven').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
		recipeOpts.oven = b.dataset.oven;
		$('#rcOven').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
		refreshRecipe(true);
	}));
	const print = () => { refreshRecipe(true); setPanel('recipe'); requestAnimationFrame(() => window.print()); };
	$('#rcPrint').addEventListener('click', print);
	$('#rcPrint2').addEventListener('click', print);
	$('#rcReset').addEventListener('click', () => { clearTicks(); refreshRecipe(true); });
	setInterval(() => { if (document.body.dataset.panel === 'recipe' && !document.hidden) refreshRecipe(false); }, 700);
	// printing from anywhere (⌘P on another tab) still prints the current recipe, never an empty card
	addEventListener('beforeprint', () => refreshRecipe(true));
	// the calculator can start from the pizza on the table
	$('#useMine').addEventListener('click', () => {
		const cm = +$('#size').value, inch = $('#unit').value === 'in';
		$('#aName').value = pizza?.recipe?.name && state.type !== 'custom' ? `My ${pizza.recipe.name}` : 'My pizza';
		$('#aD').value = inch ? +(cm / 2.54).toFixed(1) : cm;
		canonCm['#aD'] = cm;
		$('#aQ').value = 1;
		updateCalc();
		toast(`<b>Your pizza is option A</b><span>⌀ ${inch ? `${(cm / 2.54).toFixed(1)}″` : `${cm} cm`}. Set its price and what you’re comparing it with.</span>`, 3200);
	});
}

/* ---------------------------------------------------------------- UI */
function readCalc() {
	const num = (id) => Math.max(0, parseFloat($(id).value) || 0);
	// sizes: use the exact converted value when the field still shows the rounded conversion
	const size = (id) => {
		const shown = num(id);
		if ($('#unit').value !== 'in' || canonCm[id] === undefined) return shown;
		const exact = canonCm[id] / 2.54;
		return Math.abs(exact - shown) < 0.006 ? exact : shown;
	};
	return {
		unit: $('#unit').value, cur: $('#cur').value, crustOn: $('#crustOn').checked, crustW: size('#crustW'),
		A: { name: $('#aName').value || 'A', d: size('#aD'), q: Math.max(1, Math.round(num('#aQ'))), p: num('#aP') },
		B: { name: $('#bName').value || 'B', d: size('#bD'), q: Math.max(1, Math.round(num('#bQ'))), p: num('#bP') },
	};
}
function updateCalc() {
	calcState = readCalc();
	const r = compute(calcState);
	$('#result').innerHTML = renderCalc(calcState, r);
	$$('.u').forEach((e) => { e.textContent = calcState.unit; });
	$$('.c').forEach((e) => { e.textContent = calcState.cur; });
	if (compare) buildCompare(calcState, r);
}
// Currency from the browser's own region (navigator.languages, e.g. es-MX → MX$ pesos, en-US → $ and inches).
// Preset prices are written in euros or dollars, converted with rough exchange rates and rounded to menu-like
// amounts: the verdict never depends on the currency, only the figures shown do.
const EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK AD MC SM VA ME XK'.split(' ');
const REGION_CUR = { US: 'USD', PR: 'USD', EC: 'USD', SV: 'USD', PA: 'USD', GB: 'GBP', CH: 'CHF', LI: 'CHF', JP: 'JPY', MX: 'MXN', BR: 'BRL', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IN: 'INR', CN: 'CNY', HK: 'HKD', SG: 'SGD', KR: 'KRW', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', TR: 'TRY', ZA: 'ZAR', IL: 'ILS', CL: 'CLP', CO: 'COP', PE: 'PEN', AR: 'ARS', UY: 'UYU', AE: 'AED', SA: 'SAR' };
const PER_EUR = { EUR: 1, USD: 1.1, GBP: 0.85, CHF: 0.95, JPY: 165, MXN: 21, BRL: 6, CAD: 1.5, AUD: 1.65, NZD: 1.8, INR: 92, CNY: 7.8, HKD: 8.5, SGD: 1.45, KRW: 1500, SEK: 11.5, NOK: 11.7, DKK: 7.46, PLN: 4.3, CZK: 25, HUF: 400, RON: 5, TRY: 38, ZAR: 20, ILS: 4, CLP: 1000, COP: 4400, PEN: 4.1, ARS: 1100, UYU: 44, AED: 4, SAR: 4.1 };
const INCH_REGIONS = ['US', 'PR', 'GB', 'CA', 'LR', 'MM'];
const LOCALE = (() => {
	const langs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
	let region = '';
	for (const l of langs) {
		try { region = new Intl.Locale(l).maximize().region || ''; } catch { region = ''; }
		if (region) break;
	}
	const code = EURO.includes(region) ? 'EUR' : REGION_CUR[region] || 'EUR';
	let sym = '€';
	try { sym = new Intl.NumberFormat(langs[0], { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(1).find((x) => x.type === 'currency').value; } catch { /* keep € */ }
	if (/^[A-Za-z]+$/.test(sym)) sym += ' ';
	return { region, code, sym, inches: INCH_REGIONS.includes(region), fahrenheit: ['US', 'PR', 'LR', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'].includes(region) };
})();
const SYM_CODE = { '€': 'EUR', '$': 'USD', '£': 'GBP' };
const localPrice = (v, fromSym) => {
	const x = v * PER_EUR[LOCALE.code] / PER_EUR[SYM_CODE[fromSym] || 'EUR'];
	const step = x < 20 ? 0.5 : x < 100 ? 1 : x < 1000 ? 10 : x < 10000 ? 50 : 500;
	return +(Math.round(x / step) * step).toFixed(2);
};
function useLocalCurrency() {
	const sel = $('#cur');
	let opt = [...sel.options].find((o) => o.value.trim() === LOCALE.sym.trim());
	if (!opt) { opt = new Option(LOCALE.sym.trim(), LOCALE.sym); sel.prepend(opt); }
	sel.value = opt.value;
}

function applyPreset(k) {
	const p = PRESETS[k];
	$('#unit').value = p.unit; $('#unit').dataset.prev = p.unit;
	useLocalCurrency();
	[['a', p.A], ['b', p.B]].forEach(([x, v]) => {
		$(`#${x}Name`).value = v[0]; $(`#${x}D`).value = v[1]; $(`#${x}Q`).value = v[2]; $(`#${x}P`).value = localPrice(v[3], p.cur);
	});
	$('#crustW').value = p.unit === 'in' ? 1 : 2.5;
	const toCmF = p.unit === 'in' ? 2.54 : 1;
	for (const id of ['#aD', '#bD', '#crustW']) canonCm[id] = (parseFloat($(id).value) || 0) * toCmF;
	// where pizzas are sold in inches, metric presets are shown as the nearest whole-inch menu sizes
	if (LOCALE.inches && p.unit === 'cm') {
		$('#unit').value = $('#unit').dataset.prev = 'in';
		for (const id of ['#aD', '#bD', '#crustW']) { const v = Math.max(1, Math.round(canonCm[id] / 2.54)); $(id).value = v; canonCm[id] = v * 2.54; }
	}
	updateCalc();
}

function bindUI() {
	$$('#types button[data-type]').forEach((b) => b.addEventListener('click', async () => {
		if (state.busy) return;
		if (RECIPES[b.dataset.type].scan && !lib.scanMats?.[b.dataset.type]) {
			b.classList.add('loading');
			state.busy = true;
			toast('<b>Loading the scan</b><span>Real pizza, photographed from every angle and rebuilt in 3D.</span>', 2600);
			try { await loadScan(lib, b.dataset.type); } finally { state.busy = false; b.classList.remove('loading'); }
		}
		$$('#types button[data-type]').forEach((x) => x.classList.toggle('on', x === b));
		state.type = b.dataset.type;
		document.body.classList.toggle('custom-mode', state.type === 'custom');
		if (state.type !== 'custom' && state.tool) selectTool(state.tool);
		if (state.type === 'custom') {
			pizza.N = 1;
			setBake(0);
			state.hot = 0;
			toast('<b>Build it raw</b><span>Pick an ingredient and click or drag on the dough. Then bake it and watch the cheese melt.</span>', 5200);
		} else if (U.uBake.value < 0.5) setBake(1);
		if (RECIPES[state.type].scan) state.hot = Math.max(state.hot, 0.5);
		pizza.setType(state.type);
		if (compare) updateCalc();
	}));
	const size = $('#size');
	size.addEventListener('input', () => {
		state.size = +size.value;
		$('#sizeOut').textContent = `⌀ ${state.size} cm`;
		applySize(false);
		clearTimeout(size.settle);
		size.settle = setTimeout(() => applySize(true), 180);
	});
	const slices = $('#slices');
	const syncSlices = () => {
		const n = +slices.value;
		$('#slicesOut').textContent = n === 1 ? 'Whole' : `${n} slices`;
		$('#cut').textContent = n === 1 ? 'Put it back together' : `Cut into ${n} slices`;
	};
	slices.addEventListener('input', syncSlices);
	syncSlices();
	$('#cut').addEventListener('click', () => { if (state.mode === 'table') doCut(+slices.value); });
	$('#done').addEventListener('input', (e) => {
		if (state.bake.running) return;
		setBake(+e.target.value / 100);
		state.hot = U.uBake.value > 0.6 ? Math.max(state.hot, 0.6) : 0;
	});
	$('#bake').addEventListener('click', bakeSequence);
	$('#takeout').addEventListener('click', () => state.bake.resolve?.());
	$('#mute').addEventListener('click', () => {
		const m = SFX.sound.on;
		SFX.setMuted(m);
		$('#mute').classList.toggle('off', m);
		$('#mute').setAttribute('aria-pressed', String(!m));
	});
	$$('.dtabs button').forEach((b) => b.addEventListener('click', () => setPanel(b.dataset.panel)));
	bindRecipe();

	// credits popover closes on outside click / Esc / when baking
	const cred = $('.credits');
	addEventListener('pointerdown', (e) => { if (cred.open && !cred.contains(e.target)) cred.open = false; });
	addEventListener('keydown', (e) => { if (e.key === 'Escape') cred.open = false; });
	$('#show3d').addEventListener('click', () => toggleCompare(!compare));

	// pointer: slice grabbing, or placing ingredients in builder mode
	const ray = new THREE.Raycaster();
	let down = null, painting = false, last = null;
	const ndc = (e) => new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
	const el = renderer.domElement;
	el.addEventListener('pointerdown', (e) => {
		down = [e.clientX, e.clientY];
		if (!state.tool || state.mode !== 'table' || compare || state.busy || e.button !== 0) return;
		const hit = hitPizza(ndc(e), ray);
		if (!hit) return;
		painting = true;
		state.group = (state.group || 0) + 1;
		if (SAUCE_TOOLS.includes(state.tool)) state.pourAt = hit;
		else applyTool(hit);
		last = hit;
		el.setPointerCapture(e.pointerId);
	});
	el.addEventListener('pointermove', (e) => {
		if (!state.tool || state.mode !== 'table' || compare) { ghost.visible = false; return; }
		const hit = hitPizza(ndc(e), ray);
		updateGhost(hit);
		if (hit) state.hoverAt = hit;
		if (!painting || !hit) return;
		if (state.tool === 'ladle') { state.pourAt = hit; return; }
		if (state.tool === 'spread') {
			const dx = hit.x - last.x, dz = hit.z - last.z;
			if (Math.hypot(dx, dz) > 0.012) { sauceField.spread(hit.x, hit.z, dx, dz); last = hit; }
			return;
		}
		const K = KINDS[state.tool];
		const gap = state.tool === 'erase' ? 0.05 : (K.sprinkle ? K.sprinkle.r * 1.3 : K.rad * 1.7);
		if (Math.hypot(hit.x - last.x, hit.z - last.z) > gap) { applyTool(hit); last = hit; }
	});
	el.addEventListener('pointerleave', () => { ghost.visible = false; });
	el.addEventListener('pointerup', (e) => {
		if (painting) { painting = false; state.pourAt = null; saveCustom(); return; }
		if (state.tool) return;
		if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
		if (state.busy || state.mode !== 'table' || compare) return;
		ray.setFromCamera(ndc(e), camera);
		const i = pizza.pick(ray);
		if (i < 0) { pizza.release(); return; }
		if (pizza.N < 2) { toast('Cut it first! Pick a number of slices and hit <b>Cut</b>'); return; }
		pizza.grab(i);
		if (pizza.held === i && !pizza.stretchy) toast('Raw cheese doesn’t stretch. Bake it first!');
	});

	// keyboard shortcuts (ignored while typing in a field)
	addEventListener('keydown', (e) => {
		if (e.target?.closest?.('input, select, textarea, button, summary') || e.metaKey || e.ctrlKey || e.altKey) return;
		const k = e.key.toLowerCase();
		if (state.bake.running && (k === ' ' || k === 'enter')) { e.preventDefault(); state.bake.resolve?.(); return; }
		if (k === 'escape') { if (state.tool) selectTool(state.tool); else pizza.release(); return; }
		if (k === 'c' && state.mode === 'table') doCut(+slices.value);
		if (k === 'b') bakeSequence();
	});

	addEventListener('resize', () => {
		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
		applyViewOffset();
		renderer.setSize(innerWidth, innerHeight);
		composer.setSize(innerWidth, innerHeight);
		labels.setSize(innerWidth, innerHeight);
	});
}

/* ---------------------------------------------------------------- custom builder */
let pickDisc, ghost, ghostMesh = null, ghostKind = null;
let sauceField, ladle;
const SAUCE_TOOLS = ['ladle', 'spread'];
function setupBuilder() {
	pickDisc = new THREE.Mesh(new THREE.CircleGeometry(0.84, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
	pickDisc.position.y = CHEESE_Y + 0.012;
	pizza.root.add(pickDisc);
	ghost = new THREE.Group();
	const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2),
		new THREE.MeshBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0.85, depthTest: false }));
	ring.renderOrder = 10;
	ghost.add(ring);
	ghost.userData.ring = ring;
	ghost.visible = false;
	pizza.root.add(ghost);
	// the sauce texture covers the whole pizza (its rim is bare dough), so the ladle's stream and fill read only a
	// patch from the sauce-covered middle; liquid sauce is wetter than the baked layer, so a little less rough
	const streamTex = lib.sauce.raw.clone();
	streamTex.wrapS = streamTex.wrapT = THREE.MirroredRepeatWrapping;
	streamTex.repeat.set(0.16, 0.16);
	streamTex.offset.set(0.42, 0.42);
	streamTex.needsUpdate = true;
	const streamMat = new THREE.MeshStandardMaterial({ map: streamTex, color: 0xf2e6e2, roughness: 0.6, envMapIntensity: 0.35 });
	ladle = new Ladle(streamMat);
	pizza.root.add(ladle.group);
	// restore a saved custom pizza
	try {
		const saved = JSON.parse(localStorage.getItem('pizzalab-custom') || 'null');
		if (saved && Array.isArray(saved.tops)) {
			pizza.custom = saved.tops.filter((t) => KINDS[t.kind]);
			if (saved.cheese) RECIPES.custom.cheese = saved.cheese;
			if (saved.sauce) sauceField.load(saved.sauce);
			else if (pizza.custom.length) sauceField.fill(); // pizzas saved before sauce could be poured were fully sauced
		}
	} catch (e) { /* storage unavailable */ }
}
function saveCustom() {
	delete templates.custom;
	try { localStorage.setItem('pizzalab-custom', JSON.stringify({ cheese: RECIPES.custom.cheese, tops: pizza.custom || [], sauce: sauceField.serialize() }, (k, v) => (k.startsWith('_') ? undefined : v))); } catch (e) { /* ignore */ }
}
function hitPizza(p, ray) {
	ray.setFromCamera(p, camera);
	const h = ray.intersectObject(pickDisc, false)[0];
	if (!h) return null;
	const l = pizza.root.worldToLocal(h.point.clone());
	return { x: l.x, z: l.z };
}
function updateGhost(hit) {
	if (!hit) { ghost.visible = false; return; }
	ghost.visible = true;
	if (SAUCE_TOOLS.includes(state.tool)) {
		if (ghostMesh) { ghost.remove(ghostMesh); ghostMesh = null; }
		ghostKind = state.tool;
		ghost.userData.ring.scale.setScalar(state.tool === 'spread' ? 0.085 : 0.05);
		ghost.userData.ring.material.color.set(0xff8a5c);
		ghost.position.set(hit.x, pizza.surfaceY(hit.x, hit.z) + 0.004, hit.z);
		return;
	}
	const K = KINDS[state.tool];
	if (ghostKind !== state.tool) {
		if (ghostMesh) ghost.remove(ghostMesh);
		ghostMesh = state.tool === 'erase' ? null : K.make(lib.top, lib.geo, { s: 1, j: 0.4 });
		if (ghostMesh) { ghostMesh.position.y = 0.06; ghost.add(ghostMesh); }
		ghostKind = state.tool;
	}
	const r = state.tool === 'erase' ? 0.07 : (K.sprinkle ? K.sprinkle.r : K.rad) / pizza.k;
	ghost.userData.ring.scale.setScalar(r);
	if (ghostMesh) ghostMesh.scale.copy(ghostMesh.userData.s0 ||= ghostMesh.scale.clone()).multiplyScalar(1 / pizza.k);
	ghost.userData.ring.material.color.set(state.tool === 'erase' ? 0xff5a36 : 0xffd36e);
	ghost.position.set(hit.x, pizza.surfaceY(hit.x, hit.z) + 0.004, hit.z);
	if (ghostMesh) ghostMesh.rotation.y = state.time * 1.4;
}
function applyTool(hit) {
	if (state.tool === 'erase') {
		const n = pizza.removeWhere((t) => Math.hypot(t.x - hit.x, t.z - hit.z) < Math.max(0.06, KINDS[t.kind].rad * t.s));
		if (n) SFX.plop(0.6);
		return;
	}
	pizza.place(state.tool, hit.x, hit.z, state.group);
	SFX.plop(1);
}
function selectTool(id) {
	state.tool = state.tool === id ? null : id;
	$$('#custom [data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === state.tool));
	controls.mouseButtons = state.tool
		? { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
		: { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
	controls.touches = state.tool
		? { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }
		: { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
	document.body.classList.toggle('placing', !!state.tool);
	if (state.tool) pizza.release();
	if (!state.tool) ghost.visible = false;
}
function makeThumbnails() {
	const S = 112;
	const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
	r.setSize(S, S);
	r.toneMapping = THREE.ACESFilmicToneMapping;
	const sc = new THREE.Scene();
	sc.environment = T.hdr;
	const l = new THREE.DirectionalLight(0xfff1dc, 2.2); l.position.set(2, 4, 3); sc.add(l);
	const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
	const out = {};
	for (const k of PALETTE) {
		const K = KINDS[k];
		const g = new THREE.Group();
		const pts = K.sprinkle ? Array.from({ length: Math.min(K.sprinkle.n, 9) }, (_, i) => [Math.sin(i * 2.4) * K.sprinkle.r * Math.sqrt(i / 9), Math.cos(i * 2.4) * K.sprinkle.r * Math.sqrt(i / 9)]) : [[0, 0]];
		pts.forEach(([x, z], i) => { const m = K.make(lib.top, lib.geo, { s: 1, j: (i * 0.37) % 1 }); m.position.set(x, 0, z); m.rotation.y = i * 1.3 + 0.6; g.add(m); });
		sc.add(g);
		const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).length();
		cam.position.set(c.x, c.y + sz * 1.25, c.z + sz * 1.35);
		cam.lookAt(c);
		r.render(sc, cam);
		out[k] = r.domElement.toDataURL('image/png');
		sc.remove(g);
	}
	r.dispose();
	r.forceContextLoss();
	return out;
}
function buildPalette() {
	const thumbs = makeThumbnails();
	const pal = $('#palette');
	pal.innerHTML = PALETTE.map((k) => `<button data-kind="${k}" title="${KINDS[k].name}"><img src="${thumbs[k]}" alt=""><span>${KINDS[k].name}</span></button>`).join('');
	pal.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.kind)));
	$('#eraser').addEventListener('click', () => selectTool('erase'));
	$('#undo').addEventListener('click', () => {
		const gs = (pizza.custom || []).map((t) => t.g || 0);
		if (!gs.length) return;
		const g = Math.max(...gs);
		pizza.removeWhere((t) => (t.g || 0) === g);
		saveCustom();
	});
	$('#clear').addEventListener('click', () => { pizza.removeWhere(() => true); sauceField.clear(); saveCustom(); }); // back to bare dough
	$('#coat').addEventListener('click', () => { sauceField.fill(); saveCustom(); });
	$('#scrape').addEventListener('click', () => { sauceField.clear(); saveCustom(); });
	$$('#custom [data-kind="ladle"], #custom [data-kind="spread"]').forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.kind)));
	const setCheese = (c) => {
		RECIPES.custom.cheese = c;
		$$('#base button').forEach((x) => x.classList.toggle('on', x.dataset.cheese === c));
		pizza.rebuild();
	};
	$$('#base button').forEach((b) => b.addEventListener('click', () => { setCheese(b.dataset.cheese); syncStarts(); saveCustom(); }));
	// one-click bases for people who'd rather not pour: the toppings already placed stay where they are
	const syncStarts = () => {
		const cov = sauceCoverage(), c = RECIPES.custom.cheese;
		const kind = cov < 0.05 && c === 'none' ? 'bare' : cov > 0.6 && c === 'none' ? 'tomato' : cov > 0.6 && c === 'shred' ? 'classic' : '';
		$$('#starts button').forEach((x) => x.classList.toggle('on', x.dataset.start === kind));
	};
	$$('#starts button').forEach((b) => b.addEventListener('click', () => {
		if (state.busy) return;
		const k = b.dataset.start;
		if (k === 'bare') sauceField.clear(); else sauceField.fill();
		setCheese(k === 'classic' ? 'shred' : 'none');
		pizza.updateHeights();
		syncStarts();
		saveCustom();
	}));
	syncStarts();
	$('#coat').addEventListener('click', syncStarts);
	$('#scrape').addEventListener('click', syncStarts);
	$('#clear').addEventListener('click', syncStarts);
	$$('#base button').forEach((x) => x.classList.toggle('on', x.dataset.cheese === RECIPES.custom.cheese));
}

/* ---------------------------------------------------------------- loop */
const clock = new THREE.Clock();
function loop() {
	const dt = Math.min(clock.getDelta(), 0.05);
	state.time += dt;
	U.uTime.value = state.time;
	U.uHeat.value = state.mode === 'oven' ? 1 : Math.min(1, state.hot * 1.25);
	for (let i = tweens.length - 1; i >= 0; i--) {
		const tw = tweens[i];
		tw.t += dt;
		const k = Math.min(1, tw.t / tw.dur);
		tw.fn(tw.ease(k));
		if (k >= 1) { tweens.splice(i, 1); tw.res(); }
	}
	if (state.bake.running) bakeTick(dt);
	pizza.update(dt, state.time);
	oven.update(dt, state.mode === 'oven');
	// steam
	if (state.mode === 'table') state.hot = Math.max(0, state.hot - dt / 90);
	const hot = state.hot * sstep(0.55, 0.9, U.uBake.value);
	steam.children.forEach((sp) => {
		const u = sp.userData;
		u.ph += dt * u.sp;
		if (u.ph > 1) { u.ph -= 1; u.a = Math.random() * TAU; u.r = Math.sqrt(Math.random()) * 0.75; }
		const t = u.ph;
		sp.position.set(Math.sin(u.a) * u.r + Math.sin(state.time * 0.7 + u.a) * 0.08 * t, 0.05 + t * 1.3, Math.cos(u.a) * u.r);
		sp.scale.setScalar(0.12 + t * 0.42);
		sp.material.opacity = hot * 0.045 * Math.sin(Math.PI * t) * (1 - t * 0.5);
		sp.material.rotation += u.rot * dt;
	});
	if (ghost && ghost.visible && ghostMesh) ghostMesh.rotation.y = state.time * 1.4;
	// sauce: pour from the ladle while the button is held, let the passata settle, re-seat toppings on it
	const pouring = state.tool === 'ladle' && !!state.pourAt && state.type === 'custom';
	if (pouring) sauceField.pour(state.pourAt.x, state.pourAt.z, 2.6 * dt * 60);
	if (sauceField.step(dt) && state.type === 'custom') {
		state.sauceT = (state.sauceT || 0) + dt;
		if (state.sauceT > 0.25) { state.sauceT = 0; pizza.updateHeights(); }
	}
	const showLadle = state.tool === 'ladle' && state.type === 'custom' && state.hoverAt && !compare;
	ladle.group.visible = !!showLadle;
	if (showLadle) {
		const at = state.pourAt || state.hoverAt, g = 1 / pizza.k;
		ladle.group.position.set(at.x, 0, at.z);
		ladle.group.scale.setScalar(g);
		ladle.update(dt, state.time, (pizza.surfaceY(at.x, at.z) + 0.001) / g, pouring);
	}
	controls.update();
	{ const d = camera.position.distanceTo(controls.target); tableFog.near = d + 1.2; tableFog.far = d + tableFog.span; }
	composer.render();
	labels.render(scene, camera);
}

init().catch((e) => {
	console.error(e);
	loadMsg('Something went wrong while preheating: ' + e.message);
});
