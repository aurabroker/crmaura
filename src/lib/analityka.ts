// Obliczenia dla ekranów Analityki (Statystyki, Porównania, Raporty). Tylko dane firmy zalogowanego
// użytkownika — to, co już jest w appState (RLS po stronie bazy). Polisy liczone według daty początku ochrony.
import type { Policy, PolicyPayment } from '$lib/types/database';
import { ROZLICZONE, poTerminie } from '$lib/platnosci';
import { dateDiffDays } from '$lib/utils';

// ── Kolory wykresów (sprawdzone walidatorem palety: CVD, kontrast, rampa porządkowa) ──
export const KOLOR = {
	seria: '#2453D6', // jedna seria — kolor akcentu
	seriaJasna: '#9AB2F0', // miesiąc w toku / poprzedni okres (ta sama barwa, jaśniejszy stopień)
	seria2: '#EB6834', // druga seria w zestawieniu dwóch miar (polisy vs przypis)
	rampa: ['#9AB2F0', '#6A8CE6', '#2453D6', '#1D44B3'], // etapy lejka (porządkowe)
	neutralny: '#7B8496',
	ok: '#067647',
	zly: '#B42318',
	siatka: '#EAEDF1',
	os: '#C4CAD4'
} as const;

// ── Okresy ──────────────────────────────────────────────────────────────────────
export type Okres = { od: string; do: string; etykieta: string };
export type PresetOkresu = 'rok' | '12m' | 'kwartal' | 'poprzedni-rok' | 'wszystko';
export const PRESETY: [PresetOkresu, string][] = [
	['rok', 'Od początku roku'],
	['12m', 'Ostatnie 12 miesięcy'],
	['kwartal', 'Bieżący kwartał'],
	['poprzedni-rok', 'Poprzedni rok'],
	['wszystko', 'Cała historia']
];

const MIES = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MIES_PELNE = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

const iso = (r: number, m: number, d: number) => `${r}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ostatniDzien = (r: number, m: number) => new Date(Date.UTC(r, m, 0)).getUTCDate();

export function dzien(isoData: string, zRokiem = true): string {
	const [r, m, d] = isoData.split('-').map(Number);
	return `${d} ${MIES[m - 1]}${zRokiem ? ` ${r}` : ''}`;
}

export function okresZPresetu(p: PresetOkresu, dzis: string, najstarsza?: string | null): Okres {
	const [r, m] = dzis.split('-').map(Number);
	const zakres = (od: string, doo: string, nazwa: string): Okres => ({ od, do: doo, etykieta: `${nazwa} · ${dzien(od, od.slice(0, 4) !== doo.slice(0, 4))} – ${dzien(doo)}` });
	switch (p) {
		case 'rok':
			return zakres(iso(r, 1, 1), dzis, 'Od początku roku');
		case '12m': {
			const od = m === 12 ? iso(r, 1, 1) : iso(r - 1, m + 1, 1);
			return zakres(od, dzis, 'Ostatnie 12 miesięcy');
		}
		case 'kwartal': {
			const q = Math.floor((m - 1) / 3);
			return zakres(iso(r, q * 3 + 1, 1), dzis, 'Bieżący kwartał');
		}
		case 'poprzedni-rok':
			return zakres(iso(r - 1, 1, 1), iso(r - 1, 12, 31), `Rok ${r - 1}`);
		case 'wszystko':
			return zakres(najstarsza && najstarsza < dzis ? najstarsza : iso(r, 1, 1), dzis, 'Cała historia');
	}
}

/** Ten sam okres przesunięty o rok wstecz (do porównania r/r). */
export function rokWczesniej(o: Okres): Okres {
	const cof = (d: string) => {
		const [r, m, dd] = d.split('-').map(Number);
		return iso(r - 1, m, Math.min(dd, ostatniDzien(r - 1, m)));
	};
	return { od: cof(o.od), do: cof(o.do), etykieta: 'rok wcześniej' };
}

/** Okres o tej samej długości tuż przed podanym (np. poprzedni kwartał). */
export function poprzedniOkres(o: Okres, etykieta = 'poprzedni okres'): Okres {
	const dni = dateDiffDays(o.od, o.do);
	const koniec = new Date(o.od + 'T00:00:00Z');
	koniec.setUTCDate(koniec.getUTCDate() - 1);
	const poczatek = new Date(koniec);
	poczatek.setUTCDate(poczatek.getUTCDate() - dni);
	return { od: poczatek.toISOString().slice(0, 10), do: koniec.toISOString().slice(0, 10), etykieta };
}

export const wOkresie = (d: string | null | undefined, o: Okres) => !!d && d >= o.od && d <= o.do;

/** Miesiące okresu jako 'YYYY-MM'. */
export function miesiace(o: Okres): string[] {
	const out: string[] = [];
	let [r, m] = o.od.split('-').map(Number);
	const [rk, mk] = o.do.split('-').map(Number);
	while (r < rk || (r === rk && m <= mk)) {
		out.push(`${r}-${String(m).padStart(2, '0')}`);
		m++;
		if (m > 12) { m = 1; r++; }
	}
	return out;
}
export const miesiacKrotko = (ym: string, zRokiem = false) => `${MIES[Number(ym.slice(5, 7)) - 1]}${zRokiem ? ` ${ym.slice(2, 4)}` : ''}`;
export const miesiacPelny = (ym: string) => `${MIES_PELNE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// ── Agregacje ───────────────────────────────────────────────────────────────────
export type Sumy = { przypis: number; prowizja: number; polisy: number };
export const zero = (): Sumy => ({ przypis: 0, prowizja: 0, polisy: 0 });
export const liczonaPolisa = (p: Policy) => p.typ_umowy !== 'generalna'; // umowa generalna to ramka, przypis jest na polisach pod nią

export function sumuj(polisy: Policy[]): Sumy {
	const s = zero();
	for (const p of polisy) {
		s.przypis += Number(p.skladka_przypisana ?? 0);
		s.prowizja += Number(p.prowizja_przypisana ?? 0);
		s.polisy++;
	}
	return s;
}

export function miesiecznie(polisy: Policy[], o: Okres): { ym: string; s: Sumy }[] {
	const m = new Map(miesiace(o).map((ym) => [ym, zero()]));
	for (const p of polisy) {
		const s = m.get(p.data_od?.slice(0, 7) ?? '');
		if (!s) continue;
		s.przypis += Number(p.skladka_przypisana ?? 0);
		s.prowizja += Number(p.prowizja_przypisana ?? 0);
		s.polisy++;
	}
	return [...m].map(([ym, s]) => ({ ym, s }));
}

export function grupuj<K extends string>(polisy: Policy[], klucz: (p: Policy) => K | null | undefined): Map<K, Sumy & { klienci: Set<string> }> {
	const m = new Map<K, Sumy & { klienci: Set<string> }>();
	for (const p of polisy) {
		const k = klucz(p);
		if (k == null) continue;
		let s = m.get(k);
		if (!s) { s = { ...zero(), klienci: new Set() }; m.set(k, s); }
		s.przypis += Number(p.skladka_przypisana ?? 0);
		s.prowizja += Number(p.prowizja_przypisana ?? 0);
		s.polisy++;
		if (p.klient_id) s.klienci.add(p.klient_id);
	}
	return m;
}

export function mediana(v: number[]): number {
	if (!v.length) return 0;
	const s = [...v].sort((a, b) => a - b);
	const i = Math.floor(s.length / 2);
	return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

// ── Raty ────────────────────────────────────────────────────────────────────────
export type StanRat = { oplacone: Sumy; przed: Sumy; po: Sumy };
/** Raty według stanu na dziś: opłacone / przed terminem / po terminie (status liczony z daty, jak w Płatnościach). */
export function stanRat(raty: PolicyPayment[], dzis: string, ug: Set<string>): StanRat {
	const w: StanRat = { oplacone: zero(), przed: zero(), po: zero() };
	for (const r of raty) {
		if (ug.has(r.polisa_id)) continue;
		const k = ROZLICZONE.includes(r.status) ? 'oplacone' : poTerminie(r, dzis, ug) ? 'po' : 'przed';
		w[k].przypis += Number(r.kwota ?? 0);
		w[k].polisy++;
	}
	return w;
}

export const KUBELKI_ZALEGLOSCI: [string, number, number][] = [['1–30 dni', 1, 30], ['31–90 dni', 31, 90], ['ponad 90 dni', 91, Infinity]];

/** Kolumna wykresu (komponent wykresy/Kolumny). jasna = miesiąc w toku albo okres poprzedni. */
export type Kolumna = { klucz: string; etykieta: string; pelna: string; wartosc: number; dodatek?: string; jasna?: boolean };

// ── Formatowanie i osie ─────────────────────────────────────────────────────────
export const zl = (n: number) => `${Math.round(n).toLocaleString('pl-PL')} zł`;
export const liczba = (n: number) => Math.round(n).toLocaleString('pl-PL');
export const proc = (n: number, miejsc = 1) => `${(Number.isFinite(n) ? n : 0).toLocaleString('pl-PL', { minimumFractionDigits: miejsc, maximumFractionDigits: miejsc })}%`;
export function zlKrotko(n: number): string {
	const a = Math.abs(n);
	if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mln zł`;
	if (a >= 10_000) return `${Math.round(n / 1000).toLocaleString('pl-PL')} tys. zł`;
	return zl(n);
}
export function zmiana(teraz: number, wczesniej: number): number | null {
	if (!wczesniej) return null;
	return ((teraz - wczesniej) / Math.abs(wczesniej)) * 100;
}

/** Czytelne podziałki osi: 0 i 4–5 równych kroków (1/2/2,5/5 × 10^n). */
export function podzialki(max: number): { gora: number; kroki: number[] } {
	if (max <= 0) return { gora: 1, kroki: [0, 1] };
	const cel = max / 4;
	const p = Math.pow(10, Math.floor(Math.log10(cel)));
	const krok = [1, 2, 2.5, 5, 10].map((x) => x * p).find((x) => x >= cel) ?? 10 * p;
	const gora = Math.ceil(max / krok) * krok;
	const kroki: number[] = [];
	for (let t = 0; t <= gora + krok / 1000; t += krok) kroki.push(Math.round(t * 1000) / 1000);
	return { gora, kroki };
}
export function etykietaOsi(v: number, pieniadze: boolean): string {
	if (!pieniadze) return liczba(v);
	if (v === 0) return '0';
	if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mln`;
	if (v >= 1000) return `${(v / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} tys.`;
	return liczba(v);
}

// ── Eksport ─────────────────────────────────────────────────────────────────────
export function pobierzCsv(nazwa: string, naglowek: string[], wiersze: (string | number | null | undefined)[][]) {
	const pole = (v: string | number | null | undefined) => {
		const t = v == null ? '' : String(v);
		return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
	};
	const tresc = '﻿' + [naglowek, ...wiersze].map((w) => w.map(pole).join(';')).join('\r\n');
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([tresc], { type: 'text/csv;charset=utf-8' }));
	a.download = nazwa;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function pobierzXlsx(nazwa: string, arkusz: string, naglowek: string[], wiersze: (string | number | null | undefined)[][]) {
	const XLSX = await import('xlsx');
	const ws = XLSX.utils.aoa_to_sheet([naglowek, ...wiersze.map((w) => w.map((v) => v ?? ''))]);
	ws['!cols'] = naglowek.map((h, i) => ({ wch: Math.min(48, Math.max(h.length, ...wiersze.map((w) => String(w[i] ?? '').length)) + 2) }));
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, arkusz.slice(0, 31));
	XLSX.writeFile(wb, nazwa);
}
