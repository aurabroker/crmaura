// Filtr listy polis po czasie: która data polisy (początek ochrony, koniec ochrony, data zawarcia) albo „ochrona w okresie”
// (okres ubezpieczenia ma choć jeden wspólny dzień z zakresem — np. polisy, które chroniły w październiku), zakres z gotowych
// okresów (ten miesiąc, poprzedni kwartał, ten rok…) albo własny. Puste „od” albo „do” = zakres otwarty z tej strony.
import type { Policy } from './types/database.ts';
import { koniecOchrony, plusDni } from './statusPolisy.ts';

export type PoleOkresu = 'od' | 'do' | 'ochrona' | 'zawarcia';
export const POLA_OKRESU: [PoleOkresu, string][] = [
	['od', 'Początek ochrony'],
	['do', 'Koniec ochrony'],
	['ochrona', 'Ochrona w okresie'],
	['zawarcia', 'Data zawarcia']
];
export const ETYKIETA_POLA: Record<PoleOkresu, string> = Object.fromEntries(POLA_OKRESU) as Record<PoleOkresu, string>;

export type GotowyOkres =
	| 'ten_miesiac'
	| 'poprzedni_miesiac'
	| 'nastepny_miesiac'
	| 'ten_kwartal'
	| 'poprzedni_kwartal'
	| 'ten_rok'
	| 'poprzedni_rok'
	| 'ostatnie_30'
	| 'nastepne_30';
export const GOTOWE_OKRESY: [GotowyOkres, string][] = [
	['ten_miesiac', 'Ten miesiąc'],
	['poprzedni_miesiac', 'Poprzedni miesiąc'],
	['nastepny_miesiac', 'Następny miesiąc'],
	['ten_kwartal', 'Ten kwartał'],
	['poprzedni_kwartal', 'Poprzedni kwartał'],
	['ten_rok', 'Ten rok'],
	['poprzedni_rok', 'Poprzedni rok'],
	['ostatnie_30', 'Ostatnie 30 dni'],
	['nastepne_30', 'Następne 30 dni']
];

export type Zakres = { od: string; do: string };

const dzien = (r: number, m: number, d: number) => new Date(Date.UTC(r, m, d)).toISOString().slice(0, 10);
/** Miesiąc „m” (0–11, może wyjść poza rok) roku „r”: pierwszy i ostatni dzień. */
const miesiace = (r: number, m: number, ile: number): Zakres => ({ od: dzien(r, m, 1), do: dzien(r, m + ile, 0) });

/** Daty gotowego okresu względem dziś (miesiące i kwartały kalendarzowe). */
export function zakresOkresu(o: GotowyOkres, dzis: string): Zakres {
	const r = Number(dzis.slice(0, 4));
	const m = Number(dzis.slice(5, 7)) - 1;
	const kw = m - (m % 3);
	switch (o) {
		case 'ten_miesiac':
			return miesiace(r, m, 1);
		case 'poprzedni_miesiac':
			return miesiace(r, m - 1, 1);
		case 'nastepny_miesiac':
			return miesiace(r, m + 1, 1);
		case 'ten_kwartal':
			return miesiace(r, kw, 3);
		case 'poprzedni_kwartal':
			return miesiace(r, kw - 3, 3);
		case 'ten_rok':
			return miesiace(r, 0, 12);
		case 'poprzedni_rok':
			return miesiace(r - 1, 0, 12);
		case 'ostatnie_30':
			return { od: plusDni(dzis, -29), do: dzis };
		case 'nastepne_30':
			return { od: dzis, do: plusDni(dzis, 29) };
	}
}

/** Gotowy okres, którego daty to dokładnie ten zakres (do podpisu filtra), albo null. */
export function rozpoznajOkres(z: Zakres, dzis: string): GotowyOkres | null {
	return GOTOWE_OKRESY.find(([o]) => {
		const g = zakresOkresu(o, dzis);
		return g.od === z.od && g.do === z.do;
	})?.[0] ?? null;
}

type PolisaDaty = Pick<Policy, 'data_od' | 'data_do' | 'zakonczona_od' | 'data_zawarcia'>;

/** Czy polisa spełnia filtr okresu. Polisa bez wybranej daty (np. bez daty zawarcia) nie spełnia filtru z zakresem. */
export function polisaWOkresie(p: PolisaDaty, pole: PoleOkresu, z: Zakres): boolean {
	if (!z.od && !z.do) return true;
	if (pole === 'ochrona') {
		// Okres ubezpieczenia [data_od, koniec ochrony] ma wspólny dzień z zakresem; bez końca = bezterminowo.
		const koniec = koniecOchrony(p);
		return (!z.do || !p.data_od || p.data_od <= z.do) && (!z.od || !koniec || koniec >= z.od);
	}
	const d = (pole === 'od' ? p.data_od : pole === 'do' ? p.data_do : p.data_zawarcia)?.slice(0, 10);
	if (!d) return false;
	return (!z.od || d >= z.od) && (!z.do || d <= z.do);
}

const MIESIACE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const pelna = (iso: string) => `${Number(iso.slice(8, 10))} ${MIESIACE[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Podpis zakresu: „Ten miesiąc”, „od 1 października 2026”, „1 października 2026 – 31 grudnia 2026”. */
export function opisZakresu(z: Zakres, dzis: string): string {
	const gotowy = rozpoznajOkres(z, dzis);
	if (gotowy) return GOTOWE_OKRESY.find(([o]) => o === gotowy)![1].toLowerCase();
	if (z.od && z.do) return z.od === z.do ? pelna(z.od) : `${pelna(z.od)} – ${pelna(z.do)}`;
	if (z.od) return `od ${pelna(z.od)}`;
	if (z.do) return `do ${pelna(z.do)}`;
	return '';
}
