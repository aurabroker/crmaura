// Eksport list do Excela (.xlsx): jeden plik, jeden albo kilka arkuszy. Liczby zostają liczbami (Excel
// je sumuje), kwoty mają format „1 234,56”, daty ISO (2026-11-02) i znaczniki czasu stają się datami
// Excela (02.11.2026), a nagłówek dostaje autofiltr.

export type Komorka = string | number | boolean | null | undefined;
export type FormatKolumny = 'zl' | 'liczba' | 'proc' | 'data' | 'tekst';
export type Kolumna = string | { naglowek: string; format: FormatKolumny };
export interface Arkusz {
	nazwa: string;
	kolumny: Kolumna[];
	wiersze: Komorka[][];
}

/** Opis kolumn: kol.zl('Składka'), kol.data('Od'), kol.proc('Prowizja %'), kol.liczba('Polisy'),
 *  kol.tekst('NIP') — tekst wprost (NIP, PESEL, numery), bez zamiany na liczbę czy datę. */
export const kol = {
	zl: (naglowek: string): Kolumna => ({ naglowek, format: 'zl' }),
	liczba: (naglowek: string): Kolumna => ({ naglowek, format: 'liczba' }),
	proc: (naglowek: string): Kolumna => ({ naglowek, format: 'proc' }),
	data: (naglowek: string): Kolumna => ({ naglowek, format: 'data' }),
	tekst: (naglowek: string): Kolumna => ({ naglowek, format: 'tekst' })
};

const ISO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_CZAS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DZIEN_MS = 86_400_000;
const EPOKA_EXCELA = Date.UTC(1899, 11, 30);

// Numer seryjny daty Excela liczony w UTC — bez przesunięć strefy czasowej.
const seryjnaDaty = (r: number, m: number, d: number) => (Date.UTC(r, m - 1, d) - EPOKA_EXCELA) / DZIEN_MS;
// Znacznik czasu z bazy (UTC) → data i godzina w strefie przeglądarki.
function seryjnaCzasu(iso: string): number | null {
	const t = new Date(iso);
	if (Number.isNaN(t.getTime())) return null;
	return seryjnaDaty(t.getFullYear(), t.getMonth() + 1, t.getDate()) + (t.getHours() * 3600 + t.getMinutes() * 60) / 86400;
}

const NUMERYCZNE: FormatKolumny[] = ['zl', 'liczba', 'proc'];
const FORMAT_LICZBY: Partial<Record<FormatKolumny, string>> = { zl: '#,##0.00', proc: '0.00' };

type Komorka_ = { t: 'n' | 's'; v: number | string; z?: string };
export function komorkaExcela(v: Komorka, format: FormatKolumny | null): Komorka_ | null {
	if (v == null || v === '') return null;
	if (typeof v === 'boolean') return { t: 's', v: v ? 'tak' : 'nie' };
	if (typeof v === 'number') return Number.isFinite(v) ? { t: 'n', v, z: format ? FORMAT_LICZBY[format] : undefined } : null;
	const s = String(v);
	if (format === 'tekst') return { t: 's', v: s };
	// Kwoty z bazy przychodzą jako tekst („212.00”) — w kolumnach liczbowych zamieniamy je na liczby.
	if (format && NUMERYCZNE.includes(format) && s.trim() !== '' && Number.isFinite(Number(s))) {
		return { t: 'n', v: Number(s), z: FORMAT_LICZBY[format] };
	}
	if (format === 'data' || format == null) {
		const d = ISO_DATA.exec(s);
		if (d) return { t: 'n', v: seryjnaDaty(Number(d[1]), Number(d[2]), Number(d[3])), z: 'dd.mm.yyyy' };
		if (ISO_CZAS.test(s)) {
			const n = seryjnaCzasu(s);
			if (n != null) return { t: 'n', v: n, z: 'dd.mm.yyyy hh:mm' };
		}
	}
	return { t: 's', v: s };
}

// Nazwa arkusza: do 31 znaków, bez []:*?/\ i niepowtarzalna w pliku.
function nazwaArkusza(n: string, uzyte: Set<string>): string {
	const baza = (n.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Arkusz').slice(0, 31);
	let wynik = baza;
	for (let i = 2; uzyte.has(wynik.toLowerCase()); i++) wynik = `${baza.slice(0, 31 - String(i).length - 1)} ${i}`;
	uzyte.add(wynik.toLowerCase());
	return wynik;
}

/** Nazwa pliku z dzisiejszą datą: polisy → polisy-2026-11-02.xlsx */
export function nazwaPlikuExcela(poczatek: string, dzis = new Date()): string {
	const d = `${dzis.getFullYear()}-${String(dzis.getMonth() + 1).padStart(2, '0')}-${String(dzis.getDate()).padStart(2, '0')}`;
	return `${poczatek}-${d}.xlsx`;
}

export async function pobierzExcel(plik: string, arkusze: Arkusz[]): Promise<void> {
	const XLSX = await import('xlsx');
	const wb = XLSX.utils.book_new();
	const uzyte = new Set<string>();
	for (const a of arkusze) {
		const naglowek = a.kolumny.map((k) => (typeof k === 'string' ? k : k.naglowek));
		const formaty = a.kolumny.map((k) => (typeof k === 'string' ? null : k.format));
		const ws: Record<string, unknown> = {};
		naglowek.forEach((h, c) => (ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: h }));
		const szer = naglowek.map((h) => h.length);
		a.wiersze.forEach((w, i) =>
			naglowek.forEach((_, c) => {
				const k = komorkaExcela(w[c], formaty[c]);
				if (!k) return;
				ws[XLSX.utils.encode_cell({ r: i + 1, c })] = k;
				const dl = k.z?.startsWith('dd') ? k.z.length : String(w[c]).length;
				if (dl > szer[c]) szer[c] = dl;
			})
		);
		const zakres = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: a.wiersze.length, c: Math.max(0, naglowek.length - 1) } });
		ws['!ref'] = zakres;
		ws['!cols'] = szer.map((s) => ({ wch: Math.min(60, s + 2) }));
		if (naglowek.length) ws['!autofilter'] = { ref: zakres };
		XLSX.utils.book_append_sheet(wb, ws as import('xlsx').WorkSheet, nazwaArkusza(a.nazwa, uzyte));
	}
	XLSX.writeFile(wb, plik);
}
