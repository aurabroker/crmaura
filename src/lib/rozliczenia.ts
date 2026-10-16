// Rozliczenia prowizji na poziomie rat: każda rata składki ma swoją prowizję oczekiwaną (kwota × stawka polisy),
// a rozliczenie to rata opłacona z noty TU (prowizja_z_noty) albo oznaczona ręcznie. Trigger bazy
// (recalc_policy_zainkasowane) sumuje te kwoty do polisy, więc rata jest jedynym źródłem prawdy.
import type { Policy, PolicyPayment } from '$lib/types/database';
import { ROZLICZONE, poTerminie, ugBezRozliczania } from '$lib/platnosci';
import { dateDiffDays } from '$lib/utils';

export type StanRaty = 'nota' | 'oplacona' | 'po_terminie' | 'oczekujaca';

export const STAN_RATY_ETYKIETA: Record<StanRaty, string> = {
	nota: 'Rozliczona z noty',
	oplacona: 'Opłacona bez noty',
	po_terminie: 'Po terminie',
	oczekujaca: 'Oczekująca'
};

/** Różnica prowizji z noty wobec oczekiwanej, od której pokazujemy rozjazd (jak alerty przy imporcie noty). */
export const PROG_ROZJAZDU = 0.5;

export const zaokr = (n: number) => Math.round(n * 100) / 100;

/** Prowizja należna za ratę wg stawki polisy. */
export const prowizjaOczekiwana = (kwota: number, pct: number) => zaokr((Number(kwota) || 0) * (Number(pct) || 0) / 100);

export type PolisaRaty = Pick<Policy, 'id' | 'klient_id' | 'nr_polisy' | 'rodzaj' | 'prowizja_pct' | 'ilosc_rat' | 'typ_umowy' | 'rozliczaj_platnosci' | 'rozliczenie_status' | 'rozliczenie_kwota_tu' | 'deleted_at' | 'crm_insurers' | 'crm_clients'>;

export type WierszRaty = {
	rata: PolicyPayment;
	polisa: PolisaRaty | null;
	klient: string;
	tu: string;
	/** Liczba rat polisy (do opisu „2/4”). */
	rat: number;
	pct: number;
	oczekiwana: number;
	rozliczona: boolean;
	/** Prowizja zaliczona za ratę: z noty, a bez noty — wg stawki (tak liczy trigger bazy). */
	zaliczona: number;
	/** Prowizja z noty minus oczekiwana (tylko raty z noty). */
	roznica: number | null;
	rozjazd: boolean;
	stan: StanRaty;
	dni: number;
};

/**
 * Wiersze rozliczeń z rat w pamięci CRM. Pomija raty umów generalnych bez rozliczania płatności (informacyjne)
 * i raty polis z kosza.
 */
export function wierszeRozliczen(payments: PolicyPayment[], policies: PolisaRaty[], dzis: string): WierszRaty[] {
	const polisaWg = new Map(policies.map((p) => [p.id, p]));
	const ug = ugBezRozliczania(policies as Pick<Policy, 'id' | 'typ_umowy' | 'rozliczaj_platnosci'>[]);
	const out: WierszRaty[] = [];
	for (const r of payments) {
		if (ug.has(r.polisa_id)) continue;
		const p = polisaWg.get(r.polisa_id) ?? null;
		if (p?.deleted_at) continue;
		const pct = Number(p?.prowizja_pct ?? 0) || 0;
		const oczekiwana = prowizjaOczekiwana(r.kwota, pct);
		const rozliczona = ROZLICZONE.includes(r.status);
		const zNoty = rozliczona && r.prowizja_z_noty != null ? zaokr(Number(r.prowizja_z_noty)) : null;
		const zaliczona = rozliczona ? (zNoty ?? oczekiwana) : 0;
		const roznica = zNoty != null ? zaokr(zNoty - oczekiwana) : null;
		const stan: StanRaty = rozliczona ? (r.nota_id || zNoty != null ? 'nota' : 'oplacona') : poTerminie(r, dzis, ug) ? 'po_terminie' : 'oczekujaca';
		out.push({
			rata: r,
			polisa: p,
			klient: r.crm_policies?.crm_clients?.nazwa ?? p?.crm_clients?.nazwa ?? '—',
			tu: p?.crm_insurers?.skrot ?? p?.crm_insurers?.nazwa ?? '—',
			rat: parseInt(p?.ilosc_rat ?? '1') || 1,
			pct,
			oczekiwana,
			rozliczona,
			zaliczona,
			roznica,
			rozjazd: roznica != null && Math.abs(roznica) > PROG_ROZJAZDU,
			stan,
			dni: dateDiffDays(dzis, r.data_platnosci)
		});
	}
	return out;
}

export type Okres = 'miesiac' | 'poprzedni' | 'kwartal' | 'rok' | 'wszystko' | `${number}-${string}`;

export const OKRESY: { val: Okres; label: string }[] = [
	{ val: 'miesiac', label: 'Ten miesiąc' },
	{ val: 'poprzedni', label: 'Poprzedni miesiąc' },
	{ val: 'kwartal', label: 'Bieżący kwartał' },
	{ val: 'rok', label: 'Ten rok' },
	{ val: 'wszystko', label: 'Wszystkie terminy' }
];

const ostatniDzien = (rok: number, miesiac1: number) => new Date(Date.UTC(rok, miesiac1, 0)).toISOString().slice(0, 10);
const pierwszy = (rok: number, miesiac1: number) => `${rok}-${String(miesiac1).padStart(2, '0')}-01`;

/** Zakres terminów rat dla okresu (null = bez ograniczenia). Okres „RRRR-MM” to wybrany miesiąc. */
export function zakresOkresu(okres: Okres, dzis: string): { od: string; do: string } | null {
	const rok = Number(dzis.slice(0, 4));
	const m = Number(dzis.slice(5, 7));
	if (okres === 'wszystko') return null;
	if (okres === 'miesiac') return { od: pierwszy(rok, m), do: ostatniDzien(rok, m) };
	if (okres === 'poprzedni') {
		const r = m === 1 ? rok - 1 : rok;
		const pm = m === 1 ? 12 : m - 1;
		return { od: pierwszy(r, pm), do: ostatniDzien(r, pm) };
	}
	if (okres === 'kwartal') {
		const q = Math.floor((m - 1) / 3) * 3 + 1;
		return { od: pierwszy(rok, q), do: ostatniDzien(rok, q + 2) };
	}
	if (okres === 'rok') return { od: `${rok}-01-01`, do: `${rok}-12-31` };
	const mm = /^(\d{4})-(\d{2})$/.exec(okres);
	if (mm) return { od: pierwszy(Number(mm[1]), Number(mm[2])), do: ostatniDzien(Number(mm[1]), Number(mm[2])) };
	return null;
}

export const wOkresie = (termin: string, zakres: { od: string; do: string } | null) => !zakres || (termin >= zakres.od && termin <= zakres.do);

export type PodsumowanieRat = {
	rat: number;
	oczekiwana: number;
	rozliczone: number;
	rozliczona: number;
	doRozliczenia: number;
	doRozliczeniaKwota: number;
	poTerminie: number;
	rozjazdy: number;
	rozjazdKwota: number;
};

/** Liczby do kafelków: prowizja oczekiwana, rozliczona, do rozliczenia, rozjazdy z notami. */
export function podsumujRaty(wiersze: WierszRaty[]): PodsumowanieRat {
	const p: PodsumowanieRat = { rat: 0, oczekiwana: 0, rozliczone: 0, rozliczona: 0, doRozliczenia: 0, doRozliczeniaKwota: 0, poTerminie: 0, rozjazdy: 0, rozjazdKwota: 0 };
	for (const w of wiersze) {
		p.rat++;
		p.oczekiwana += w.oczekiwana;
		if (w.rozliczona) {
			p.rozliczone++;
			p.rozliczona += w.zaliczona;
		} else {
			p.doRozliczenia++;
			p.doRozliczeniaKwota += w.oczekiwana;
			if (w.stan === 'po_terminie') p.poTerminie++;
		}
		if (w.rozjazd && w.roznica != null) {
			p.rozjazdy++;
			p.rozjazdKwota += w.roznica;
		}
	}
	for (const k of ['oczekiwana', 'rozliczona', 'doRozliczeniaKwota', 'rozjazdKwota'] as const) p[k] = zaokr(p[k]);
	return p;
}

export type FiltrStanu = 'wszystkie' | 'do_rozliczenia' | 'po_terminie' | 'nota' | 'oplacona' | 'rozjazd';

export const FILTRY_STANU: { val: FiltrStanu; label: string }[] = [
	{ val: 'wszystkie', label: 'Wszystkie' },
	{ val: 'do_rozliczenia', label: 'Do rozliczenia' },
	{ val: 'po_terminie', label: 'Po terminie' },
	{ val: 'nota', label: 'Z noty' },
	{ val: 'oplacona', label: 'Opłacone bez noty' },
	{ val: 'rozjazd', label: 'Rozjazd z notą' }
];

export function pasujeStan(w: WierszRaty, f: FiltrStanu): boolean {
	switch (f) {
		case 'wszystkie': return true;
		case 'do_rozliczenia': return !w.rozliczona;
		case 'po_terminie': return w.stan === 'po_terminie';
		case 'nota': return w.stan === 'nota';
		case 'oplacona': return w.stan === 'oplacona';
		case 'rozjazd': return w.rozjazd;
	}
}

/** Status raty po ręcznym rozliczeniu: kwota wg noty niższa od raty to rozliczenie częściowe. */
export const statusPoRozliczeniu = (kwotaRaty: number, kwotaNoty: number): PolicyPayment['status'] =>
	kwotaNoty + 0.005 < Number(kwotaRaty) ? 'Częściowo opłacona' : 'Opłacona';
