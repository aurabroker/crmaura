// Wspólne reguły rat — jedna definicja „po terminie” dla menu, Pulpitu i Płatności.
import type { Policy, PolicyPayment } from '$lib/types/database';

/** Statusy rat uznane za rozliczone. */
export const ROZLICZONE = ['Opłacona', 'Częściowo opłacona'];

/**
 * Towarzystwo, przy którym klientowi nie wysyłamy informacji o płatnościach (flaga polisy bez_info_platnosci):
 * Leadenhall — w CRM składka i raty bez opłat dystrybucyjnych, a klient płaci całość (brutto), więc kwota
 * w przypomnieniu albo w e-mailu z polisą byłaby błędna. Nowa polisa takiego TU ma flagę zaznaczoną domyślnie.
 */
export const tuBezInfoPlatnosci = (tu: { nazwa?: string | null; skrot?: string | null } | null | undefined) =>
	!!tu && /leadenhall/i.test(`${tu.nazwa ?? ''} ${tu.skrot ?? ''}`);

/** Umowy generalne bez rozliczania płatności — ich raty są tylko informacyjne. */
export function ugBezRozliczania(policies: Pick<Policy, 'id' | 'typ_umowy' | 'rozliczaj_platnosci'>[]): Set<string> {
	return new Set(policies.filter((p) => p.typ_umowy === 'generalna' && !p.rozliczaj_platnosci).map((p) => p.id));
}

/**
 * Ręczne „Oznacz wpłatę”: data wpłaty jest wymagana — domyślnie termin raty, bo data dzisiejsza zwykle jest
 * błędem (rozliczenie robi się po czasie). Zwraca komunikat błędu albo '' gdy data jest poprawna.
 */
export function walidujDateWplaty(data: string | null | undefined, dzis: string): string {
	if (!data) return 'Podaj datę wpłaty.';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) return 'Nieprawidłowa data wpłaty.';
	if (data > dzis) return 'Data wpłaty nie może być z przyszłości.';
	return '';
}

/** Raty pogrupowane po dacie wpłaty — jeden zapis na datę zamiast na ratę. Kolejność dat rosnąco. */
export function ratyWgDatyWplaty(ids: string[], daty: Record<string, string>): [string, string[]][] {
	const m = new Map<string, string[]>();
	for (const id of ids) {
		const d = daty[id] ?? '';
		m.set(d, [...(m.get(d) ?? []), id]);
	}
	return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Rata po terminie: oznaczona jako zaległa albo oczekująca z minioną datą (poza UG bez rozliczania). */
export function poTerminie(
	p: Pick<PolicyPayment, 'status' | 'data_platnosci' | 'polisa_id'>,
	today: string,
	ug: Set<string>
): boolean {
	return !ug.has(p.polisa_id) && (p.status === 'Zaległa' || (p.status === 'Oczekująca' && p.data_platnosci < today));
}
