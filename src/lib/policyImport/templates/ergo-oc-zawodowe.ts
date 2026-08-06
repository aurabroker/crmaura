// ERGO HESTIA — OC z tytułu wykonywania czynności zawodowych.
// Nagłówek jest dwukolumnowy: etykiety po lewej (x < 330), wartości po prawej.
// Certyfikaty wystawiane pod Programem Ubezpieczenia niosą jego numer w treści —
// mapper wiąże po nim polisę z Umową Generalną.

import type { ExtractedPolicy, RiskItem } from '../types';
import { emptyExtraction } from '../types';
import type { PdfDoc } from '../pdfDoc';
import { collapse, grab, grabAll, toAmount, toDate } from '../parse';

const X_PRAWA_KOLUMNA = 330;

export function detect(doc: PdfDoc): string | null {
	if (!/ERGO Hestia/i.test(doc.text))
		return 'W dokumencie nie znaleziono oznaczeń ERGO Hestii — to nie jest polisa tego towarzystwa.';
	if (!/POLISA\/POLICY/i.test(doc.text))
		return 'Brak nagłówka „POLISA/POLICY” — to nie jest polisa OC zawodowego w tym układzie.';
	return null;
}

export function parse(doc: PdfDoc): ExtractedPolicy {
	const out = emptyExtraction();
	const text = doc.text;

	out.nr_polisy = grab(text, /POLISA\/POLICY:\s*([A-Z0-9/-]+)/i);
	out.data_od = toDate(
		grab(text, /Period of insurance\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/, 1)
	);
	out.data_do = toDate(
		grab(text, /Period of insurance\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/, 2)
	);
	// Stopka podpisu: "data wystawienia / data zawarcia".
	out.data_zawarcia = toDate(
		grab(text, /(\d{2}\.\d{2}\.\d{4})\s*\/\s*(\d{2}\.\d{2}\.\d{4})\s*\n\s*Podpis Ubezpieczaj/i, 2)
	);

	parseStrony(doc, out);

	out.skladka = toAmount(grab(text, /SKŁADKA \/ PREMIUM\s*([\d\s.,]+)\s*zł/i));
	out.raty = grabAll(text, /(\d{2}\.\d{2}\.\d{4})\s*\/\s*([\d\s.,]+)\s*zł/g).map((m) => ({
		data: toDate(m[1])!,
		kwota: toAmount(m[2])
	}));
	out.ilosc_rat = out.raty.length || null;
	out.konto_do_wplat = collapse(grab(text, /numer konta:\s*([\d\s]{20,34})/i));

	out.ryzyka = parseRyzyka(doc);
	out.przedmiot = out.ryzyka.length
		? out.ryzyka
				.map((r) =>
					r.suma != null ? `${r.przedmiot}: ${r.suma.toLocaleString('pl-PL')} zł` : r.przedmiot
				)
				.join('; ')
		: null;

	out.program_ug = grab(text, /Programem Ubezpieczenia nr\s*([A-Z0-9/]+?)\.?\s*$/im);
	out.produkt_owu = grab(text, /nr\s+(AB-[A-Z]+-\d+\/\d+)/i);

	const klauzule = grabAll(text, /^\s*\d+\.\s*(Klauzula[^\n]+)$/gm)
		.map((m) => collapse(m[1]))
		.filter(Boolean) as string[];
	if (klauzule.length) out.dodatkowe['Klauzule dodatkowe'] = klauzule.join(' | ');

	const franszyza = collapse(grab(text, /Franszyza redukcyjna:\s*([^\n]+)/i));
	if (franszyza) out.dodatkowe['Franszyza'] = franszyza;

	const teryt = collapse(grab(text, /Zakres terytorialny:\s*([^.]+)\./i));
	if (teryt) out.dodatkowe['Zakres terytorialny'] = teryt;

	const underwriter = grab(text, /Underwriter No\.?:\s*(\d+)/i);
	if (underwriter) out.dodatkowe['Nr underwritera'] = underwriter;

	const liczba = grab(text, /Łączna liczba ubezpieczonych\s*(\d+)/i);
	if (liczba) out.dodatkowe['Liczba ubezpieczonych'] = liczba;

	if (out.program_ug) out.dodatkowe['Program ubezpieczenia'] = out.program_ug;

	return out;
}

function parseStrony(doc: PdfDoc, out: ExtractedPolicy) {
	const lblUbezpieczajacy = doc.words.find(
		(w) => w.page === 1 && w.text.startsWith('UBEZPIECZAJĄCY')
	);
	const lblUbezpieczony = doc.words.find((w) => w.page === 1 && w.text === 'Ubezpieczony');
	const lblRyzyka = doc.words.find((w) => w.page === 1 && w.text.startsWith('UBEZPIECZONE RYZYKA'));

	if (lblUbezpieczajacy) {
		// Blok ubezpieczającego: od linii bazowej etykiety w górę o wysokość trzech wierszy.
		const blok = doc.region(1, {
			yFrom: lblUbezpieczajacy.y - 2,
			yTo: lblUbezpieczajacy.y + 20,
			xFrom: X_PRAWA_KOLUMNA
		});
		const jedna = collapse(blok.split('\n').join(' ')) ?? '';
		const m = jedna.match(
			/^(.+?),\s*(.+?),\s*(\d{2}-\d{3})\s+([^,]+?)\s*,?\s*(?:POLSKA)?\s*NIP:?\s*(\d{10})\s*$/i
		);
		if (m) {
			out.klient_nazwa = collapse(m[1]);
			out.klient_adres = collapse(`${m[2]}, ${m[3]} ${m[4]}`);
			out.klient_nip = m[5];
		} else {
			out.klient_nazwa = collapse(jedna.replace(/,?\s*NIP:?\s*\d{10}\s*$/i, ''));
			out.klient_nip = grab(jedna, /NIP:?\s*(\d{10})/i);
		}
	}

	if (lblUbezpieczony && lblRyzyka) {
		const blok = doc.region(1, {
			yFrom: lblRyzyka.y + 2,
			yTo: lblUbezpieczony.y - 2,
			xFrom: X_PRAWA_KOLUMNA
		});
		const jedna = collapse(blok.split('\n').join(' ')) ?? '';
		out.ubezpieczony_nazwa = collapse(jedna.split('|')[0]?.replace(/NIP:?.*$/i, ''));
		out.ubezpieczony_nip = grab(jedna, /NIP:?\s*(\d{10})/i);
	}

	// Ubezpieczony tożsamy z ubezpieczającym — w CRM zostawiamy puste pole "ubezpieczony".
	if (out.ubezpieczony_nip && out.ubezpieczony_nip === out.klient_nip) {
		out.ubezpieczony_nazwa = out.klient_nazwa;
	}
}

// Tabela ryzyk: nazwa | symbol (M30 - 13) | suma ubezpieczenia | składka.
function parseRyzyka(doc: PdfDoc): RiskItem[] {
	const ryzyka: RiskItem[] = [];
	for (const linia of doc.text.split('\n')) {
		const m = linia.match(
			/^(.+?)\s+([A-Z]\d{2}\s*-\s*\d+)\s+([\d\s.,]+)\s*zł(?:\s+([\d\s.,]+)\s*zł)?\s*$/
		);
		if (!m) continue;
		const przedmiot = collapse(m[1]);
		if (!przedmiot) continue;
		ryzyka.push({
			sekcja: 'UBEZPIECZONE RYZYKA',
			przedmiot: `${przedmiot} (${collapse(m[2])})`,
			suma: toAmount(m[3]),
			skladka: toAmount(m[4])
		});
	}
	return ryzyka;
}
