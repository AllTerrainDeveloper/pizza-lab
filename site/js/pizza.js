// The pizza: layered geometry (base, sauce, cheese, cornicione), toppings and slicing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise, rng, sstep } from './noise.js';
import * as TX from './textures.js';
import { buildIngredients, KINDS } from './ingredients.js';
import { CheesePull } from './cheese-pull.js';
import { TAU, makeGeometry, cloneMaterial } from './geo.js';

const NZ = new Noise(1234);

// Shared uniforms: every pizza material listens to the same bake / rise values.
export const U = { uBake: { value: 1 }, uRise: { value: 1 }, uTime: { value: 0 }, uHeat: { value: 0.6 }, uPep: { value: Array.from({ length: 48 }, () => new THREE.Vector3()) }, uPepCount: { value: 0 } };

// Boiling mozzarella: cells of bubbles that grow, brown and pop. Shared by vertex + fragment.
const BUBBLE_GLSL = `
vec2 bHash( vec2 p ) { p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) ); return fract( sin( p ) * 43758.5453 ); }
// sine-free hash (no GPU sin() precision loss), so bubbleHeight() in JS finds the very same bubbles
vec2 bHash2( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.xx + p3.yz ) * p3.zy ); }
float bubbles( vec2 uv, float K, float t, float speed, float density ) {
	vec2 g = uv * K, i = floor( g ), f = fract( g );
	float h = 0.0;
	for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
		vec2 o = vec2( float( x ), float( y ) );
		vec2 r = bHash2( i + o );
		if ( r.x > density ) continue;
		vec2 c = o + 0.25 + 0.5 * bHash2( i + o + 17.0 ) - f;
		float ph = fract( t * speed * ( 0.55 + 0.9 * r.y ) + r.x * 7.0 );
		float life = smoothstep( 0.0, 0.8, ph ) * ( 1.0 - smoothstep( 0.86, 0.93, ph ) );
		float rad = ( 0.16 + 0.32 * r.y ) * life;
		float d2 = dot( c, c ) / ( rad * rad + 1e-5 );
		h = max( h, sqrt( max( 0.0, 1.0 - d2 ) ) * life );
	}
	return h;
}
`;

// CPU mirror of bubbles() (same hash, same cells) so toppings can ride the cheese's blisters
const fr = (v) => v - Math.floor(v);
function bHash2(px, py) {
	let x = fr(px * 0.1031), y = fr(py * 0.103), z = fr(px * 0.0973);
	const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
	x += d; y += d; z += d;
	return [fr((x + y) * z), fr((x + z) * y)];
}
function bubbles(u, v, K, t, speed, density) {
	const gx = u * K, gy = v * K, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
	let h = 0;
	for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
		const r = bHash2(ix + ox, iy + oy);
		if (r[0] > density) continue;
		const q = bHash2(ix + ox + 17, iy + oy + 17);
		const cx = ox + 0.25 + 0.5 * q[0] - fx, cy = oy + 0.25 + 0.5 * q[1] - fy;
		const ph = fr(t * speed * (0.55 + 0.9 * r[1]) + r[0] * 7);
		const life = sstep(0, 0.8, ph) * (1 - sstep(0.86, 0.93, ph));
		const rad = (0.16 + 0.32 * r[1]) * life;
		const d2 = (cx * cx + cy * cy) / (rad * rad + 1e-5);
		h = Math.max(h, Math.sqrt(Math.max(0, 1 - d2)) * life);
	}
	return h;
}

// Unit-radius pizza layout (1 unit = pizza radius)
export const SAUCE_Y = 0.023, CHEESE_Y = 0.026;
// Pepperoni cupping (rim lift, in the slice's local units) and the thickness spread that encodes per-slice variation.
const FOOD_MIN_ROUGH = 0.86;
const PEP_CUP = 0.2, PEP_VAR_SPAN = 0.06;
const isPepKind = (k) => k === 'pep' || k === 'salami';
const angleOf = (t) => (Math.atan2(t.x, t.z) + TAU) % TAU;
const pepVar = (t) => (t.j * 7.31 + t.rot * 3.7) % 1;
// stable per-topping pseudo-random numbers (same topping, same numbers, on every rebuild and in every slice copy)
const tHash = (t, k) => { const v = Math.sin((t.x * 91.7 + t.z * 47.3 + t.j * 13.1 + k * 7.77) * 43.1) * 43758.5453; return v - Math.floor(v); };

// Every cured slice gets its own outline: a few low harmonics (sausage not perfectly round, knife not perfectly
// square to it) plus a faint ripple, and a gently uneven top. Interior vertices scale with the rim so the
// texture follows the shape.
function pepShape(base, t) {
	const g = base.clone(), p = g.attributes.position;
	const h = (k) => tHash(t, k);
	const a = [0.035 + 0.04 * h(1), 0.025 + 0.035 * h(2), 0.012 + 0.02 * h(3)], ph = [h(4), h(5), h(6)].map((v) => v * TAU);
	const ovalA = h(7) * TAU, oval = 0.04 + 0.06 * h(8);
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
		if (r < 1e-6) continue;
		const th = Math.atan2(z, x);
		let f = 1 + oval * Math.cos(2 * (th - ovalA));
		for (let k = 0; k < 3; k++) f += a[k] * Math.cos((k + 1) * th + ph[k]) * (k === 1 ? 0.5 : 1);
		f += 0.012 * Math.sin(9 * th + ph[0] * 3) * h(9);
		p.setX(i, x * f);
		p.setZ(i, z * f);
		if (p.getY(i) > 0) p.setY(i, p.getY(i) + 0.008 * Math.sin(x * 3.1 + ph[1]) * Math.cos(z * 2.7 + ph[2]));
	}
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}
const R_SAUCE = 0.875, R_CHEESE = 0.86, R_BASE = 0.88;

// Offset of the texel under pizza-local (x, z) in a cheese coverage map (r = raw height, g = melted).
function texelAt(cov, x, z) {
	const S = cov.S, clampS = (v) => Math.min(S - 1, Math.max(0, Math.round(v * S)));
	return (clampS(0.5 - z / 2) * S + clampS(0.5 + x / 2)) * 4;
}

const PROF_PTS = [
	[0.835, 0.018], [0.848, 0.034], [0.868, 0.058], [0.895, 0.079], [0.927, 0.091], [0.957, 0.089],
	[0.981, 0.074], [0.996, 0.05], [1.0, 0.028], [0.994, 0.01], [0.976, 0.001], [0.94, 0.0], [0.86, 0.0],
];
const PROF = new THREE.SplineCurve(PROF_PTS.map((p) => new THREE.Vector2(p[0], p[1]))).getSpacedPoints(40);
const PN = PROF.map((p, j) => {
	const a = PROF[Math.max(0, j - 1)], b = PROF[Math.min(PROF.length - 1, j + 1)];
	const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
	return [-ty / l, tx / l];
});

const lumpCache = new Map();
function lump(theta) {
	const key = Math.round(theta * 1e4);
	let v = lumpCache.get(key);
	if (!v) {
		const c = Math.cos(theta), s = Math.sin(theta);
		const h = 1 + 0.42 * (NZ.fbm3(c * 1.7 + 4, s * 1.7, 0.3, 3) - 0.5) + 0.16 * (NZ.n3(c * 6, s * 6, 2.2) - 0.5);
		const w = 1 + 0.5 * (NZ.fbm3(c * 2.3, s * 2.3 + 7, 1.1, 2) - 0.5);
		v = [h, w];
		lumpCache.set(key, v);
	}
	return v;
}
function crustRY(theta, j) {
	const [h, w] = lump(theta);
	const p = PROF[j];
	const r = 0.835 + (p.x - 0.835) * w * 0.94 + 0.012 * (w - 1);
	const y = p.y <= 0.02 ? p.y : 0.02 + (p.y - 0.02) * h;
	return [Math.min(r, 1.02), y];
}

/* ------------------------------------------------------------------ geometry builders */
function buildDisc(a0, a1, rMax, y, rings, segsFull, down = false, yFn = null) {
	const segs = Math.max(4, Math.ceil(segsFull * (a1 - a0) / TAU));
	const pos = [0, yFn ? yFn(0, 0) : y, 0], uv = [0.5, 0.5], nrm = [0, down ? -1 : 1, 0], idx = [];
	for (let k = 1; k <= rings; k++) {
		const r = rMax * k / rings;
		for (let i = 0; i <= segs; i++) {
			const t = a0 + (a1 - a0) * i / segs;
			const x = r * Math.sin(t), z = r * Math.cos(t);
			pos.push(x, yFn ? yFn(x, z) : y, z); uv.push(0.5 + x / 2, 0.5 + z / 2); nrm.push(0, down ? -1 : 1, 0);
		}
	}
	const row = (k) => 1 + (k - 1) * (segs + 1);
	const tri = (a, b, c) => (down ? idx.push(a, c, b) : idx.push(a, b, c));
	for (let i = 0; i < segs; i++) tri(0, row(1) + i, row(1) + i + 1);
	for (let k = 1; k < rings; k++) {
		for (let i = 0; i < segs; i++) {
			const A = row(k) + i, B = row(k + 1) + i, C = row(k + 1) + i + 1, D = row(k) + i + 1;
			tri(A, B, C); tri(A, C, D);
		}
	}
	const g = makeGeometry({ position: pos, normal: nrm, uv }, idx);
	if (yFn) g.computeVertexNormals();
	return g;
}

// A solid cut face: a wall standing on the cut line at angle theta, from yBot(r) up to yTop(r),
// sampled at the given radii so its top edge matches the surface exactly. Extruded, not painted.
function buildWall(theta, flip, radii, yBot, yTop) {
	const s = Math.sin(theta), c = Math.cos(theta);
	const nx = flip ? c : -c, nz = flip ? -s : s;
	const pos = [], nrm = [], uv = [], idx = [];
	radii.forEach((r, i) => {
		const x = r * s + nx * 0.0004, z = r * c + nz * 0.0004, yb = yBot(r), yt = Math.max(yb, yTop(r));
		pos.push(x, yb, z, x, yt, z);
		nrm.push(nx, 0, nz, nx, 0, nz);
		uv.push(0.5 + (r * s) / 2, 0.5 + (r * c) / 2, 0.5 + (r * s) / 2, 0.5 + (r * c) / 2);
		if (i) {
			const b0 = (i - 1) * 2, t0 = b0 + 1, b1 = i * 2, t1 = b1 + 1;
			flip ? idx.push(b0, t1, b1, b0, t0, t1) : idx.push(b0, b1, t1, b0, t1, t0);
		}
	});
	return makeGeometry({ position: pos, normal: nrm, uv }, idx);
}

// Rim wall around [a0, a1] at radius r, from y0 up to the surface height yTop(x, z).
function buildRim(a0, a1, r, y0, yTop) {
	const segs = Math.max(8, Math.ceil(300 * (a1 - a0) / TAU));
	const pos = [], nrm = [], uv = [], idx = [];
	for (let i = 0; i <= segs; i++) {
		const t = a0 + (a1 - a0) * i / segs, s = Math.sin(t), c = Math.cos(t), x = r * s, z = r * c;
		pos.push(x, y0, z, x, Math.max(y0, yTop(x, z)), z);
		nrm.push(s, 0, c, s, 0, c);
		uv.push(0.5 + x / 2, 0.5 + z / 2, 0.5 + x / 2, 0.5 + z / 2);
		if (i) { const b0 = (i - 1) * 2, t0 = b0 + 1, b1 = i * 2, t1 = b1 + 1; idx.push(b0, t0, b1, b1, t0, t1); }
	}
	return makeGeometry({ position: pos, normal: nrm, uv }, idx);
}

function buildCrust(a0, a1) {
	const segs = Math.max(8, Math.ceil(420 * (a1 - a0) / TAU));
	const P = PROF.length, pos = [], uv = [], idx = [];
	for (let i = 0; i <= segs; i++) {
		const t = a0 + (a1 - a0) * i / segs, s = Math.sin(t), c = Math.cos(t);
		for (let j = 0; j < P; j++) {
			const [r, y] = crustRY(t, j);
			const [nr, ny] = PN[j];
			let X = r * s, Z = r * c, Y = y;
			const w = sstep(0.012, 0.05, y);
			const d = 0.0075 * w * (NZ.fbm3(X * 9, Y * 9, Z * 9, 3) - 0.5) * 2;
			X += nr * s * d; Z += nr * c * d; Y += ny * d;
			pos.push(X, Y, Z);
			uv.push(t / TAU, j / (P - 1));
		}
	}
	for (let i = 0; i < segs; i++) {
		for (let j = 0; j < P - 1; j++) {
			const a = i * P + j, b = (i + 1) * P + j, c = (i + 1) * P + j + 1, d = i * P + j + 1;
			idx.push(a, d, b, d, c, b);
		}
	}
	const g = makeGeometry({ position: pos, uv }, idx);
	g.computeVertexNormals();
	return g;
}

function mapToAngle(g, theta, flip) {
	const p = g.attributes.position, s = Math.sin(theta), c = Math.cos(theta);
	const uv = [], nrm = [];
	const nx = flip ? c : -c, nz = flip ? -s : s;
	for (let i = 0; i < p.count; i++) {
		const r = p.getX(i), y = p.getY(i);
		uv.push(r * 2.5, y * 2.5);
		p.setXYZ(i, r * s + nx * 0.0004, y, r * c + nz * 0.0004);
		nrm.push(nx, 0, nz);
	}
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
	if (flip) {
		const ix = g.index.array;
		for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
	}
	return g;
}

function buildCutFace(theta, flip) {
	const pts = [new THREE.Vector2(0, 0.0015)];
	for (let j = PROF.length - 1; j >= 0; j--) {
		const [r, y] = crustRY(theta, j);
		pts.push(new THREE.Vector2(r, y));
	}
	pts.push(new THREE.Vector2(0, 0.02));
	return mapToAngle(new THREE.ShapeGeometry(new THREE.Shape(pts)), theta, flip);
}

function buildStrip(theta, flip, r1, y0, y1) {
	const sh = new THREE.Shape([
		new THREE.Vector2(0, y0), new THREE.Vector2(r1, y0), new THREE.Vector2(r1, y1), new THREE.Vector2(0, y1),
	]);
	return mapToAngle(new THREE.ShapeGeometry(sh), theta, flip);
}

/* ------------------------------------------------------------------ material patching */
function patch(mat, key, o) {
	mat.customProgramCacheKey = () => key;
	mat.onBeforeCompile = (sh) => {
		sh.uniforms.uBake = U.uBake;
		sh.uniforms.uRise = U.uRise;
		Object.assign(sh.uniforms, o.uniforms || {});
		const decl = 'uniform float uBake;\nuniform float uRise;\n' + (o.decl || '');
		sh.vertexShader = decl + sh.vertexShader;
		sh.fragmentShader = decl + sh.fragmentShader;
		if (o.vNormal) sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + o.vNormal);
		if (o.vBegin) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + o.vBegin);
		if (o.vDisp) sh.vertexShader = sh.vertexShader.replace('#include <displacementmap_vertex>', o.vDisp);
		const pre = 'float bb = clamp(uBake, 0.0, 1.0);\nfloat burn = clamp((uBake - 1.0) / 0.6, 0.0, 1.0);\n';
		sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', pre + (o.fMap || '#include <map_fragment>'));
		if (o.fColor) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + o.fColor);
		// Food is diffuse. Whatever a material computes per pixel (oil, sauce, a scan's roughness map), it ends
		// above FOOD_MIN_ROUGH, so light scatters as a broad soft lobe and never a mirror-like hotspot.
		sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + (o.fRough || '') + `\nroughnessFactor = clamp( roughnessFactor, ${(o.minRough ?? FOOD_MIN_ROUGH).toFixed(2)}, 1.0 );`);
		if (o.fNormalAfter) sh.fragmentShader = sh.fragmentShader.replace('#include <clearcoat_normal_fragment_begin>', o.fNormalAfter + '\n#include <clearcoat_normal_fragment_begin>');
		if (o.normal2) {
			sh.fragmentShader = sh.fragmentShader.replace(
				'#include <normal_fragment_maps>',
				THREE.ShaderChunk.normal_fragment_maps.replace(
					'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
					'vec3 mapN = mix( texture2D( normalMap, vNormalMapUv ).xyz, texture2D( uNormal2, vNormalMapUv ).xyz, smoothstep( 0.1, 0.8, bb ) ) * 2.0 - 1.0;'
				)
			);
		}
	};
}

const NOISE3_GLSL = `
float h31( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float vnoise3( vec3 x ) {
	vec3 i = floor( x ), f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( h31( i ), h31( i + vec3( 1, 0, 0 ) ), f.x ), mix( h31( i + vec3( 0, 1, 0 ) ), h31( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( h31( i + vec3( 0, 0, 1 ) ), h31( i + vec3( 1, 0, 1 ) ), f.x ), mix( h31( i + vec3( 0, 1, 1 ) ), h31( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
`;

const CHAR_GLSL = (uvExpr) => `
	vec4 chs = texture2D( uChar, ${uvExpr} );
	float leo = clamp( chs.r, 0.0, 1.0 ) * smoothstep( 0.8, 1.0, bb ) * uLeopard;
	float bm = smoothstep( 1.0 - burn * 0.75, 1.14 - burn * 0.75, chs.g * 0.85 + chs.r * 0.25 ) * min( 1.0, burn * 4.0 );
	sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, vec3( 0.045, 0.03, 0.022 ), clamp( leo * 0.88, 0.0, 1.0 ) );
	// over-baking: everything browns, then charcoal patches spread
	sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * vec3( 0.58, 0.38, 0.22 ), burn * 0.85 );
	sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, vec3( 0.035, 0.022, 0.016 ), bm * 0.92 );
`;

const BAKE_DECL = 'uniform sampler2D uMap2;\nuniform sampler2D uChar;\nuniform float uLeopard;\n';
const bakeUniforms = (baked, char, leopard) => ({ uMap2: { value: baked }, uChar: { value: char }, uLeopard: { value: leopard } });

// Perturbs the shading normal by a height computed in the fragment shader (screen-space bump mapping).
const BUMP_GLSL = (height, before = '') => `
	{
		float bumpH = ${height};
		${before}
		vec3 sx = dFdx( - vViewPosition ), sy = dFdy( - vViewPosition );
		vec3 r1 = cross( sy, normal ), r2 = cross( normal, sx );
		float det = dot( sx, r1 );
		vec3 grad = sign( det ) * ( dFdx( bumpH ) * r1 + dFdy( bumpH ) * r2 );
		normal = normalize( abs( det ) * normal - grad );
	}`;

const TWO_MAP = (extra = '') => `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = mix( texture2D( map, vMapUv ), texture2D( uMap2, vMapUv ), smoothstep( 0.05, 0.95, bb ) );
	${extra}
	diffuseColor *= sampledDiffuseColor;
#endif
`;

/* ------------------------------------------------------------------ the shared library */
export function createLibrary(onProgress = () => {}) {
	const L = {};
	const step = (n, f) => { onProgress(n); return f(); };
	// High resolution everywhere a desktop GPU/CPU can afford it (textures generate 2x per side: 4x the detail);
	// phones and small machines keep the lighter set so the page still opens quickly.
	const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	const Q = coarse || (navigator.hardwareConcurrency || 4) < 8 ? 1 : 2;
	L.quality = Q;
	L.sauce = step('Simmering the tomato sauce', () => TX.makeSauce(768 * Q));
	L.crust = step('Kneading the dough', () => TX.makeCrust(2048 * Q, 256 * Q));
	L.cheese = {
		shred: step('Shredding mozzarella', () => TX.makeCheese('shred', 11, 1024 * Q)),
		fior: step('Tearing fior di latte', () => TX.makeCheese('fior', 29, 1024 * Q)),
	};
	L.charPlanar = TX.makePlanarChar(512 * Q);
	L.crumb = TX.makeCrumb(512 * Q);
	L.pep = TX.makePepperoni();
	L.basil = TX.makeBasil();

	// --- base materials
	const sauce = new THREE.MeshPhysicalMaterial({ map: L.sauce.raw, roughness: 0.35, clearcoat: 0.25, clearcoatRoughness: 0.35 });
	patch(sauce, 'sauce', {
		decl: BAKE_DECL,
		uniforms: bakeUniforms(L.sauce.baked, L.charPlanar, 0),
		fMap: TWO_MAP(CHAR_GLSL('vMapUv * 2.0')),
		fRough: 'roughnessFactor = mix( 0.5, 0.66, bb ) + burn * 0.3;',
	});

	// Custom pizzas start as bare dough; the sauce is wherever it was poured (a live height field, see sauce.js).
	// Thin sauce is translucent and orange with dough showing through; thick sauce is deep red and stands up a
	// few millimetres, with its own shading at the edges.
	L.uSauce = { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) };
	L.uSauce.value.needsUpdate = true;
	const saucePoured = new THREE.MeshPhysicalMaterial({ map: L.sauce.raw, roughness: 0.9 });
	patch(saucePoured, 'sauce-poured', {
		decl: BAKE_DECL + 'uniform sampler2D uSauce;\n',
		uniforms: { ...bakeUniforms(L.sauce.baked, L.charPlanar, 0), uSauce: L.uSauce },
		vBegin: 'transformed.y += texture2D( uSauce, uv ).r * 0.0045 - 0.0012;',
		fMap: TWO_MAP(`
	float sh = texture2D( uSauce, vMapUv ).r;
	float grain = texture2D( uChar, vMapUv * 5.0 ).b;
	float cover = smoothstep( 0.015, 0.07, sh + ( grain - 0.5 ) * 0.035 );
	vec3 dough = mix( vec3( 0.8, 0.56, 0.28 ), vec3( 0.78, 0.46, 0.2 ), smoothstep( 0.3, 1.0, bb ) ) * ( 0.94 + 0.12 * grain ); // linear-space cream, matches the raw crust
	vec3 thin = sampledDiffuseColor.rgb * vec3( 1.28, 1.12, 1.0 );
	vec3 sauceCol = mix( mix( dough, thin, 0.75 ), sampledDiffuseColor.rgb * 0.94, smoothstep( 0.06, 0.32, sh ) );
	// in the oven passata loses water and caramelises: deeper, duller brick red, darkest where it's thin
	sauceCol *= mix( vec3( 1.0 ), vec3( 0.72, 0.6, 0.55 ) * ( 0.9 + 0.1 * smoothstep( 0.05, 0.3, sh ) ), smoothstep( 0.35, 1.0, bb ) );
	sampledDiffuseColor.rgb = mix( dough, sauceCol, cover );
	${CHAR_GLSL('vMapUv * 2.0')}`),
		fNormalAfter: BUMP_GLSL('texture2D( uSauce, vMapUv ).r * 0.006'),
	});

	const crust = new THREE.MeshPhysicalMaterial({
		map: L.crust.raw, normalMap: L.crust.normal, normalScale: new THREE.Vector2(0.9, 0.9),
		roughness: 0.85, side: THREE.DoubleSide,
	});
	patch(crust, 'crust', {
		decl: BAKE_DECL,
		uniforms: bakeUniforms(L.crust.baked, L.crust.char, 1),
		vBegin: 'if ( transformed.y > 0.02 ) transformed.y = 0.02 + ( transformed.y - 0.02 ) * uRise;',
		fMap: TWO_MAP(CHAR_GLSL('vMapUv')),
		fRough: 'roughnessFactor = mix( 0.92, 0.8, bb ) + burn * 0.15;',
	});

	const crumb = new THREE.MeshStandardMaterial({ map: L.crumb, color: 0xd9c7a8, roughness: 0.95, side: THREE.DoubleSide });
	patch(crumb, 'crumb', {
		vBegin: 'if ( transformed.y > 0.02 ) transformed.y = 0.02 + ( transformed.y - 0.02 ) * uRise;',
		fColor: 'diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 1.0, 0.97, 0.9 ), bb ) * ( 1.0 - burn * 0.25 );',
	});

	const bottom = new THREE.MeshStandardMaterial({ map: L.crust.baked, roughness: 0.95, color: 0xb98a5c, side: THREE.DoubleSide });
	patch(bottom, 'bottom', {
		fColor: 'diffuseColor.rgb *= mix( vec3( 1.62, 1.42, 1.15 ), vec3( 0.95 ), bb ) * ( 1.0 - burn * 0.55 );',
	});

	// Cut walls are textured from the very same raw/baked maps as the layer's top, sampled straight down at each
	// wall point, so the cross-section continues the colour above it instead of being a flat stripe.
	const wallMat = (raw, baked, key, shade) => {
		const m = new THREE.MeshStandardMaterial({ map: raw, color: new THREE.Color(shade, shade, shade), roughness: 0.9, side: THREE.DoubleSide });
		patch(m, key, { decl: 'uniform sampler2D uMap2;\n', uniforms: { uMap2: { value: baked } }, fMap: TWO_MAP('sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * vec3( 0.5, 0.33, 0.2 ), burn * 0.9 );') });
		return m;
	};
	const sauceWall = wallMat(L.sauce.raw, L.sauce.baked, 'sauce-wall', 0.82);
	const cheeseWall = {
		shred: wallMat(L.cheese.shred.raw, L.cheese.shred.baked, 'cheese-wall-shred', 0.93),
		fior: wallMat(L.cheese.fior.raw, L.cheese.fior.baked, 'cheese-wall-fior', 0.93),
	};

	const makeCheeseMat = (c, key) => {
		const m = new THREE.MeshPhysicalMaterial({
			map: c.raw, normalMap: c.normRaw, normalScale: new THREE.Vector2(1, 1),
			displacementMap: c.height, displacementScale: 0.032,
			roughness: 0.6, clearcoat: 0.35, clearcoatRoughness: 0.45,
		});
		patch(m, key, {
			decl: BAKE_DECL + 'uniform sampler2D uNormal2;\nuniform sampler2D uCov;\nuniform float uTime;\nuniform float uHeat;\nuniform vec3 uPep[ 48 ];\nuniform int uPepCount;\n' + BUBBLE_GLSL,
			uniforms: {
				...bakeUniforms(c.baked, L.charPlanar, 0), uNormal2: { value: c.normBaked }, uCov: { value: c.height },
				uTime: U.uTime, uHeat: U.uHeat, uPep: U.uPep, uPepCount: U.uPepCount,
			},
			vDisp: `
#ifdef USE_DISPLACEMENTMAP
	float vb = clamp( uBake, 0.0, 1.0 );
	vec2 hh = texture2D( displacementMap, vDisplacementMapUv ).rg;
	float hgt = mix( hh.r, hh.g, smoothstep( 0.1, 0.8, vb ) );
	float blister = bubbles( vDisplacementMapUv, 13.0, uTime, 0.11, 0.55 ) * uHeat * smoothstep( 0.35, 0.8, vb ) * step( 0.3, hh.g );
	float under = 1.0, lip = 0.0;
	vec2 vp = vDisplacementMapUv * 2.0 - 1.0;
	for ( int i = 0; i < 48; i ++ ) {
		if ( i >= uPepCount ) break;
		float dp = length( vp - uPep[ i ].xy ) / uPep[ i ].z;
		under = min( under, smoothstep( 0.9, 1.05, dp ) );
		lip = max( lip, exp( - pow( ( dp - 1.04 ) / 0.11, 2.0 ) ) );
	}
	hgt *= under; // the slice presses the melt flat beneath it
	hgt += lip * 0.32 * hh.g * smoothstep( 0.25, 0.8, vb ); // molten cheese creeps up against each slice's edge
	// blisters are not flattened under a slice: a blister rising under it lifts the slice instead (Pizza.bubbleLift)
	transformed += normalize( objectNormal ) * ( hgt * mix( displacementScale, displacementScale * 0.8, vb ) + blister * 0.006 + displacementBias );
#endif`,
			fMap: TWO_MAP(`
	vec2 cv = texture2D( uCov, vMapUv ).rg;
	float cov = mix( cv.r, cv.g, smoothstep( 0.1, 0.8, bb ) );
	if ( cov < 0.13 ) discard;
	float edgeBleed = 1.0 - smoothstep( 0.13, 0.3, cov );
	float heat = uHeat * smoothstep( 0.35, 0.8, bb ) * smoothstep( 0.25, 0.45, cv.g );
	float bub = ( bubbles( vMapUv, 34.0, uTime, 0.32, 0.3 ) * 0.6 + bubbles( vMapUv, 12.0, uTime, 0.1, 0.45 ) ) * heat;
	bub *= 0.55 + 0.9 * bHash( floor( vMapUv * 260.0 ) ).y * 0.5;
	sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * vec3( 0.95, 0.8, 0.55 ), smoothstep( 0.35, 1.0, bub ) * 0.7 );
	float oil = 0.0;
	vec2 pp = vMapUv * 2.0 - 1.0;
	for ( int i = 0; i < 48; i ++ ) {
		if ( i >= uPepCount ) break;
		float d = length( pp - uPep[ i ].xy ) / ( uPep[ i ].z * 1.55 ); // rendered fat bleeds a few mm past each slice
		oil = max( oil, 1.0 - smoothstep( 0.9, 1.45, d + 0.14 * ( bHash( floor( pp * 90.0 ) ).x - 0.5 ) ) );
	}
	oil *= smoothstep( 0.35, 0.95, bb );
	sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * vec3( 1.04, 0.6, 0.26 ), oil * 0.75 );
	sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * vec3( 1.0, 0.58, 0.36 ), edgeBleed * 0.65 * smoothstep( 0.3, 0.9, bb ) );
	${CHAR_GLSL('vMapUv * 2.0')}`),
			fRough: 'roughnessFactor = mix( 0.78, 0.6, bb ) + bub * 0.05 - oil * 0.3 * ( 1.0 - burn ) + burn * 0.35 + edgeBleed * 0.35;',
			fNormalAfter: BUMP_GLSL('bub * 0.0016', 'normal = normalize( mix( normal, normalize( vNormal ), edgeBleed * 0.7 ) ); // soften the glinting cheese rim'),
			normal2: true,
		});
		return m;
	};
	L.mat = {
		sauce, saucePoured, crust, crumb, bottom, sauceWall, cheeseWall,
		cheese: { shred: makeCheeseMat(L.cheese.shred, 'cheese-shred'), fior: makeCheeseMat(L.cheese.fior, 'cheese-fior') },
	};

	// --- toppings
	const pepMat = (tint, key) => {
		const m = new THREE.MeshPhysicalMaterial({ map: L.pep, color: tint, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.7 });
		patch(m, key, {
			decl: `uniform float uCup;\nvarying float vPepVar;\n#define PEP_VAR_SPAN ${PEP_VAR_SPAN.toFixed(3)}\n`,
			uniforms: { uCup: { value: PEP_CUP } },
			// per-slice variation is read from the mesh's own thickness ratio (scale.y / scale.x), which moving,
			// exploding or lifting a slice never changes; a world-position hash made every pepperoni flicker as it moved
			vBegin: 'float rr = dot( position.xz, position.xz ); vPepVar = clamp( ( length( modelMatrix[ 1 ].xyz ) / length( modelMatrix[ 0 ].xyz ) - 1.0 ) / PEP_VAR_SPAN, 0.0, 1.0 ); transformed.y += rr * uCup * ( 0.7 + 0.6 * vPepVar ) * smoothstep( 0.0, 1.0, clamp( uBake, 0.0, 1.3 ) );', // cup = rim curls up; the centre never drops below the flat disc the shadow pass draws, so it can't fall into its own shadow
			fMap: `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	float dd = length( vMapUv - 0.5 ) * 2.0;
	sampledDiffuseColor.rgb *= ( 0.88 + 0.24 * vPepVar ) * mix( 1.0, 0.8, bb ) * ( 1.0 - smoothstep( 0.78, 1.0, dd ) * ( 0.25 + 0.3 * vPepVar ) * bb );
	sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, vec3( 0.09, 0.035, 0.025 ), min( 1.0, burn * 1.6 ) * ( 0.75 + 0.25 * smoothstep( 0.4, 1.0, dd ) ) );
	diffuseColor *= sampledDiffuseColor;
#endif`,
		});
		return m;
	};
	// Each ingredient browns and chars on its own: Maillard browning arrives in patches (noise in the piece's own
	// space, seeded per piece), thin edges and corners (high curvature) and faces turned up to the dome's heat go
	// first, and only well past "perfetto" do those patches turn to carbon. The seed comes from the piece's own
	// axis-scale ratios, which never change when a slice moves, so nothing flickers.
	const tinted = (params, tint, key, opts = {}) => {
		const m = new THREE.MeshPhysicalMaterial(params);
		patch(m, key, {
			// photo ingredients: a detail layer (the same photo again at ~4.3x, offset) modulates brightness so at
			// close range the surface keeps fine grain where the photo alone has fewer texels than the screen
			fMap: opts.detail ? `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	vec3 fine = texture2D( map, vMapUv * 4.3 + vec2( 0.37, 0.21 ) ).rgb;
	float lumB = max( 0.05, dot( sampledDiffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) );
	float lumF = dot( fine, vec3( 0.3, 0.59, 0.11 ) );
	sampledDiffuseColor.rgb *= clamp( 0.88 + 0.12 * lumF / lumB, 0.8, 1.15 );
	diffuseColor *= sampledDiffuseColor;
#endif` : undefined,
			decl: 'varying vec3 vObjP;\nvarying vec3 vObjN;\nvarying float vSeed;\n' + NOISE3_GLSL,
			vBegin: 'vObjP = position; vObjN = normal; vSeed = fract( length( modelMatrix[ 0 ].xyz ) / length( modelMatrix[ 1 ].xyz ) * 13.7 + length( modelMatrix[ 2 ].xyz ) / length( modelMatrix[ 1 ].xyz ) * 7.31 );',
			fColor: `diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( ${tint.join(', ')} ), bb );
	{
		vec3 q = vObjP * 9.0 + vSeed * 31.0;
		float nz = vnoise3( q ) * 0.65 + vnoise3( q * 3.1 ) * 0.35;
		float edge = clamp( length( fwidth( vObjN ) ) * 4.0, 0.0, 1.0 );
		float up = clamp( vObjN.y, 0.0, 1.0 );
		float heat = clamp( uBake, 0.0, 1.8 ) * ( 0.8 + 0.4 * nz ) + 0.18 * edge + 0.08 * up;
		float brown = smoothstep( 0.8, 1.25, heat );
		float charred = smoothstep( 1.28, 1.5, heat + 0.25 * burn * edge );
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.66, 0.46, 0.3 ), brown * 0.7 );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.045, 0.032, 0.026 ) * ( 0.8 + 0.4 * nz ), charred );
	}`,
			fRough: 'roughnessFactor = min( 1.0, roughnessFactor + burn * 0.35 );',
		});
		return m;
	};
	L.top = {
		pepMat: pepMat(0xffffff, 'pep'),
		salamiMat: pepMat(0xb07070, 'salami'),
		basilMat: tinted({ map: L.basil, roughness: 0.35, clearcoat: 0.4, side: THREE.DoubleSide }, [0.62, 0.6, 0.42], 'basil'),
		mushFace: tinted({ color: 0xe8d8b8, roughness: 0.7 }, [0.78, 0.66, 0.5], 'mushface'),
		mushSide: tinted({ color: 0x8a6342, roughness: 0.6 }, [0.7, 0.6, 0.5], 'mushside'),
		oliveMat: new THREE.MeshPhysicalMaterial({ color: 0x1c1216, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15 }),
		chiliMat: tinted({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, [0.8, 0.62, 0.55], 'chili'),
		chiliMats: CHILI_COLS.map((c, i) => tinted({ vertexColors: true, color: new THREE.Color(...c), roughness: 0.9, side: THREE.DoubleSide }, [0.8, 0.62, 0.55], `chili-${i}`)),
	};

	// pepperoni: disc top + bottom + side, radius 1, thickness 0.14 (cups in the shader)
	{
		const top = buildDisc(0, TAU, 1, 0.04, 8, 48);
		{ // round the top edge over so it reads as a soft cured-meat slice, not a coin
			const p = top.attributes.position;
			for (let i = 0; i < p.count; i++) {
				const r = Math.hypot(p.getX(i), p.getZ(i));
				if (r > 0.8) p.setY(i, p.getY(i) - Math.pow((r - 0.8) / 0.2, 2) * 0.03);
			}
		}
		const bot = buildDisc(0, TAU, 1, -0.04, 2, 40, true);
		const side = new THREE.CylinderGeometry(1, 1, 0.05, 40, 1, true).translate(0, -0.015, 0);
		side.deleteAttribute('uv');
		const suv = [];
		for (let i = 0; i < side.attributes.position.count; i++) {
			const x = side.attributes.position.getX(i), z = side.attributes.position.getZ(i);
			suv.push(0.5 + x * 0.49, 0.5 + z * 0.49);
		}
		side.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
		top.computeVertexNormals();
		L.geo = { pep: mergeGeometries([top, bot, side]) };
	}
	// basil leaf
	{
		const s = new THREE.Shape();
		s.moveTo(0, 0);
		s.bezierCurveTo(0.42, 0.12, 0.38, 0.72, 0, 1);
		s.bezierCurveTo(-0.38, 0.72, -0.42, 0.12, 0, 0);
		const g = new THREE.ShapeGeometry(s, 14);
		const p = g.attributes.position, uv = [];
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), y = p.getY(i);
			uv.push(x + 0.5, y);
			p.setXYZ(i, x, 0.18 * x * x * 4 * 0.25 + 0.05 * Math.sin(y * 3), -(y - 0.5));
		}
		g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		g.computeVertexNormals();
		L.geo.basil = g;
	}
	// mushroom slice silhouette
	{
		const s = new THREE.Shape();
		s.moveTo(-0.18, -0.5);
		s.lineTo(-0.16, -0.05);
		s.bezierCurveTo(-0.5, -0.06, -0.55, 0.1, -0.5, 0.18);
		s.bezierCurveTo(-0.4, 0.5, 0.4, 0.5, 0.5, 0.18);
		s.bezierCurveTo(0.55, 0.1, 0.5, -0.06, 0.16, -0.05);
		s.lineTo(0.18, -0.5);
		s.quadraticCurveTo(0, -0.54, -0.18, -0.5);
		const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 2, curveSegments: 16 });
		g.rotateX(-Math.PI / 2);
		g.computeVertexNormals();
		L.geo.mush = g;
	}
	L.geo.olive = new THREE.TorusGeometry(1, 0.45, 10, 24).rotateX(Math.PI / 2);
	// Crushed red pepper: thin, torn, curled pieces of dried pod skin (a few irregular shapes), darker and
	// browner at the torn edges, with flat pale seeds mixed in. Colour per piece comes from CHILI_COLS.
	L.geo.chiliV = [0, 1, 2, 3].map((v) => chiliFlake(v));
	L.geo.chili = L.geo.chiliV[0];
	buildIngredients(L, { tinted, patch, BUBBLE_GLSL, U });
	tame(L.top);
	tame(L.mat);
	return L;
}

// Food is diffuse: no clearcoat, no sheen, a tenth of the usual specular, high roughness. Environment light
// stays for soft fill, but can no longer show up as glare at grazing angles. Takes a material or a nest of them.
function tame(m) {
	if (!m || typeof m !== 'object' || m.isTexture || m.isBufferGeometry) return;
	if (!m.isMaterial) { Object.values(m).forEach(tame); return; }
	if (m.isMeshPhysicalMaterial) { m.clearcoat = 0; m.sheen = 0; m.specularIntensity = 0.1; }
	m.roughness = Math.max(m.roughness, FOOD_MIN_ROUGH);
	m.envMapIntensity = 0.35;
}

/* ------------------------------------------------------------------ pizza recipes */
export const RECIPES = {
	margherita: { name: 'Margherita', cheese: 'fior', tops: [['basil', 8, 0.6, 0.22]] },
	pepperoni: { name: 'Pepperoni', cheese: 'shred', tops: [['pep', 26, 0.7, 0.185]] },
	funghi: { name: 'Funghi', cheese: 'shred', tops: [['mush', 17, 0.7, 0.17], ['olive', 11, 0.72, 0.1]] },
	diavola: { name: 'Diavola', cheese: 'shred', tops: [['salami', 21, 0.7, 0.155], ['olive', 7, 0.7, 0.1], ['basil', 3, 0.55, 0.2], ['chili', 170, 0.76, 0]] },
	custom: { name: 'Your pizza', cheese: 'none', tops: [], pour: true },
	// Real pizzas captured with photogrammetry by ambientCG (CC0). cx/cy/r: pizza circle in the texture, mean: height-map baseline.
	scan1: { name: 'Tonno e cipolla', cheese: 'none', tops: [], scan: { dir: 'pizza001', id: 'Pizza001', cx: 0.499, cy: 0.504, r: 0.466, mean: 120 } },
	scan2: { name: 'Spinaci gratinata', cheese: 'none', tops: [], scan: { dir: 'pizza002', id: 'Pizza002', cx: 0.501, cy: 0.5, r: 0.476, mean: 120 } },
	scan3: { name: 'Ortolana', cheese: 'none', tops: [], scan: { dir: 'pizza003', id: 'Pizza003', cx: 0.5, cy: 0.49, r: 0.482, mean: 120 } },
	scan4: { name: 'Spinaci e ricotta', cheese: 'none', tops: [], scan: { dir: 'pizza004', id: 'Pizza004', cx: 0.501, cy: 0.5, r: 0.483, mean: 120 } },
};

// Load one scanned pizza's maps (lazily, only when it's picked) and build its material.
export async function loadScan(L, type) {
	L.scanMats ||= {};
	if (L.scanMats[type]) return L.scanMats[type];
	const c = RECIPES[type].scan, base = `assets/scans/${c.dir}/`;
	const tl = new THREE.TextureLoader();
	const load = (f, srgb) => tl.loadAsync(base + f).then((t) => {
		if (srgb) t.colorSpace = THREE.SRGBColorSpace;
		t.anisotropy = 8;
		t.repeat.set(2 * c.r, 2 * c.r);
		t.offset.set(c.cx - c.r, 1 - c.cy - c.r);
		return t;
	});
	const [map, normalMap, heightTex, alphaMap, roughnessMap, aoMap] = await Promise.all([
		load('color.jpg', true), load('normal.jpg'), load('height.jpg'), load('opacity.jpg'), load('rough.jpg'), load('ao.jpg'),
	]);
	// read the height map once so the surface (and every cut wall) is displaced on the CPU, identically
	const img = heightTex.image, cv = document.createElement('canvas');
	cv.width = img.width; cv.height = img.height;
	const cx2 = cv.getContext('2d', { willReadFrequently: true });
	cx2.drawImage(img, 0, 0);
	const hd = cx2.getImageData(0, 0, cv.width, cv.height).data, HW = cv.width, HH = cv.height;
	const scale = 0.1, bias = -(c.mean / 255) * scale + 0.012;
	L.scanY ||= {};
	L.scanY[type] = (x, z) => {
		const fx = (c.cx + c.r * x) * HW - 0.5, fy = (c.cy - c.r * z) * HH - 0.5;
		const x0 = Math.max(0, Math.min(HW - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(HH - 2, Math.floor(fy)));
		const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
		const p = (xx, yy) => hd[(yy * HW + xx) * 4];
		const h = ((p(x0, y0) * (1 - tx) + p(x0 + 1, y0) * tx) * (1 - ty) + (p(x0, y0 + 1) * (1 - tx) + p(x0 + 1, y0 + 1) * tx) * ty) / 255;
		return Math.max(0.014, 0.02 + h * scale + bias);
	};
	const m = new THREE.MeshStandardMaterial({
		map, normalMap, alphaMap, roughnessMap, aoMap,
		alphaTest: 0.5, aoMapIntensity: 1, roughness: 1, envMapIntensity: 0.15, normalScale: new THREE.Vector2(1.4, 1.4),
	});
	// cut walls show the topping layer in cross-section using the same photo
	L.scanSide ||= {};
	L.scanSide[type] = new THREE.MeshStandardMaterial({ map, roughness: 0.95, envMapIntensity: 0.1, side: THREE.DoubleSide, color: 0xd9cfc4 });
	patch(m, 'scan', {
		decl: 'uniform sampler2D uChar;\n',
		uniforms: { uChar: { value: L.charPlanar } },
		fMap: `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	float lum = dot( sampledDiffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
	vec3 pale = mix( vec3( lum ), sampledDiffuseColor.rgb, 0.3 ) * 1.15 + vec3( 0.07, 0.06, 0.035 );
	sampledDiffuseColor.rgb = mix( pale, sampledDiffuseColor.rgb, smoothstep( 0.0, 1.0, bb ) );
	vec4 chs = texture2D( uChar, vMapUv * 3.0 );
	float bm = smoothstep( 1.0 - burn * 1.05, 1.12 - burn * 1.05, chs.g * 0.85 + chs.r * 0.25 ) * min( 1.0, burn * 4.0 );
	sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, vec3( 0.045, 0.03, 0.022 ), bm * 0.95 );
	sampledDiffuseColor.rgb *= 1.0 - burn * 0.35;
	diffuseColor *= sampledDiffuseColor;
#endif`,
	});
	m.roughness = 1; m.envMapIntensity = 0.3;
	L.scanMats[type] = m;
	return m;
}

function buildSkirt(a0, a1, r, y0, y1) {
	const segs = Math.max(6, Math.ceil(240 * (a1 - a0) / TAU));
	const g = new THREE.CylinderGeometry(r, r, y1 - y0, segs, 1, true, a0, a1 - a0);
	g.translate(0, (y0 + y1) / 2, 0);
	return g;
}

// k = pizza diameter / 33 cm. The pizza group is scaled by k, so toppings are made 1/k as big in its local
// units (a pepperoni stays ~3.5 cm on any pizza) and a bigger pie gets more of them, in proportion to area.
function placeToppings(recipe, seed = 77, kSize = 1) {
	const R = rng(seed);
	const placed = [], out = [];
	for (const [kind, count0, rMax, minD0] of recipe.tops) {
		const count = Math.round(count0 * kSize * kSize), minD = minD0 / kSize;
		let n = 0, tries = 0;
		while (n < count && tries++ < count * 300) {
			const a = R() * TAU, r = Math.sqrt(R()) * rMax;
			const x = Math.sin(a) * r, z = Math.cos(a) * r;
			if (minD > 0 && placed.some((p) => Math.hypot(p.x - x, p.z - z) < Math.max(minD, p.d) * 0.95)) continue;
			const sb = 0.8 + R() * 0.4;
			const t = { kind, x, z, rot: R() * TAU, sb, s: sb / kSize, tx: (R() - 0.5) * 0.08, tz: (R() - 0.5) * 0.08, j: R() };
			if (minD > 0) placed.push({ x, z, d: minD });
			out.push(t);
			n++;
		}
	}
	return out;
}

// dried pod skin: deep red, brick red, orange-red, and the pale seeds
const CHILI_COLS = [[0.52, 0.07, 0.035], [0.7, 0.13, 0.05], [0.82, 0.28, 0.09], [0.9, 0.78, 0.5]];
const chiliColour = (t) => Math.floor(t.j * 97) % CHILI_COLS.length;
const isChiliSeed = (t) => chiliColour(t) === CHILI_COLS.length - 1;

function chiliFlake(v) {
	const R = rng(300 + v * 17), n = 6 + Math.floor(R() * 3);
	const pts = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * TAU + (R() - 0.5) * 0.6;
		const r = 0.45 + R() * 0.55;
		pts.push([Math.cos(a) * r * (v === 3 ? 0.8 : 1.15), Math.sin(a) * r * (v === 3 ? 0.8 : 0.7)]);
	}
	const pos = [0, 0, 0], col = [1, 1, 1], idx = [];
	const curl = v === 3 ? 0.05 : 0.18 + R() * 0.2, twist = (R() - 0.5) * 0.3;
	const y = (x, z) => curl * x * x + twist * x * z;
	for (let i = 0; i < n; i++) {
		const [x, z] = pts[i];
		pos.push(x, y(x, z), z);
		col.push(0.72, 0.62, 0.6); // torn edges: drier and darker
		idx.push(0, 1 + i, 1 + ((i + 1) % n));
	}
	const g = makeGeometry({ position: pos, color: col, uv: new Array((pos.length / 3) * 2).fill(0) }, idx);
	g.computeVertexNormals();
	return g;
}

/* ------------------------------------------------------------------ Pizza */
export class Pizza {
	constructor(lib, type = 'pepperoni') {
		this.L = lib;
		this.root = new THREE.Group();
		this.root.name = 'pizza';
		this.slices = [];
		this.N = 1;
		this.held = -1;
		this.k = 1; // diameter / 33 cm
		this.pull = new CheesePull(this);
		this.setType(type);
	}

	setType(type) {
		this.type = type;
		this.recipe = RECIPES[type];
		this.toppings = type === 'custom' ? (this.custom ||= []) : this.layToppings();
		this.rebuild();
	}

	layToppings() {
		return placeToppings(this.recipe, 77 + Object.keys(RECIPES).indexOf(this.type) * 13, this.k);
	}

	disposeSlices() {
		for (const s of this.slices) {
			s.group.traverse((o) => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); });
			if (s.mats && s.mats !== this.L.top) Object.values(s.mats).flat().forEach((m) => m.dispose());
			s.walls?.forEach((m) => m.dispose());
			this.root.remove(s.group);
		}
		this.slices = [];
	}

	get cheese() { return this.L.cheese[this.recipe.cheese]; }

	get scanMat() { return this.recipe.scan && this.L.scanMats?.[this.type]; }

	build(N = 1) {
		this.releaseNow();
		this.disposeSlices();
		this.N = N;
		for (let i = 0; i < N; i++) this.slices.push(this.buildSlice(i));
		this.topMeshes = [];
		const chili = this.slices.map(() => []);
		for (const t of this.toppings) {
			if (t.kind === 'chili') chili[Math.min(N - 1, Math.floor(angleOf(t) / (TAU / N)))].push(t);
			else this.addToSlices(t);
		}
		chili.forEach((flakes, i) => flakes.length && this.addChili(flakes, this.slices[i]));
		this.updateHeights();
	}

	// Rebuild at the same cut, with the slices as far apart as they were.
	rebuild() {
		const ex = this.slices[0]?.exT || 0;
		this.build(this.N);
		for (const s of this.slices) s.ex = s.exT = ex;
	}

	buildSlice(index) {
		const N = this.N, a0 = index * TAU / N, a1 = (index + 1) * TAU / N, mid = (a0 + a1) / 2;
		const group = new THREE.Group();
		group.userData.slice = index;
		const slice = {
			index, group, a0, a1, mid, walls: [], ex: 0, exT: 0, lift: 0, liftT: 0,
			dir: new THREE.Vector3(Math.sin(mid), 0, Math.cos(mid)),
			tiltAxis: new THREE.Vector3(Math.cos(mid), 0, -Math.sin(mid)),
		};
		const add = (geo, mat, castShadow = true) => {
			const m = new THREE.Mesh(geo, mat);
			m.castShadow = castShadow;
			m.receiveShadow = true;
			m.userData.ownGeo = true;
			m.userData.slice = index;
			group.add(m);
		};
		// cut faces get per-slice copies, so each can be shaded by how open its cut is (shadeCutFaces)
		const wall = (mat) => {
			const c = cloneMaterial(mat);
			c.userData.base = mat.color.clone();
			slice.walls.push(c);
			return c;
		};
		const cuts = N > 1 ? [[a0, false], [a1, true]] : [];
		if (this.scanMat) this.buildScanLayers(slice, cuts, add, wall);
		else this.buildLayers(slice, cuts, add, wall);
		this.clipToppingsTo(slice);
		this.root.add(group);
		return slice;
	}

	buildLayers({ a0, a1 }, cuts, add, wall) {
		const M = this.L.mat, { pour, cheese } = this.recipe, cheeseMat = M.cheese[cheese];
		add(buildDisc(a0, a1, R_BASE, 0.0015, 10, 160, true), M.bottom);
		if (pour) add(buildDisc(a0, a1, R_SAUCE, SAUCE_Y, 90, 480), M.saucePoured, false);
		else add(buildDisc(a0, a1, R_SAUCE, SAUCE_Y, 28, 220), M.sauce, false);
		if (cheeseMat) add(buildDisc(a0, a1, R_CHEESE, CHEESE_Y, 150, 720), cheeseMat, false); // ~1 vertex per 2 texels of the melt map
		add(buildCrust(a0, a1), M.crust);
		const radii = Array.from({ length: 165 }, (_, k) => (k / 164) * 0.82);
		for (const [theta, flip] of cuts) {
			add(buildCutFace(theta, flip), wall(M.crumb), false);
			if (!pour) add(buildStrip(theta, flip, 0.83, 0.02, SAUCE_Y + 0.001), wall(M.sauceWall), false);
			if (!cheeseMat) continue;
			// top tucked just under the melt, so a closed seam reads as a shadowed line
			const top = (r) => this.surfaceY(r * Math.sin(theta), r * Math.cos(theta)) - 0.0015;
			add(buildWall(theta, flip, radii, () => SAUCE_Y + 0.001, top), wall(M.cheeseWall[cheese]), false);
		}
	}

	// A scanned pizza is one photographed surface over a dough base; its cut walls show both in cross-section.
	buildScanLayers({ a0, a1 }, cuts, add, wall) {
		const { L, type } = this, M = L.mat, height = L.scanY[type];
		add(buildDisc(a0, a1, 0.985, 0.0015, 10, 160, true), M.bottom);
		add(buildRim(a0, a1, 0.975, 0.0015, height), M.bottom);
		add(buildDisc(a0, a1, 1.0, 0.02, 110, 420, false, height), this.scanMat);
		const radii = Array.from({ length: 109 }, (_, k) => Math.min(0.975, k / 110));
		for (const [theta, flip] of cuts) {
			const top = (r) => height(r * Math.sin(theta), r * Math.cos(theta));
			const dough = (r) => Math.min(0.018, top(r));
			add(buildWall(theta, flip, radii, () => 0.0015, dough), wall(M.crumb), false);
			add(buildWall(theta, flip, radii, dough, top), wall(L.scanSide[type]), false);
		}
	}

	// Toppings that straddle a cut get a copy in each slice, clipped along the cut line.
	clipToppingsTo(slice) {
		const { a0, a1 } = slice;
		slice.localPlanes = [
			new THREE.Plane(new THREE.Vector3(Math.cos(a0), 0, -Math.sin(a0)), 0),
			new THREE.Plane(new THREE.Vector3(-Math.cos(a1), 0, Math.sin(a1)), 0),
		];
		slice.planes = slice.localPlanes.map((p) => p.clone());
		if (this.N === 1) { slice.mats = this.L.top; return; }
		const clipped = (m) => {
			if (Array.isArray(m)) return m.map(clipped);
			const c = cloneMaterial(m);
			c.clippingPlanes = slice.planes;
			c.clipShadows = true;
			c.side = THREE.DoubleSide; // cut toppings show solid insides, not see-through shells
			return c;
		};
		slice.mats = Object.fromEntries(Object.entries(this.L.top).map(([k, m]) => [k, clipped(m)]));
	}

	addChili(flakes, slice) {
		const variants = this.L.geo.chiliV;
		const mesh = new THREE.InstancedMesh(variants[slice.index % variants.length], slice.mats.chiliMat, flakes.length);
		const colour = new THREE.Color();
		flakes.forEach((t, i) => mesh.setColorAt(i, colour.setRGB(...CHILI_COLS[chiliColour(t)])));
		mesh.castShadow = true;
		Object.assign(mesh.userData, { slice: slice.index, list: flakes, isChili: true });
		slice.group.add(mesh);
		this.topMeshes.push(mesh);
	}

	addToSlices(t) {
		return this.slices.filter((s) => this.overlaps(t, s)).map((s) => this.addTopping(t, s));
	}

	overlaps(t, s) {
		const rad = KINDS[t.kind].rad * t.s, a = angleOf(t);
		if (a >= s.a0 && a < s.a1) return true;
		if (this.N === 1) return false;
		for (const b of [s.a0, s.a1]) {
			const dx = Math.sin(b), dz = Math.cos(b);
			const pr = t.x * dx + t.z * dz;
			const d = pr < 0 ? Math.hypot(t.x, t.z) : Math.hypot(t.x - pr * dx, t.z - pr * dz);
			if (d < rad) return true;
		}
		return false;
	}

	addTopping(t, slice) {
		const K = KINDS[t.kind];
		const m = K.make(slice.mats, this.L.geo, t);
		m.position.set(t.x, 0, t.z);
		m.rotation.set(t.tx, t.rot, t.tz);
		m.castShadow = true;
		m.receiveShadow = true;
		m.userData.slice = slice.index;
		m.userData.t = t;
		m.userData.rad = K.rad * t.s;
		if (isPepKind(t.kind)) {
			m.rotation.set(0, t.rot, 0);
			m.scale.y = m.scale.x * (1 + PEP_VAR_SPAN * pepVar(t));
			m.geometry = t._geo || (t._shape ||= pepShape(this.L.geo.pep, t));
		} else {
			// no two pieces alike: each is stretched a little differently on every axis
			m.scale.x *= 0.88 + 0.24 * tHash(t, 11);
			m.scale.y *= 0.82 + 0.36 * tHash(t, 12);
			m.scale.z *= 0.88 + 0.24 * tHash(t, 13);
		}
		m.userData.half = K.half(m);
		m.userData.cheese = !!K.cheese;
		if (K.cheese) m.castShadow = false; // the shadow pass doesn't run the melt shader, so a melted puddle would be shadowed by its own unmelted blob
		slice.group.add(m);
		this.topMeshes.push(m);
		return m;
	}

	// --- custom builder: place / remove toppings live
	place(kind, x, z, group) {
		const K = KINDS[kind], R = Math.random;
		const pts = K.sprinkle
			? Array.from({ length: K.sprinkle.n }, () => { const a = R() * TAU, r = (Math.sqrt(R()) * K.sprinkle.r) / this.k; return [x + Math.sin(a) * r, z + Math.cos(a) * r]; })
			: [[x, z]];
		const added = [];
		for (const [px, pz] of pts) {
			const rr = Math.hypot(px, pz), lim = 0.8 - (K.rad * 0.5) / this.k;
			const k = rr > lim ? lim / rr : 1;
			const sb = 0.8 + R() * 0.4;
			const t = { kind, x: px * k, z: pz * k, rot: R() * TAU, sb, s: sb / this.k, tx: (R() - 0.5) * (K.sprinkle ? 0.6 : 0.06), tz: (R() - 0.5) * (K.sprinkle ? 0.6 : 0.06), j: R(), g: group };
			this.toppings.push(t);
			added.push(...this.addToSlices(t));
		}
		this.updateHeights();
		return added;
	}

	removeWhere(fn) {
		const kill = new Set(this.toppings.filter(fn));
		if (!kill.size) return 0;
		for (let i = this.toppings.length - 1; i >= 0; i--) if (kill.has(this.toppings[i])) this.toppings.splice(i, 1);
		this.topMeshes = this.topMeshes.filter((m) => {
			if (m.userData.t && kill.has(m.userData.t)) { m.parent?.remove(m); return false; }
			return true;
		});
		return kill.size;
	}

	updateClipPlanes() {
		if (this.N < 2) return;
		this.root.updateMatrixWorld(true);
		for (const s of this.slices) {
			s.planes[0].copy(s.localPlanes[0]).applyMatrix4(s.group.matrixWorld);
			s.planes[1].copy(s.localPlanes[1]).applyMatrix4(s.group.matrixWorld);
		}
	}

	// The albedo of the cheese at a pizza-local point, as currently baked.
	cheeseColour(x, z) {
		const ch = this.cheese || this.L.cheese.shred;
		const read = (tex) => {
			const im = tex.image;
			if (!tex.userData.px) tex.userData.px = im.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, im.width, im.height);
			const d = tex.userData.px, W = d.width, H = d.height;
			let r = 0, g = 0, b = 0, n = 0;
			for (let dy = -3; dy <= 3; dy += 3) {
				for (let dx = -3; dx <= 3; dx += 3) {
					const px = Math.min(W - 1, Math.max(0, Math.round((0.5 + x / 2) * W) + dx)), py = Math.min(H - 1, Math.max(0, Math.round((0.5 - z / 2) * H) + dy));
					const k = (py * W + px) * 4;
					r += d.data[k]; g += d.data[k + 1]; b += d.data[k + 2]; n++;
				}
			}
			return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
		};
		const bb = Math.min(1, U.uBake.value);
		const c = read(ch.raw).lerp(read(ch.baked), sstep(0.05, 0.95, bb));
		return c.lerp(read(ch.raw).multiplyScalar(0.96), 0.35);
	}

	// Height of the actual cheese surface (or the sauce in a gap) at pizza-local x,z.
	// Mirrors the cheese shader: same coverage map, same raw→melted blend, same displacement.
	surfaceY(x, z) {
		if (this.recipe.scan) return this.L.scanY?.[this.type]?.(x, z) ?? 0.034;
		const ch = this.cheese;
		if (!ch && this.recipe.pour && this.sauceField) return SAUCE_Y - 0.0012 + Math.min(1, (this.sauceField.at(x, z) / 1.4) * 3) * 0.0045;
		if (!ch) return SAUCE_Y + 0.001;
		const b = Math.min(1, U.uBake.value), w = sstep(0.1, 0.8, b);
		const k = texelAt(ch.cov, x, z);
		const h = (ch.cov.data[k] * (1 - w) + ch.cov.data[k + 1] * w) / 255;
		if (h < 0.13) return SAUCE_Y + 0.001;
		return CHEESE_Y + h * 0.032 * (1 - 0.2 * b);
	}

	cheeseDepthAt(x, z) {
		return Math.max(0.0025, this.surfaceY(x, z) - SAUCE_Y);
	}

	// Is there cheese to pull at this point? The base layer where it covers it, or a piece the user placed
	// (those spread to about twice their raw size as they melt).
	hasCheeseAt(x, z) {
		if (this.recipe.scan) return true;
		const melted = U.uBake.value > 0.5;
		const reach = (t) => KINDS[t.kind].rad * t.s * (melted ? 1.9 : 1) * 0.85;
		if (this.toppings.some((t) => KINDS[t.kind]?.cheese && Math.hypot(t.x - x, t.z - z) < reach(t))) return true;
		const cov = this.cheese?.cov;
		return !!cov && cov.data[texelAt(cov, x, z) + (melted ? 1 : 0)] / 255 > 0.35;
	}

	updateHeights() {
		this.tellCheeseAboutCuredMeat();
		const melt = sstep(0.1, 0.8, Math.min(1, U.uBake.value));
		for (const m of this.topMeshes) {
			if (m.userData.isChili) this.seatChili(m);
			else this.seatTopping(m, melt);
		}
		this.stackCuredMeat();
		// rest poses: bubbleLift() adds the blisters on top of these every frame
		for (const m of this.topMeshes) {
			if (m.userData.isChili || m.userData.cheese) continue;
			m.userData.baseY = m.position.y;
			m.userData.baseQ ||= new THREE.Quaternion().setFromEuler(m.rotation); // taken once: later the mesh may be tipped by a bubble
			m.userData.lifted = false;
		}
	}

	// The cheese shader presses the melt flat under each cured slice and lets its fat bleed out around it.
	tellCheeseAboutCuredMeat() {
		const slots = U.uPep.value;
		const cured = this.toppings.filter((t) => isPepKind(t.kind)).slice(0, slots.length);
		cured.forEach((t, i) => slots[i].set(t.x, t.z, KINDS[t.kind].rad * t.s));
		U.uPepCount.value = cured.length;
	}

	seatChili(flakes) {
		const o = new THREE.Object3D();
		flakes.userData.list.forEach((t, i) => {
			o.position.set(t.x, this.surfaceY(t.x, t.z) + 0.0012, t.z);
			o.rotation.set(t.tx * 3, t.rot, t.tz * 3);
			o.scale.setScalar(((isChiliSeed(t) ? 0.007 : 0.01) + t.j * 0.008) / this.k);
			o.updateMatrix();
			flakes.setMatrixAt(i, o.matrix);
		});
		flakes.instanceMatrix.needsUpdate = true;
	}

	// Highest and mean surface height under a topping: its centre plus n points alternating between two radii.
	heightsAround(t, n, inner, outer) {
		let max = this.surfaceY(t.x, t.z), sum = max;
		for (let k = 0; k < n; k++) {
			const a = (k / n) * TAU, r = k % 2 ? inner : outer;
			const y = this.surfaceY(t.x + Math.sin(a) * r, t.z + Math.cos(a) * r);
			max = Math.max(max, y);
			sum += y;
		}
		return { max, mean: sum / (n + 1) };
	}

	seatTopping(m, melt) {
		const { t, rad, half } = m.userData, K = KINDS[t.kind], pour = this.recipe.pour;
		const { max, mean } = this.heightsAround(t, pour ? 16 : 10, rad * 0.45, rad * (pour ? 0.95 : 0.8));
		if (isPepKind(t.kind)) {
			// cured slices sit on the pressed-flat cheese (or the sauce where there is none), a fifth of their
			// thickness pressed in; the rim curls up from there and the melt banks up around it
			const floor = max > SAUCE_Y + 0.002 ? CHEESE_Y : SAUCE_Y + 0.001;
			m.position.y = t._y = floor + 0.025 * m.scale.y;
			return;
		}
		if (m.userData.cheese) {
			// molten cheese floods outwards (about twice its raw footprint), so it must clear the highest point
			// of what it will spread over, not just what is under the raw piece
			const spread = rad * (1 + melt);
			m.position.y = Math.max(max, this.heightsAround(t, 16, spread * 0.6, spread).max) + half;
			return;
		}
		// On poured sauce the layer's thickness varies under a piece, so a flat piece must clear its highest
		// point and is barely pressed in. On cheese it settles towards the mean, deeper once molten.
		const rest = K.drape ? mean : pour ? max : mean + (max - mean) * 0.25 * (1 - melt);
		const y = rest - (0.0025 + 0.002 * melt) * (pour ? 0.2 : 1);
		m.position.y = y + half;
		if (K.drape) this.drapeOnSurface(m, y);
		if (K.leaf) this.drapeLeaf(m, y);
	}

	// The cheese blisters while it bakes (see the melt shader). A blister that rises under a topping pushes it up
	// instead of swelling through it: flat pieces rise and tip like a lid nudged from below, pepper strips bend
	// over it along their length, and everything settles back when the bubble collapses.
	blisterAt(x, z, k, time) {
		const cov = this.cheese?.cov;
		if (!cov || cov.data[texelAt(cov, x, z) + 1] < 0.3 * 255) return 0; // only where the melt is deep enough to blister
		return bubbles(0.5 + x / 2, 0.5 + z / 2, 13, time, 0.11, 0.55) * k * 0.006;
	}

	bubbleLift(time) {
		const k = this.recipe.scan || !this.cheese ? 0 : U.uHeat.value * sstep(0.35, 0.8, Math.min(1, U.uBake.value));
		const up = (this._up ||= new THREE.Vector3(0, 1, 0)), nrm = (this._nrm ||= new THREE.Vector3()), q = (this._q ||= new THREE.Quaternion());
		for (const m of this.topMeshes) {
			const ud = m.userData;
			if (ud.baseY === undefined || ud.cheese || ud.isChili) continue;
			if (k <= 0) {
				if (ud.lifted) { m.position.y = ud.baseY; m.quaternion.copy(ud.baseQ); if (ud.drapeY) this.liftStrip(m, null); ud.lifted = false; }
				continue;
			}
			ud.lifted = true;
			const t = ud.t;
			if (ud.leafGrid) { this.liftLeaf(m, k, time); continue; }
			if (ud.drapeY) { this.liftStrip(m, (x, z) => this.blisterAt(x, z, k, time)); continue; }
			// a rigid piece on a bump: sample its footprint, then find the plane it rests on (centre + tilt)
			const r = ud.rad, N = r > 0.05 ? 12 : 6;
			const h0 = this.blisterAt(t.x, t.z, k, time);
			let best = h0, bx = 0, bz = 0;
			const hs = [];
			for (let i = 0; i < N; i++) {
				const a = (i / N) * TAU, rr = r * (i % 2 ? 0.5 : 0.92);
				const dx = Math.sin(a) * rr, dz = Math.cos(a) * rr, h = this.blisterAt(t.x + dx, t.z + dz, k, time);
				hs.push([dx, dz, h]);
				if (h > best) { best = h; bx = dx; bz = dz; }
			}
			if (best <= 1e-6) { m.position.y = ud.baseY; m.quaternion.copy(ud.baseQ); continue; }
			// tip towards the highest bump, pivoting on the far side; then lift until nothing pokes through
			const d = Math.hypot(bx, bz);
			let gx = 0, gz = 0;
			if (d > 1e-6) { const g = Math.min(0.12, (best - h0) / d * 0.5); gx = (bx / d) * g; gz = (bz / d) * g; }
			let c = h0;
			for (const [dx, dz, h] of hs) c = Math.max(c, h - (gx * dx + gz * dz));
			m.position.y = ud.baseY + c;
			nrm.set(-gx, 1, -gz).normalize();
			m.quaternion.copy(q.setFromUnitVectors(up, nrm).multiply(ud.baseQ));
		}
	}

	// pepper strips bend over a blister station by station (each station is lifted by the highest bubble under
	// its cross-section, and the lift is blended smoothly along the strip). heightAt = null restores the rest shape.
	liftStrip(m, heightAt) {
		const ud = m.userData, S = ud.drapeSt, p = m.geometry.attributes.position, Y = ud.drapeY, sy = m.scale.y;
		if (!heightAt) { for (let v = 0; v < p.count; v++) p.setY(v, Y[v]); p.needsUpdate = true; return; }
		const lift = (ud._lift ||= new Float32Array(S.NB + 1));
		let any = 0;
		for (let i = 0; i <= S.NB; i++) {
			const o = i * 6;
			lift[i] = Math.max(heightAt(S.pts[o], S.pts[o + 1]), heightAt(S.pts[o + 2], S.pts[o + 3]), heightAt(S.pts[o + 4], S.pts[o + 5]));
			any = Math.max(any, lift[i]);
		}
		if (!any && !ud._wasLifted) return;
		ud._wasLifted = any > 0;
		for (let pass = 0; pass < 2; pass++) for (let i = 1; i < S.NB; i++) lift[i] = Math.max(lift[i], (lift[i - 1] + lift[i + 1]) / 2 * 0.9);
		const bp = ud.drapeBase.attributes.position;
		for (let v = 0; v < p.count; v++) {
			const f = Math.min(S.NB, Math.max(0, (bp.getX(v) - S.x0) / S.span)), i = Math.min(S.NB - 1, Math.floor(f)), u = f - i;
			const uu = u * u * (3 - 2 * u);
			p.setY(v, Y[v] + (lift[i] * (1 - uu) + lift[i + 1] * uu) / sy);
		}
		p.needsUpdate = true;
	}

	// A soft leaf (basil) lies on whatever is under every point of it: the pizza's height is sampled on a small grid
	// over the leaf (each sample the highest point within ~1 mm, so it never dips into the sauce or the cheese), the
	// grid is softened a little (a leaf bends, it doesn't crease), and every vertex is set from it by bilinear
	// interpolation. The same grid is reused each frame to lift the leaf by the bubbles rising under it.
	drapeLeaf(m, restY) {
		const base = (m.userData.drapeBase ||= m.geometry);
		if (m.geometry === base) m.geometry = base.clone();
		if (!base.boundingBox) base.computeBoundingBox();
		const bb = base.boundingBox, G = 9;
		const t = m.userData.t, cs = Math.cos(t.rot), sn = Math.sin(t.rot), sx = m.scale.x, sz = m.scale.z, sy = m.scale.y;
		const world = (lx, lz) => [t.x + lx * sx * cs + lz * sz * sn, t.z - lx * sx * sn + lz * sz * cs];
		const gx0 = bb.min.x, gz0 = bb.min.z, dx = (bb.max.x - bb.min.x) / (G - 1), dz = (bb.max.z - bb.min.z) / (G - 1);
		const pts = new Float32Array(G * G * 2), H = new Float32Array(G * G), r = 0.006;
		for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
			const [x, z] = world(gx0 + i * dx, gz0 + j * dz), k = j * G + i;
			pts[k * 2] = x; pts[k * 2 + 1] = z;
			H[k] = Math.max(this.surfaceY(x, z), this.surfaceY(x + r, z), this.surfaceY(x - r, z), this.surfaceY(x, z + r), this.surfaceY(x, z - r));
		}
		const Hs = H.slice();
		for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
			let sum = 0, n = 0;
			for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
				const ii = i + a, jj = j + b;
				if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
				const w = a || b ? 1 : 2;
				sum += Hs[jj * G + ii] * w; n += w;
			}
			H[j * G + i] = Math.max(sum / n, Hs[j * G + i] - 0.0008); // softened, but never pressed more than a hair into it
		}
		const grid = (m.userData.leafGrid = { G, gx0, gz0, dx, dz, pts, lift: new Float32Array(G * G) });
		const bp = base.attributes.position, p = m.geometry.attributes.position;
		const Y = (m.userData.drapeY ||= new Float32Array(p.count));
		for (let v = 0; v < p.count; v++) {
			const h = this.gridAt(grid, H, bp.getX(v), bp.getZ(v));
			Y[v] = bp.getY(v) + (h - restY) / sy;
			p.setY(v, Y[v]);
		}
		p.needsUpdate = true;
		m.geometry.computeVertexNormals();
		m.geometry.computeBoundingSphere();
	}

	gridAt(g, A, lx, lz) {
		const fx = Math.min(g.G - 1.0001, Math.max(0, (lx - g.gx0) / g.dx)), fz = Math.min(g.G - 1.0001, Math.max(0, (lz - g.gz0) / g.dz));
		const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j, G = g.G;
		return (A[j * G + i] * (1 - u) + A[j * G + i + 1] * u) * (1 - w) + (A[(j + 1) * G + i] * (1 - u) + A[(j + 1) * G + i + 1] * u) * w;
	}

	// the leaf rides the blisters point by point: the cheese under it swells and the leaf bends over it, so the melt
	// never wells up through the leaf
	liftLeaf(m, k, time) {
		const ud = m.userData, g = ud.leafGrid, L = g.lift, p = m.geometry.attributes.position, Y = ud.drapeY, sy = m.scale.y;
		let any = 0;
		for (let q = 0; q < g.G * g.G; q++) { L[q] = this.blisterAt(g.pts[q * 2], g.pts[q * 2 + 1], k, time); any = Math.max(any, L[q]); }
		if (!any && !ud._wasLifted) return;
		ud._wasLifted = any > 0;
		const bp = ud.drapeBase.attributes.position;
		for (let v = 0; v < p.count; v++) p.setY(v, Y[v] + this.gridAt(g, L, bp.getX(v), bp.getZ(v)) / sy);
		p.needsUpdate = true;
	}

	// Flexible pieces (pepper strips) rest on the pizza like a real soft strip: stiff across its width, able to bend
	// along its length but only so sharply. The strip is cut into stations along its length; each station sits on
	// the cheese/sauce under its own cross-section (pressed a little into the melt, so mostly its high points),
	// then a bending limit lets it slope off a cheese pool's edge gradually instead of dropping straight down it
	// (which drew a thin vertical "leg"). Every vertex of a station moves together, so the arch keeps its shape.
	drapeOnSurface(m, restY) {
		const base = (m.userData.drapeBase ||= m.geometry);
		if (m.geometry === base) m.geometry = base.clone();
		if (!base.boundingBox) base.computeBoundingBox();
		const bp = base.attributes.position, p = m.geometry.attributes.position;
		const t = m.userData.t, cs = Math.cos(t.rot), sn = Math.sin(t.rot), sx = m.scale.x, sz = m.scale.z, sy = m.scale.y;
		const x0 = base.boundingBox.min.x, x1 = base.boundingBox.max.x, NB = 20, span = (x1 - x0) / NB;
		const mx = new Float32Array(NB + 1).fill(-1e9), sum = new Float32Array(NB + 1), cnt = new Float32Array(NB + 1);
		const st = (lx) => Math.min(NB, Math.max(0, Math.round((lx - x0) / span)));
		for (let v = 0; v < bp.count; v++) {
			const lx = bp.getX(v), lz = bp.getZ(v);
			const x = t.x + (lx * sx) * cs + (lz * sz) * sn, z = t.z - (lx * sx) * sn + (lz * sz) * cs;
			const h = this.surfaceY(x, z), i = st(lx);
			if (h > mx[i]) mx[i] = h;
			sum[i] += h; cnt[i]++;
		}
		const H = new Float32Array(NB + 1);
		// per station: centre and the two edges of its cross-section (pizza coords), for bubbleLift()
		const pts = new Float32Array((NB + 1) * 6), lzMin = new Float32Array(NB + 1).fill(1e9), lzMax = new Float32Array(NB + 1).fill(-1e9);
		for (let v = 0; v < bp.count; v++) {
			const lx = bp.getX(v), lz = bp.getZ(v), i = st(lx), o = i * 6;
			const x = t.x + (lx * sx) * cs + (lz * sz) * sn, z = t.z - (lx * sx) * sn + (lz * sz) * cs;
			pts[o] += x / cnt[i]; pts[o + 1] += z / cnt[i];
			if (lz < lzMin[i]) { lzMin[i] = lz; pts[o + 2] = x; pts[o + 3] = z; }
			if (lz > lzMax[i]) { lzMax[i] = lz; pts[o + 4] = x; pts[o + 5] = z; }
		}
		m.userData.drapeSt = { NB, x0, span, pts };
		for (let i = 0; i <= NB; i++) H[i] = cnt[i] ? mx[i] * 0.4 + (sum[i] / cnt[i]) * 0.6 : -1e9; // soft melt: it sinks into the cheese, not perched on its peaks
		for (let i = 0; i <= NB; i++) if (H[i] < -1e8) H[i] = H[i - 1] ?? restY;
		// bending limit: a station may sit at most `drop` below its neighbour (~45°), so off a pool edge the
		// strip leans down over a few millimetres rather than folding straight down it
		const drop = 1.0 * span * sx;
		for (let i = 1; i <= NB; i++) H[i] = Math.max(H[i], H[i - 1] - drop);
		for (let i = NB - 1; i >= 0; i--) H[i] = Math.max(H[i], H[i + 1] - drop);
		// a strip bends in smooth curves: round the profile off (no straight creases for the light to catch),
		// then make sure no station ends up pressed more than a hair into what it rests on, and smooth again
		const sup = H.slice(), blur = (n) => {
			for (let pass = 0; pass < n; pass++) {
				const c = H.slice();
				for (let i = 0; i <= NB; i++) H[i] = (c[Math.max(0, i - 1)] + c[i] * 2 + c[Math.min(NB, i + 1)]) / 4;
			}
		};
		blur(6);
		for (let i = 0; i <= NB; i++) H[i] = Math.max(H[i], sup[i] - 0.0012);
		blur(3);
		for (let i = 0; i <= NB; i++) H[i] = Math.max(H[i], sup[i] - 0.0018);
		// Catmull-Rom between stations: the bend is continuous in slope, so the shading is too
		const at = (i) => H[Math.min(NB, Math.max(0, i))];
		for (let v = 0; v < p.count; v++) {
			const f = Math.min(NB, Math.max(0, (bp.getX(v) - x0) / span)), i = Math.min(NB - 1, Math.floor(f)), u = f - i;
			const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
			const h = p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
			p.setY(v, bp.getY(v) + (h - restY) / sy);
		}
		p.needsUpdate = true;
		m.geometry.computeVertexNormals();
		m.geometry.computeBoundingSphere();
		const Y = (m.userData.drapeY ||= new Float32Array(p.count));
		for (let v = 0; v < p.count; v++) Y[v] = p.getY(v);
		m.userData._wasLifted = false;
	}

	// Overlapping pepperoni/salami: each slice lies on the ones placed before it. Under an overlap the upper
	// slice is lifted so its underside clears the lower slice's (cupped) top by a hair; past the lower rim it
	// bends back down into the cheese over half its own radius. The bend is written into a per-topping copy of
	// the disc geometry, so it is exact for every vertex (not a whole-slice offset).
	stackCuredMeat() {
		const peps = this.toppings.filter((t) => isPepKind(t.kind) && t._y !== undefined);
		if (!peps.length) return;
		const cupS = sstep(0, 1, Math.min(U.uBake.value, 1.3));
		for (const t of peps) {
			t._r = KINDS[t.kind].rad * t.s;
			t._sy = t._r * (1 + PEP_VAR_SPAN * pepVar(t));
			t._cup = PEP_CUP * (0.7 + 0.6 * pepVar(t)) * cupS;
		}
		const topL = (t, rr) => 0.04 - (rr > 0.8 ? ((rr - 0.8) / 0.2) ** 2 * 0.03 : 0) + rr * rr * t._cup;
		const botL = (t, rr) => -0.04 + rr * rr * t._cup;
		const gap = 0.0006;
		const lift = (t, x, z, depth = 0) => {
			if (!t._under || depth > 6) return 0;
			let best = 0;
			const ri = Math.min(1, Math.hypot(x - t.x, z - t.z) / t._r);
			const bot = t._y + botL(t, ri) * t._sy;
			for (const j of t._under) {
				const d = Math.hypot(x - j.x, z - j.z), dc = Math.min(d, j._r * 0.999), k = d > 1e-6 ? dc / d : 0;
				const cx = j.x + (x - j.x) * k, cz = j.z + (z - j.z) * k;
				const top = j._y + topL(j, dc / j._r) * j._sy + lift(j, cx, cz, depth + 1);
				const fall = 1 - sstep(0, t._r * 0.5, d - j._r);
				best = Math.max(best, (top + gap - bot) * fall);
			}
			return best;
		};
		peps.forEach((t, i) => {
			t._under = peps.slice(0, i).filter((j) => Math.hypot(j.x - t.x, j.z - t.z) < (j._r + t._r) * 0.995);
			if (!t._under.length) t._under = null;
		});
		const c = new Map();
		for (const t of peps) {
			const base = (t._shape ||= pepShape(this.L.geo.pep, t)), bp = base.attributes.position;
			if (!t._under) { c.set(t, base); continue; }
			const g = t._geo ||= base.clone();
			const p = g.attributes.position, cs = Math.cos(t.rot), sn = Math.sin(t.rot);
			for (let v = 0; v < p.count; v++) {
				const lx = bp.getX(v), lz = bp.getZ(v);
				const x = t.x + (lx * cs + lz * sn) * t._r, z = t.z + (-lx * sn + lz * cs) * t._r;
				p.setY(v, bp.getY(v) + lift(t, x, z) / t._sy);
			}
			p.needsUpdate = true;
			g.computeVertexNormals();
			g.computeBoundingSphere();
			c.set(t, g);
		}
		for (const m of this.topMeshes) {
			const t = m.userData.t;
			if (t && c.has(t) && m.geometry !== c.get(t)) m.geometry = c.get(t);
		}
	}

	// Resize to a new diameter (k = cm / 33). While the slider moves, existing toppings are shrunk in place so
	// they never grow with the dough; once it settles (final), recipes are re-laid with more (or fewer) pieces.
	setRealSize(k, final) {
		if (!this.kBuilt) this.kBuilt = this.k;
		this.k = k;
		const f = this.kBuilt / k;
		for (const m of this.topMeshes) {
			m.userData.s0 ||= m.scale.clone();
			m.scale.copy(m.userData.s0).multiplyScalar(f);
		}
		if (!final || Math.abs(this.kBuilt - k) < 1e-4) return;
		this.kBuilt = k;
		if (this.type === 'custom') {
			for (const t of this.toppings) { t.sb ??= t.s; t.s = t.sb / k; delete t._shape; delete t._geo; delete t._under; }
		} else if (!this.recipe.scan) {
			this.toppings = this.layToppings();
		}
		this.rebuild();
	}

	setExplode(e) { for (const s of this.slices) s.exT = e; }

	// --- lifting a slice, and the cheese that stretches with it (cheese-pull.js)
	get stretchy() { return U.uBake.value >= 0.45; }

	grab(i) {
		if (this.N < 2) return;
		const wasHeld = this.held === i;
		this.release();
		if (wasHeld) return;
		this.held = i;
		this.slices[i].liftT = 1;
		this.pull.clear();
		if (this.stretchy) this.pull.start(this.slices[i]);
	}

	release() {
		if (this.held < 0) return;
		this.slices[this.held].liftT = 0;
		this.held = -1;
		this.pull.release();
	}

	releaseNow() {
		this.pull.clear();
		this.held = -1;
	}

	update(dt, time) {
		this.bubbleLift(time);
		this.moveSlices(dt);
		this.updateClipPlanes();
		this.shadeCutFaces();
		this.pull.update(dt);
	}

	moveSlices(dt) {
		const ease = (rate) => 1 - Math.exp(-dt * rate);
		for (const s of this.slices) {
			s.ex += (s.exT - s.ex) * ease(7);
			s.lift += (s.liftT - s.lift) * ease(s.liftT > s.lift ? 3.2 : 6);
			s.group.position.copy(s.dir).multiplyScalar(s.ex + s.lift * 0.38).setY(s.lift * 0.58);
			s.group.quaternion.setFromAxisAngle(s.tiltAxis, -0.32 * s.lift);
		}
	}

	// A cut face is lit by how far its cut is open: inside a closed 1-2 mm seam it sits in shadow (a dark line,
	// like a real cut), lifted out it is fully lit.
	shadeCutFaces() {
		const n = this.slices.length, open = (s) => s.ex + s.lift * 0.6;
		this.slices.forEach((s, i) => {
			if (!s.walls.length) return;
			const widest = Math.max(open(s), open(this.slices[(i + 1) % n]), open(this.slices[(i + n - 1) % n]));
			const ao = 0.16 + 0.84 * sstep(0.008, 0.09, widest);
			if (Math.abs(s.ao - ao) < 0.002) return;
			s.ao = ao;
			for (const m of s.walls) m.color.copy(m.userData.base).multiplyScalar(ao);
		});
	}

	pick(raycaster) {
		const hits = raycaster.intersectObject(this.root, true);
		for (const h of hits) {
			let o = h.object;
			while (o && o.userData.slice === undefined) o = o.parent;
			if (o) return o.userData.slice;
		}
		return -1;
	}
}

/* ------------------------------------------------------------------ the pizza wheel */
export function makeCutter() {
	const g = new THREE.Group();
	const metal = new THREE.MeshPhysicalMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.18, clearcoat: 0.4 });
	const wood = new THREE.MeshStandardMaterial({ color: 0x2b1d15, roughness: 0.55 });
	const spin = new THREE.Group();
	const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.025, 64).rotateZ(Math.PI / 2), metal);
	const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.09, 24).rotateZ(Math.PI / 2), metal);
	spin.add(disc, hub);
	const fork = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), metal);
	fork.position.set(0.06, 0.18, -0.12);
	fork.rotation.x = -0.75;
	const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 1.3, 24), wood);
	handle.position.set(0.06, 0.62, -0.62);
	handle.rotation.x = -0.75;
	g.add(spin, fork, handle);
	g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
	g.userData.spin = spin;
	g.visible = false;
	return g;
}
