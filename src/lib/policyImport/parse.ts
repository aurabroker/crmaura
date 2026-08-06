// Konwersje wartości spotykanych na polisach oraz walidacja identyfikatorów.

/** "3 016,50" / "3 016" / "3.016,50" → 3016.5 */
export function toAmount(raw: string | null | undefined): number | null {
	if (!raw) return null;
	const cleaned = raw
		.replace(/ /g, ' ')
		.replace(/zł|PLN/gi, '')
		.replace(/\s/g, '')
		.replace(/\.(?=\d{3}\b)/g, '')
		.replace(',', '.')
		.trim();
	if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
	const n = parseFloat(cleaned);
	return Number.isFinite(n) ? n : null;
}

/** "06.08.2026" albo "2026-08-06" → "2026-08-06" */
export function toDate(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const s = raw.trim();
	let m = s.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
	if (m) return `${m[3]}-${m[2]}-${m[1]}`;
	m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (m) return s;
	return null;
}

export function digits(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const d = raw.replace(/\D/g, '');
	return d || null;
}

export function isValidNip(raw: string | null | undefined): boolean {
	const nip = digits(raw);
	if (!nip || nip.length !== 10) return false;
	const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
	const sum = weights.reduce((acc, w, i) => acc + w * Number(nip[i]), 0);
	const control = sum % 11;
	return control !== 10 && control === Number(nip[9]);
}

export function isValidRegon(raw: string | null | undefined): boolean {
	const regon = digits(raw);
	if (!regon) return false;
	const check = (value: string, weights: number[]) => {
		const sum = weights.reduce((acc, w, i) => acc + w * Number(value[i]), 0);
		const control = sum % 11;
		return (control === 10 ? 0 : control) === Number(value[weights.length]);
	};
	if (regon.length === 9) return check(regon, [8, 9, 2, 3, 4, 5, 6, 7]);
	// REGON 14-znakowy zawiera w sobie poprawny 9-znakowy.
	if (regon.length === 14)
		return (
			check(regon.slice(0, 9), [8, 9, 2, 3, 4, 5, 6, 7]) &&
			check(regon, [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8])
		);
	return false;
}

/** Pierwsza grupa pierwszego dopasowania albo null. */
export function grab(text: string, re: RegExp, group = 1): string | null {
	const m = text.match(re);
	return m?.[group]?.trim() || null;
}

/** Wszystkie dopasowania jako tablica grup. */
export function grabAll(text: string, re: RegExp): RegExpMatchArray[] {
	return [...text.matchAll(re)];
}

export function collapse(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const s = raw.replace(/\s+/g, ' ').trim();
	return s || null;
}
