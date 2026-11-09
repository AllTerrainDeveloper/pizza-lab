// Wood-fired dome oven with a living fire.
import * as THREE from 'three';
import { makeEmbers, makeSoftSprite } from './textures.js';
import { Noise } from './noise.js';

const NZ = new Noise(5);

export class Oven {
	constructor(scene, tex) {
		this.group = new THREE.Group();
		this.group.position.set(80, 0, 0);
		scene.add(this.group);
		const G = this.group;
		const R = 6, gap = THREE.MathUtils.degToRad(80);

		const brick = (rep, tint, extra = {}) => {
			const d = tex.brickDiff.clone(); d.repeat.set(rep[0], rep[1]); d.wrapS = d.wrapT = THREE.RepeatWrapping; d.needsUpdate = true;
			const n = tex.brickNorm.clone(); n.repeat.copy(d.repeat); n.wrapS = n.wrapT = THREE.RepeatWrapping; n.needsUpdate = true;
			return new THREE.MeshStandardMaterial({ map: d, normalMap: n, color: tint, roughness: 0.92, ...extra });
		};

		// dome (outside) with an opening facing +z
		const outer = new THREE.Mesh(
			new THREE.SphereGeometry(R, 96, 40, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, 0, Math.PI / 2),
			brick([7, 2.4], 0xd8a890)
		);
		outer.castShadow = outer.receiveShadow = true;
		G.add(outer);
		// sooty inside
		const inner = new THREE.Mesh(
			new THREE.SphereGeometry(R - 0.35, 96, 40, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, 0, Math.PI / 2),
			brick([7, 2.4], 0x4a3128, { side: THREE.BackSide, envMapIntensity: 0.25, emissive: 0x1a0700 })
		);
		inner.receiveShadow = true;
		G.add(inner);

		// cooking floor
		const floor = new THREE.Mesh(new THREE.CircleGeometry(R - 0.33, 96).rotateX(-Math.PI / 2), brick([3.2, 3.2], 0x9a8070, { envMapIntensity: 0.3 }));
		floor.position.y = 0.002;
		floor.receiveShadow = true;
		G.add(floor);

		// facade with arch
		const W = 4.7, H = 6.6, aw = 1.95, ah = 1.7;
		// The bevel pulls every edge of the opening inward by its size, which left a little brick sill across the
		// mouth that the pizza slid through. The opening reaches down by exactly the bevel, so its floor is flush
		// with the hearth; the facade itself runs on below ground (hidden in the base) to keep the outline valid.
		const bev = 0.08, sink = 0.6;
		const sh = new THREE.Shape();
		sh.moveTo(-W, -sink); sh.lineTo(W, -sink); sh.lineTo(W, H); sh.lineTo(-W, H); sh.lineTo(-W, -sink);
		const hole = new THREE.Path();
		hole.moveTo(-aw, -bev); hole.lineTo(-aw, ah); hole.absarc(0, ah, aw, Math.PI, 0, true); hole.lineTo(aw, -bev); hole.lineTo(-aw, -bev);
		sh.holes.push(hole);
		const facadeGeo = new THREE.ExtrudeGeometry(sh, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.08, bevelSize: bev, bevelSegments: 2, curveSegments: 40 });
		const facade = new THREE.Mesh(facadeGeo, brick([0.17, 0.17], 0xe2b39c));
		facade.position.z = 3.2;
		facade.castShadow = facade.receiveShadow = true;
		G.add(facade);
		// keystone arch trim
		const trim = new THREE.Mesh(new THREE.TorusGeometry(aw + 0.18, 0.2, 12, 48, Math.PI), brick([0.6, 3], 0xb58a72));
		trim.position.set(0, ah, 4.95);
		G.add(trim);
		// flue
		const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 3.5, 32), new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 0.7, roughness: 0.4 }));
		flue.position.set(0, H + 1.6, 3.9);
		G.add(flue);

		// base + landing ledge
		const stone = new THREE.MeshStandardMaterial({ color: 0x8f877e, roughness: 0.85 });
		const base = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 12), brick([2.5, 1.2], 0xb59585));
		base.position.set(0, -3.001, -0.5);
		base.receiveShadow = true;
		G.add(base);
		const ledge = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 6), brick([2.2, 1.3], 0x9c9188));
		ledge.position.set(0, -0.25, 7.6);
		ledge.receiveShadow = true;
		G.add(ledge);

		// logs with glowing cracks
		const emb = makeEmbers();
		const bark = tex.woodDiff.clone(); bark.repeat.set(0.35, 1.2); bark.needsUpdate = true;
		const barkN = tex.woodNorm.clone(); barkN.repeat.copy(bark.repeat); barkN.needsUpdate = true;
		const logMat = new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, color: 0x1c140f, roughness: 0.95, envMapIntensity: 0.2, emissive: 0xffffff, emissiveMap: emb, emissiveIntensity: 2.2 });
		const capMat = new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 1, emissive: 0xffffff, emissiveMap: emb, emissiveIntensity: 1.2 });
		this.logMat = logMat;
		const logs = [[-2.3, -3.4, 0.5], [-1.8, -3.9, -0.4], [-2.6, -2.9, 1.4], [-2.0, -3.3, 2.5]];
		for (const [x, z, ry] of logs) {
			const l = new THREE.Mesh(new THREE.CylinderGeometry(0.2 + Math.random() * 0.06, 0.25, 1.9, 18, 3).rotateZ(Math.PI / 2), [logMat, capMat, capMat]);
			l.position.set(x, 0.24, z);
			l.rotation.y = ry;
			l.castShadow = true;
			G.add(l);
		}
		// ember bed glow
		const glowTex = (() => {
			const c = document.createElement('canvas'); c.width = c.height = 128;
			const x = c.getContext('2d');
			const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
			g.addColorStop(0, 'rgba(255,160,60,1)'); g.addColorStop(0.4, 'rgba(255,80,10,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
			x.fillStyle = g; x.fillRect(0, 0, 128, 128);
			return new THREE.CanvasTexture(c);
		})();
		const bed = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff }));
		bed.position.set(-2.1, 0.02, -3.3);
		G.add(bed);
		this.bed = bed;

		// lights
		this.fire = new THREE.PointLight(0xff7a2a, 80, 16, 1.6);
		this.fire.position.set(-1.9, 2.2, -2.9);
		this.fire.castShadow = true;
		this.fire.shadow.mapSize.set(1024, 1024);
		this.fire.shadow.bias = -0.002;
		G.add(this.fire);
		this.fill = new THREE.PointLight(0xffa060, 18, 12, 1.5);
		this.fill.position.set(1.5, 3.5, 2.5);
		G.add(this.fill);

		// flames: additive point sprites
		// flames: noise-driven flame tongues on camera-facing cards, plus a few loose sparks
		this.fireMat = new THREE.ShaderMaterial({
			transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
			uniforms: { uTime: { value: 0 }, uSeed: { value: 0 } },
			vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
			fragmentShader: `
				varying vec2 vUv; uniform float uTime; uniform float uSeed;
				float h( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
				float n( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
					return mix( mix( h( i ), h( i + vec2( 1, 0 ) ), f.x ), mix( h( i + vec2( 0, 1 ) ), h( i + vec2( 1, 1 ) ), f.x ), f.y ); }
				float fbm( vec2 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 5; i ++ ) { s += a * n( p ); p *= 2.07; a *= 0.5; } return s; }
				void main() {
					vec2 uv = vUv;
					float t = uTime * 1.6 + uSeed * 10.0;
					// rising, wind-licked turbulence
					vec2 q = vec2( uv.x * 2.4 + uSeed * 3.0, uv.y * 2.0 - t );
					float turb = fbm( q + vec2( fbm( q * 1.7 + t * 0.3 ) * 0.8, 0.0 ) );
					float x = ( uv.x - 0.5 ) + ( turb - 0.5 ) * 0.62 * uv.y + sin( uv.y * 9.0 - t * 3.0 + uSeed * 20.0 ) * 0.035 * uv.y;
					// tear-drop body that narrows and breaks up toward the tips
					float width = mix( 0.42, 0.04, pow( uv.y, 0.8 ) );
					float body = 1.0 - smoothstep( width * 0.55, width, abs( x ) );
					float fl = body * smoothstep( 1.0, 0.25, uv.y + ( turb - 0.5 ) * 0.55 ) * smoothstep( 0.0, 0.08, uv.y );
					fl = clamp( fl * ( 0.55 + turb ), 0.0, 1.0 );
					// black-body-ish ramp: white-yellow core, orange body, deep red edges
					vec3 c = mix( vec3( 0.5, 0.05, 0.01 ), vec3( 1.0, 0.36, 0.04 ), smoothstep( 0.1, 0.5, fl ) );
					c = mix( c, vec3( 1.0, 0.72, 0.28 ), smoothstep( 0.66, 0.98, fl ) * ( 1.0 - uv.y ) );
					float a = smoothstep( 0.04, 0.3, fl );
					gl_FragColor = vec4( c * a * 0.62, a );
				}`,
		});
		this.flames = [];
		const spots = [[-2.1, -3.3, 1.5, 2.6], [-2.6, -3.0, 1.1, 2.0], [-1.6, -3.6, 1.1, 2.1], [-2.3, -3.8, 0.9, 1.7], [-1.8, -2.9, 0.9, 1.6]];
		spots.forEach(([x, z, w, h], i) => {
			const m = this.fireMat.clone();
			m.uniforms.uSeed.value = i * 0.37 + 0.1;
			const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), m);
			card.position.set(x, 0.18, z);
			card.renderOrder = 5;
			G.add(card);
			this.flames.push(card);
		});
		this.embers = this.makeParticles(90, 2);
		const soft = makeSoftSprite();
		this.smoke = [];
		for (let i = 0; i < 14; i++) {
			const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0x2b2420, transparent: true, depthWrite: false, opacity: 0 }));
			sp.userData = { ph: Math.random(), sp: 0.12 + Math.random() * 0.08, ox: (Math.random() - 0.5) * 1.2, rot: (Math.random() - 0.5) * 0.4 };
			G.add(sp);
			this.smoke.push(sp);
		}
		G.add(this.embers.points);

		this.center = new THREE.Vector3().copy(G.position);
		this.time = 0;
	}

	makeParticles(n, kind) {
		const geo = new THREE.BufferGeometry();
		const pos = new Float32Array(n * 3), life = new Float32Array(n), size = new Float32Array(n);
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
		geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
		const mat = new THREE.ShaderMaterial({
			transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
			uniforms: { uKind: { value: kind }, uPx: { value: Math.min(window.devicePixelRatio, 2) } },
			vertexShader: `
				attribute float aLife; attribute float aSize; varying float vLife; uniform float uPx;
				void main() {
					vLife = aLife;
					vec4 mv = modelViewMatrix * vec4( position, 1.0 );
					gl_PointSize = aSize * uPx * ( 420.0 / -mv.z ) * ( 1.0 - aLife * 0.55 );
					gl_Position = projectionMatrix * mv;
				}`,
			fragmentShader: `
				varying float vLife; uniform float uKind;
				void main() {
					float d = length( gl_PointCoord - 0.5 );
					float a = 1.0 - smoothstep( 0.0, 0.5, d );
					vec3 hot = vec3( 1.0, 0.74, 0.36 ) * 1.6;
					vec3 mid = vec3( 1.0, 0.36, 0.05 ) * 1.25;
					vec3 cold = vec3( 0.35, 0.05, 0.01 );
					vec3 c = mix( hot, mid, smoothstep( 0.0, 0.35, vLife ) );
					c = mix( c, cold, smoothstep( 0.45, 1.0, vLife ) );
					if ( uKind > 1.5 ) { c = vec3( 1.0, 0.55, 0.15 ) * 4.0; a = 1.0 - smoothstep( 0.1, 0.5, d ); }
					a *= ( 1.0 - vLife ) * ( uKind > 1.5 ? 1.0 : 0.5 );
					gl_FragColor = vec4( c * a, a );
				}`,
		});
		const pts = new THREE.Points(geo, mat);
		pts.frustumCulled = false;
		const vel = new Float32Array(n * 3), ttl = new Float32Array(n), age = new Float32Array(n);
		for (let i = 0; i < n; i++) { age[i] = Math.random(); ttl[i] = 1; life[i] = 1; }
		return { points: pts, n, vel, ttl, age, kind };
	}

	spawn(p, i) {
		const pos = p.points.geometry.attributes.position.array, size = p.points.geometry.attributes.aSize.array;
		const a = Math.random() * Math.PI * 2, r = Math.random() * 1.0;
		pos[i * 3] = -2.1 + Math.cos(a) * r * 1.1;
		pos[i * 3 + 1] = 0.35 + Math.random() * 0.2;
		pos[i * 3 + 2] = -3.3 + Math.sin(a) * r * 0.8;
		if (p.kind === 1) {
			p.vel[i * 3] = 0.35 + Math.random() * 0.4; p.vel[i * 3 + 1] = 2.2 + Math.random() * 1.6; p.vel[i * 3 + 2] = 0.45 + 0.4 * Math.random();
			p.ttl[i] = 0.55 + Math.random() * 0.75; size[i] = 0.6 + Math.random() * 0.8;
		} else {
			p.vel[i * 3] = (Math.random() - 0.2) * 1.4; p.vel[i * 3 + 1] = 1.5 + Math.random() * 2.5; p.vel[i * 3 + 2] = (Math.random() - 0.3) * 1.4;
			p.ttl[i] = 1.2 + Math.random() * 1.8; size[i] = 0.05 + Math.random() * 0.06;
		}
		p.age[i] = 0;
	}

	stepParticles(p, dt) {
		const pos = p.points.geometry.attributes.position.array, life = p.points.geometry.attributes.aLife.array;
		for (let i = 0; i < p.n; i++) {
			p.age[i] += dt;
			if (p.age[i] >= p.ttl[i]) this.spawn(p, i);
			const t = p.age[i] / p.ttl[i];
			life[i] = t;
			const y = pos[i * 3 + 1];
			// flames lick along the dome toward the centre and top
			const swirl = NZ.n3(pos[i * 3] * 0.8, y * 0.8, this.time * 1.5 + i) - 0.5;
			pos[i * 3] += (p.vel[i * 3] + swirl * 1.5) * dt * (0.4 + y * 0.25);
			pos[i * 3 + 1] += p.vel[i * 3 + 1] * dt * (1 - t * 0.4);
			pos[i * 3 + 2] += (p.vel[i * 3 + 2] + swirl) * dt;
			const rr = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
			if (rr > 5.3) { const k = 5.3 / rr; pos[i * 3] *= k; pos[i * 3 + 1] *= k; pos[i * 3 + 2] *= k; }
		}
		p.points.geometry.attributes.position.needsUpdate = true;
		p.points.geometry.attributes.aLife.needsUpdate = true;
		p.points.geometry.attributes.aSize.needsUpdate = true;
	}

	update(dt, active) {
		this.time += dt;
		if (!active) return;
		this.stepParticles(this.embers, dt);
		for (const sp of this.smoke) {
			const u = sp.userData;
			u.ph = (u.ph + dt * u.sp) % 1;
			const t = u.ph;
			// rises from the fire, then follows the dome curve toward the mouth
			sp.position.set(-2.0 + u.ox + t * 2.2, 1.6 + t * 3.0, -3.2 + t * 4.5);
			sp.scale.setScalar(1.2 + t * 2.6);
			sp.material.opacity = 0.32 * Math.sin(Math.PI * t);
			sp.material.rotation += u.rot * dt;
		}
		if (this.camera) {
			const cp = this.group.worldToLocal(this.camera.position.clone());
			for (const f of this.flames) {
				f.rotation.y = Math.atan2(cp.x - f.position.x, cp.z - f.position.z); // face the camera, stay upright
				f.material.uniforms.uTime.value = this.time;
			}
		}
		const t = this.time;
		const flick = 0.82 + 0.22 * NZ.n2(t * 7, 1) + 0.08 * Math.sin(t * 23);
		this.fire.intensity = 85 * (0.75 + 0.5 * (flick - 0.82));
		this.fire.position.x = -1.9 + (NZ.n2(t * 3, 5) - 0.5) * 0.4;
		this.logMat.emissiveIntensity = 1.8 + 0.8 * NZ.n2(t * 2, 9);
		this.bed.material.opacity = 0.8 + 0.2 * flick;
	}
}
