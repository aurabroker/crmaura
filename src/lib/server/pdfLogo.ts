import type { jsPDF } from 'jspdf';
import { LOGO_SCIEZKI, LOGO_VIEWBOX } from '$lib/renewals/logo';

// Logo Beauty❤️Polisa w PDF jako grafika wektorowa (ostre przy każdym powiększeniu, bez pliku obrazu).
// Ścieżki SVG zamieniamy na polecenia PDF: odcinki i krzywe Béziera w bezwzględnych współrzędnych.

export type Odcinek = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

const LICZBA_ARG: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

/** Ścieżka SVG (atrybut d) → odcinki w bezwzględnych współrzędnych. Łuki (A) nie są obsługiwane. */
export function sciezkaSvg(d: string): Odcinek[] {
	const tokeny = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
	const out: Odcinek[] = [];
	let i = 0;
	let cmd = '';
	let x = 0, y = 0; // bieżący punkt
	let x0 = 0, y0 = 0; // początek podścieżki (dla Z)
	let kx: number | null = null, ky = 0; // drugi punkt kontrolny poprzedniej krzywej C/S (dla S)
	let qx: number | null = null, qy = 0; // punkt kontrolny poprzedniej krzywej Q/T (dla T)
	const liczba = () => {
		const t = tokeny[i++];
		const n = Number(t);
		if (t === undefined || /^[a-zA-Z]$/.test(t) || !Number.isFinite(n)) throw new Error(`Logo: błędna ścieżka SVG w pobliżu „${t}”`);
		return n;
	};
	const szescienna = (c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number) => {
		out.push(['C', c1x, c1y, c2x, c2y, ex, ey]);
		x = ex;
		y = ey;
	};

	while (i < tokeny.length) {
		if (/^[a-zA-Z]$/.test(tokeny[i])) cmd = tokeny[i++];
		else if (!cmd || cmd === 'Z' || cmd === 'z') throw new Error('Logo: liczby bez polecenia w ścieżce SVG');
		const W = cmd.toUpperCase();
		if (!(W in LICZBA_ARG)) throw new Error(`Logo: nieobsługiwane polecenie ścieżki „${cmd}”`);
		const wzgl = cmd !== W;
		const dx = wzgl ? x : 0, dy = wzgl ? y : 0;
		let nowyKx: number | null = null, nowyKy = 0, nowyQx: number | null = null, nowyQy = 0;

		switch (W) {
			case 'M': {
				x = liczba() + dx;
				y = liczba() + dy;
				x0 = x;
				y0 = y;
				out.push(['M', x, y]);
				// Kolejne pary po M to odcinki proste.
				cmd = wzgl ? 'l' : 'L';
				break;
			}
			case 'L':
				x = liczba() + dx;
				y = liczba() + dy;
				out.push(['L', x, y]);
				break;
			case 'H':
				x = liczba() + dx;
				out.push(['L', x, y]);
				break;
			case 'V':
				y = liczba() + dy;
				out.push(['L', x, y]);
				break;
			case 'C': {
				const c1x = liczba() + dx, c1y = liczba() + dy, c2x = liczba() + dx, c2y = liczba() + dy;
				szescienna(c1x, c1y, c2x, c2y, liczba() + dx, liczba() + dy);
				nowyKx = c2x;
				nowyKy = c2y;
				break;
			}
			case 'S': {
				// Pierwszy punkt kontrolny to odbicie drugiego punktu poprzedniej krzywej C/S.
				const c1x = kx === null ? x : 2 * x - kx, c1y = kx === null ? y : 2 * y - ky;
				const c2x = liczba() + dx, c2y = liczba() + dy;
				szescienna(c1x, c1y, c2x, c2y, liczba() + dx, liczba() + dy);
				nowyKx = c2x;
				nowyKy = c2y;
				break;
			}
			case 'Q':
			case 'T': {
				let px: number, py: number;
				if (W === 'Q') {
					px = liczba() + dx;
					py = liczba() + dy;
				} else {
					px = qx === null ? x : 2 * x - qx;
					py = qx === null ? y : 2 * y - qy;
				}
				const ex = liczba() + dx, ey = liczba() + dy;
				// Krzywa kwadratowa jako sześcienna.
				szescienna(x + (2 / 3) * (px - x), y + (2 / 3) * (py - y), ex + (2 / 3) * (px - ex), ey + (2 / 3) * (py - ey), ex, ey);
				nowyQx = px;
				nowyQy = py;
				break;
			}
			case 'Z':
				out.push(['Z']);
				x = x0;
				y = y0;
				break;
		}
		kx = nowyKx;
		ky = nowyKy;
		qx = nowyQx;
		qy = nowyQy;
	}
	return out;
}

let gotowe: { fill: [number, number, number]; odcinki: Odcinek[] }[] | null = null;
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16)) as [number, number, number];

/** Rysuje logo z lewym górnym rogiem w (x, y) i szerokością `szer` (jednostki dokumentu). Zwraca wysokość logo. */
export function rysujLogo(doc: jsPDF, x: number, y: number, szer: number): number {
	gotowe ??= LOGO_SCIEZKI.map((s) => ({ fill: rgb(s.fill), odcinki: sciezkaSvg(s.d) }));
	const k = szer / LOGO_VIEWBOX.szer;
	const poprzedni = doc.getFillColor();
	for (const s of gotowe) {
		doc.setFillColor(...s.fill);
		for (const o of s.odcinki) {
			if (o[0] === 'M') doc.moveTo(x + o[1] * k, y + o[2] * k);
			else if (o[0] === 'L') doc.lineTo(x + o[1] * k, y + o[2] * k);
			else if (o[0] === 'C') doc.curveTo(x + o[1] * k, y + o[2] * k, x + o[3] * k, y + o[4] * k, x + o[5] * k, y + o[6] * k);
			else doc.close();
		}
		// Reguła niezerowego nawinięcia — ta sama co domyślna w SVG (dziurki w literach).
		doc.fill();
	}
	doc.setFillColor(poprzedni);
	return LOGO_VIEWBOX.wys * k;
}
