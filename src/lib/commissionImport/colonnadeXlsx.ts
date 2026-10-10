// Zestawienie prowizyjne Colonnade (portal Cellent) — XLSX, jeden arkusz, jedna pozycja = jedna rata
// opłacona albo zwrócona w okresie raportu. Kolumny rozpoznajemy po nagłówkach (kolejność może się
// zmienić), pod tabelą jest wiersz z samą sumą prowizji.
//
// Nagłówki (stan z noty NP-01/002905/05/2026): Nazwa Pośrednika · Numer Pośrednika · Imię i nazwisko
// pracownika Pośrednika · Nr polisy · Początek okresu ubezpieczenia · Koniec okresu ubezpieczenia ·
// Nazwa ubezpieczającego · Status · Data opłacenia lub zwrotu składki · Liczba rat · Numer opłaconej raty ·
// Status płatności · Kwota wpłaty / zwrotu [PLN] · Wynagrodzenie prowizyjne [%] · Wynagrodzenie
// prowizyjne [PLN] · Okres raportu · Data wygenerowania raportu.
// Numer noty jest tylko w nazwie pliku: NP-01_002905_05_2026_zestawienie_… → NP-01/002905/05/2026.

export type ColonnadePozycja = {
	nr_polisy: string;
	ubezpieczajacy: string;
	nr_raty: number | null;
	liczba_rat: number | null;
	data_oplacenia: string | null; // YYYY-MM-DD
	status_platnosci: string; // np. „opłacona”, „zwrot”
	kwota: number; // ujemna przy zwrocie
	prowizja_pct: number | null;
	prowizja: number; // ujemna przy zwrocie
};

export type ColonnadeZestawienie = {
	numer: string;
	okres: string | null; // YYYY-MM
	data_wygenerowania: string | null; // YYYY-MM-DD
	posrednik: string | null;
	pozycje: ColonnadePozycja[];
	razem_kwota: number;
	razem_prowizja: number;
	ostrzezenia: string[];
};

type Komorka = string | number | boolean | Date | null | undefined;

const norm = (s: Komorka) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Data z komórki: liczba Excela (dni od 1899-12-30), Date albo tekst DD.MM.RRRR / RRRR-MM-DD. */
export function dataZKomorki(v: Komorka): string | null {
	if (v == null || v === '') return null;
	if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
	if (typeof v === 'number' && v > 20000 && v < 80000) {
		return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
	}
	const t = String(v).trim();
	let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	m = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
	if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
	return null;
}

/** Kwota z komórki: liczba albo tekst „1 612,00” / „1612.00”. */
export function kwotaZKomorki(v: Komorka): number {
	if (typeof v === 'number') return v;
	const t = String(v ?? '').replace(/\s|zł|pln/gi, '').replace(',', '.');
	const n = parseFloat(t);
	return Number.isFinite(n) ? n : 0;
}

/** Numer noty z nazwy pliku: „NP-01_002905_05_2026_zestawienie_AURA.xlsx” → „NP-01/002905/05/2026”. */
export function numerZNazwyPliku(nazwa: string): string | null {
	const m = nazwa.match(/(NP-\d+)[_\s-]+(\d{4,})[_\s-]+(\d{2})[_\s-]+(\d{4})/i);
	return m ? `${m[1].toUpperCase()}/${m[2]}/${m[3]}/${m[4]}` : null;
}

const KOLUMNY = {
	nr_polisy: (h: string) => h === 'nr polisy' || h.startsWith('numer polisy'),
	ubezpieczajacy: (h: string) => h.includes('ubezpieczającego'),
	data_oplacenia: (h: string) => h.startsWith('data opłacenia'),
	liczba_rat: (h: string) => h === 'liczba rat',
	nr_raty: (h: string) => h.includes('numer opłaconej raty') || h === 'nr raty',
	status_platnosci: (h: string) => h === 'status płatności',
	kwota: (h: string) => h.startsWith('kwota wpłaty') || h.startsWith('kwota'),
	prowizja_pct: (h: string) => h.includes('prowizyjne') && h.includes('[%]'),
	prowizja: (h: string) => h.includes('prowizyjne') && h.includes('[pln]'),
	okres: (h: string) => h === 'okres raportu',
	wygenerowano: (h: string) => h.startsWith('data wygenerowania'),
	posrednik: (h: string) => h === 'nazwa pośrednika'
} as const;
type Klucz = keyof typeof KOLUMNY;

export function parseColonnade(wiersze: Komorka[][], nazwaPliku: string): ColonnadeZestawienie {
	const ostrzezenia: string[] = [];
	const iNaglowka = wiersze.findIndex((w) => w.some((k) => KOLUMNY.nr_polisy(norm(k))) && w.some((k) => KOLUMNY.prowizja(norm(k))));
	if (iNaglowka < 0) throw new Error('To nie wygląda na zestawienie Colonnade — brak nagłówków „Nr polisy” i „Wynagrodzenie prowizyjne [PLN]”.');
	const naglowek = wiersze[iNaglowka].map(norm);
	const kol = {} as Record<Klucz, number>;
	for (const k of Object.keys(KOLUMNY) as Klucz[]) kol[k] = naglowek.findIndex((h) => KOLUMNY[k](h));
	for (const k of ['nr_polisy', 'kwota', 'prowizja'] as Klucz[]) {
		if (kol[k] < 0) throw new Error(`Brak kolumny „${k.replace('_', ' ')}” w zestawieniu Colonnade.`);
	}
	const z = (w: Komorka[], k: Klucz) => (kol[k] >= 0 ? w[kol[k]] : null);

	const pozycje: ColonnadePozycja[] = [];
	let sumaZPliku: number | null = null;
	let okres: string | null = null;
	let wygenerowano: string | null = null;
	let posrednik: string | null = null;
	for (const w of wiersze.slice(iNaglowka + 1)) {
		const nr = String(z(w, 'nr_polisy') ?? '').trim();
		if (!nr) {
			// Wiersz z samą sumą prowizji pod tabelą
			const s = z(w, 'prowizja');
			if (s !== null && s !== '' && sumaZPliku === null) sumaZPliku = kwotaZKomorki(s);
			continue;
		}
		const status = norm(z(w, 'status_platnosci'));
		const kwota = kwotaZKomorki(z(w, 'kwota'));
		const prowizja = kwotaZKomorki(z(w, 'prowizja'));
		const zwrot = status.includes('zwrot');
		pozycje.push({
			nr_polisy: nr.replace(/\.0+$/, ''),
			ubezpieczajacy: String(z(w, 'ubezpieczajacy') ?? '').trim(),
			nr_raty: Number(z(w, 'nr_raty')) || null,
			liczba_rat: Number(z(w, 'liczba_rat')) || null,
			data_oplacenia: dataZKomorki(z(w, 'data_oplacenia')),
			status_platnosci: status || 'opłacona',
			// Zwrot zawsze ze znakiem minus, nawet gdy plik podaje kwotę dodatnią
			kwota: zwrot ? -Math.abs(kwota) : kwota,
			prowizja: zwrot ? -Math.abs(prowizja) : prowizja,
			prowizja_pct: z(w, 'prowizja_pct') != null && z(w, 'prowizja_pct') !== '' ? kwotaZKomorki(z(w, 'prowizja_pct')) : null
		});
		okres ??= dataZKomorki(z(w, 'okres'))?.slice(0, 7) ?? null;
		wygenerowano ??= dataZKomorki(z(w, 'wygenerowano'));
		posrednik ??= String(z(w, 'posrednik') ?? '').trim() || null;
	}
	if (!pozycje.length) throw new Error('Zestawienie Colonnade nie ma żadnej pozycji.');

	const razem_kwota = Math.round(pozycje.reduce((s, p) => s + p.kwota, 0) * 100) / 100;
	const razem_prowizja = Math.round(pozycje.reduce((s, p) => s + p.prowizja, 0) * 100) / 100;
	if (sumaZPliku !== null && Math.abs(sumaZPliku - razem_prowizja) > 0.01) {
		ostrzezenia.push(`Suma prowizji w pliku (${sumaZPliku.toFixed(2)} zł) różni się od sumy pozycji (${razem_prowizja.toFixed(2)} zł).`);
	}
	for (const p of pozycje) {
		if (p.prowizja_pct != null && Math.abs(Math.abs(p.kwota) * p.prowizja_pct / 100 - Math.abs(p.prowizja)) > 0.02) {
			ostrzezenia.push(`Polisa ${p.nr_polisy}: prowizja ${p.prowizja.toFixed(2)} zł nie odpowiada ${p.prowizja_pct}% od ${p.kwota.toFixed(2)} zł.`);
		}
	}

	let numer = numerZNazwyPliku(nazwaPliku);
	if (!numer) {
		numer = `COLONNADE/${okres ?? wygenerowano ?? 'bez-daty'}`;
		ostrzezenia.push(`Nie rozpoznano numeru noty w nazwie pliku — zapisuję jako „${numer}”. Pobierz plik z portalu bez zmiany nazwy.`);
	}
	return { numer, okres, data_wygenerowania: wygenerowano, posrednik, pozycje, razem_kwota, razem_prowizja, ostrzezenia };
}
