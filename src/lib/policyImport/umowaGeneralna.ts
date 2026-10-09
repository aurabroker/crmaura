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

const DNI_ZAWARCIA_PRZED_OKRESEM = 92;

/**
 * Początek umowy: data zawarcia, gdy umowę zawarto krótko przed początkiem okresu (nowy rok programu
 * zawarty przed startem — certyfikaty idą już pod nią), w innym razie początek okresu. Dawna data
 * zawarcia umowy-matki (np. 2023 przy okresie 2026/27) nie przesuwa początku.
 */
export function poczatekUmowy(u: Umowa): string | null {
	if (!u.data_od) return u.data_zawarcia ?? null;
	if (!u.data_zawarcia || u.data_zawarcia >= u.data_od) return u.data_od;
	const dni = (Date.parse(u.data_od) - Date.parse(u.data_zawarcia)) / 86_400_000;
	return dni <= DNI_ZAWARCIA_PRZED_OKRESEM ? u.data_zawarcia : u.data_od;
}

// Od najnowszej; przy równym początku decyduje późniejszy okres, potem numer (kolejność stała).
const odNajnowszej = (a: Umowa, b: Umowa) =>
	(poczatekUmowy(b) ?? '').localeCompare(poczatekUmowy(a) ?? '') ||
	(b.data_od ?? '').localeCompare(a.data_od ?? '') ||
	(b.data_do ?? '').localeCompare(a.data_do ?? '') ||
	(b.nr_polisy ?? '').localeCompare(a.nr_polisy ?? '');

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

/** Umowa programu obowiązująca w dniu `dzien` (najnowsza przy nakładaniu się okresów) albo null. */
export function umowaObowiazujaca<T extends Umowa>(umowy: T[], dzien: string): T | null {
	return (
		[...umowy].sort(odNajnowszej).find((u) => {
			const od = poczatekUmowy(u);
			return !!od && od <= dzien && (!u.data_do || dzien <= u.data_do);
		}) ?? null
	);
}

/**
 * Opiekun TU dla nowej polisy w Umowie Generalnej: domyślnie ten sam co na umowie
 * (o ile umowa jest z tym samym towarzystwem co polisa).
 */
export function opiekunZUmowy(
	policies: Pick<Policy, 'id' | 'tu_id' | 'tu_contact_id'>[],
	parentId: string | null | undefined,
	tuId: string | null | undefined
): string | null {
	if (!parentId) return null;
	const ug = policies.find((p) => p.id === parentId);
	return ug && ug.tu_contact_id && (!tuId || ug.tu_id === tuId) ? ug.tu_contact_id : null;
}
