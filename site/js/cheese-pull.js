// Cheese pulls: the molten mozzarella that stretches between a lifted slice and its neighbours.
// Each pull is a bundle of fibres rooted in the melt on both sides of a cut. As the slice rises they neck
// down to threads (volume is conserved), bead up, snap one by one and recoil into the cheese they came from.
import * as THREE from 'three';
import { rng, sstep } from './noise.js';
import { TAU, makeGeometry } from './geo.js';

const PULLS_PER_SLICE = 8;
const REST_LENGTH = 0.05; // stretch (in pizza radii) at which a fibre starts to thin
const FINE = 0.003; // fibres thinner than this bead up and get fewer facets
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export class CheesePull {
	constructor(pizza) {
		this.pizza = pizza;
		this.pulls = [];
		this.material = new THREE.MeshPhysicalMaterial({
			map: fibreTexture(), vertexColors: true, roughness: 0.6, specularIntensity: 0.25, envMapIntensity: 0.3,
			emissive: new THREE.Color(0.06, 0.042, 0.016), // thin cheese lets light through: never grey in its own shadow
		});
	}

	start(slice) {
		this.clear();
		const { pizza } = this, R = rng(slice.index * 31 + 7);
		for (let k = 0; k < PULLS_PER_SLICE; k++) {
			const first = k % 2 === 0, theta = first ? slice.a0 : slice.a1;
			const neighbour = pizza.slices[(slice.index + (first ? -1 : 1) + pizza.N) % pizza.N];
			const r = this.findCheese(theta, R);
			if (r > 0) this.pulls.push(this.makePull(slice, neighbour, theta, r, R));
		}
	}

	// The cheese is most continuous towards the tip, so most pulls start there.
	findCheese(theta, R) {
		for (let tries = 0; tries < 40; tries++) {
			const r = 0.1 + R() ** 1.5 * 0.62;
			if (this.pizza.hasCheeseAt(r * Math.sin(theta), r * Math.cos(theta))) return r;
		}
		return -1;
	}

	makePull(slice, neighbour, theta, r, R) {
		const { pizza } = this;
		const along = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
		const across = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta)).multiplyScalar(Math.sin(slice.mid - theta) >= 0 ? 1 : -1); // into the lifted slice
		const P = along.clone().multiplyScalar(r);
		P.y = pizza.surfaceY(P.x, P.z) - 0.003;
		// Threads come out of the molten inside: creamy, only tinted by the browned top. The root on the slice
		// left lying wears the colour of the surface it leaves (divided by the fibre map's mean so they match).
		const top = pizza.cheeseColour(P.x, P.z);
		const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
		mesh.castShadow = true;
		(pizza.stringParent || pizza.root.parent).add(mesh);
		const fibres = Array.from({ length: 5 + Math.floor(R() * 6) }, () => this.makeFibre(P, along, across, R));
		return {
			P, slice, neighbour, mesh, fibres, age: 0, releasedAt: -1,
			core: new THREE.Color(0.86, 0.66, 0.34).lerp(top, 0.4), root: top.clone().multiplyScalar(1 / 0.86),
		};
	}

	// Each fibre has its own spot along the cut and its own depth in the melt, so a pull fans out into a web at
	// the slices and necks together in between.
	makeFibre(P, along, across, R) {
		const { pizza } = this;
		const base = P.clone().addScaledVector(along, (R() - 0.5) * 0.12);
		const at = (inward, y) => { const q = base.clone().addScaledVector(across, inward); q.y = y(q); return q; };
		const sunk = (dy) => (q) => pizza.surfaceY(q.x, q.z) + dy;
		// On the slice left lying the root sits a little way in and dives into the melt.
		const inLying = -(0.008 + R() * 0.016);
		// On the lifted slice the thread leaves through the cut face of the cheese layer, low enough (and thin
		// enough) that nothing pokes out above the surface; it carries on inside and bends down just outside.
		const edge = at(0.001, sunk(0));
		const depth = pizza.cheeseDepthAt(edge.x, edge.z);
		const face = edge.clone().setY(edge.y - depth * 0.6);
		const r0 = 0.001 + R() ** 3 * 0.006; // mostly fine threads, the odd thick rope
		return {
			lyingRoot: at(inLying, sunk(-0.014)), lying: at(inLying, sunk(-0.002)),
			lifted: face, liftedOut: at(-0.0015, () => face.y - 0.007), liftedRoot: at(0.0022, () => face.y + Math.min(0.0035, depth * 0.3)),
			r0, maxRootRadius: depth * 0.42,
			lean: 0.7 + R() * 0.6, neck: 0.5 + R() * 0.4, wander: (R() - 0.5) * 2, waves: 1.2 + R() * 1.8, phase: R() * TAU,
			slack: R() < 0.25 ? 0.15 + R() * 0.25 : R() * R() * 0.1, // most fibres are pulled taut, a few hang in a shallow loop
			breakAt: 0.15 + R() ** 1.3 * 0.75 + r0 * 40, // thick ones last longest
			splitAt: 0.25 + R() * 0.5, releaseDelay: R() * 0.35, tint: 0.97 + R() * 0.06,
			broken: false, brokenFor: 0, brokenLength: 0, brokenThin: 1,
		};
	}

	release() {
		for (const p of this.pulls) if (p.releasedAt < 0) p.releasedAt = p.age;
	}

	clear() {
		this.pulls.forEach(discard);
		this.pulls = [];
	}

	update(dt) {
		if (!this.pulls.length) return;
		const { root } = this.pizza;
		root.updateMatrixWorld(true);
		this.scale = root.getWorldScale(new THREE.Vector3()).x;
		this.rootY = root.getWorldPosition(new THREE.Vector3()).y;
		for (const pull of this.pulls) this.updatePull(pull, dt);
		this.pulls = this.pulls.filter((pull) => !pull.done || discard(pull));
	}

	updatePull(pull, dt) {
		pull.age += dt;
		const lyingMatrix = pull.neighbour.group.matrixWorld, liftedMatrix = pull.slice.group.matrixWorld;
		const a = pull.P.clone().applyMatrix4(lyingMatrix), b = pull.P.clone().applyMatrix4(liftedMatrix);
		const side = b.clone().sub(a).cross(UP);
		if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
		const span = {
			a, b, side: side.normalize(), lyingMatrix, liftedMatrix,
			length: a.distanceTo(b) / this.scale,
		};
		span.thin = Math.sqrt(REST_LENGTH / Math.max(REST_LENGTH, span.length)); // radius of a thread stretched at constant volume
		const buf = { position: [], normal: [], uv: [], color: [], index: [] };
		let alive = 0;
		for (const f of pull.fibres) {
			const letGo = pull.releasedAt >= 0 && pull.age - pull.releasedAt > f.releaseDelay;
			if (!f.broken && (span.length > f.breakAt || letGo)) {
				Object.assign(f, { broken: true, brokenFor: 0, brokenLength: Math.max(span.length, 0.01), brokenThin: span.thin });
			}
			alive += f.broken ? this.addStubs(buf, pull, f, span, dt) : this.addThread(buf, pull, f, span);
		}
		pull.mesh.geometry.dispose();
		const { index, ...attributes } = buf;
		pull.mesh.geometry = index.length ? makeGeometry(attributes, index) : new THREE.BufferGeometry();
		pull.done = !alive && (pull.releasedAt >= 0 || pull.fibres.every((f) => f.broken));
	}

	// An intact fibre, from its root in the lying slice to its root in the lifted one.
	addThread(buf, pull, f, span) {
		const { a, b, side, length, thin } = span, s = this.scale;
		if (length < 0.004) return 0;
		const world = (p, m) => p.clone().applyMatrix4(m);
		const from = world(f.lying, span.lyingMatrix), to = world(f.lifted, span.liftedMatrix);
		const tension = Math.min(1, length / f.breakAt);
		const rRoot = f.r0 * s, rMid = rRoot * thin * f.lean;
		const sag = (0.03 + f.slack * (1 - 0.8 * tension)) * length * s;
		const spread = Math.min(0.05, 0.01 + length * 0.03) * s;
		const sway = 0.25 * Math.sin(pull.age * 1.7 + f.phase);
		const centre = new THREE.Vector3();
		const pts = [world(f.lyingRoot, span.lyingMatrix)];
		for (let k = 0; k < 14; k++) {
			const q = k / 14, u = q - Math.sin(TAU * q) / (TAU * 1.6), w = Math.sin(Math.PI * u); // points crowd towards both roots
			const p = from.clone().lerp(to, u).lerp(centre.lerpVectors(a, b, u), f.neck * w);
			p.addScaledVector(side, f.wander * Math.sin(Math.PI * u * f.waves + f.phase + sway) * spread * w);
			p.y -= sag * 4 * u * (1 - u);
			pts.push(this.keepAbove(p, rMid, u));
		}
		pts.push(world(f.liftedOut, span.liftedMatrix), to, world(f.liftedRoot, span.liftedMatrix));

		const cap = f.maxRootRadius * s;
		const beads = Math.max(0, 0.55 - thin) * 1.6 * (f.r0 < FINE ? 1 : 0.4), beadCount = 3 + Math.floor(length * 18);
		const radius = (u) => {
			const e = Math.abs(2 * u - 1); // 0 mid-span, 1 at the roots
			let r = rMid + (rRoot - rMid) * e ** 3;
			r *= 1 + beads * Math.max(0, Math.sin(u * beadCount * Math.PI + f.phase)) ** 6; // thin threads bead up before they snap
			if (u < 0.5) r *= 1 + 0.9 * sstep(0.6, 1, e) ** 2; // a foot flaring into the melt it is pulled out of
			else if (r > cap) r += (cap - r) * sstep(0.8, 0.95, u); // never thicker than the layer it leaves through
			return r * endCap(u);
		};
		const mid = pull.core.clone().multiplyScalar(f.tint), c = new THREE.Color();
		const colour = (u) => c.copy(u > 0.5 ? pull.core : pull.root).lerp(mid, sstep(0.02, 0.24, Math.min(u, 1 - u)));
		addTube(buf, pts, radius, colour, length * 6, pts.length * 3, f.r0 < FINE ? 7 : 9);
		return 1;
	}

	// A snapped fibre leaves two stubs. Each starts on the line the thread had when it broke, springs back by
	// a third and falls: the one on the lying slice settles onto the cheese and melts back into it, the one on
	// the lifted slice dangles, a bead at its tip, until the slice is put down.
	addStubs(buf, pull, f, span, dt) {
		f.brokenFor += dt;
		const s = this.scale, t = f.brokenFor;
		const putDown = pull.releasedAt >= 0 ? sstep(0, 1.3, pull.age - pull.releasedAt - f.releaseDelay) : 0;
		const recoil = 1 - Math.exp(-t * 8), fall = 1 - Math.exp(-t * 4);
		const world = (p, m) => p.clone().applyMatrix4(m);
		const lying = world(f.lying, span.lyingMatrix), lifted = world(f.lifted, span.liftedMatrix);
		const rRoot = f.r0 * s, rThread = rRoot * Math.max(0.2, f.brokenThin) * f.lean;
		const stubs = [
			{ from: lying, to: lifted, share: f.splitAt, root: world(f.lyingRoot, span.lyingMatrix), r: rRoot, gone: Math.max(putDown, sstep(0.5, 2, t)) },
			{ from: lifted, to: lying, share: 1 - f.splitAt, root: world(f.liftedRoot, span.liftedMatrix), r: Math.min(rRoot, f.maxRootRadius * s), gone: putDown, hangs: true },
		];
		const c = new THREE.Color(), mid = pull.core.clone().multiplyScalar(f.tint);
		const colour = (u) => c.copy(pull.root).lerp(mid, sstep(0, 0.45, u));
		let alive = 0;
		for (const stub of stubs) {
			if (stub.gone >= 1) continue;
			alive = 1;
			const length = f.brokenLength * stub.share * (1 - 0.35 * recoil) * (1 - 0.6 * stub.gone) * s;
			const dir = stub.to.clone().sub(stub.from);
			if (dir.lengthSq() < 1e-10) dir.copy(span.side);
			dir.normalize();
			const rest = stub.hangs ? DOWN : dir.clone().setY(-0.5).normalize();
			// the tip falls first, so the stub bends over rather than swinging round like a stick
			const pts = [stub.root], p = stub.from.clone(), step = new THREE.Vector3();
			for (let k = 0; k <= 6; k++) {
				const u = k / 6;
				pts.push(this.keepAbove(p.clone(), rThread, u * 0.5));
				p.addScaledVector(step.copy(dir).lerp(rest, fall * (0.3 + 0.7 * u)).normalize(), length / 6);
			}
			const bead = 1 + 1.5 * recoil;
			const radius = (u) => (stub.r + (rThread - stub.r) * Math.min(1, u * 2.5)) * (1 + (bead - 1) * sstep(0.75, 0.95, u)) * (1 - stub.gone) * endCap(u);
			addTube(buf, pts, radius, colour, (length / s) * 6, 12, 6);
		}
		return alive;
	}

	// Cheese drapes over the pizza and the board, it never sinks through them. u = how far along the strand:
	// near its roots a thread may stay sunk in the melt, so it grows out of the cheese instead of sitting on it.
	keepAbove(p, radius, u) {
		const { pizza } = this, local = pizza.root.worldToLocal(p.clone());
		const free = sstep(0, 0.14, Math.min(u, 1 - u));
		const onPizza = Math.hypot(local.x, local.z) < 0.98;
		const y = onPizza ? pizza.surfaceY(local.x, local.z) + 0.004 * free - 0.003 * (1 - free) : 0.003;
		p.y = Math.max(p.y, this.rootY + y * this.scale + radius * free);
		return p;
	}
}

function discard(pull) {
	pull.mesh.geometry.dispose();
	pull.mesh.parent?.remove(pull.mesh);
}

// rounds a tube's ends off, so no open mouth can show where an end peeks out of the melt
const endCap = (u) => { const e = Math.min(u, 1 - u); return e < 0.02 ? Math.sqrt(Math.max(0, 1 - ((0.02 - e) / 0.02) ** 2)) : 1; };

// Appends a round tube through pts to buf. Sampled by parameter with parallel-transported frames: cheaper
// than Frenet frames, and the frame never flips (no pinched twists).
function addTube(buf, pts, radius, colour, vLength, segs, radial) {
	const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); // no overshoot where root points crowd together
	const P = Array.from({ length: segs + 1 }, (_, i) => curve.getPoint(i / segs));
	const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), prevT = new THREE.Vector3(), axis = new THREE.Vector3(), q = new THREE.Quaternion();
	const base = buf.position.length / 3;
	for (let i = 0; i <= segs; i++) {
		T.subVectors(P[Math.min(segs, i + 1)], P[Math.max(0, i - 1)]);
		if (T.lengthSq() < 1e-14) T.set(1, 0, 0);
		T.normalize();
		if (i === 0) {
			N.set(0, 1, 0);
			if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
		} else {
			const sin = axis.crossVectors(prevT, T).length();
			if (sin > 1e-8) N.applyQuaternion(q.setFromAxisAngle(axis.divideScalar(sin), Math.asin(Math.min(1, sin))));
		}
		N.addScaledVector(T, -N.dot(T)).normalize();
		B.crossVectors(T, N);
		prevT.copy(T);
		const t = i / segs, r = Math.max(0, radius(t)), p = P[i], col = colour(t);
		for (let j = 0; j <= radial; j++) {
			const v = (j / radial) * TAU, c = Math.cos(v), sn = Math.sin(v);
			const nx = N.x * c + B.x * sn, ny = N.y * c + B.y * sn, nz = N.z * c + B.z * sn;
			buf.position.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
			buf.normal.push(nx, ny, nz);
			buf.uv.push(j / radial, t * vLength);
			buf.color.push(col.r, col.g, col.b);
		}
	}
	for (let i = 0; i < segs; i++) {
		for (let j = 0; j < radial; j++) {
			const a = base + i * (radial + 1) + j, b = a + radial + 1;
			buf.index.push(a, a + 1, b, b, a + 1, b + 1);
		}
	}
}

// Stretched mozzarella shows fine lengthwise striations: the aligned protein fibres, with fat between them.
let fibreTex;
function fibreTexture() {
	if (fibreTex) return fibreTex;
	const W = 64, H = 256, canvas = document.createElement('canvas');
	canvas.width = W; canvas.height = H;
	const x = canvas.getContext('2d');
	x.fillStyle = '#f0ebe2';
	x.fillRect(0, 0, W, H);
	const R = rng(5);
	for (let i = 0; i < 90; i++) {
		const cx = R() * W, w = 0.6 + R() * 2.2, l = 40 + R() * 200, y0 = R() * H;
		x.fillStyle = R() < 0.5 ? `rgba(255,255,255,${0.25 + R() * 0.35})` : `rgba(190,180,165,${0.15 + R() * 0.25})`;
		for (const dy of [0, -H, H]) x.fillRect(cx, y0 + dy, w, l);
	}
	fibreTex = new THREE.CanvasTexture(canvas);
	fibreTex.colorSpace = THREE.SRGBColorSpace;
	fibreTex.wrapS = fibreTex.wrapT = THREE.RepeatWrapping;
	fibreTex.anisotropy = 4;
	return fibreTex;
}
