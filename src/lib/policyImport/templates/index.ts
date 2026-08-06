// Rejestr szablonów: towarzystwo → produkty → parser.
// Produkt bez parsera jest widoczny na liście, ale import jest zablokowany —
// dzięki temu widać, co jest gotowe, a co czeka na wzorcową polisę.

import type { InsurerTemplate, ProductTemplate } from '../types';
import * as wartaEkstrabiznes from './warta-ekstrabiznes';
import * as ergoOcZawodowe from './ergo-oc-zawodowe';
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
				label: 'OC zawodowe',
				rodzaj: 'OC',
				parse: ergoOcZawodowe.parse,
				detect: ergoOcZawodowe.detect
			},
			{
				id: 'ergo-flota-komunikacja',
				label: 'Flota / Komunikacja',
				rodzaj: 'flota',
				todo: 'Szablon czeka na wzorcową polisę ERGO Hestii (flota / komunikacja).'
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
