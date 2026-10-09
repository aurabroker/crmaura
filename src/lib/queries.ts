// Wspólne zapytania o polisy i płatności. crm_policies ma dwa powiązania z crm_clients
// (klient_id i ubezpieczony_id), więc osadzenie klienta musi wskazać kolumnę — samo
// `crm_clients(...)` baza odrzuca jako niejednoznaczne, a lista polis zostaje pusta.

export const POLICY_SELECT =
	'*, crm_clients!klient_id(nazwa), ubezpieczony:crm_clients!ubezpieczony_id(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))';

export const PAYMENT_SELECT = '*, crm_policies(nr_polisy, crm_clients!klient_id(nazwa))';

// Supabase (PostgREST) oddaje najwyżej 1000 wierszy na zapytanie — dłuższe listy po cichu się ucinały
// (np. klienci starsi niż 1000 najnowszych „nie istnieli”). Listy, które mogą przekroczyć limit,
// pobieramy stronami: pierwsza z licznikiem, pozostałe równolegle. Krok = długość pierwszej strony,
// więc działa też przy innym limicie projektu. Zapytanie musi mieć jednoznaczny porządek
// (ostatni klucz sortowania: id), inaczej strony mogłyby się nakładać.
export const STRONA_BAZY = 1000;

type OdpowiedzStrony<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };

// Kontrakt jak w supabase-js: przy jakimkolwiek błędzie data = null (wołający zostawiają wtedy starą listę
// albo pokazują błąd — nigdy nie dostają listy uciętej po cichu).
export async function wszystkieWiersze<T>(
	strona: (od: number, doWiersza: number, licz: boolean) => PromiseLike<OdpowiedzStrony<T>>
): Promise<{ data: T[] | null; error: { message: string } | null }> {
	const p = await strona(0, STRONA_BAZY - 1, true);
	if (p.error) return { data: null, error: p.error };
	const out: T[] = [...(p.data ?? [])];
	const razem = p.count ?? out.length;
	const krok = out.length;
	if (!krok || razem <= krok) return { data: out, error: null };
	const reszta = await Promise.all(
		Array.from({ length: Math.ceil((razem - krok) / krok) }, (_, i) => strona(krok * (i + 1), krok * (i + 2) - 1, false))
	);
	for (const r of reszta) {
		if (r.error) return { data: null, error: r.error };
		out.push(...(r.data ?? []));
	}
	// Strony to osobne zapytania: wiersz dodany w międzyczasie przesuwa kolejne strony i wiersz z granicy
	// przychodzi dwa razy (a podwójne id psuje listy z kluczem w Svelte). Zostawiamy pierwsze wystąpienie.
	const widziane = new Set<unknown>();
	return {
		data: out.filter((w) => {
			const id = (w as { id?: unknown })?.id;
			if (id === undefined) return true;
			if (widziane.has(id)) return false;
			widziane.add(id);
			return true;
		}),
		error: null
	};
}
