// Dopasowanie pozycji noty prowizyjnej do polisy w CRM po numerze.
//
// Umowy wieloletnie rozliczane rocznie (np. Leadenhall Life na 15 lat — w każdym roku inna prowizja)
// prowadzimy w CRM jako osobne polisy na każdy rok polisowy, z rokiem dopisanym do numeru:
// „LHC3028651_2025”, „LHC3028651_2026”… W nocie jest sam numer umowy i numer raty liczony od początku
// umowy (1…180), więc polisę wybieramy po dacie wpłaty, a numer raty przeliczamy na ratę w roku.

type Polisa = { nr_polisy: string; data_od?: string | null; data_do?: string | null };

/** Numer bez spacji i myślników, wielkimi literami. */
export function normalizujNr(nr: string): string {
	return nr.replace(/[\s-]/g, '').toUpperCase();
}

const ROK_POLISOWY = /^(.+?)\s*[_/\s-]\s*((?:19|20)\d{2})$/;

/** „LHC3028651_2025” → { umowa: 'LHC3028651', rok: 2025 }; numer bez roku na końcu → null. */
export function rokPolisowyZNumeru(nr: string): { umowa: string; rok: number } | null {
	const m = nr.trim().match(ROK_POLISOWY);
	return m ? { umowa: m[1], rok: Number(m[2]) } : null;
}

/**
 * Polisa o numerze z noty. Kolejno: ten sam numer, ten sam po normalizacji, rok polisowy umowy
 * wieloletniej (ten, którego okres obejmuje datę wpłaty), numer z noty jako końcówka numeru w CRM.
 */
export function znajdzPolise<P extends Polisa>(polisy: P[], nrZNoty: string, dataWplaty?: string | null): P | null {
	const norm = normalizujNr(nrZNoty);
	const dokladna = polisy.find((x) => x.nr_polisy === nrZNoty) ?? polisy.find((x) => normalizujNr(x.nr_polisy) === norm);
	if (dokladna) return dokladna;

	const lata = polisy.filter((x) => {
		const r = rokPolisowyZNumeru(x.nr_polisy);
		return !!r && normalizujNr(r.umowa) === norm;
	});
	if (lata.length) return wybierzRok(lata, dataWplaty);

	return polisy.find((x) => {
		const pn = normalizujNr(x.nr_polisy);
		return pn.endsWith(norm) || norm.endsWith(pn);
	}) ?? null;
}

// Rok polisowy obejmujący datę wpłaty; gdy żaden — ostatni rozpoczęty przed nią, a bez daty — najnowszy.
function wybierzRok<P extends Polisa>(lata: P[], data?: string | null): P {
	const wgStartu = [...lata].sort((a, b) => (a.data_od ?? '').localeCompare(b.data_od ?? ''));
	if (!data) return wgStartu[wgStartu.length - 1];
	const obejmuje = wgStartu.find((p) => (p.data_od ?? '') <= data && data <= (p.data_do ?? '9999-12-31'));
	if (obejmuje) return obejmuje;
	const wczesniejsze = wgStartu.filter((p) => (p.data_od ?? '') <= data);
	return wczesniejsze.length ? wczesniejsze[wczesniejsze.length - 1] : wgStartu[0];
}

/** Numer raty umowy (1…180) jako numer raty w roku polisowym (1…12); bez zmian, gdy mieści się w roku. */
export function rataWRoku(nrRatyUmowy: number, ratWRoku: number): number {
	if (!(ratWRoku > 0) || nrRatyUmowy <= ratWRoku) return nrRatyUmowy;
	return ((nrRatyUmowy - 1) % ratWRoku) + 1;
}
