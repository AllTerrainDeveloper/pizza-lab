// Procedural pizza textures, painted on canvases at load time.
// Planar textures map the pizza disc: u = 0.5 + x/2, v = 0.5 + z/2 (unit-radius pizza).
import * as THREE from 'three';
import { Noise, rng, clamp, mix, sstep } from './noise.js';

const N = new Noise(7);
const N2 = new Noise(91);
const TAU = Math.PI * 2;

function canvas(w, h) {
	const c = document.createElement('canvas');
	c.width = w; c.height = h;
	return [c, c.getContext('2d', { willReadFrequently: true })];
}

function tex(c, { srgb = true, wrap = false } = {}) {
	const t = new THREE.CanvasTexture(c);
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.needsUpdate = true;
	return t;
}

function normalFromHeight(h, w, hh, strength, wrapU = false) {
	const [c, ctx] = canvas(w, hh);
	const img = ctx.createImageData(w, hh);
	const d = img.data;
	for (let y = 0; y < hh; y++) {
		const yu = Math.max(0, y - 1), yd = Math.min(hh - 1, y + 1);
		for (let x = 0; x < w; x++) {
			const xl = wrapU ? (x - 1 + w) % w : Math.max(0, x - 1);
			const xr = wrapU ? (x + 1) % w : Math.min(w - 1, x + 1);
			const dx = (h[y * w + xr] - h[y * w + xl]) * strength;
			const dy = (h[yu * w + x] - h[yd * w + x]) * strength;
			let nx = -dx, ny = -dy, nz = 1;
			const l = Math.hypot(nx, ny, nz);
			nx /= l; ny /= l; nz /= l;
			const k = (y * w + x) * 4;
			d[k] = (nx * 0.5 + 0.5) * 255;
			d[k + 1] = (ny * 0.5 + 0.5) * 255;
			d[k + 2] = (nz * 0.5 + 0.5) * 255;
			d[k + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return tex(c, { srgb: false });
}

const toPx = (x, z, S) => [(x * 0.5 + 0.5) * S, (1 - (z * 0.5 + 0.5)) * S];

/* ---------------------------------------------------------------- Sauce */
export function makeSauce(S = 768) {
	const [c1, x1] = canvas(S, S), [c2, x2] = canvas(S, S);
	const i1 = x1.createImageData(S, S), i2 = x2.createImageData(S, S);
	const d1 = i1.data, d2 = i2.data;
	for (let j = 0; j < S; j++) {
		const z = (1 - j / S) * 2 - 1;
		for (let i = 0; i < S; i++) {
			const x = (i / S) * 2 - 1;
			const r = Math.hypot(x, z);
			// passata on a pizza: a deep, slightly orange tomato red (not the pink of fruit flesh), thicker and darker
			// in places, with fine crushed-pulp grain and the odd glint of olive oil; no big pale blotches
			const n = N.fbm2(x * 5 + 10, z * 5, 5);
			const n2 = N.fbm2(x * 46, z * 46 + 3, S > 1000 ? 4 : 3); // crushed tomato pulp: fine grain
			const n3 = N.fbm2(x * 120 + 7, z * 120 - 5, 2); // pulp fibres at close range
			let R = mix(150, 184, n), G = mix(36, 58, n), B = mix(16, 24, n);
			const f = 0.9 + 0.16 * n2 + 0.08 * (n3 - 0.5);
			R *= f; G *= f; B *= f;
			const oil = sstep(0.66, 0.78, N.fbm2(x * 14 + 40, z * 14 - 7, 3)) * 0.35; // thin oil films read warmer/orange
			R = mix(R, 196, oil); G = mix(G, 78, oil); B = mix(B, 22, oil);
			let bR = R * 0.95, bG = G * 0.9, bB = B * 0.85;
			const car = sstep(0.56, 0.74, N.fbm2(x * 9 - 3, z * 9 + 11, 3));
			bR = mix(bR, 150, car * 0.45); bG = mix(bG, 38, car * 0.45); bB = mix(bB, 18, car * 0.45);
			const edge = 0.825 + 0.04 * (N.fbm2(x * 8, z * 8, 3) - 0.5) * 2;
			const e = sstep(edge - 0.015, edge + 0.012, r);
			R = mix(R, 226, e); G = mix(G, 204, e); B = mix(B, 168, e);
			bR = mix(bR, 200, e); bG = mix(bG, 140, e); bB = mix(bB, 80, e);
			const k = (j * S + i) * 4;
			d1[k] = R; d1[k + 1] = G; d1[k + 2] = B; d1[k + 3] = 255;
			d2[k] = bR; d2[k + 1] = bG; d2[k + 2] = bB; d2[k + 3] = 255;
		}
	}
	x1.putImageData(i1, 0, 0);
	x2.putImageData(i2, 0, 0);
	// dried oregano: small, irregular, dull olive-brown flakes (a few, not a field of dark 'seeds')
	const R = rng(3), ks = S / 768;
	for (const ctx of [x1, x2]) {
		for (let k = 0; k < 300; k++) {
			const a = R() * TAU, rr = Math.sqrt(R()) * 0.8;
			const [px, py] = toPx(Math.sin(a) * rr, Math.cos(a) * rr, S);
			const g = 62 + R() * 26;
			ctx.fillStyle = `rgba(${g * 0.95 | 0},${g | 0},${28 + R() * 10 | 0},${0.55 + R() * 0.3})`;
			ctx.beginPath();
			const pts = 4 + (R() * 3 | 0), sz = (0.5 + R() * 1.1) * ks; // a jagged little flake, not an ellipse
			for (let q = 0; q < pts; q++) {
				const th = (q / pts) * TAU + R() * 0.6, rd = sz * (0.5 + R() * 0.8);
				q ? ctx.lineTo(px + Math.cos(th) * rd, py + Math.sin(th) * rd) : ctx.moveTo(px + Math.cos(th) * rd, py + Math.sin(th) * rd);
			}
			ctx.fill();
		}
	}
	return { raw: tex(c1), baked: tex(c2) };
}

/* ---------------------------------------------------------------- Cheese */
export function makeCheese(style = 'shred', seed = 11, S = 1024) {
	const R = rng(seed);
	const k1024 = S / 1024;
	// 1) raw cheese heightfield (strands or fresh mozzarella blobs)
	const [ca, xa] = canvas(S, S);
	xa.fillStyle = '#000';
	xa.fillRect(0, 0, S, S);
	xa.globalCompositeOperation = 'lighter';
	if (style === 'shred') {
		xa.lineCap = 'round';
		// a generous handful spread to ~1.5 cm from the cornicione: only small, scattered windows of sauce stay open
		for (let n = 0; n < 14000; n++) {
			const a = R() * TAU, rr = Math.sqrt(R()) * 0.8;
			const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
			if (N.fbm2(x * 6.5 + seed, z * 6.5, 3) < 0.33 + R() * 0.07) continue;
			const [px, py] = toPx(x, z, S);
			const ang = R() * Math.PI, len = (10 + R() * 26) * k1024;
			const cx = Math.cos(ang) * len / 2, cy = Math.sin(ang) * len / 2;
			xa.strokeStyle = `rgba(255,255,255,${0.2 + R() * 0.22})`;
			xa.lineWidth = (4 + R() * 5) * k1024;
			xa.beginPath();
			xa.moveTo(px - cx, py - cy);
			xa.quadraticCurveTo(px + (R() - 0.5) * 10 * k1024, py + (R() - 0.5) * 10 * k1024, px + cx, py + cy);
			xa.stroke();
		}
	} else {
		const pts = [];
		let tries = 0;
		// torn fior di latte: irregular pieces of mixed size that melt into pools covering about half the pie
		while (pts.length < 24 && tries++ < 6000) {
			const a = R() * TAU, rr = Math.sqrt(R()) * 0.68;
			const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
			if (pts.every((p) => Math.hypot(p[0] - x, p[1] - z) > 0.2)) pts.push([x, z]);
		}
		for (const [x, z] of pts) {
			const [px, py] = toPx(x, z, S);
			const rad = (0.07 + R() * R() * 0.11) * S / 2;
			const g = xa.createRadialGradient(px, py, 0, px, py, rad * 1.15);
			g.addColorStop(0, 'rgba(255,255,255,1)');
			g.addColorStop(0.65, 'rgba(235,235,235,0.95)');
			g.addColorStop(1, 'rgba(120,120,120,0.0)');
			xa.fillStyle = g;
			xa.beginPath();
			const off = R() * 10;
			for (let s = 0; s <= 28; s++) {
				const t = (s / 28) * TAU;
				const w = rad * (0.82 + 0.3 * N.n2(Math.cos(t) * 1.6 + off, Math.sin(t) * 1.6 + off));
				const X = px + Math.cos(t) * w, Y = py + Math.sin(t) * w;
				s ? xa.lineTo(X, Y) : xa.moveTo(X, Y);
			}
			xa.fill();
		}
	}
	const rawData = xa.getImageData(0, 0, S, S).data;

	// 2) melted heightfield: blur (it spreads!) + bubbles
	// Hot mozzarella flows: heavy blur, then a domain warp so the pools lose the strand shapes.
	const [cb, xb] = canvas(S, S);
	xb.filter = `blur(${(style === 'shred' ? 15 : 14) * k1024}px)`;
	xb.drawImage(ca, 0, 0);
	xb.filter = 'none';
	const blurData = xb.getImageData(0, 0, S, S).data;

	const P = S * S;
	const hR = new Float32Array(P), hM = new Float32Array(P), toast = new Float32Array(P);
	const warp = 26 * k1024;
	for (let j = 0; j < S; j++) {
		for (let i = 0; i < S; i++) {
			const p = j * S + i;
			hR[p] = clamp(rawData[p * 4] / 255);
			const wx = i + (N.fbm2(i / S * 7, j / S * 7 + 3, 3) - 0.5) * 2 * warp;
			const wy = j + (N.fbm2(i / S * 7 + 9, j / S * 7, 3) - 0.5) * 2 * warp;
			const q = (Math.min(S - 1, Math.max(0, wy | 0)) * S + Math.min(S - 1, Math.max(0, wx | 0))) * 4;
			const b = blurData[q] / 255;
			// flat molten plateau with soft, rounded pool edges
			// molten, but not a billiard table: where more cheese piled up the melt stays lumpier and higher
			hM[p] = style === 'shred'
				? Math.pow(sstep(0.03, 0.42, b), 1.6) * (0.46 + 0.26 * sstep(0.35, 0.95, b)) + (N2.fbm2(i / S * 22, j / S * 22, 3) - 0.5) * 0.08 * sstep(0.2, 0.5, b)
				: sstep(0.09, 0.4, b) * (0.6 + 0.2 * sstep(0.4, 0.9, b)); // gentle taper into sauce gaps
		}
	}
	const nb = style === 'shred' ? 900 : 320;
	for (let n = 0; n < nb; n++) {
		const a = R() * TAU, rr = Math.sqrt(R()) * 0.76;
		const [px, py] = toPx(Math.sin(a) * rr, Math.cos(a) * rr, S);
		const ix = px | 0, iy = py | 0;
		if (hM[iy * S + ix] < 0.45) continue;
		const rad = (5 + R() * R() * 20) * k1024;
		const amp = 0.06 + R() * 0.12;
		const sx = 0.7 + R() * 0.6, ph = R() * 6.28;
		for (let y = Math.max(0, iy - rad | 0); y < Math.min(S, iy + rad + 1); y++) {
			for (let x = Math.max(0, ix - rad | 0); x < Math.min(S, ix + rad + 1); x++) {
				const ax = (x - px) * sx, ay = (y - py) / sx;
				const an = Math.atan2(ay, ax), wob = 1 + 0.14 * Math.sin(an * 2 + ph) + 0.08 * Math.sin(an * 5 + ph * 2.3); // irregular, not 3-lobed (that read as little triangles)
				const dd = (ax * ax + ay * ay) / (rad * rad * wob * wob);
				if (dd >= 1) continue;
				const dome = Math.pow(1 - dd, 1.6);
				const q = y * S + x;
				hM[q] += dome * amp;
				toast[q] = Math.max(toast[q], dome * (0.4 + amp * 1.6));
			}
		}
	}

	// 3) albedo raw / baked + height RG texture
	const [cr, xr] = canvas(S, S), [ck, xk] = canvas(S, S), [ch, xh] = canvas(S, S);
	const ir = xr.createImageData(S, S), ik = xk.createImageData(S, S), ih = xh.createImageData(S, S);
	const fior = style !== 'shred';
	for (let j = 0; j < S; j++) {
		const z = (1 - j / S) * 2 - 1;
		for (let i = 0; i < S; i++) {
			const x = (i / S) * 2 - 1;
			const p = j * S + i, k = p * 4;
			const n = N2.fbm2(x * 30, z * 30, 3);
			const h = hR[p];
			const f = 0.8 + 0.2 * Math.min(1, h * 1.6) + (n - 0.5) * 0.12;
			ir.data[k] = 238 * f; ir.data[k + 1] = 232 * f; ir.data[k + 2] = 212 * f; ir.data[k + 3] = 255;

			const oil = sstep(0.45, 0.72, N.fbm2(x * 6 + 3, z * 6 - 2, 3));
			let r = fior ? 246 : 246, g = fior ? 236 : 212, b = fior ? 204 : 132;
			r = mix(r, 236, oil * 0.7); g = mix(g, fior ? 214 : 178, oil * 0.7); b = mix(b, fior ? 150 : 70, oil * 0.7);
			const big = sstep(0.5, 0.74, N.fbm2(x * 7 - 9, z * 7 + 4, 4)) * sstep(0.2, 0.6, hM[p]);
			const speck = sstep(0.62, 0.82, N2.fbm2((x * 0.8 + z * 0.6) * 16 + 2, (z * 0.8 - x * 0.6) * 16 - 5, 4)) * sstep(0.3, 0.6, hM[p]);
			// thin cheese browns first: pool edges (fior) and the borders of sauce gaps (shredded)
			const rim = fior ? sstep(0.14, 0.3, hM[p]) * (1 - sstep(0.36, 0.55, hM[p])) : (1 - sstep(0.18, 0.42, hM[p])) * 0.9;
			const t = clamp(toast[p] * (fior ? 1.0 : 1.25) + big * (fior ? 0.55 : 0.85) + speck * (fior ? 0.3 : 0.38) + rim * 0.75);
			r = mix(r, 206, t); g = mix(g, 128, t); b = mix(b, 48, t);
			const deep = sstep(0.7, 1.05, toast[p] + big * 0.45 + speck * 0.3) * (fior ? 0.6 : 1);
			r = mix(r, 128, deep); g = mix(g, 66, deep); b = mix(b, 26, deep);
			const fn = 0.93 + (n - 0.5) * 0.14;
			ik.data[k] = r * fn; ik.data[k + 1] = g * fn; ik.data[k + 2] = b * fn; ik.data[k + 3] = 255;

			ih.data[k] = clamp(h) * 255; ih.data[k + 1] = clamp(hM[p]) * 255; ih.data[k + 2] = 0; ih.data[k + 3] = 255;
		}
	}
	xr.putImageData(ir, 0, 0);
	xk.putImageData(ik, 0, 0);
	xh.putImageData(ih, 0, 0);
	const heightTex = tex(ch, { srgb: false });
	heightTex.anisotropy = 1;
	return {
		raw: tex(cr),
		baked: tex(ck),
		height: heightTex,
		cov: { data: ih.data, S },
		// per-pixel slopes halve when the resolution doubles; keep the bump the same physical size
		normRaw: normalFromHeight(hR, S, S, 3.5 * k1024),
		normBaked: normalFromHeight(hM, S, S, 5 * k1024),
	};
}

/* ---------------------------------------------------------------- Planar char (burn) mask */
export function makePlanarChar(S = 512) {
	const [c, x] = canvas(S, S);
	const img = x.createImageData(S, S);
	for (let j = 0; j < S; j++) {
		for (let i = 0; i < S; i++) {
			const k = (j * S + i) * 4;
			img.data[k] = 0;
			img.data[k + 1] = N.fbm2(i / S * 6 + 20, j / S * 6, 4) * 255;
			img.data[k + 2] = 0; img.data[k + 3] = 255;
		}
	}
	x.putImageData(img, 0, 0);
	x.globalCompositeOperation = 'lighter';
	const R = rng(5);
	for (let n = 0; n < 160; n++) {
		const px = R() * S, py = R() * S, rad = (2 + R() * 7) * (S / 512);
		const g = x.createRadialGradient(px, py, 0, px, py, rad);
		g.addColorStop(0, 'rgba(255,0,0,0.9)');
		g.addColorStop(1, 'rgba(255,0,0,0)');
		x.fillStyle = g;
		x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
	}
	return tex(c, { srgb: false });
}

/* ---------------------------------------------------------------- Crust (cornicione) */
// u: angle around the pizza (0..1), v: along the profile, 0 = inner edge by the sauce, 1 = underside.
export function makeCrust(W = 2048, H = 256) {
	const [c1, x1] = canvas(W, H), [c2, x2] = canvas(W, H), [c3, x3] = canvas(W, H);
	const i1 = x1.createImageData(W, H), i2 = x2.createImageData(W, H), i3 = x3.createImageData(W, H);
	const height = new Float32Array(W * H);
	const stops = [
		[0.0, 208, 146, 74], [0.15, 206, 140, 66], [0.33, 178, 102, 42], [0.5, 184, 110, 46],
		[0.66, 205, 142, 70], [0.8, 214, 162, 96], [0.9, 168, 108, 54], [1.0, 132, 84, 44],
	];
	const grad = (v) => {
		for (let s = 1; s < stops.length; s++) {
			if (v <= stops[s][0]) {
				const a = stops[s - 1], b = stops[s], t = (v - a[0]) / (b[0] - a[0]);
				return [mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t)];
			}
		}
		return stops[stops.length - 1].slice(1);
	};
	for (let j = 0; j < H; j++) {
		const v = 1 - j / H;
		for (let i = 0; i < W; i++) {
			const u = i / W, ang = u * TAU;
			const ca = Math.cos(ang), sa = Math.sin(ang);
			const n = N.fbm3(ca * 30, sa * 30, v * 12, 4);
			const big = N.fbm3(ca * 7 + 3, sa * 7, v * 3, 3);
			const fine = N2.fbm3(ca * 90, sa * 90, v * 36, 2);
			const k = (j * W + i) * 4;
			// raw dough
			// fresh dough is a warm cream (a little yellow from the oil and the semola), not white; only a light
			// dusting of flour on the rim. ACES tone mapping greys out near-whites, so it stays below them.
			const fr = 0.9 + 0.12 * n;
			const flour = sstep(0.76, 0.88, fine) * (0.35 + v * 0.35);
			i1.data[k] = mix(234 * fr, 240, flour);
			i1.data[k + 1] = mix(196 * fr, 226, flour);
			i1.data[k + 2] = mix(138 * fr, 196, flour);
			i1.data[k + 3] = 255;
			// baked
			const [gr, gg, gb] = grad(v);
			const top = sstep(0.12, 0.3, v) * (1 - sstep(0.62, 0.8, v));
			const dk = 0.88 + 0.22 * n - top * sstep(0.5, 0.75, big) * 0.22;
			const fl2 = sstep(0.74, 0.84, fine) * (sstep(0.82, 0.95, v) * 0.8 + 0.12);
			i2.data[k] = mix(gr * dk, 236, fl2);
			i2.data[k + 1] = mix(gg * dk, 222, fl2);
			i2.data[k + 2] = mix(gb * dk, 196, fl2);
			i2.data[k + 3] = 255;
			// char: R = leopard spots (drawn below), G = slow burn field
			i3.data[k] = 0;
			i3.data[k + 1] = clamp(big * 0.7 + top * 0.45 + n * 0.15) * 255;
			i3.data[k + 2] = 0; i3.data[k + 3] = 255;
			height[j * W + i] = n * 0.6 + fine * 0.4;
		}
	}
	x1.putImageData(i1, 0, 0);
	x2.putImageData(i2, 0, 0);
	x3.putImageData(i3, 0, 0);
	// leopard spots, circular in world space (v pixels are ~1.9x denser than u pixels)
	x3.globalCompositeOperation = 'lighter';
	const R = rng(21);
	const spot = (px, py, ru, a) => {
		x3.save();
		x3.translate(px, py);
		x3.scale(1, 1.9);
		const g = x3.createRadialGradient(0, 0, 0, 0, 0, ru);
		g.addColorStop(0, `rgba(255,0,0,${a})`);
		g.addColorStop(0.6, `rgba(255,0,0,${a * 0.7})`);
		g.addColorStop(1, 'rgba(255,0,0,0)');
		x3.fillStyle = g;
		x3.fillRect(-ru, -ru, ru * 2, ru * 2);
		x3.restore();
	};
	for (let n = 0; n < 380; n++) {
		const u = R(), v = 0.18 + R() * 0.5;
		const px = u * W, py = (1 - v) * H, ru = 2.5 + R() * R() * 11, a = 0.6 + R() * 0.4;
		spot(px, py, ru, a);
		if (px < 20) spot(px + W, py, ru, a);
		if (px > W - 20) spot(px - W, py, ru, a);
		if (R() < 0.5) for (let m = 0; m < 3; m++) spot(px + (R() - 0.5) * 24, py + (R() - 0.5) * 10, 1.5 + R() * 3, a * 0.8);
	}
	const t1 = tex(c1, { wrap: true }), t2 = tex(c2, { wrap: true }), t3 = tex(c3, { srgb: false, wrap: true });
	const nrm = normalFromHeight(height, W, H, 5 * (W / 2048), true);
	nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
	return { raw: t1, baked: t2, char: t3, normal: nrm };
}

/* ---------------------------------------------------------------- Crumb (cut faces) */
export function makeCrumb(S = 512) {
	const [c, x] = canvas(S, S);
	const img = x.createImageData(S, S);
	for (let j = 0; j < S; j++) {
		for (let i = 0; i < S; i++) {
			const n = N.fbm2(i / S * 20, j / S * 20, S > 600 ? 5 : 3);
			const k = (j * S + i) * 4;
			img.data[k] = 236 * (0.92 + n * 0.12);
			img.data[k + 1] = 218 * (0.92 + n * 0.12);
			img.data[k + 2] = 176 * (0.92 + n * 0.12);
			img.data[k + 3] = 255;
		}
	}
	x.putImageData(img, 0, 0);
	const R = rng(8), kc = S / 512;
	for (let n = 0; n < 420; n++) {
		const px = R() * S, py = R() * S, rx = (2 + R() * R() * 22) * kc, ry = rx * (0.5 + R() * 0.6);
		const g = x.createRadialGradient(px, py - ry * 0.3, 0, px, py, rx);
		g.addColorStop(0, 'rgba(170,130,80,0.9)');
		g.addColorStop(0.8, 'rgba(205,172,120,0.7)');
		g.addColorStop(1, 'rgba(230,210,170,0)');
		x.fillStyle = g;
		x.beginPath();
		x.ellipse(px, py, rx, ry, R() * 3, 0, TAU);
		x.fill();
	}
	return tex(c, { wrap: true });
}

/* ---------------------------------------------------------------- Pepperoni */
export function makePepperoni(S = 256) {
	const [c, x] = canvas(S, S);
	const img = x.createImageData(S, S);
	for (let j = 0; j < S; j++) {
		for (let i = 0; i < S; i++) {
			const px = i / S * 2 - 1, py = j / S * 2 - 1;
			const d = Math.hypot(px, py);
			const n = N.fbm2(px * 5 + 3, py * 5, 4);
			const fat = sstep(0.74, 0.8, N2.n2(px * 26 + 7, py * 26) * 0.65 + N.n2(px * 55, py * 55) * 0.35);
			let r = 186 * (0.8 + 0.3 * n), g = 46 * (0.75 + 0.4 * n), b = 40 * (0.8 + 0.3 * n);
			r = mix(r, 232, fat * 0.8); g = mix(g, 176, fat * 0.8); b = mix(b, 150, fat * 0.8);
			const rim = sstep(0.88, 0.99, d);
			r = mix(r, 150, rim * 0.7); g = mix(g, 40, rim * 0.7); b = mix(b, 28, rim * 0.7);
			const k = (j * S + i) * 4;
			img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
		}
	}
	x.putImageData(img, 0, 0);
	return tex(c);
}

/* ---------------------------------------------------------------- Basil leaf */
export function makeBasil(W = 128, H = 256) {
	const [c, x] = canvas(W, H);
	const g = x.createLinearGradient(0, 0, W, 0);
	g.addColorStop(0, '#1f5a1c');
	g.addColorStop(0.5, '#3f8f2c');
	g.addColorStop(1, '#1f5a1c');
	x.fillStyle = g;
	x.fillRect(0, 0, W, H);
	x.strokeStyle = 'rgba(170,220,120,0.55)';
	x.lineWidth = 3;
	x.beginPath(); x.moveTo(W / 2, H); x.lineTo(W / 2, 8); x.stroke();
	x.lineWidth = 1.5;
	for (let k = 0; k < 7; k++) {
		const y = H - 30 - k * 30;
		x.beginPath(); x.moveTo(W / 2, y); x.quadraticCurveTo(W * 0.3, y - 14, 6, y - 34); x.stroke();
		x.beginPath(); x.moveTo(W / 2, y); x.quadraticCurveTo(W * 0.7, y - 14, W - 6, y - 34); x.stroke();
	}
	const img = x.getImageData(0, 0, W, H);
	for (let p = 0; p < W * H; p++) {
		const n = 0.85 + N.n2((p % W) / 9, Math.floor(p / W) / 9) * 0.3;
		img.data[p * 4] *= n; img.data[p * 4 + 1] *= n; img.data[p * 4 + 2] *= n;
	}
	x.putImageData(img, 0, 0);
	return tex(c);
}

/* ---------------------------------------------------------------- Embers (glowing logs) */
export function makeEmbers(W = 256, H = 256) {
	const [c, x] = canvas(W, H);
	const img = x.createImageData(W, H);
	for (let j = 0; j < H; j++) {
		for (let i = 0; i < W; i++) {
			const ang = i / W * TAU;
			const n = N.fbm3(Math.cos(ang) * 3, Math.sin(ang) * 3, j / H * 8, 5);
			const crack = 1 - Math.abs(n - 0.5) * 2;
			const glow = sstep(0.9, 0.985, crack) * sstep(0.35, 0.6, N.fbm3(Math.cos(ang) * 1.3 + 5, Math.sin(ang) * 1.3, j / H * 2, 2));
			const k = (j * W + i) * 4;
			img.data[k] = 255 * glow; img.data[k + 1] = 120 * glow * glow; img.data[k + 2] = 20 * glow; img.data[k + 3] = 255;
		}
	}
	x.putImageData(img, 0, 0);
	return tex(c, { wrap: true });
}

/* ---------------------------------------------------------------- Soft sprite (steam / smoke) */
// Orange chili oil that pepperoni sweats into the cheese while it bakes.
export function makeGrease(S = 128) {
	const [c, x] = canvas(S, S);
	const img = x.createImageData(S, S);
	for (let j = 0; j < S; j++) {
		for (let i = 0; i < S; i++) {
			const px = i / S * 2 - 1, py = j / S * 2 - 1;
			const d = Math.hypot(px, py), a = Math.atan2(py, px);
			const edge = 0.72 + 0.22 * N.n2(Math.cos(a) * 2 + 4, Math.sin(a) * 2);
			const al = clamp(1 - sstep(edge - 0.25, edge, d)) * (0.55 + 0.45 * N.fbm2(px * 4, py * 4, 3));
			const k = (j * S + i) * 4;
			img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 255; img.data[k + 3] = al * 255;
		}
	}
	x.putImageData(img, 0, 0);
	return tex(c);
}

export function makeSoftSprite(S = 128) {
	const [c, x] = canvas(S, S);
	const img = x.createImageData(S, S);
	for (let j = 0; j < S; j++) {
		for (let i = 0; i < S; i++) {
			const px = i / S * 2 - 1, py = j / S * 2 - 1;
			const d = Math.hypot(px, py);
			const n = N.fbm2(px * 3 + 5, py * 3, 4);
			const a = clamp((1 - d) * 1.4) * sstep(0.3, 0.75, n + (1 - d) * 0.35);
			const k = (j * S + i) * 4;
			img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 255; img.data[k + 3] = a * 255;
		}
	}
	x.putImageData(img, 0, 0);
	return tex(c);
}

/* ---------------------------------------------------------------- Flour dusting on the table */
export function makeFlour(S = 1024) {
	const [c, x] = canvas(S, S);
	const R = rng(44);
	for (let n = 0; n < 7000; n++) {
		const a = R() * TAU, rr = 0.24 + Math.pow(R(), 1.8) * 0.6;
		if (N.fbm2(Math.cos(a) * rr * 4 + 8, Math.sin(a) * rr * 4, 3) < 0.5) continue;
		const px = S / 2 + Math.cos(a) * rr * S / 2, py = S / 2 + Math.sin(a) * rr * S / 2;
		x.fillStyle = `rgba(250,246,236,${0.04 + R() * 0.14})`;
		x.beginPath();
		x.arc(px, py, 0.4 + R() * 1.1, 0, TAU);
		x.fill();
	}
	return tex(c);
}
