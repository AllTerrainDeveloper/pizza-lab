// Tiny deterministic RNG + value noise used to paint every procedural texture.

export function rng(seed = 1) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export class Noise {
	constructor(seed = 1) {
		const r = rng(seed);
		const p = new Uint8Array(256);
		for (let i = 0; i < 256; i++) p[i] = i;
		for (let i = 255; i > 0; i--) {
			const j = Math.floor(r() * (i + 1));
			const t = p[i]; p[i] = p[j]; p[j] = t;
		}
		this.perm = new Uint16Array(768);
		for (let i = 0; i < 768; i++) this.perm[i] = p[i & 255];
		this.val = new Float32Array(256);
		for (let i = 0; i < 256; i++) this.val[i] = r();
	}

	n2(x, y) {
		const xi = Math.floor(x), yi = Math.floor(y);
		const xf = x - xi, yf = y - yi;
		const X = xi & 255, Y = yi & 255, P = this.perm, V = this.val;
		const a = V[P[P[X] + Y]], b = V[P[P[X + 1] + Y]];
		const c = V[P[P[X] + Y + 1]], d = V[P[P[X + 1] + Y + 1]];
		const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
		return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
	}

	n3(x, y, z) {
		const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
		const xf = x - xi, yf = y - yi, zf = z - zi;
		const X = xi & 255, Y = yi & 255, Z = zi & 255, P = this.perm, V = this.val;
		const A = P[X] + Y, B = P[X + 1] + Y;
		const AA = P[A] + Z, AB = P[A + 1] + Z, BA = P[B] + Z, BB = P[B + 1] + Z;
		const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
		const x1 = V[P[AA]] + (V[P[BA]] - V[P[AA]]) * u;
		const x2 = V[P[AB]] + (V[P[BB]] - V[P[AB]]) * u;
		const x3 = V[P[AA + 1]] + (V[P[BA + 1]] - V[P[AA + 1]]) * u;
		const x4 = V[P[AB + 1]] + (V[P[BB + 1]] - V[P[AB + 1]]) * u;
		const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
		return y1 + (y2 - y1) * w;
	}

	fbm2(x, y, oct = 4) {
		let s = 0, a = 0.5, f = 1, n = 0;
		for (let i = 0; i < oct; i++) { s += a * this.n2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
		return s / n;
	}

	fbm3(x, y, z, oct = 4) {
		let s = 0, a = 0.5, f = 1, n = 0;
		for (let i = 0; i < oct; i++) { s += a * this.n3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
		return s / n;
	}
}

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
