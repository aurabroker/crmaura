// Sortowanie tabel po kliknięciu w nagłówek kolumny. Jedna instancja na tabelę:
//   const sort = new Sortowanie<Policy>({ nr: (p) => p.nr_polisy, do: (p) => p.data_do }, { klucz: 'nr' }, 'polisy');
//   {#each sort.sortuj(wiersze) as p} … <SortTh s={sort} k="nr">Nr polisy</SortTh>
// Puste wartości zawsze na końcu; tekst po polsku (ą, ł, ż…), liczby w tekście naturalnie (2 < 10).

export type Kierunek = 'asc' | 'desc';
export type Wartosc = string | number | boolean | Date | null | undefined;
export type Kolumny<T> = Record<string, (wiersz: T) => Wartosc>;

const kolator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });

function pusta(v: Wartosc): boolean {
	return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

export function porownaj(a: Wartosc, b: Wartosc): number {
	if (a instanceof Date) a = a.getTime();
	if (b instanceof Date) b = b.getTime();
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
	return kolator.compare(String(a), String(b));
}

export class Sortowanie<T> {
	klucz = $state<string | null>(null);
	kierunek = $state<Kierunek>('asc');
	readonly #kolumny: Kolumny<T>;
	readonly #pamiec: string | null;

	constructor(kolumny: Kolumny<T>, domyslnie?: { klucz: string; kierunek?: Kierunek }, pamiec?: string) {
		this.#kolumny = kolumny;
		this.#pamiec = pamiec ? `crm-sort:${pamiec}` : null;
		if (domyslnie) {
			this.klucz = domyslnie.klucz;
			this.kierunek = domyslnie.kierunek ?? 'asc';
		}
		// Ostatnie sortowanie tej tabeli (ta przeglądarka) — wygoda, nie wymóg.
		if (this.#pamiec) {
			try {
				const z = JSON.parse(localStorage.getItem(this.#pamiec) ?? 'null') as { k?: unknown; d?: unknown } | null;
				if (z && typeof z.k === 'string' && z.k in kolumny && (z.d === 'asc' || z.d === 'desc')) {
					this.klucz = z.k;
					this.kierunek = z.d;
				}
			} catch {
				/* brak dostępu do localStorage — zostaje domyślne */
			}
		}
	}

	/** Kliknięcie w nagłówek: ta sama kolumna odwraca kierunek, inna sortuje rosnąco. */
	przelacz(klucz: string) {
		if (!(klucz in this.#kolumny)) return;
		if (this.klucz === klucz) this.kierunek = this.kierunek === 'asc' ? 'desc' : 'asc';
		else {
			this.klucz = klucz;
			this.kierunek = 'asc';
		}
		if (this.#pamiec) {
			try {
				localStorage.setItem(this.#pamiec, JSON.stringify({ k: this.klucz, d: this.kierunek }));
			} catch {
				/* noop */
			}
		}
	}

	/** Posortowana kopia (oryginalna tablica bez zmian); przy remisie zostaje kolejność wejściowa. */
	sortuj(wiersze: readonly T[]): T[] {
		const f = this.klucz ? this.#kolumny[this.klucz] : undefined;
		if (!f) return [...wiersze];
		const znak = this.kierunek === 'asc' ? 1 : -1;
		return wiersze
			.map((w, i) => ({ w, i, v: f(w) }))
			.sort((a, b) => {
				const pa = pusta(a.v);
				const pb = pusta(b.v);
				if (pa || pb) return pa === pb ? a.i - b.i : pa ? 1 : -1;
				return porownaj(a.v, b.v) * znak || a.i - b.i;
			})
			.map((x) => x.w);
	}

	aria(klucz: string): 'ascending' | 'descending' | 'none' {
		return this.klucz === klucz ? (this.kierunek === 'asc' ? 'ascending' : 'descending') : 'none';
	}
}
