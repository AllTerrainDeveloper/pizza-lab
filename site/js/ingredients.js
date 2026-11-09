// Ingredient models: geometry + procedural textures + materials, and the catalogue the builder uses.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { Noise, rng, clamp, mix, sstep } from './noise.js';

const TAU = Math.PI * 2;
const N = new Noise(303);

function canvas(w, h) {
	const c = document.createElement('canvas');
	c.width = w; c.height = h;
	return [c, c.getContext('2d', { willReadFrequently: true })];
}
function tex(c, srgb = true) {
	const t = new THREE.CanvasTexture(c);
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	return t;
}
function paint(S, fn) {
	const [c, x] = canvas(S, S);
	const img = x.createImageData(S, S);
	for (let j = 0; j < S; j++) {
		for (let i = 0; i < S; i++) {
			const [r, g, b, a = 255] = fn(i / S, j / S);
			const k = (j * S + i) * 4;
			img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = a;
		}
	}
	x.putImageData(img, 0, 0);
	return [c, x];
}

/* ---------------------------------------------------------------- textures */
function tomatoCutTex() {
	const S = 256, [c, x] = canvas(S, S), C = S / 2;
	x.fillStyle = '#b8160c'; x.beginPath(); x.arc(C, C, C, 0, TAU); x.fill();
	x.fillStyle = '#e0452a'; x.beginPath(); x.arc(C, C, C * 0.86, 0, TAU); x.fill();
	const R = rng(12);
	for (let k = 0; k < 3; k++) {
		const a = (k / 3) * TAU + 0.4;
		x.save();
		x.translate(C + Math.cos(a) * C * 0.42, C + Math.sin(a) * C * 0.42);
		x.rotate(a);
		const g = x.createRadialGradient(0, 0, 2, 0, 0, C * 0.36);
		g.addColorStop(0, 'rgba(236,190,90,0.95)'); g.addColorStop(0.7, 'rgba(222,140,60,0.9)'); g.addColorStop(1, 'rgba(210,70,40,0.0)');
		x.fillStyle = g;
		x.beginPath(); x.ellipse(0, 0, C * 0.34, C * 0.26, 0, 0, TAU); x.fill();
		for (let s = 0; s < 7; s++) {
			x.fillStyle = 'rgba(245,232,170,0.95)';
			x.beginPath(); x.ellipse((R() - 0.5) * C * 0.36, (R() - 0.5) * C * 0.26, 5, 3.2, R() * 3, 0, TAU); x.fill();
		}
		x.restore();
	}
	x.fillStyle = 'rgba(245,150,120,0.9)'; x.beginPath(); x.arc(C, C, C * 0.16, 0, TAU); x.fill();
	return tex(c);
}
function onionTex() {
	const [c] = paint(64, (u, v) => {
		const p = sstep(0.1, 0.3, v) * (1 - sstep(0.45, 0.6, v));
		return [mix(238, 150, p), mix(228, 50, p), mix(236, 120, p)];
	});
	return tex(c);
}
function hamTex() {
	const [c] = paint(256, (u, v) => {
		const n = N.fbm2(u * 6, v * 6, 4);
		const fat = sstep(0.62, 0.7, N.fbm2(u * 3 + 9, v * 9, 4));
		const r = mix(214 * (0.9 + n * 0.2), 246, fat), g = mix(124 * (0.88 + n * 0.25), 222, fat), b = mix(126 * (0.9 + n * 0.2), 214, fat);
		return [r, g, b];
	});
	return tex(c);
}
function pineappleTex() {
	const [c] = paint(256, (u, v) => {
		const fib = 0.5 + 0.5 * Math.sin(u * 140 + N.n2(u * 8, v * 30) * 6);
		const n = N.fbm2(u * 10, v * 10, 3);
		const f = 0.82 + fib * 0.12 + n * 0.12;
		return [250 * f, 208 * f, 74 * f];
	});
	return tex(c);
}
function jalapenoTex() {
	const S = 256, [c, x] = canvas(S, S), C = S / 2;
	x.clearRect(0, 0, S, S);
	x.fillStyle = '#2d6a1f'; x.beginPath(); x.arc(C, C, C, 0, TAU); x.fill();
	x.fillStyle = '#9dc46a'; x.beginPath(); x.arc(C, C, C * 0.86, 0, TAU); x.fill();
	x.globalCompositeOperation = 'destination-out';
	x.beginPath(); x.arc(C, C, C * 0.62, 0, TAU); x.fill();
	x.globalCompositeOperation = 'source-over';
	x.fillStyle = '#e8e6c8';
	for (let k = 0; k < 3; k++) {
		const a = (k / 3) * TAU;
		x.save(); x.translate(C, C); x.rotate(a);
		x.fillRect(C * 0.05, -5, C * 0.6, 10);
		x.restore();
	}
	x.beginPath(); x.arc(C, C, C * 0.2, 0, TAU); x.fill();
	const R = rng(4);
	for (let s = 0; s < 16; s++) {
		const a = R() * TAU, r = C * (0.12 + R() * 0.32);
		x.fillStyle = '#f3ecc4';
		x.beginPath(); x.ellipse(C + Math.cos(a) * r, C + Math.sin(a) * r, 7, 5, a, 0, TAU); x.fill();
	}
	return tex(c);
}
function mozzTex(baked) {
	const [c] = paint(256, (u, v) => {
		const n = N.fbm2(u * 9, v * 9, 4);
		if (!baked) { const f = 0.94 + n * 0.08; return [250 * f, 247 * f, 236 * f]; }
		const blist = sstep(0.6, 0.78, N.fbm2(u * 7 + 3, v * 7, 4));
		const spot = sstep(0.7, 0.85, N.fbm2(u * 20, v * 20 + 5, 3));
		let r = 248, g = 220, b = 150;
		r = mix(r, 205, blist); g = mix(g, 130, blist); b = mix(b, 50, blist);
		r = mix(r, 140, spot * blist); g = mix(g, 75, spot * blist); b = mix(b, 30, spot * blist);
		return [r, g, b];
	});
	return tex(c);
}
function gorgoTex(baked) {
	const [c] = paint(256, (u, v) => {
		const vein = 1 - Math.abs(N.fbm2(u * 5, v * 5, 5) - 0.5) * 2;
		const ve = sstep(0.82, 0.95, vein);
		const speck = sstep(0.74, 0.8, N.n2(u * 40, v * 40));
		const k = clamp(ve + speck * 0.8);
		let r = baked ? 244 : 246, g = baked ? 224 : 240, b = baked ? 170 : 222;
		r = mix(r, 70, k); g = mix(g, 98, k); b = mix(b, 92, k);
		return [r, g, b];
	});
	return tex(c);
}

/* ---------------------------------------------------------------- geometry helpers */
function lumpy(base, amp, freq, seed, yRange = [0, 1]) {
	const g = base.toNonIndexed ? base : base;
	const p = g.attributes.position;
	const nz = new Noise(seed);
	let minY = Infinity, maxY = -Infinity;
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
		const d = 1 + amp * (nz.fbm3(x * freq + 3, y * freq, z * freq, 3) - 0.5) * 2;
		p.setXYZ(i, x * d, y * d, z * d);
		minY = Math.min(minY, y * d); maxY = Math.max(maxY, y * d);
	}
	for (let i = 0; i < p.count; i++) {
		const y = (p.getY(i) - minY) / (maxY - minY);
		p.setY(i, yRange[0] + y * (yRange[1] - yRange[0]));
	}
	g.computeVertexNormals();
	return g;
}
function sphereUV(g) {
	const p = g.attributes.position, uv = [];
	for (let i = 0; i < p.count; i++) uv.push(0.5 + p.getX(i) * 0.5, 0.5 + p.getZ(i) * 0.5);
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	return g;
}

/* ---------------------------------------------------------------- build */
export function buildIngredients(L, { tinted, patch, BUBBLE_GLSL, U }) {
	const T = L.top, G = L.geo;
	L.tinted = tinted;

	// cherry tomato half (cut side up)
	{
		const dome = new THREE.SphereGeometry(1, 36, 12, 0, TAU, Math.PI / 2, Math.PI / 2);
		const cap = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
		G.tomato = mergeGeometries([dome, cap], true);
		T.tomatoSkin = tinted({ color: 0xc41d0f, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 }, [0.78, 0.62, 0.58], 'tomskin');
		T.tomatoCut = tinted({ map: tomatoCutTex(), roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2 }, [0.86, 0.66, 0.56], 'tomcut');
	}
	// red onion: two concentric ring arcs
	{
		const a = new THREE.TorusGeometry(1, 0.11, 8, 56, TAU * 0.78).rotateX(Math.PI / 2);
		const b = new THREE.TorusGeometry(0.8, 0.1, 8, 48, TAU * 0.66).rotateX(Math.PI / 2).rotateY(1.2);
		G.onion = mergeGeometries([a, b]);
		T.onion = tinted({ map: onionTex(), roughness: 0.32, clearcoat: 0.6, sheen: 0.6, sheenColor: new THREE.Color(0xffd8f0) }, [0.86, 0.7, 0.58], 'onion');
	}
	// bell pepper strip, curled
	{
		const s = new THREE.Shape();
		s.moveTo(-0.5, -0.06); s.lineTo(0.5, -0.08); s.quadraticCurveTo(0.56, 0, 0.5, 0.08); s.lineTo(-0.5, 0.06); s.quadraticCurveTo(-0.55, 0, -0.5, -0.06);
		const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, steps: 1, curveSegments: 6 });
		g.translate(0, 0, -0.025);
		g.rotateX(-Math.PI / 2);
		const tess = g.index ? g.toNonIndexed() : g;
		const p = tess.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i);
			p.setY(i, p.getY(i) + 0.16 * x * x);
			p.setZ(i, p.getZ(i) + 0.07 * Math.sin(x * 4));
		}
		tess.computeVertexNormals();
		G.pepper = tess;
		const pm = (c, k) => tinted({ color: c, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08 }, [0.8, 0.74, 0.62], k);
		T.pepperG = pm(0x2b8a1c, 'pepG'); T.pepperR = pm(0xcf180c, 'pepR'); T.pepperY = pm(0xf2b400, 'pepY');
	}
	// ham: four irregular torn pieces
	{
		G.ham = [];
		for (let v = 0; v < 4; v++) {
			const R = rng(50 + v), s = new THREE.Shape();
			const n = 9;
			for (let k = 0; k <= n; k++) {
				const a = (k / n) * TAU, r = 0.5 * (0.72 + R() * 0.42);
				k ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.8) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.8);
			}
			const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 2, curveSegments: 4 });
			g.rotateX(-Math.PI / 2);
			const p = g.attributes.position;
			for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 0.05 * Math.sin(p.getX(i) * 6) * Math.cos(p.getZ(i) * 5));
			g.computeVertexNormals();
			G.ham.push(g);
		}
		const m = tinted({ map: hamTex(), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.3 }, [0.88, 0.7, 0.64], 'ham');
		m.map.repeat.set(1.6, 1.6);
		T.ham = m;
	}
	// pineapple chunk
	{
		const s = new THREE.Shape();
		const r0 = 0.28, r1 = 0.62, a = 0.36;
		s.moveTo(Math.cos(-a) * r0 - 0.45, Math.sin(-a) * r0);
		s.lineTo(Math.cos(-a) * r1 - 0.45, Math.sin(-a) * r1);
		s.absarc(-0.45, 0, r1, -a, a, false);
		s.lineTo(Math.cos(a) * r0 - 0.45, Math.sin(a) * r0);
		s.absarc(-0.45, 0, r0, a, -a, true);
		const g = new THREE.ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 8 });
		g.rotateX(-Math.PI / 2);
		g.computeVertexNormals();
		G.pineapple = g;
		const m = tinted({ map: pineappleTex(), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.25 }, [0.92, 0.7, 0.46], 'pineapple');
		m.map.repeat.set(2, 2);
		T.pineapple = m;
	}
	// jalapeño slice (alpha-cut hollow), corn kernel
	T.jalapeno = tinted({ map: jalapenoTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.25, clearcoat: 0.8 }, [0.75, 0.72, 0.55], 'jalapeno');
	G.corn = lumpy(new THREE.SphereGeometry(1, 16, 12), 0.08, 2, 9, [0, 0.75]);
	T.corn = tinted({ color: 0xf6c21c, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2 }, [0.92, 0.76, 0.5], 'corn');

	// ---- cheeses that melt: slump, spread with a wobbly edge, turn golden and bubble
	const meltMat = (map, map2, key, { melt = 1, spread = 0.9, minY = 0, maxY = 1, rough = [0.55, 0.32], shrinkX = 0, rMax = 1.25 } = {}) => {
		const m = new THREE.MeshPhysicalMaterial({ map, roughness: rough[0], clearcoat: 0.45, clearcoatRoughness: 0.35, sheen: 0.5, sheenColor: new THREE.Color(0xfff4dc) });
		patch(m, key, {
			decl: `uniform sampler2D uMap2;\nuniform float uTime;\nuniform float uHeat;\nuniform float uMelt;\nuniform float uSpread;\nvarying vec3 vMeltP;\n${BUBBLE_GLSL}`,
			uniforms: { uMap2: { value: map2 }, uTime: U.uTime, uHeat: U.uHeat, uMelt: { value: melt }, uSpread: { value: spread } },
			vNormal: `float meltM = smoothstep( 0.15, 0.85, clamp( uBake, 0.0, 1.0 ) ) * uMelt;
	objectNormal = normalize( mix( objectNormal, vec3( 0.0, 1.0, 0.0 ), meltM * 0.92 ) );`,
			vBegin: `{
	float yb = clamp( ( position.y - ${minY.toFixed(3)} ) / ${(maxY - minY).toFixed(3)}, 0.0, 1.0 );
	float ang = atan( position.z, position.x );
	vMeltP = vec3( position.xz / ${rMax.toFixed(3)}, ang );
	float wob = 1.0 + 0.22 * meltM * ( sin( ang * 5.0 + 1.3 ) * 0.6 + sin( ang * 3.0 - 2.1 ) * 0.4 );
	// melts into an even puddle: spreads as a whole and collapses to a thin, nearly flat layer
	transformed.xz *= 1.0 + meltM * uSpread * wob; // uniform spread: the top always covers the slumped sides
	transformed.x *= 1.0 - meltM * ${shrinkX.toFixed(2)}; // strands draw up into blobs as they melt
	transformed.y = ${minY.toFixed(3)} + ( transformed.y - ${minY.toFixed(3)} ) * mix( 1.0, 0.09, meltM ) * ( 1.0 - meltM * 0.4 * yb );
}`,
			fMap: `
	// molten cheese has no straight edges: past the melt point the rim is eaten back into soft lobes that
	// thin out into the sauce (the tessellated silhouette of the raw piece would otherwise show as a polygon)
	{
		float mM = smoothstep( 0.15, 0.85, clamp( uBake, 0.0, 1.0 ) ) * uMelt;
		float rr = length( vMeltP.xy );
		float lobes = 0.06 * sin( vMeltP.z * 7.0 + 1.7 ) + 0.04 * sin( vMeltP.z * 13.0 - 0.6 ) + 0.05 * ( bHash( floor( vMeltP.xy * 40.0 ) ).x - 0.5 );
		if ( mM > 0.25 && rr > mix( 1.2, 0.78, smoothstep( 0.25, 0.9, mM ) ) + lobes ) discard;
	}
#ifdef USE_MAP
	// detail map: the same photo sampled again at ~4x frequency and offset, so close up the raw cheese keeps
	// fine milky grain instead of going soft (the photo has fewer texels than a lump covers at full zoom)
	vec4 rawC = texture2D( map, vMapUv );
	vec3 fine = texture2D( map, vMapUv * 3.7 + vec2( 0.31, 0.17 ) ).rgb;
	rawC.rgb *= 0.82 + 0.36 * dot( fine, vec3( 0.3, 0.59, 0.11 ) ) / max( 0.2, dot( rawC.rgb, vec3( 0.3, 0.59, 0.11 ) ) ) * 0.5;
	vec4 sampledDiffuseColor = mix( rawC, texture2D( uMap2, vMapUv ), smoothstep( 0.2, 0.95, bb ) );
	float bub = bubbles( vMapUv, 9.0, uTime, 0.35, 0.7 ) * uHeat * smoothstep( 0.4, 0.9, bb ) * uMelt;
	sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * vec3( 0.84, 0.64, 0.4 ), smoothstep( 0.5, 1.0, bub ) * 0.8 );
	sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 1.0, 0.9, 0.72 ), smoothstep( 0.3, 1.0, bb ) * uMelt );
	sampledDiffuseColor.rgb *= 1.0 - burn * 0.55;
	diffuseColor *= sampledDiffuseColor;
#endif`,
			fRough: `roughnessFactor = mix( ${Math.max(0.6, rough[0]).toFixed(2)}, ${Math.max(0.55, rough[1]).toFixed(2)}, bb );`,
		});
		return m;
	};
	G.mozz = [0, 1, 2].map((s) => sphereUV(lumpy(new THREE.IcosahedronGeometry(1, 6), 0.28, 1.6, 70 + s, [0, 0.8]))); // dense enough to read smooth up close
	T.mozz = meltMat(mozzTex(false), mozzTex(true), 'mozz', { melt: 1, spread: 0.95, maxY: 0.8 });
	G.shred = (() => {
		const g = new THREE.CylinderGeometry(0.11, 0.11, 1, 10, 16).rotateZ(Math.PI / 2).translate(0, 0.11, 0);
		const p = g.attributes.position;
		for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 0.05 * Math.sin(p.getX(i) * 5));
		g.computeVertexNormals();
		return sphereUV(g);
	})();
	T.shred = meltMat(mozzTex(false), mozzTex(true), 'shred', { melt: 1, spread: 2.2, maxY: 0.27, shrinkX: 0.62, rMax: 0.5 });
	G.gorgo = [0, 1].map((s) => sphereUV(lumpy(new THREE.DodecahedronGeometry(1, 1), 0.3, 2.2, 90 + s, [0, 0.9])));
	T.gorgo = meltMat(gorgoTex(false), gorgoTex(true), 'gorgo', { melt: 0.75, spread: 0.6, maxY: 0.9, rough: [0.75, 0.42] });
}

/* ---------------------------------------------------------------- catalogue */
// make(T, G, t) -> mesh, scaled. half: lift above the surface. rad: footprint radius (pizza units).
export const KINDS = {
	pep: { name: 'Pepperoni', rad: 0.1, make: (T, G, t) => sc(new THREE.Mesh(G.pep, T.pepMat), 0.1 * t.s), half: (m) => 0.03 * m.scale.x },
	salami: { name: 'Salami', rad: 0.082, make: (T, G, t) => sc(new THREE.Mesh(G.pep, T.salamiMat), 0.082 * t.s), half: (m) => 0.03 * m.scale.x },
	ham: { name: 'Ham', rad: 0.08, make: (T, G, t) => sc(new THREE.Mesh(G.ham[Math.floor(t.j * 4) % 4], T.ham), 0.15 * t.s), half: () => 0.003 },
	mush: { name: 'Mushroom', rad: 0.06, make: (T, G, t) => sc(new THREE.Mesh(G.mush, [T.mushFace, T.mushSide]), 0.135 * t.s), half: (m) => 0.026 * m.scale.x },
	olive: { name: 'Black olive', rad: 0.045, make: (T, G, t) => { const m = new THREE.Mesh(G.olive, T.oliveMat); m.scale.set(0.034 * t.s, 0.03, 0.034 * t.s); return m; }, half: () => 0.0135 },
	tomato: { name: 'Cherry tomato', rad: 0.07, make: (T, G, t) => { const m = new THREE.Mesh(G.tomato, [T.tomatoSkin, T.tomatoCut]); m.scale.set(0.068 * t.s, 0.04, 0.068 * t.s); return m; }, half: () => 0.004 },
	onion: { name: 'Red onion', rad: 0.075, make: (T, G, t) => sc(new THREE.Mesh(G.onion, T.onion), 0.075 * t.s), half: (m) => 0.11 * m.scale.x },
	pepper: { name: 'Bell pepper', rad: 0.1, make: (T, G, t) => sc(new THREE.Mesh(G.pepper, [T.pepperG, T.pepperR, T.pepperY][Math.floor(t.j * 3) % 3]), 0.2 * t.s), half: () => 0.006 },
	jalapeno: { name: 'Jalapeño', rad: 0.055, make: (T, G, t) => { const m = new THREE.Mesh(G.pep, T.jalapeno); m.scale.set(0.055 * t.s, 0.04, 0.055 * t.s); return m; }, half: () => 0.003 },
	pineapple: { name: 'Pineapple', rad: 0.06, make: (T, G, t) => sc(new THREE.Mesh(G.pineapple, T.pineapple), 0.11 * t.s), half: () => 0.006 },
	corn: { name: 'Sweetcorn', rad: 0.02, sprinkle: { n: 9, r: 0.07 }, make: (T, G, t) => { const m = new THREE.Mesh(G.corn, T.corn); m.scale.set(0.018 * t.s, 0.018, 0.015 * t.s); return m; }, half: () => -0.002 },
	basil: { name: 'Basil', rad: 0.1, make: (T, G, t) => sc(new THREE.Mesh(G.basil, T.basilMat), 0.17 * t.s), half: () => 0.002 },
	flake: { name: 'Chili flakes', rad: 0.012, sprinkle: { n: 16, r: 0.08 }, make: (T, G, t) => { const k = Math.floor(t.j * 97) % 4; return sc(new THREE.Mesh(G.chiliV[k], T.chiliMats[k]), (k === 3 ? 0.007 : 0.01) + t.j * 0.008); }, half: () => 0.001 },
	mozz: { name: 'Mozzarella', rad: 0.07, cheese: true, make: (T, G, t) => { const m = new THREE.Mesh(G.mozz[Math.floor(t.j * 3) % 3], T.mozz); m.scale.set(0.07 * t.s, 0.05 * t.s, 0.07 * t.s); return m; }, half: () => 0.0008 },
	shred: { name: 'Shredded mozz', rad: 0.04, cheese: true, sprinkle: { n: 22, r: 0.075 }, make: (T, G, t) => { const m = new THREE.Mesh(G.shred, T.shred); m.scale.set(0.045 * t.s, 0.045, 0.045 * t.s); return m; }, half: () => 0.0008 },
	gorgo: { name: 'Gorgonzola', rad: 0.04, cheese: true, sprinkle: { n: 6, r: 0.06 }, make: (T, G, t) => { const m = new THREE.Mesh(G.gorgo[Math.floor(t.j * 2) % 2], T.gorgo); m.scale.set(0.03 * t.s, 0.026 * t.s, 0.03 * t.s); return m; }, half: () => 0.0008 },
};
function sc(m, s) { m.scale.setScalar(s); return m; }

export const PALETTE = ['mozz', 'shred', 'gorgo', 'pep', 'salami', 'ham', 'mush', 'olive', 'tomato', 'onion', 'pepper', 'jalapeno', 'pineapple', 'corn', 'basil', 'flake'];

/* ---------------------------------------------------------------- photographed ingredients */
// Real photographs (openly licensed, see assets/ingredients/credits.json), cut out and traced. Each piece is
// built as a solid: its traced outline (holes included) is extruded to the ingredient's real thickness with a
// small rounded bevel, the photo is projected on top and bottom, and the side walls take the colour of the
// photo's own edge. Thickness is in real units: world thickness = D * footprint radius.
const PHOTO = {
	tomato: { dir: 'tomato_slice', D: 0.43, tint: [0.86, 0.66, 0.56] },
	olive: { dir: 'olive_ring', D: 0.4, tint: [0.8, 0.75, 0.7] },
	mush: { dir: 'mushroom_slice', D: 0.28, tint: [0.82, 0.68, 0.52] },
	pepper: { dir: ['pepper_green_strip', 'pepper_red_strip', 'pepper_yellow_strip'], D: 0.13, rad: 0.15, tint: [0.8, 0.74, 0.62], strip: true, drape: true },
	onion: { dir: 'onion_ring', D: 0.24, tint: [0.86, 0.7, 0.58] },
	ham: { dir: 'ham_piece', D: 0.09, tint: [0.88, 0.7, 0.64] },
	pineapple: { dir: 'pineapple_chunk', D: 0.9, bevel: [0.22, 0.1, 3], tint: [0.92, 0.7, 0.46] },
	jalapeno: { dir: 'jalapeno_slice', D: 0.33, tint: [0.75, 0.72, 0.55] },
	corn: { dir: 'corn_kernel', D: 1.1, bevel: [0.42, 0.34, 8], crease: Math.PI * 0.6, tint: [0.92, 0.76, 0.5] },
	basil: { dir: 'basil_leaf', D: 0.03, tint: [0.62, 0.6, 0.42], leaf: true }, // a soft leaf: subdivided so it can drape and ride the bubbles
};

const topUV = {
	generateTopUV(g, v, a, b, c) {
		return [a, b, c].map((i) => new THREE.Vector2(v[i * 3] * 0.5 + 0.5, v[i * 3 + 1] * 0.5 + 0.5));
	},
	generateSideWallUV(g, v, a, b, c, d) {
		return [a, b, c, d].map((i) => new THREE.Vector2(v[i * 3] * 0.5 + 0.5, v[i * 3 + 1] * 0.5 + 0.5));
	},
};

// A bell-pepper strip is a slice of the pepper's curved wall, not a flat card: an arch ~1.6 cm wide and ~4 mm
// thick that rests on its two long edges, every edge and end rolled soft, gently bowed along its length. The skin is
// textured from the clean middle of the photo only (the photo's own fold and cut end would look painted on),
// the hollow underside is the paler flesh, and the cut faces use the softened edge colour.
function stripGeometry(o, seed = 0) {
	// every variant has its own shape: how wide, how much it narrows, how it curves sideways, how the ends are cut
	const rnd = (k) => { const v = Math.sin((seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
	const A0 = 0.5 + 0.2 * rnd(1), Rc = 0.75 + 0.1 * rnd(2), T = 0.085 + 0.025 * rnd(11); // baked strips slump: a shallow arch, the wall roasted thin (~3–4 mm)
	const NL = 44, NA = 14, NR = 6, NE = 5; // along, across the skin, around each rolled edge, rows rounding each end
	const taper = 0.45 + 0.35 * rnd(3), taperEnd = rnd(4) < 0.5 ? -1 : 1; // which end narrows, and how much
	const sideCurve = (rnd(5) - 0.5) * 0.5, settle = 0.004 + 0.004 * rnd(6); // how far the middle of the long edges sinks into the melt
	const slant0 = (rnd(7) - 0.5) * 0.5, slant1 = (rnd(8) - 0.5) * 0.5; // angled knife cuts at the two ends
	const ripple = 0.012 + 0.012 * rnd(9), ripPh = rnd(10) * 6.28;
	const halfV = 0.5 / Math.max(1.5, o.aspect || 3) * 0.7; // the strip's half-height in the photo's UV
	const u0 = 0.14, u1 = 0.6;
	// The strip is one closed tube: its cross-section runs across the skin, rolls round the far edge, back along
	// the flesh and round the near edge, so every edge is soft (roasted pepper has no knife-sharp corners) and
	// the shading flows over it. At the ends the section shrinks to a rounded cap.
	const loop = [];
	for (let j = 0; j <= NA; j++) loop.push({ s: (j / NA) * 2 - 1, m: 1, e: 0 });
	for (let k = 1; k < NR; k++) { const f = (Math.PI * k) / NR; loop.push({ s: 1, m: 0.5 + 0.5 * Math.cos(f), e: Math.sin(f) }); }
	for (let j = NA; j >= 0; j--) loop.push({ s: (j / NA) * 2 - 1, m: 0, e: 0 });
	for (let k = 1; k < NR; k++) { const f = (Math.PI * k) / NR; loop.push({ s: -1, m: 0.5 - 0.5 * Math.cos(f), e: -Math.sin(f) }); }
	const rows = [];
	for (let k = NE; k >= 1; k--) { const f = (Math.PI / 2) * (k / NE); rows.push({ x: -1 - T * 0.45 * Math.sin(f), c: Math.cos(f) }); }
	for (let i = 0; i <= NL; i++) rows.push({ x: (i / NL) * 2 - 1, c: 1 });
	for (let k = 1; k <= NE; k++) { const f = (Math.PI / 2) * (k / NE); rows.push({ x: 1 + T * 0.45 * Math.sin(f), c: Math.cos(f) }); }
	const pos = [], uv = [], col = [];
	for (const R of rows) {
		const xc = Math.max(-1, Math.min(1, R.x)), t = xc * 0.5 + 0.5;
		const w = 1 - (1 - taper) * Math.max(0, taperEnd > 0 ? t : 1 - t) ** 1.6; // narrows towards one end
		const cw = Math.sqrt(R.c); // the end rounds off in plan too, but stays square-ish (a knife cut, softened)
		for (const Lp of loop) {
			const sE = Lp.s * cw, mE = 0.5 + (Lp.m - 0.5) * R.c;
			const a = sE * (A0 / 2) * w + (Lp.e * R.c * (T / 2)) / (Rc - T / 2);
			const r = Rc - T + T * mE + mE * mE * ripple * Math.sin(sE * 3.1 + xc * 2.3 + ripPh);
			const xe = R.x + (xc > 0 ? slant1 : xc < 0 ? slant0 : 0) * sE * Math.abs(xc) ** 8; // slanted end cuts
			const xq = Math.min(1, xe * xe);
			pos.push(xe, r * Math.cos(a) - (Rc - T) * Math.cos((A0 / 2) * w) - settle * (1 - xq), r * Math.sin(a) + sideCurve * (xq - 0.33));
			// one continuous photo all the way round: the UV keeps running over the rolled edge and back along the
			// underside (no second material, so no seam); the flesh side is only a shade paler, graded smoothly
			uv.push(u0 + t * (u1 - u0), 0.5 + sE * halfV * w * (1 + 0.12 * Math.abs(Lp.e)));
			const k = 0.9 + 0.1 * mE;
			col.push(k, k * 1.01, k * 0.97);
		}
	}
	const n = loop.length, idx = [];
	for (let ri = 0; ri < rows.length - 1; ri++) {
		for (let j = 0; j < n; j++) {
			const jn = (j + 1) % n, a = ri * n + j, b = ri * n + jn, c = a + n, d = b + n;
			idx.push(a, b, c, c, b, d);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	g.setIndex(idx);
	g.addGroup(0, idx.length, 0); // skin, rolled edges, cut ends and flesh: all the one photo material
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

function pieceGeometry(o, D, bevel = [0.15, 0.025, 2], crease = Math.PI * 0.42) {
	const toV = (p) => new THREE.Vector2(p[0], p[1]);
	const shape = new THREE.Shape(o.outer.map(toV));
	for (const h of o.holes || []) shape.holes.push(new THREE.Path(h.map(toV)));
	// bevel = [share of the thickness that is rounded on each face, inset of the rounding, segments]: plump kernels
	// and chunks get a deep round-over, thin slices only a slight soft edge
	const [bt, bs, bn] = bevel, depth = D * (1 - 2 * bt);
	const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: D * bt, bevelSize: bs, bevelOffset: -bs, bevelSegments: bn, curveSegments: 4, UVGenerator: topUV });
	g.rotateX(-Math.PI / 2); // shape x,y -> world x,-z ; extrusion along +y
	g.translate(0, -depth / 2, 0);
	let m = 0;
	for (const p of o.outer) m = Math.max(m, Math.hypot(p[0], p[1]));
	g.scale(1 / m, 1, 1 / m); // footprint radius 1; thickness stays D (times the mesh scale)
	// smooth shading: an extrusion gets one flat normal per facet, so a round kernel or the soft edge of a slice
	// reads as a cut gem. Normals are averaged across every edge gentler than `crease`, so the light grades
	// smoothly over the rounded bevel while a true corner stays crisp. (Scaled up while the normals are worked
	// out: the utility welds vertices on a 0.01 grid, which would merge the bevel's close rings.)
	g.scale(100, 100, 100);
	const s = toCreasedNormals(g, crease);
	s.scale(0.01, 0.01, 0.01);
	return s;
}

// An extruded piece's face is one flat polygon with vertices only round its outline, so it cannot bend. For soft
// pieces (a basil leaf) the faces (group 0) are split into small triangles; the thin sides (group 1) are kept, and
// both are merged back with their material groups.
function subdivideFaces(g, maxEdge) {
	const part = (gr) => {
		const out = new THREE.BufferGeometry();
		for (const [name, a] of Object.entries(g.attributes)) {
			out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
		}
		return out;
	};
	const groups = g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
	const faces = new TessellateModifier(maxEdge, 8).modify(part(groups[0]));
	const rest = groups.slice(1).map(part);
	for (const r of rest) for (const name of Object.keys(r.attributes)) if (!faces.attributes[name]) r.deleteAttribute(name);
	const merged = mergeGeometries([faces, ...rest], true);
	merged.computeBoundingSphere();
	return merged;
}

export async function loadPhotoIngredients(L) {
	const base = 'assets/ingredients/';
	let credits = [];
	try { credits = await (await fetch(base + 'credits.json')).json(); } catch { return []; }
	const have = new Set(credits.map((c) => c.name));
	const tl = new THREE.TextureLoader();
	L.photoUsed = new Set();
	const one = async (dir) => {
		if (!have.has(dir)) return null;
		L.photoUsed.add(dir); // only photos actually on the pizza are credited
		// colour maps are opaque JPEGs whose edge colour was bled outwards offline; the silhouette is outline.json
		const [tex, o] = await Promise.all([tl.loadAsync(base + dir + '/color.jpg'), fetch(base + dir + '/outline.json').then((r) => r.json())]);
		const full = tex.image;
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping; // the detail layer samples it at 4.3x
		// the cut side of a slice is the same flesh/skin, but without the photo's fine edge streaks smeared down it
		const sc = document.createElement('canvas');
		sc.width = sc.height = 128;
		const sx = sc.getContext('2d');
		sx.filter = 'blur(3px)';
		sx.drawImage(full, 0, 0, 128, 128);
		const sideTex = new THREE.CanvasTexture(sc);
		sideTex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = 8;
		return { tex, sideTex, o };
	};
	const done = [];
	await Promise.all(Object.entries(PHOTO).map(async ([kind, P]) => {
		const dirs = Array.isArray(P.dir) ? P.dir : [P.dir];
		const got = (await Promise.all(dirs.map((d) => one(d).catch(() => null)))).filter(Boolean);
		if (!got.length) return;
		const variants = got.map(({ tex, sideTex, o }, i) => {
			const key = `photo_${kind}_${i}`;
			L.top[key] = [
				L.tinted({ map: tex, roughness: 0.9, specularIntensity: 0.1, vertexColors: !!P.strip }, P.tint, `photo-${kind}-${i}`, { detail: true }), // a strip shades its flesh side through vertex colour
				L.tinted({ map: sideTex, roughness: 0.92, specularIntensity: 0.1, color: 0xd6cec6 }, P.tint, `photo-${kind}-side-${i}`),
			];
			const g0 = P.strip ? stripGeometry(o, i * 7 + 3) : pieceGeometry(o, P.D, P.bevel, P.crease);
			return { geo: P.leaf ? subdivideFaces(g0, 0.14) : g0, key };
		});
		const K = KINDS[kind];
		if (P.rad) K.rad = P.rad;
		K.make = (T, G, t) => {
			const v = variants[Math.floor(t.j * variants.length) % variants.length];
			const m = new THREE.Mesh(v.geo, T[v.key]); // per-slice copies carry the cut's clipping planes
			m.scale.setScalar(K.rad * t.s);
			if (P.drape || P.leaf) { t.tx = 0; t.tz = 0; }
			return m;
		};
		K.half = P.strip ? () => -0.0008 : (m) => P.D * 0.5 * m.scale.y;
		K.photo = true;
		if (P.drape) K.drape = true; // flexible: rests at the mean height under it, not on its highest point
		if (P.leaf) K.leaf = true; // soft and thin: every point of it lies on the pizza and rides the bubbles
		done.push(kind);
	}));
	// cured meats keep their procedural irregular discs (they drape over each other), but wear the photo
	const cured = await one('salami_slice').catch(() => null);
	if (cured) {
		// map the disc onto the inner 90% of the photo, so its rim lands on the real casing, never on bled edge pixels
		cured.tex.repeat.set(0.9, 0.9);
		cured.tex.offset.set(0.05, 0.05);
		// pepperoni wears its own photo when there is one; otherwise the salami grain with a paprika tint
		const pepOwn = have.has('pepperoni_real');
		for (const [k, tint] of pepOwn ? [['salamiMat', 0xffffff]] : [['salamiMat', 0xffffff], ['pepMat', 0xffb49a]]) {
			const m = L.top[k];
			m.map = cured.tex;
			m.color.set(tint);
			m.needsUpdate = true;
		}
		done.push('salami', 'pep');
	}
	if (have.has('pepperoni_real')) {
		// a real (CC0) American pepperoni slice, unwrapped so its circle fills the disc: uv = 0.5 + 0.49 * (x, z)
		try {
			const t = await tl.loadAsync(base + 'pepperoni_real/color_disc.jpg');
			t.colorSpace = THREE.SRGBColorSpace;
			t.anisotropy = 8;
			t.repeat.set(0.98, 0.98);
			t.offset.set(0.01, 0.01);
			L.top.pepMat.map = t;
			L.top.pepMat.color.set(0xffffff);
			L.top.pepMat.needsUpdate = true;
			L.photoUsed.add('pepperoni_real');
		} catch { /* keep the salami-grain fallback */ }
	}
	// fresh mozzarella (raw pieces and shreds): the photo's milky, fibrous surface, made seamless by mirror
	// tiling a crop from the middle of the slice, so it wraps the lumpy pieces without seams
	const mz = await one('mozzarella_piece').catch(() => null);
	if (mz) {
		const src = mz.tex.image, W = src.width, c = Math.round(W * 0.3), S = c * 2;
		const cv = document.createElement('canvas');
		cv.width = cv.height = S;
		const x = cv.getContext('2d');
		for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
			x.save();
			x.translate(fx < 0 ? S : 0, fy < 0 ? S : 0);
			x.scale(fx, fy);
			x.drawImage(src, (W - c) / 2, (src.height - c) / 2, c, c, fx < 0 ? 0 : 0, 0, c, c);
			x.restore();
		}
		// mirrored quadrants: top-left original, the others reflected about the centre lines
		const t = new THREE.CanvasTexture(cv);
		t.colorSpace = THREE.SRGBColorSpace;
		t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
		t.anisotropy = 8;
		for (const k of ['mozz', 'shred']) { L.top[k].map = t; L.top[k].needsUpdate = true; }
		done.push('mozz', 'shred');
	}
	L.photoCredits = credits;
	return done;
}
