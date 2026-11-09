// Real recordings (CC0 / public domain / CC BY), see assets/sfx/credits.json.
// Played through Web Audio so the fire and sizzle loops are seamless.
let ctx = null, master = null, loading = null;
const buffers = {};
const FILES = ['fire', 'sizzle', 'cut', 'ding', 'plop'];
export const sound = { on: true };

function ac() {
	if (!ctx) {
		ctx = new (window.AudioContext || window.webkitAudioContext)();
		master = ctx.createGain();
		master.gain.value = sound.on ? 0.8 : 0;
		master.connect(ctx.destination);
		loading = Promise.all(FILES.map(async (f) => {
			try {
				const res = await fetch(`assets/sfx/${f}.mp3`);
				buffers[f] = await ctx.decodeAudioData(await res.arrayBuffer());
			} catch (e) { /* a missing sound must never break the app */ }
		}));
	}
	if (ctx.state === 'suspended') ctx.resume();
	return ctx;
}

// unlock + preload on the first interaction (browsers block audio before that)
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => ac(), { once: true, passive: true }));

function play(name, { vol = 1, rate = 1, loop = false } = {}) {
	if (!sound.on && !loop) return null;
	const c = ac(), b = buffers[name];
	if (!b) return null;
	const src = c.createBufferSource(), g = c.createGain();
	src.buffer = b;
	src.loop = loop;
	src.playbackRate.value = rate;
	g.gain.value = vol;
	src.connect(g).connect(master);
	src.start();
	return { src, g };
}

export function setMuted(m) {
	sound.on = !m;
	if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}

export function crunch() { play('cut', { vol: 0.9, rate: 0.92 + Math.random() * 0.16 }); }
export function chime() { play('ding', { vol: 0.8 }); }
export function plop(v = 1) { play('plop', { vol: 0.7 * v, rate: 0.85 + Math.random() * 0.35 }); }

let fireNodes = null;
export async function fire(on) {
	ac();
	if (on && !fireNodes) {
		await loading;
		if (fireNodes) return;
		const f = play('fire', { vol: 0, loop: true }), s = play('sizzle', { vol: 0, loop: true });
		fireNodes = { f, s };
		f?.g.gain.setTargetAtTime(1.1, ctx.currentTime, 0.5);
	} else if (!on && fireNodes) {
		const n = fireNodes;
		fireNodes = null;
		for (const x of [n.f, n.s]) {
			if (!x) continue;
			x.g.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
			setTimeout(() => x.src.stop(), 1800);
		}
	}
}

export function sizzle(level) {
	if (fireNodes?.s && ctx) fireNodes.s.g.gain.setTargetAtTime(Math.min(1, level) * 0.55, ctx.currentTime, 0.25);
}
