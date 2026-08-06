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

function groupIntoLines(words: Word[]): Line[] {
	const buckets = new Map<string, Word[]>();
	for (const w of words) {
		// Tolerancja 2pt — fragmenty jednego wiersza bywają przesunięte o ułamki punktu.
		const key = `${w.page}|${Math.round(w.y / 2)}`;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(w);
		else buckets.set(key, [w]);
	}
	return [...buckets.values()]
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
		.filter((l) => l.text)
		.sort((a, b) => a.page - b.page || b.y - a.y);
}
