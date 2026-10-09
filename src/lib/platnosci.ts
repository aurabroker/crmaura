// Wspólne reguły rat — jedna definicja „po terminie” dla menu, Pulpitu i Płatności.
import type { Policy, PolicyPayment } from '$lib/types/database';

/** Statusy rat uznane za rozliczone. */
export const ROZLICZONE = ['Opłacona', 'Częściowo opłacona'];

/** Umowy generalne bez rozliczania płatności — ich raty są tylko informacyjne. */
export function ugBezRozliczania(policies: Pick<Policy, 'id' | 'typ_umowy' | 'rozliczaj_platnosci'>[]): Set<string> {
	return new Set(policies.filter((p) => p.typ_umowy === 'generalna' && !p.rozliczaj_platnosci).map((p) => p.id));
}

/** Rata po terminie: oznaczona jako zaległa albo oczekująca z minioną datą (poza UG bez rozliczania). */
export function poTerminie(
	p: Pick<PolicyPayment, 'status' | 'data_platnosci' | 'polisa_id'>,
	today: string,
	ug: Set<string>
): boolean {
	return !ug.has(p.polisa_id) && (p.status === 'Zaległa' || (p.status === 'Oczekująca' && p.data_platnosci < today));
}
