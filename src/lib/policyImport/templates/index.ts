// Rejestr szablonów: towarzystwo → produkty → parser.
// Produkt bez parsera jest widoczny na liście, ale import jest zablokowany —
// dzięki temu widać, co jest gotowe, a co czeka na wzorcową polisę.

import type { InsurerTemplate, ProductTemplate } from '../types';
import * as wartaEkstrabiznes from './warta-ekstrabiznes';
import * as ergoOcZawodowe from './ergo-oc-zawodowe';
import * as ergoOcIndywidualna from './ergo-oc-indywidualna';
import * as ergoFlota from './ergo-flota-komunikacja';
import * as ergoNnw from './ergo-nnw-program';
import * as uniqaKomunikacja from './uniqa-komunikacja';

export const INSURER_TEMPLATES: InsurerTemplate[] = [
	{
		skrot: 'WARTA',
		nazwa: 'TUiR WARTA S.A.',
		produkty: [
			{
				id: 'warta-ekstrabiznes',
				label: 'Warta Ekstrabiznes Plus',
				rodzaj: 'majątkowa',
				parse: wartaEkstrabiznes.parse,
				detect: wartaEkstrabiznes.detect
			}
		]
	},
	{
		skrot: 'UNIQA',
		nazwa: 'UNIQA TU S.A.',
		produkty: [
			{
				id: 'uniqa-flota-komunikacja',
				label: 'Flota / Komunikacja (Auto & Przestrzeń)',
				rodzaj: 'komunikacja',
				parse: uniqaKomunikacja.parse,
				detect: uniqaKomunikacja.detect
			}
		]
	},
	{
		skrot: 'ERGO',
		nazwa: 'STU ERGO Hestia S.A.',
		produkty: [
			{
				id: 'ergo-oc-zawodowe',
				label: 'OC zawodowe — certyfikat z programu',
				rodzaj: 'OC',
				parse: ergoOcZawodowe.parse,
				detect: ergoOcZawodowe.detect
			},
			{
				id: 'ergo-oc-indywidualna',
				label: 'OC zawodowe — polisa indywidualna (po ocenie ryzyka)',
				rodzaj: 'OC',
				parse: ergoOcIndywidualna.parse,
				detect: ergoOcIndywidualna.detect
			},
			{
				id: 'ergo-nnw-program',
				label: 'NNW — certyfikat z programu (Biznes & Podróż)',
				rodzaj: 'nnw',
				parse: ergoNnw.parse,
				detect: ergoNnw.detect,
				// Certyfikat nie drukuje numeru programu — umowa generalna NNW po podtypie i towarzystwie.
				ugPodtyp: 'nnw'
			},
			{
				id: 'ergo-flota-komunikacja',
				label: 'Flota / Komunikacja — certyfikaty z umowy generalnej (Cumulus)',
				rodzaj: 'komunikacja',
				parse: ergoFlota.parse,
				parseMany: ergoFlota.parseMany,
				detect: ergoFlota.detect
			}
		]
	},
	{
		skrot: 'PZU',
		nazwa: 'PZU S.A.',
		produkty: []
	},
	{
		skrot: 'ALLIANZ',
		nazwa: 'TU Allianz Polska S.A.',
		produkty: []
	}
];

/**
 * Szablony towarzystwa dopasowane po skrócie lub nazwie z crm_insurers.
 *
 * Kancelarie wpisują towarzystwa własnymi skrótami ("Hestia" zamiast "ERGO"),
 * dlatego dopasowujemy też po nazwie. Spółki życiowe wykluczamy: wszystkie
 * szablony dotyczą ubezpieczeń majątkowych i komunikacyjnych, a nazwy spółek
 * życiowych z tej samej grupy zawierają ten sam człon ("STU na Życie Ergo
 * Hestia S.A." trafiałaby w szablony ERGO).
 */
export function templatesFor(insurer: {
	skrot?: string | null;
	nazwa: string;
	dzial?: string | null;
}): ProductTemplate[] {
	if ((insurer.dzial ?? '').trim().toLowerCase() === 'życiowy') return [];

	const skrot = (insurer.skrot ?? '').trim().toUpperCase();
	const nazwa = insurer.nazwa.trim().toUpperCase();
	const hit = INSURER_TEMPLATES.find(
		(t) => t.skrot === skrot || nazwa.includes(t.skrot) || t.nazwa.toUpperCase() === nazwa
	);
	return hit?.produkty ?? [];
}
