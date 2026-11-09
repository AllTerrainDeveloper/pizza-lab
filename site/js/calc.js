// The Size Showdown: is one big pizza a better deal than two medium ones?

export const PRESETS = {
	familiar: { unit: 'cm', cur: '€', A: ['Familiar', 40, 1, 18], B: ['Medium', 30, 2, 12] },
	meme: { unit: 'in', cur: '$', A: ['18″ pizza', 18, 1, 22], B: ['12″ pizza', 12, 2, 14] },
	large: { unit: 'cm', cur: '€', A: ['Large', 36, 1, 15], B: ['Small', 26, 2, 8.5] },
	party: { unit: 'cm', cur: '€', A: ['XXL', 50, 1, 29], B: ['Medium', 30, 3, 11] },
};

const KCAL_PER_CM2 = 1.25; // a typical cheese pizza: ~250 kcal / 100 g, ~0.5 g per cm²

export function compute(s) {
	const crust = s.crustOn ? s.crustW : 0;
	const r = (d) => Math.max(0, d / 2 - crust);
	const one = (d) => Math.PI * r(d) ** 2;
	const full = (d) => Math.PI * (d / 2) ** 2;
	const mk = (o) => ({ ...o, r: r(o.d), one: one(o.d), area: o.q * one(o.d), full: o.q * full(o.d), cost: o.q * o.p });
	const A = mk(s.A), B = mk(s.B);
	for (const o of [A, B]) o.ppa = o.area > 0 ? o.cost / o.area : Infinity;
	const valid = A.d > 0 && B.d > 0 && A.p > 0 && B.p > 0 && A.area > 0 && B.area > 0;
	const winner = !valid || Math.abs(A.ppa - B.ppa) / Math.max(A.ppa, B.ppa) < 0.005 ? null : A.ppa < B.ppa ? 'A' : 'B';
	const lo = Math.min(A.ppa, B.ppa), hi = Math.max(A.ppa, B.ppa);
	const cheaper = valid ? (1 - lo / hi) * 100 : 0;
	// diameter each A pizza would need so that all of A equals all of B
	const dEq = 2 * (Math.sqrt(B.area / (A.q * Math.PI)) + crust);
	const fairA = valid ? (A.area * (B.cost / B.area)) / A.q : 0;
	const cm2 = s.unit === 'in' ? 6.4516 : 1;
	// crust share of one pizza for a typical rim (the chosen crust width, or 2.5 cm / 1 in)
	const cw = s.crustOn ? s.crustW : s.unit === 'in' ? 1 : 2.5;
	const share = (d) => (d / 2 > 0 ? 1 - Math.max(0, d / 2 - cw) ** 2 / (d / 2) ** 2 : 0);
	return {
		A, B, valid, winner, cheaper, dEq, fairA, crust, cw,
		kcalA: A.full * cm2 * KCAL_PER_CM2, kcalB: B.full * cm2 * KCAL_PER_CM2,
		shareA: share(A.d), shareB: share(B.d),
	};
}

const sig = (n, k = 4) => (isFinite(n) ? Number(n.toPrecision(k)).toLocaleString(undefined, { maximumSignificantDigits: k }) : '–');
const fmt = (n, d = 0) => (isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');

export function render(s, r) {
	const u = s.unit, ua = u === 'in' ? 'in²' : 'cm²';
	const per = u === 'in' ? 10 : 100;
	const money = (v) => s.cur + fmt(v, 2);
	const nm = (o) => (o.q > 1 ? `${o.q}× ${o.name}` : o.name);
	if (!r.valid) {
		const why = !(r.A.d > 0 && r.B.d > 0) ? 'Enter a diameter for both options.'
			: !(r.A.p > 0 && r.B.p > 0) ? 'Enter a price above zero for both options (free pizza wins every time 🍕).'
			: 'The crust is wider than the radius, so there’s no topping area left. Make the crust narrower.';
		return `<div class="verdict tie">${why}</div>`;
	}
	const maxA = Math.max(r.A.area, r.B.area);
	const big = r.A.area >= r.B.area ? r.A : r.B, small = big === r.A ? r.B : r.A;
	const morePct = (big.area / small.area - 1) * 100;
	const W = r.winner ? r[r.winner] : null, L = W === r.A ? r.B : r.A;
	const verdict = !W
		? `<div class="verdict tie">Dead heat: both cost the same per bite. Pick by appetite!</div>`
		: `<div class="verdict win-${r.winner}"><span class="crown" aria-hidden="true">♛</span> <b>${nm(W)}</b> is the better deal: <b>${fmt(r.cheaper, 1)}% cheaper</b> per bite${W === big && morePct >= 0.05 ? ' <i>and</i> more pizza' : ''}. <a href="#" class="jump">See how ↓</a></div>`;
	const bar = (o, k) => `
		<div class="bar bar-${k}">
			<div class="bar-label"><span>${nm(o)}</span><span>${fmt(o.area, 0)} ${ua}</span></div>
			<div class="bar-track"><div class="bar-fill" style="width:${(o.area / maxA) * 100}%"></div></div>
			<div class="bar-meta">${money(o.cost)} total · <b>${money(o.ppa * per)}</b> per ${per} ${ua}</div>
		</div>`;

	// ---- the worked explanation, with the user's own numbers
	const A = r.A, B = r.B, c = r.crust;
	const rad = (o) => (c ? `(${sig(o.d)} ÷ 2 − ${sig(c)})` : `(${sig(o.d)} ÷ 2)`);
	const ratioD = A.d / B.d, ratioA = ratioD * ratioD;
	const wider = (ratioD - 1) * 100;
	const step = (n, title, body) => `<li><h4><span>${n}</span>${title}</h4>${body}</li>`;
	const eq = (x) => `<div class="eq">${x}</div>`;
	const steps = [
		step(1, 'Area of one pizza', `
			${eq(`area = π × r²${c ? `, with r = d ÷ 2 − crust` : `, with r = d ÷ 2`}`)}
			<p>${A.name}: π × ${rad(A)}² = π × ${sig(A.r)}² = <b>${fmt(A.one, 1)} ${ua}</b><br>
			${B.name}: π × ${rad(B)}² = π × ${sig(B.r)}² = <b>${fmt(B.one, 1)} ${ua}</b></p>
			${c ? `<p class="note">Crust ignored: we only count the part with toppings.</p>` : ''}`),
		step(2, 'Total pizza in each order', `
			<p>A: ${A.q} × ${fmt(A.one, 1)} = <b>${fmt(A.area, 1)} ${ua}</b><br>
			B: ${B.q} × ${fmt(B.one, 1)} = <b>${fmt(B.area, 1)} ${ua}</b></p>
			<p class="note">${morePct < 0.05 ? 'Both orders give the same amount of pizza.' : `${nm(big)} has <b>${fmt(morePct, 1)}% more pizza</b> (${fmt(big.area, 1)} ÷ ${fmt(small.area, 1)} = ${sig(big.area / small.area)}×).`}</p>`),
		step(3, `Price per ${per} ${ua}`, `
			${eq(`price per ${per} ${ua} = total price ÷ total area × ${per}`)}
			<p>A: ${money(A.cost)} ÷ ${fmt(A.area, 1)} × ${per} = <b>${s.cur}${sig(A.ppa * per, 5)}</b><br>
			B: ${money(B.cost)} ÷ ${fmt(B.area, 1)} × ${per} = <b>${s.cur}${sig(B.ppa * per, 5)}</b></p>
			<p class="note">Shown to 5 significant figures so you can redo the maths; the bars above round to cents.</p>`),
		step(4, 'Who wins', W ? `
			${eq(`saving = 1 − cheaper rate ÷ dearer rate`)}
			<p>1 − ${s.cur}${sig(W.ppa * per, 5)} ÷ ${s.cur}${sig(L.ppa * per, 5)} = <b>${fmt(r.cheaper, 1)}%</b> less money for the same amount of pizza with ${nm(W)}.</p>` : `<p>Both rates are within half a percent: it’s a tie.</p>`),
		step(5, 'Why the menu fools you', `
			${eq(`area grows with the square of the diameter`)}
			${(() => {
				const bigD = A.d >= B.d ? A : B, smallD = bigD === A ? B : A;
				const k = bigD.d / smallD.d, k2 = k * k;
				if (Math.abs(k - 1) < 0.005) return `<p>Both pizzas have the same diameter, so only the count and price matter here.</p>`;
				return `<p>One ${bigD.name} is ${sig(k)}× the diameter of one ${smallD.name} (${fmt((k - 1) * 100, 1)}% wider), so it holds ${sig(k)}² = <b>${sig(k2)}×</b> as much pizza${c ? ' before removing the crust' : ''}. Adding more pizzas only multiplies linearly (${B.q > 1 || A.q > 1 ? `here ×${Math.max(A.q, B.q)}` : '×1'}): size scales with the square, count does not. ${W ? `In this match-up that makes <b>${nm(W)}</b> the better deal.` : 'In this match-up it evens out exactly.'}</p>`;
			})()}`),
		step(6, `How big would ${A.q > 1 ? 'each' : 'one'} ${A.name} need to be?`, `
			${eq(`d = 2 × (√(total B ÷ ${A.q > 1 ? `(${A.q} × π)` : 'π'})${c ? ' + crust' : ''})`)}
			<p>2 × (√(${fmt(B.area, 1)} ÷ ${A.q > 1 ? `(${A.q} × 3.1416)` : '3.1416'})${c ? ` + ${fmt(c, 1)}` : ''}) = <b>⌀ ${fmt(r.dEq, 1)} ${u}</b> to equal ${nm(B)}. It actually is ⌀ ${fmt(A.d, 1)} ${u}${A.d >= r.dEq ? ', so it already gives you more.' : ', so it falls short.'}</p>`),
		step(7, `A fair price for the ${A.name}`, `
			${eq(`fair price = area of A × (B’s price ÷ B’s area)`)}
			<p>${fmt(A.one, 1)} × (${money(B.cost)} ÷ ${fmt(B.area, 1)}) = <b>${money(r.fairA)}</b> per ${A.name}. You pay ${money(A.p)}: ${A.p <= r.fairA ? `a bargain, <b>${money(r.fairA - A.p)} under</b> B’s rate` : `overpriced by <b>${money(A.p - r.fairA)}</b> compared with B’s rate`}.</p>`),
		step(8, 'Crust share (the edge nobody fights over)', `
			${eq(`crust share = 1 − ((r − crust) ÷ r)²`)}
			<p>With a ${fmt(r.cw, 1)} ${u} rim: ${A.name} is <b>${r.shareA >= 0.995 ? 'all crust' : fmt(r.shareA * 100, 0) + '%'}</b> crust, ${B.name} is <b>${r.shareB >= 0.995 ? 'all crust' : fmt(r.shareB * 100, 0) + '%'}</b>. The crust is a ring of fixed width, so bigger pizzas waste proportionally less on it.</p>`),
	].join('');

	return `
		${verdict}
		${bar(A, 'A')}
		${bar(B, 'B')}
		${svg(s, r)}
		<ul class="facts">
			<li>${morePct < 0.05 ? 'Both orders give <b>the same amount of pizza</b>.' : `<b>${nm(big)}</b> gives you <b>${fmt(morePct, 1)}% more pizza</b>${c ? ' (not counting crust)' : ''}.`}</li>
			<li>One ${A.name} would need <b>⌀ ${fmt(r.dEq, 1)} ${u}</b> to match ${nm(B)}${A.q > 1 ? ' (each)' : ''}.</li>
			<li>Fair price for ${A.q > 1 ? 'each' : 'the'} ${A.name} at ${B.name} rates: <b>${money(r.fairA)}</b>.</li>
			<li>Energy check: ≈ <b>${fmt(r.kcalA, 0)}</b> vs <b>${fmt(r.kcalB, 0)}</b> kcal <span class="muted">(whole pizzas incl. crust, ≈${KCAL_PER_CM2} kcal per cm²)</span>.</li>
		</ul>
		<details class="explain" open>
			<summary>How it’s calculated, step by step</summary>
			<ol class="steps">${steps}</ol>
		</details>`;
}

function svg(s, r) {
	const Wd = 320, H = 130;
	const layout = (q) => {
		const cols = Math.ceil(Math.sqrt(q)), rows = Math.ceil(q / cols);
		return { cols, rows };
	};
	const la = layout(r.A.q), lb = layout(r.B.q);
	const wA = la.cols * r.A.d, hA = la.rows * r.A.d, wB = lb.cols * r.B.d, hB = lb.rows * r.B.d;
	const eq = r.A.q === 1 ? r.dEq : 0;
	const k = Math.min((Wd - 40) / (Math.max(wA, eq) + wB), (H - 14) / Math.max(hA, hB, eq));
	const circles = (o, l, x0) => {
		let out = '';
		for (let i = 0; i < o.q; i++) {
			const c = i % l.cols, rr = Math.floor(i / l.cols);
			const cx = x0 + (c + 0.5) * o.d * k, cy = H / 2 + (rr - (l.rows - 1) / 2) * o.d * k;
			out += `<circle cx="${cx}" cy="${cy}" r="${(o.d / 2) * k - 1}" fill="url(#pz)" stroke="#a8642c" stroke-width="${Math.max(2, o.d * k * 0.07)}"/>`;
		}
		return out;
	};
	const xA = 10 + Math.max(0, (eq - r.A.d) / 2) * k, xB = Wd - 10 - wB * k;
	let ring = '';
	if (eq) {
		const cx = xA + (r.A.d / 2) * k;
		ring = `<circle cx="${cx}" cy="${H / 2}" r="${(eq / 2) * k}" fill="none" stroke="var(--cheese)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
	}
	return `
	<figure class="mini-wrap">
		<svg class="mini" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Both orders drawn to scale">
			<defs><radialGradient id="pz"><stop offset="0" stop-color="#f6d58a"/><stop offset="0.75" stop-color="#e9a94f"/><stop offset="1" stop-color="#c7612c"/></radialGradient></defs>
			${circles(r.A, la, xA)}${ring}
			${circles(r.B, lb, xB)}
			<text x="6" y="${H - 3}" class="mini-t">A</text><text x="${Wd - 14}" y="${H - 3}" class="mini-t">B</text>
		</svg>
		<figcaption>Drawn to scale.${eq ? ' Dashed ring: the size A would need to match B.' : ''}</figcaption>
	</figure>`;
}
