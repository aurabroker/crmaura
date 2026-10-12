// Terminy rat w CRM ułożone według numeracji towarzystwa.
//
// Leadenhall numeruje raty inaczej, niż zakłada miesięczny harmonogram CRM: pierwsza wpłata obejmuje
// kilka rat naraz, dalej idzie po jednej racie miesięcznie (np. polisa od 28.10.2025, rata 12
// opłacona 27.07.2026). Z noty znamy numer raty i datę wpłaty — od niej liczymy kolejne raty co
// miesiąc w przód i w tył, a raty, które wypadłyby przed początkiem ochrony, dostają datę początku
// (zapłacone pierwszą wpłatą). Rozliczonych rat nie ruszamy.

export type RataHarmonogramu = { id: string; nr_raty: number; data_platnosci: string; status: string };
export type ZmianaTerminu = { id: string; nr_raty: number; z: string; na: string };

const ROZLICZONE = ['Opłacona', 'Częściowo opłacona'];

/** Data RRRR-MM-DD przesunięta o n miesięcy; dzień ponad koniec miesiąca → ostatni dzień miesiąca. */
export function dodajMiesiace(data: string, n: number): string {
	const [r, m, d] = data.slice(0, 10).split('-').map(Number);
	const cel = new Date(Date.UTC(r, m - 1 + n, 1));
	const ostatni = new Date(Date.UTC(cel.getUTCFullYear(), cel.getUTCMonth() + 1, 0)).getUTCDate();
	cel.setUTCDate(Math.min(d, ostatni));
	return cel.toISOString().slice(0, 10);
}

/** Zmiany terminów nierozliczonych rat, tak by rata nrRaty przypadała na dzień wpłaty z noty. */
export function harmonogramWgNoty(
	raty: RataHarmonogramu[],
	nrRaty: number,
	dataWplaty: string,
	poczatekOchrony: string | null
): ZmianaTerminu[] {
	const zmiany: ZmianaTerminu[] = [];
	for (const r of raty) {
		if (ROZLICZONE.includes(r.status)) continue;
		let na = dodajMiesiace(dataWplaty, r.nr_raty - nrRaty);
		if (r.nr_raty < nrRaty && poczatekOchrony && na < poczatekOchrony) na = poczatekOchrony;
		if (na !== r.data_platnosci) zmiany.push({ id: r.id, nr_raty: r.nr_raty, z: r.data_platnosci, na });
	}
	return zmiany;
}

/** Status nierozliczonej raty po zmianie terminu — jak przy zapisie polisy. */
export function statusPoTerminie(data: string, dzis: string): 'Zaległa' | 'Oczekująca' {
	return data < dzis ? 'Zaległa' : 'Oczekująca';
}
