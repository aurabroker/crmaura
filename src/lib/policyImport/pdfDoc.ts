// Model tekstu PDF z zachowaniem współrzędnych — bez zależności od pdf.js,
// dzięki czemu parsery szablonów da się uruchomić i testować poza przeglądarką.
// Polisy mają układ wielokolumnowy, więc samo sklejanie tekstu gubi przypisanie
// wartości do etykiet; pracujemy na słowach z pozycją X/Y.

export interface Word {
	page: number;
	x: number;
	y: number;
	text: string;
}

export interface Line {
	page: number;
	y: number;
	text: string;
	words: Word[];
}

export class PdfDoc {
	readonly words: Word[];
	readonly lines: Line[];
	readonly pageCount: number;
	readonly pageWidth: number;
	/** Cały dokument jako tekst, wiersz po wierszu. */
	readonly text: string;

	constructor(words: Word[], pageCount: number, pageWidth: number) {
		this.words = words;
		this.pageCount = pageCount;
		this.pageWidth = pageWidth;
		this.lines = groupIntoLines(words);
		this.text = this.lines.map((l) => l.text).join('\n');
	}

	/** Tekst wierszy spełniających warunek — do parsowania kolumn i sekcji. */
	textOf(pred: (w: Word) => boolean): string {
		return groupIntoLines(this.words.filter(pred))
			.map((l) => l.text)
			.join('\n');
	}

	/** Pierwsze słowo pasujące do wzorca — kotwica do wyliczania regionów. */
	findWord(needle: string | RegExp): Word | undefined {
		const test =
			typeof needle === 'string'
				? (t: string) => t.startsWith(needle)
				: (t: string) => needle.test(t);
		return this.words.find((w) => test(w.text));
	}

	/**
	 * Tekst z prostokątnego obszaru strony. Zakres Y liczony od linii bazowej
	 * w górę — PDF ma początek układu współrzędnych w lewym dolnym rogu.
	 */
	region(page: number, opts: { yFrom: number; yTo: number; xFrom?: number; xTo?: number }): string {
		const { yFrom, yTo, xFrom = -Infinity, xTo = Infinity } = opts;
		return this.textOf(
			(w) => w.page === page && w.y >= yFrom && w.y <= yTo && w.x >= xFrom && w.x <= xTo
		);
	}
}

/** Maksymalna różnica linii bazowych uznawana jeszcze za ten sam wiersz (pt). */
const TOLERANCJA_WIERSZA = 2.5;

/**
 * Grupuje słowa w wiersze po bliskości linii bazowej. Zaokrąglanie do stałych
 * kubełków tu nie wystarcza: fragmenty tego samego wiersza bywają przesunięte
 * o ułamki punktu i przy granicy kubełka rozpadałyby się na dwa wiersze.
 */
function groupIntoLines(words: Word[]): Line[] {
	const posortowane = [...words].sort((a, b) => a.page - b.page || b.y - a.y);
	const grupy: Word[][] = [];
	let biezaca: Word[] = [];
	let kotwica = 0;

	for (const w of posortowane) {
		const pasuje =
			biezaca.length > 0 &&
			biezaca[0].page === w.page &&
			Math.abs(kotwica - w.y) <= TOLERANCJA_WIERSZA;
		if (pasuje) {
			biezaca.push(w);
		} else {
			if (biezaca.length) grupy.push(biezaca);
			biezaca = [w];
			// Kotwicą jest pierwsze słowo wiersza — inaczej długi wiersz mógłby
			// "dryfować" i wciągać kolejny.
			kotwica = w.y;
		}
	}
	if (biezaca.length) grupy.push(biezaca);

	return grupy
		.map((ws) => {
			const sorted = [...ws].sort((a, b) => a.x - b.x);
			return {
				page: sorted[0].page,
				y: sorted[0].y,
				words: sorted,
				text: sorted
					.map((w) => w.text)
					.join(' ')
					.replace(/\s+/g, ' ')
					.trim()
			};
		})
		.filter((l) => l.text);
}
