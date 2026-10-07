// Wybór Umowy Generalnej dla polisy z programu.
// Program bywa przedłużany z tym samym numerem (np. ERGO Hestia OC beauty WA50/003353/24/A),
// a w CRM kolejna umowa ma dopisek roku („WA50/003353/24/A_2026”). Polisa trafia pod umowę
// obowiązującą w dniu jej zawarcia.

import type { Policy } from '$lib/types/database';

/** Numer programu bez spacji, wielkimi literami i bez dopisku roku („_2026”). */
export function numerProgramu(nr: string | null | undefined): string {
	return (nr ?? '').replace(/\s/g, '').toUpperCase().replace(/_\d{4}$/, '');
}

type Umowa = Pick<Policy, 'id' | 'nr_polisy' | 'typ_umowy' | 'data_od' | 'data_do' | 'data_zawarcia' | 'deleted_at'>;

/** Początek umowy: wcześniejsza z dat zawarcia i początku okresu. */
export function poczatekUmowy(u: Umowa): string | null {
	const daty = [u.data_zawarcia, u.data_od].filter((d): d is string => !!d).sort();
	return daty[0] ?? null;
}

const odNajnowszej = (a: Umowa, b: Umowa) => (poczatekUmowy(b) ?? '').localeCompare(poczatekUmowy(a) ?? '');

/** Umowy Generalne danego programu, od najnowszej. */
export function umowyProgramu<T extends Umowa>(policies: T[], program: string | null | undefined): T[] {
	const szukany = numerProgramu(program);
	if (!szukany) return [];
	return policies
		.filter((p) => p.typ_umowy === 'generalna' && !p.deleted_at && numerProgramu(p.nr_polisy) === szukany)
		.sort(odNajnowszej);
}

/**
 * Umowa dla polisy zawartej w dniu `dzien` (YYYY-MM-DD):
 * - umowa obowiązująca tego dnia (przy nakładaniu się okresów — najnowsza),
 * - polisa zawarta w przerwie między umowami — następna umowa,
 * - polisa po końcu wszystkich umów albo bez daty — najnowsza umowa.
 */
export function wybierzUmowe<T extends Umowa>(umowy: T[], dzien: string | null | undefined): T | null {
	if (!umowy.length) return null;
	const odNowej = [...umowy].sort(odNajnowszej);
	if (odNowej.length === 1 || !dzien) return odNowej[0];
	const obowiazujace = odNowej.filter((u) => {
		const od = poczatekUmowy(u);
		return (!od || od <= dzien) && (!u.data_do || dzien <= u.data_do);
	});
	if (obowiazujace.length) return obowiazujace[0];
	const nastepne = odNowej.filter((u) => (poczatekUmowy(u) ?? '') > dzien);
	if (nastepne.length) return nastepne[nastepne.length - 1];
	return odNowej[0];
}
