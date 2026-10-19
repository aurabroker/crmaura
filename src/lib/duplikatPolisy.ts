// Polisa już w systemie: ten sam numer (bez spacji, myślników i wielkości liter) u tej samej firmy.
// Formularze pytają przed zapisem — polisa dodana drugi raz podwaja przypis, raty i odnowienia.
import type { Policy } from '$lib/types/database';
import { askConfirm } from '$lib/stores/confirm.svelte';
import { fmtDzien } from '$lib/utils';

/** Numer do porównań: wielkie litery i cyfry, bez spacji, ukośników i myślników. */
export const normalizujNrPolisy = (nr: string | null | undefined) => (nr ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

type PolisaDoPorownania = Pick<Policy, 'id' | 'nr_polisy' | 'deleted_at'> & Partial<Pick<Policy, 'data_od' | 'data_do' | 'rodzaj' | 'crm_clients' | 'crm_insurers'>>;

/** Istniejąca polisa (poza koszem) o tym samym numerze; `pominId` wyłącza edytowaną polisę. */
export function znajdzDuplikatPolisy<P extends PolisaDoPorownania>(nr: string | null | undefined, policies: P[], pominId?: string | null): P | null {
	const szukany = normalizujNrPolisy(nr);
	if (szukany.length < 3) return null;
	return policies.find((p) => !p.deleted_at && p.id !== pominId && normalizujNrPolisy(p.nr_polisy) === szukany) ?? null;
}

/** „KOP-TRANS · OC · 9 paź 2025 – 8 paź 2026 · WARTA” — do monitu i ostrzeżenia pod polem numeru. */
export function opisDuplikatu(p: PolisaDoPorownania): string {
	const okres = p.data_od && p.data_do ? `${fmtDzien(p.data_od, true)} – ${fmtDzien(p.data_do, true)}` : null;
	return [p.crm_clients?.nazwa, p.rodzaj, okres, p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa].filter(Boolean).join(' · ');
}

/**
 * Monit przed zapisem: gdy polisa o tym numerze już jest, pyta, czy mimo to zapisać drugą.
 * Zwraca true, gdy można zapisywać (brak duplikatu albo świadoma zgoda).
 */
export async function potwierdzDuplikat(nr: string | null | undefined, policies: PolisaDoPorownania[], pominId?: string | null): Promise<boolean> {
	const d = znajdzDuplikatPolisy(nr, policies, pominId);
	if (!d) return true;
	return askConfirm({
		title: 'Ta polisa już jest w systemie',
		message: `${d.nr_polisy} — ${opisDuplikatu(d) || 'istniejąca polisa'}.`,
		detail: 'Zapis utworzy drugi rekord tej samej polisy: podwójny przypis, raty i odnowienia. Jeśli to kolejny okres, nadaj numer z nowej polisy albo użyj „Odnów” na karcie poprzedniej.',
		confirmLabel: 'Zapisz mimo to',
		cancelLabel: 'Wróć do formularza',
		danger: true
	});
}
