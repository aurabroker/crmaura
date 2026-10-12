// Zestawienie do noty księgowej Leadenhall / Squarelife — XLSX, jeden arkusz, jedna pozycja = jedna rata
// opłacona w okresie noty. Kolumny rozpoznajemy po nagłówkach (wcześniej import czytał je po numerach
// i pomijał datę wpłaty, przez co porównywał prowizję z jednej raty z prowizją za całą polisę).
// „Nr raty składki” NIE jest numerem kolejnej raty: ta sama polisa ma 12 przy pierwszej wpłacie
// (N/362/11/2025) i przy wpłacie po dziewięciu miesiącach (N/710/08/2026). Odczytujemy go tylko
// informacyjnie — import dobiera ratę w CRM po dacie wpłaty.
//
// Tytuł w A1: „Zestawienie do noty księgowej nr N/710/08/2026”. Nagłówki (stan z noty N/710/08/2026):
// Polisa · Nr wniosku · Status polisy · Ubezpieczający · Produkt · Przypis z polisy · Data zawarcia polisy ·
// Data początku ochrony · Data końca ochrony · Liczba rat składki · Data dodania płatności ·
// Data płatności składki · Nr raty składki · Składka · Procent prowizji · Prowizja · Nazwa pośrednika ·
// Pracownik · PESEL Pracownika. Procent prowizji jest ułamkiem (0,2 = 20%).
// Nazwiska są zapisane encjami XML w komórkach typu „str” — przed parsowaniem trzeba je odczytać
// przez naprawKomorkiStr (xlsxNaprawa.ts), bo SheetJS psuje w nich polskie litery.
import { dataZKomorki, kwotaZKomorki } from './colonnadeXlsx';

export type LeadenhallPozycja = {
	nr_polisy: string;
	ubezpieczajacy: string;
	produkt: string | null;
	przypis: number | null; // składka roczna z polisy
	data_od: string | null; // początek ochrony
	data_do: string | null; // koniec ochrony
	liczba_rat: number | null;
	nr_raty: number | null;
	data_platnosci: string | null; // YYYY-MM-DD — data płatności składki
	skladka: number; // kwota raty
	prowizja_pct: number | null; // w procentach (20, nie 0,2)
	prowizja: number;
};

export type LeadenhallNota = {
	numer: string;
	pozycje: LeadenhallPozycja[];
	razem_skladka: number;
	razem_prowizja: number;
	okres: string | null; // YYYY-MM z numeru noty
	ostrzezenia: string[];
};

type Komorka = string | number | boolean | Date | null | undefined;
const norm = (s: Komorka) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const KOLUMNY = {
	nr_polisy: (h: string) => h === 'polisa' || h === 'nr polisy' || h === 'numer polisy',
	ubezpieczajacy: (h: string) => h.startsWith('ubezpieczający'),
	produkt: (h: string) => h === 'produkt',
	przypis: (h: string) => h.startsWith('przypis'),
	data_od: (h: string) => h.startsWith('data początku'),
	data_do: (h: string) => h.startsWith('data końca'),
	liczba_rat: (h: string) => h.startsWith('liczba rat'),
	data_platnosci: (h: string) => h.startsWith('data płatności'),
	nr_raty: (h: string) => h.startsWith('nr raty') || h.startsWith('numer raty'),
	skladka: (h: string) => h === 'składka',
	prowizja_pct: (h: string) => h.startsWith('procent prowizji') || h === 'prowizja %' || h === '% prowizji',
	prowizja: (h: string) => h === 'prowizja'
} as const;
type Klucz = keyof typeof KOLUMNY;

export function parseLeadenhall(wiersze: Komorka[][]): LeadenhallNota {
	const ostrzezenia: string[] = [];
	const tytul = wiersze.slice(0, 5).map((w) => String(w?.[0] ?? '')).find((t) => /nr\s+[A-Z0-9]/i.test(t)) ?? '';
	const numer = tytul.match(/nr\s+([A-Z0-9][A-Z0-9/\-]*)/i)?.[1] ?? '';

	const iNaglowka = wiersze.findIndex((w) => w.some((k) => KOLUMNY.nr_polisy(norm(k))) && w.some((k) => KOLUMNY.prowizja(norm(k))));
	if (iNaglowka < 0) throw new Error('To nie wygląda na zestawienie Leadenhall — brak nagłówków „Polisa” i „Prowizja”.');
	const naglowek = wiersze[iNaglowka].map(norm);
	const kol = {} as Record<Klucz, number>;
	for (const k of Object.keys(KOLUMNY) as Klucz[]) kol[k] = naglowek.findIndex((h) => KOLUMNY[k](h));
	for (const [k, nazwa] of [['nr_polisy', 'Polisa'], ['skladka', 'Składka'], ['prowizja', 'Prowizja']] as [Klucz, string][]) {
		if (kol[k] < 0) throw new Error(`Brak kolumny „${nazwa}” w zestawieniu Leadenhall.`);
	}
	if (kol.data_platnosci < 0) ostrzezenia.push('W pliku nie ma kolumny „Data płatności składki” — raty zostaną dobrane po kwocie, od najstarszej nierozliczonej.');
	const z = (w: Komorka[], k: Klucz) => (kol[k] >= 0 ? w[kol[k]] : null);
	const liczba = (v: Komorka) => (v == null || v === '' ? null : Number(String(v).replace(',', '.')) || null);

	const pozycje: LeadenhallPozycja[] = [];
	for (const w of wiersze.slice(iNaglowka + 1)) {
		const nr = String(z(w, 'nr_polisy') ?? '').trim();
		if (!nr || /^razem|^suma/i.test(nr)) continue;
		const pctSurowy = z(w, 'prowizja_pct');
		let pct = pctSurowy == null || pctSurowy === '' ? null : kwotaZKomorki(String(pctSurowy).replace('%', ''));
		if (pct != null && Math.abs(pct) <= 1) pct = Math.round(pct * 10000) / 100; // 0,2 → 20
		const przypis = z(w, 'przypis');
		pozycje.push({
			nr_polisy: nr,
			ubezpieczajacy: String(z(w, 'ubezpieczajacy') ?? '').trim(),
			produkt: String(z(w, 'produkt') ?? '').trim() || null,
			przypis: przypis == null || przypis === '' ? null : kwotaZKomorki(przypis),
			data_od: dataZKomorki(z(w, 'data_od')),
			data_do: dataZKomorki(z(w, 'data_do')),
			liczba_rat: liczba(z(w, 'liczba_rat')),
			nr_raty: liczba(z(w, 'nr_raty')),
			data_platnosci: dataZKomorki(z(w, 'data_platnosci')),
			skladka: kwotaZKomorki(z(w, 'skladka')),
			prowizja_pct: pct,
			prowizja: kwotaZKomorki(z(w, 'prowizja'))
		});
	}
	if (!pozycje.length) throw new Error('Zestawienie Leadenhall nie ma żadnej pozycji.');
	if (!numer) ostrzezenia.push('Nie rozpoznano numeru noty w tytule zestawienia (komórka A1).');

	for (const p of pozycje) {
		if (p.prowizja_pct != null && Math.abs(Math.abs(p.skladka) * p.prowizja_pct / 100 - Math.abs(p.prowizja)) > 0.02) {
			ostrzezenia.push(`Polisa ${p.nr_polisy}: prowizja ${p.prowizja.toFixed(2)} zł nie odpowiada ${p.prowizja_pct}% od ${p.skladka.toFixed(2)} zł.`);
		}
	}
	const okres = numer.match(/\/(\d{2})\/(\d{4})$/);
	return {
		numer,
		pozycje,
		razem_skladka: Math.round(pozycje.reduce((s, p) => s + p.skladka, 0) * 100) / 100,
		razem_prowizja: Math.round(pozycje.reduce((s, p) => s + p.prowizja, 0) * 100) / 100,
		okres: okres ? `${okres[2]}-${okres[1]}` : null,
		ostrzezenia
	};
}
