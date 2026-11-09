// Pouring tomato sauce on bare dough.
//
// Passata is not water: it is a yield-stress (Bingham-type) fluid. It only flows while the stress its own
// weight puts on it, roughly ρ·g·h·|∇h|, beats the yield stress τy. A fresh ladleful therefore slumps into
// a puddle, spreads while it is thick, and stops dead once the layer is thin, with a soft rounded edge,
// which is exactly how a sauced pizza looks. We run that rule on a small height grid over the pizza:
// flux between neighbours = k · h̄ · max(0, h̄·|Δh|/dx − τ), with τ varying a little from cell to cell
// (dough is not perfectly smooth), so edges come out naturally irregular.
//
// The pizzaiolo's other move, spreading with the back of the ladle, is a local shear: under the ladle the
// yield stress is overcome and sauce is pushed outwards along the stroke.
import * as THREE from 'three';
import { rng, Noise } from './noise.js';
const NZ = new Noise(17);
const smooth = (x, y) => Math.min(1, Math.max(0, NZ.fbm2(x, y, 3)));

let N = 160;
// grid cells across the pizza; 256 on desktops (≈1.3 mm cells on a 33 cm pizza) for crisp sauce edges
export function setSauceGrid(n) { N = n; }
const R_SAUCE = 0.86; // sauce stops at the cornicione
const TAU0 = 0.0016, K = 7, MAXH = 1.4;

export class SauceField {
	constructor() {
		this.h = new Float32Array(N * N);
		this.f = new Float32Array(N * N);
		this.tau = new Float32Array(N * N);
		this.inside = new Uint8Array(N * N);
		const R = rng(4);
		for (let j = 0; j < N; j++) {
			for (let i = 0; i < N; i++) {
				const x = ((i + 0.5) / N) * 2 - 1, z = ((j + 0.5) / N) * 2 - 1;
				const p = j * N + i;
				this.inside[p] = Math.hypot(x, z) < R_SAUCE ? 1 : 0;
				// dough roughness varies smoothly over a few millimetres, not cell by cell (white noise here made a
				// visible per-cell checkerboard once lit)
				this.tau[p] = TAU0 * (0.6 + 0.8 * smooth(i / 9, j / 9));
			}
		}
		this.data = new Uint8Array(N * N * 4);
		this.tex = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat);
		this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
		this.tex.needsUpdate = true;
		this.active = 0;
		this.volume = 0;
	}

	idx(x, z) {
		const i = Math.floor((x * 0.5 + 0.5) * N), j = Math.floor((z * 0.5 + 0.5) * N);
		return [Math.min(N - 1, Math.max(0, i)), Math.min(N - 1, Math.max(0, j))];
	}

	// drop `vol` of sauce in a small, slightly irregular splat at (x, z)
	pour(x, z, vol) {
		vol *= (N / 160) ** 2; // same ladleful covers the same area at any grid resolution
		const [ci, cj] = this.idx(x, z);
		const rad = 3.4 * N / 160;
		let wsum = 0;
		const cells = [];
		const reach = Math.ceil(rad * 1.2);
		for (let j = cj - reach; j <= cj + reach; j++) {
			for (let i = ci - reach; i <= ci + reach; i++) {
				if (i < 0 || j < 0 || i >= N || j >= N) continue;
				const p = j * N + i;
				if (!this.inside[p]) continue;
				const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (rad * rad);
				const w = Math.exp(-d2 * 1.6) * (0.75 + 0.5 * Math.random());
				cells.push([p, w]);
				wsum += w;
			}
		}
		for (const [p, w] of cells) this.h[p] = Math.min(MAXH, this.h[p] + (vol * w) / wsum);
		this.volume += vol;
		this.active = 2.5;
	}

	// back-of-the-ladle spreading: under the ladle the sauce yields and is pushed out along the stroke
	spread(x, z, dx, dz) {
		const [ci, cj] = this.idx(x, z);
		const rad = Math.round(7 * N / 160);
		const len = Math.hypot(dx, dz) || 1;
		const ux = dx / len, uz = dz / len;
		const h = this.h, f = this.f;
		f.fill(0);
		for (let j = cj - rad; j <= cj + rad; j++) {
			for (let i = ci - rad; i <= ci + rad; i++) {
				if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) continue;
				const p = j * N + i;
				const d = Math.hypot(i - ci, j - cj) / rad;
				if (d >= 1 || !this.inside[p] || h[p] <= 0) continue;
				const w = (1 - d * d) * 0.35;
				// move part of this cell's sauce one cell outwards (away from the ladle centre) and along the stroke
				const ox = (i - ci) / (d * rad + 1e-3) * 0.6 + ux * 0.8, oz = (j - cj) / (d * rad + 1e-3) * 0.6 + uz * 0.8;
				const ti = i + Math.sign(ox) * (Math.abs(ox) > 0.35 ? 1 : 0), tj = j + Math.sign(oz) * (Math.abs(oz) > 0.35 ? 1 : 0);
				const q = tj * N + ti;
				if (!this.inside[q]) continue;
				const m = h[p] * w;
				f[p] -= m;
				f[q] += m;
			}
		}
		for (let p = 0; p < N * N; p++) h[p] = Math.max(0, h[p] + f[p]);
		this.active = 2.5;
	}

	clear() { this.h.fill(0); this.volume = 0; this.active = 1; }

	fill() { // a quick even coat (the classic spiral), with thinner edges
		for (let j = 0; j < N; j++) {
			for (let i = 0; i < N; i++) {
				const p = j * N + i;
				if (!this.inside[p]) continue;
				const r = Math.hypot(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1);
				this.h[p] = 0.11 * (1 - Math.pow(r / R_SAUCE, 6)) * (0.85 + 0.3 * Math.random());
			}
		}
		this.active = 2;
	}

	// Bingham flow: only where the layer is thick and steep enough to beat the yield stress
	step(dt) {
		if (this.active <= 0) return false;
		this.active -= dt;
		const h = this.h, f = this.f, dx = 2 / N;
		// explicit flow moves sauce one cell per substep, so a finer grid needs (N/160)^2 more substeps
		// to spread the same physical distance in the same time
		const g = (N / 160) ** 2, sub = Math.ceil(3 * g);
		for (let s = 0; s < sub; s++) {
			f.fill(0);
			for (let j = 1; j < N - 1; j++) {
				for (let i = 1; i < N - 1; i++) {
					const p = j * N + i;
					if (!this.inside[p]) continue;
					const hp = h[p];
					for (const q of [p + 1, p + N]) {
						if (!this.inside[q]) continue;
						const hq = h[q], dh = hp - hq;
						const hb = (hp + hq) * 0.5;
						if (hb <= 0) continue;
						const stress = hb * Math.abs(dh) / dx * 0.02;
						const t = (this.tau[p] + this.tau[q]) * 0.5;
						if (stress <= t) continue;
						let flux = K * hb * (stress - t) * Math.sign(dh) * (dt / 3) * 60;
						flux = Math.max(-hq * 0.12, Math.min(hp * 0.12, flux)); // ≤1/8 per face keeps the explicit scheme from ringing into a checkerboard
						f[p] -= flux;
						f[q] += flux;
					}
				}
			}
			for (let p = 0; p < N * N; p++) if (f[p]) h[p] = Math.max(0, h[p] + f[p]);
		}
		this.upload();
		return true;
	}

	upload() {
		const d = this.data, h = this.h;
		// the surface the eye sees is the sauce smoothed over ~3 cells (surface tension), not raw cells
		const sm = this.sm || (this.sm = new Float32Array(N * N));
		for (let j = 0; j < N; j++) {
			for (let i = 0; i < N; i++) {
				let a = 0, wsum = 0;
				for (let dj = -1; dj <= 1; dj++) {
					for (let di = -1; di <= 1; di++) {
						const ii = i + di, jj = j + dj;
						if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
						const w = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
						a += h[jj * N + ii] * w; wsum += w;
					}
				}
				sm[j * N + i] = a / wsum;
			}
		}
		for (let p = 0; p < N * N; p++) {
			const v = Math.min(255, (sm[p] / MAXH) * 255 * 3);
			d[p * 4] = v; d[p * 4 + 1] = v; d[p * 4 + 2] = v; d[p * 4 + 3] = 255;
		}
		this.tex.needsUpdate = true;
	}

	// coverage 0..1 at a pizza-local point (used for the cut walls and ingredient resting height)
	at(x, z) { const [i, j] = this.idx(x, z); return this.h[j * N + i]; }

	serialize() {
		const q = new Uint8Array(N * N);
		for (let p = 0; p < N * N; p++) q[p] = Math.min(255, Math.round((this.h[p] / MAXH) * 255));
		let s = '';
		for (let p = 0; p < q.length; p += 8192) s += String.fromCharCode(...q.subarray(p, p + 8192));
		return btoa(s);
	}

	load(b64) {
		try {
			const s = atob(b64);
			const M = Math.round(Math.sqrt(s.length));
			if (M * M !== s.length) return;
			// saved at another grid size: resample (bilinear) onto this one
			for (let j = 0; j < N; j++) {
				for (let i = 0; i < N; i++) {
					const fx = ((i + 0.5) / N) * M - 0.5, fy = ((j + 0.5) / N) * M - 0.5;
					const x0 = Math.max(0, Math.min(M - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(M - 2, Math.floor(fy)));
					const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
					const at = (x, y) => s.charCodeAt(y * M + x) / 255;
					const v = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
					this.h[j * N + i] = this.inside[j * N + i] ? v * MAXH : 0;
				}
			}
			this.upload();
		} catch { /* keep empty */ }
	}
}

// The ladle: a brushed-steel bowl on a long handle that hovers over the pointer, tilts to pour, and lets a
// stream of sauce fall onto the dough (thick near the lip, necking as it accelerates under gravity).
export class Ladle {
	constructor(sauceMat) {
		this.group = new THREE.Group();
		this.group.visible = false;
		const steel = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.38 });
		const pts = [];
		for (let k = 0; k <= 16; k++) {
			const a = (k / 16) * Math.PI * 0.5;
			pts.push(new THREE.Vector2(Math.sin(a) * 0.16 + 0.001, -Math.cos(a) * 0.11));
		}
		const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), steel);
		bowl.material.side = THREE.DoubleSide;
		const fillMat = sauceMat;
		this.fill = new THREE.Mesh(new THREE.CircleGeometry(0.145, 40).rotateX(-Math.PI / 2), fillMat);
		this.fill.position.y = -0.02;
		const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.9, 12), steel);
		handle.rotation.z = Math.PI / 2 - 0.5;
		handle.position.set(-0.53, 0.22, 0);
		this.tilt = new THREE.Group();
		this.tilt.add(bowl, this.fill, handle);
		this.tilt.position.y = 0.42;
		this.group.add(this.tilt);
		this.stream = new THREE.Mesh(new THREE.BufferGeometry(), fillMat);
		this.stream.castShadow = true;
		this.group.add(this.stream);
		this.pouring = 0;
		this.flow = 0;
	}

	update(dt, time, target, pouring, scale) {
		this.pouring += ((pouring ? 1 : 0) - this.pouring) * (1 - Math.exp(-dt * 8));
		this.tilt.rotation.z = -0.15 - this.pouring * 0.75;
		this.tilt.rotation.x = Math.sin(time * 1.3) * 0.02;
		this.flow = this.pouring;
		this.stream.geometry.dispose();
		if (this.flow < 0.05) { this.stream.geometry = new THREE.BufferGeometry(); return; }
		// stream from the lip (rotated with the bowl) down to the dough
		const lip = new THREE.Vector3(0.15, -0.01, 0).applyEuler(this.tilt.rotation).add(this.tilt.position);
		const end = new THREE.Vector3(0, target, 0);
		const pts = [];
		for (let k = 0; k <= 12; k++) {
			const u = k / 12;
			const p = new THREE.Vector3().lerpVectors(lip, end, u);
			p.x = lip.x * (1 - u) * (1 - u); // falls almost straight, curving off the lip
			p.x += Math.sin(time * 9 + u * 7) * 0.004 * u;
			p.z += Math.cos(time * 7 + u * 5) * 0.003 * u;
			pts.push(p);
		}
		const curve = new THREE.CatmullRomCurve3(pts);
		const r0 = 0.024 * this.flow;
		// free fall: speed grows as sqrt(2gh), so by continuity the radius shrinks as (1 + h/h0)^-1/4
		this.stream.geometry = new THREE.TubeGeometry(curve, 24, 1, 16, false);
		const pos = this.stream.geometry.attributes.position;
		const c = new THREE.Vector3();
		for (let s = 0; s <= 24; s++) {
			const u = s / 24;
			curve.getPointAt(u, c);
			// it spreads a little where it lands (a smooth foot, not a stepped cone)
			const land = Math.max(0, (u - 0.9) / 0.1);
			const r = r0 * Math.pow(1 + u * 12, -0.25) * (1 + 0.8 * land * land);
			for (let k = 0; k <= 16; k++) {
				const v = s * 17 + k;
				const x = pos.getX(v) - c.x, y = pos.getY(v) - c.y, z = pos.getZ(v) - c.z;
				const l = Math.hypot(x, y, z) || 1;
				pos.setXYZ(v, c.x + (x / l) * r, c.y + (y / l) * r, c.z + (z / l) * r);
			}
		}
		pos.needsUpdate = true;
		this.stream.geometry.computeVertexNormals();
	}
}
