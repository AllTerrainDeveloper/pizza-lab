import * as THREE from 'three';

export const TAU = Math.PI * 2;

const ITEM_SIZE = { position: 3, normal: 3, color: 3, uv: 2 };

export function makeGeometry(attributes, index) {
	const g = new THREE.BufferGeometry();
	for (const [name, data] of Object.entries(attributes)) {
		g.setAttribute(name, new THREE.Float32BufferAttribute(data, ITEM_SIZE[name]));
	}
	if (index) g.setIndex(index);
	return g;
}

// Material.clone() drops the shader patch (see patch() in pizza.js), so carry it over.
export function cloneMaterial(m) {
	const c = m.clone();
	c.onBeforeCompile = m.onBeforeCompile;
	c.customProgramCacheKey = m.customProgramCacheKey;
	return c;
}
