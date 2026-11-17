// Składka w Statystykach i Porównaniach na dwa sposoby („podstawa”):
//  - składka zainkasowana (klucz 'inkaso'): opłacone raty w miesiącu terminu płatności — klient płaci zwykle co miesiąc,
//    więc składka rozkłada się na miesiące rat. Liczy się termin raty, nie dzień oznaczenia jej jako opłaconej: raty
//    rozliczane hurtem (noty prowizyjne, zaznaczenie wielu rat naraz) nie piętrzą się w miesiącu rozliczenia,
//  - składka przypisana (klucz 'przypis'): cała składka polisy w dniu początku ochrony (tak liczą Raporty i sprawozdanie
//    dla KNF).
// Prowizja od składki zainkasowanej: część prowizji polisy proporcjonalna do raty (tak samo wychodzi z not prowizyjnych).
import type { Policy, PolicyPayment } from './types/database.ts';
import { ROZLICZONE } from './platnosci.ts';

export type Podstawa = 'inkaso' | 'przypis';
/** Krótkie etykiety przełącznika (po słowie „Składka”). */
export const PODSTAWY: [Podstawa, string][] = [
	['inkaso', 'Zainkasowana'],
	['przypis', 'Przypisana']
];
/** d — dopełniacz („udział składki zainkasowanej”), m — miejscownik („udział w składce zainkasowanej”). */
export const OPIS_PODSTAWY: Record<Podstawa, { skladka: string; prowizja: string; polisy: string; zasada: string; d: string; m: string }> = {
	inkaso: {
		skladka: 'Składka zainkasowana',
		prowizja: 'Prowizja od składki zainkasowanej',
		polisy: 'Polisy z opłaconą ratą',
		zasada: 'opłacone raty w miesiącu terminu płatności',
		d: 'składki zainkasowanej',
		m: 'składce zainkasowanej'
	},
	przypis: {
		skladka: 'Składka przypisana',
		prowizja: 'Prowizja przypisana',
		polisy: 'Nowe polisy',
		zasada: 'cała składka polisy w miesiącu początku ochrony',
		d: 'składki przypisanej',
		m: 'składce przypisanej'
	}
};

type PolisaSkladki = Pick<Policy, 'id' | 'klient_id' | 'data_od' | 'skladka_przypisana' | 'prowizja_przypisana'>;
type RataSkladki = Pick<PolicyPayment, 'polisa_id' | 'status' | 'kwota' | 'data_oplacenia' | 'data_platnosci'>;

/** Kwota składki w dniu: opłacona rata (termin płatności, oplacona — data opłacenia) albo cała polisa (początek ochrony). */
export type Pozycja<P extends PolisaSkladki = Policy> = { p: P; kwota: number; prowizja: number; data: string; oplacona?: string | null };

/** Dzień, do którego liczy się opłacona rata: termin płatności, a gdy go nie ma — data opłacenia. */
export const dzienRaty = (r: Pick<PolicyPayment, 'data_oplacenia' | 'data_platnosci'>): string => (r.data_platnosci || r.data_oplacenia || '').slice(0, 10);

/** Składka przypisana: każda polisa raz, w dniu początku ochrony. */
export function pozycjePrzypisu<P extends PolisaSkladki>(polisy: P[]): Pozycja<P>[] {
	return polisy
		.filter((p) => !!p.data_od)
		.map((p) => ({ p, kwota: Number(p.skladka_przypisana ?? 0), prowizja: Number(p.prowizja_przypisana ?? 0), data: p.data_od.slice(0, 10) }));
}

/** Składka zainkasowana: opłacone raty polis z listy w dniu terminu (raty innych polis, np. umów generalnych, są pomijane). */
export function pozycjeInkasa<P extends PolisaSkladki>(polisy: P[], raty: RataSkladki[]): Pozycja<P>[] {
	const wg = new Map(polisy.map((p) => [p.id, p]));
	const out: Pozycja<P>[] = [];
	for (const r of raty) {
		const p = wg.get(r.polisa_id);
		if (!p || !ROZLICZONE.includes(r.status)) continue;
		const data = dzienRaty(r);
		if (!data) continue;
		const kwota = Number(r.kwota ?? 0);
		const skladka = Number(p.skladka_przypisana ?? 0);
		const oplacona = r.data_oplacenia ? r.data_oplacenia.slice(0, 10) : null;
		out.push({ p, kwota, prowizja: skladka ? (kwota * Number(p.prowizja_przypisana ?? 0)) / skladka : 0, data, oplacona });
	}
	return out;
}

export const wDniach = (data: string, o: { od: string; do: string }) => !!data && data >= o.od && data <= o.do;
export const pozycjeWOkresie = <P extends PolisaSkladki>(lista: Pozycja<P>[], o: { od: string; do: string }) => lista.filter((x) => wDniach(x.data, o));

/** polisy i klienci — liczba różnych (polisa z kilkoma ratami liczy się raz); pozycji — opłaconych rat albo polis. */
export type SumySkladki = { skladka: number; prowizja: number; polisy: number; klienci: number; pozycji: number };
export const zeroSkladki = (): SumySkladki => ({ skladka: 0, prowizja: 0, polisy: 0, klienci: 0, pozycji: 0 });

function licznik() {
	let skladka = 0;
	let prowizja = 0;
	let pozycji = 0;
	const polisy = new Set<string>();
	const klienci = new Set<string>();
	return {
		dodaj(x: Pozycja<PolisaSkladki>) {
			skladka += x.kwota;
			prowizja += x.prowizja;
			pozycji++;
			polisy.add(x.p.id);
			if (x.p.klient_id) klienci.add(x.p.klient_id);
		},
		wynik: (): SumySkladki => ({ skladka, prowizja, polisy: polisy.size, klienci: klienci.size, pozycji })
	};
}

export function sumujPozycje<P extends PolisaSkladki>(lista: Pozycja<P>[]): SumySkladki {
	const l = licznik();
	for (const x of lista) l.dodaj(x);
	return l.wynik();
}

export function grupujPozycje<K extends string, P extends PolisaSkladki>(lista: Pozycja<P>[], klucz: (p: P) => K | null | undefined): Map<K, SumySkladki> {
	const m = new Map<K, ReturnType<typeof licznik>>();
	for (const x of lista) {
		const k = klucz(x.p);
		if (k == null) continue;
		let l = m.get(k);
		if (!l) {
			l = licznik();
			m.set(k, l);
		}
		l.dodaj(x);
	}
	return new Map([...m].map(([k, l]) => [k, l.wynik()]));
}

/** Sumy w podanych miesiącach ('RRRR-MM'); pozycje spoza listy miesięcy są pomijane. */
export function miesiecznieSkladki<P extends PolisaSkladki>(lista: Pozycja<P>[], miesiace: string[]): { ym: string; s: SumySkladki }[] {
	const m = new Map(miesiace.map((ym) => [ym, licznik()]));
	for (const x of lista) m.get(x.data.slice(0, 7))?.dodaj(x);
	return [...m].map(([ym, l]) => ({ ym, s: l.wynik() }));
}
