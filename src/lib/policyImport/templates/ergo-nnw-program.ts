// ERGO HESTIA — NNW z Programu: certyfikat „POLISA/POLICY” (OWU Biznes & Podróż) wystawiany
// pod umową generalną następstw nieszczęśliwych wypadków, np. dla gabinetów z programu beauty
// (klauzula HIV/WZW przy czynnościach zawodowych). Układ jak certyfikat OC zawodowego: etykiety
// po lewej (x < 330), wartości po prawej, tabela ryzyk „nazwa | symbol | suma | składka”.
// Dokument NIE drukuje numeru programu — mapper wiąże polisę z umową generalną po podtypie
// „nnw” i towarzystwie (ProductTemplate.ugPodtyp), a operator może wskazać inną.
//
// Importy względne z rozszerzeniem, żeby szablon dało się uruchomić w testach node.

import type { ExtractedPolicy, RiskItem } from '../types.ts';
import { emptyExtraction } from '../types.ts';
import type { PdfDoc } from '../pdfDoc.ts';
import { collapse, grab, grabAll, toAmount, toDate } from '../parse.ts';

const X_PRAWA_KOLUMNA = 330;
const RYZYKO_NNW = /NAST[ĘE]PSTW NIESZCZ[ĘE][ŚS]LIWYCH WYPADK[ÓO]W/i;
const KLAUZULA_HIV = /HIV/i;
/** Składka roczna od osoby w programie Beauty Razem: NNW (wariant I) i płatne rozszerzenie o klauzulę HIV/WZW. */
export const SKLADKA_NNW_OSOBA = 150;
export const SKLADKA_HIV_OSOBA = 75;
/** Wiersz tabeli ryzyk: nazwa | symbol (A05 - 12) | suma ubezpieczenia | składka. */
const WIERSZ_RYZYKA = /^(.+?)\s+([A-Z]\d{2}\s*-\s*\d+)\s+([\d\s.,]+)\s*zł(?:\s+([\d\s.,]+)\s*zł)?\s*$/;

export function detect(doc: PdfDoc): string | null {
	if (!/ERGO Hestia/i.test(doc.text))
		return 'W dokumencie nie znaleziono oznaczeń ERGO Hestii — to nie jest polisa tego towarzystwa.';
	if (!/POLISA\/POLICY/i.test(doc.text))
		return 'Brak nagłówka „POLISA/POLICY” — to nie jest certyfikat z programu w tym układzie.';
	if (!RYZYKO_NNW.test(doc.text))
		return 'W tabeli ryzyk nie ma ubezpieczenia następstw nieszczęśliwych wypadków — to nie jest certyfikat NNW (OC zawodowe ma własny produkt).';
	return null;
}

export function parse(doc: PdfDoc): ExtractedPolicy {
	const out = emptyExtraction();
	const text = doc.text;

	out.nr_polisy = grab(text, /POLISA\/POLICY:\s*([A-Z0-9/-]+)/i);
	const okres = text.match(/Period of insurance\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/i);
	out.data_od = toDate(okres?.[1]);
	out.data_do = toDate(okres?.[2]);
	// Stopka podpisu: „data wystawienia / data zawarcia”.
	out.data_zawarcia = toDate(
		grab(text, /(\d{2}\.\d{2}\.\d{4})\s*\/\s*(\d{2}\.\d{2}\.\d{4})\s*\n\s*Podpis Ubezpieczaj/i, 2)
	);

	parseStrony(doc, out);

	out.ryzyka = parseRyzyka(doc);
	rozdzielSkladke(out.ryzyka);
	// Pierwsza pozycja to NNW — jej suma jest sumą ubezpieczenia certyfikatu.
	out.suma_gwarancyjna = out.ryzyka.find((r) => r.suma != null)?.suma ?? null;
	out.przedmiot = out.ryzyka.length
		? out.ryzyka
				.map((r) => (r.suma != null ? `${r.przedmiot}: ${r.suma.toLocaleString('pl-PL')} zł` : r.przedmiot))
				.join('; ')
		: null;

	out.skladka = toAmount(grab(text, /SKŁADKA \/ PREMIUM\s*([\d\s.,]+)\s*zł/i));
	out.raty = grabAll(text, /(\d{2}\.\d{2}\.\d{4})\s*\/\s*([\d\s.,]+)\s*zł/g).map((m) => ({
		data: toDate(m[1])!,
		kwota: toAmount(m[2])
	}));
	out.ilosc_rat = out.raty.length || null;
	out.konto_do_wplat = collapse(grab(text, /numer konta:\s*([\d\s]{20,34})/i));

	// Numer programu drukują tylko niektóre certyfikaty — zwykle jest tu „zgodnie z Programem” bez numeru.
	out.program_ug = grab(text, /Programem Ubezpieczenia nr\s*([A-Z0-9/]+?)\.?\s*$/im);
	out.produkt_owu =
		collapse(grab(text, /zawarto na podstawie\s+(.+?\bNR\s+PAT\/OW\d+\/\d+)/i)) ??
		grab(text, /\bNR\s+(PAT\/OW\d+\/\d+)/i);

	const liczbaOsob = grab(text, /liczba ubezpieczonych\s+(\d+)\b/i);
	if (liczbaOsob) out.dodatkowe['Liczba ubezpieczonych'] = liczbaOsob;
	const osoboDni = grab(text, /liczba osobo-dni\s+(\d+)\b/i);
	if (osoboDni) out.dodatkowe['Liczba osobo-dni'] = osoboDni;
	const parametry: [string, RegExp][] = [
		['Zakres terytorialny', /Zakres terytorialny:\s*([^,]+)/i],
		['Zakres czasowy', /Zakres czasowy:\s*([^,]+)/i],
		['Zakres świadczeń', /Zakres świadczeń:\s*([^,]+)/i],
		['Klasa ryzyka', /Klasa ryzyka:\s*([^,]+)/i]
	];
	for (const [klucz, re] of parametry) {
		const v = collapse(grab(text, re));
		if (v) out.dodatkowe[klucz] = v;
	}

	out.rodzaj = 'nnw';
	return out;
}

/**
 * Nagłówek: ubezpieczający w prawej kolumnie obok etykiety (nazwa, adres, NIP), ubezpieczony
 * to osoba („JOANNA BERNACKA-WOLAK | Data urodzenia: 25.12.1981”) — zostaje w parametrach,
 * bo nie ma NIP ani REGON, po których CRM wiązałby go z kartoteką.
 */
function parseStrony(doc: PdfDoc, out: ExtractedPolicy) {
	const lblUbezpieczajacy = doc.words.find((w) => w.page === 1 && w.text.startsWith('UBEZPIECZAJĄCY'));
	const lblUbezpieczony = doc.words.find((w) => w.page === 1 && w.text === 'Ubezpieczony' && w.x >= X_PRAWA_KOLUMNA);
	const lblRyzyka = doc.words.find((w) => w.page === 1 && w.text.startsWith('UBEZPIECZONE RYZYKA'));

	if (lblUbezpieczajacy) {
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
		const osoba = collapse(jedna.split('|')[0]?.replace(/NIP:?.*$/i, ''));
		out.ubezpieczony_nazwa = osoba;
		out.ubezpieczony_nip = grab(jedna, /NIP:?\s*(\d{10})/i);
		const urodzenia = grab(jedna, /Data urodzenia:\s*(\d{2}\.\d{2}\.\d{4})/i);
		if (osoba) out.dodatkowe['Ubezpieczony'] = urodzenia ? `${osoba} (ur. ${urodzenia})` : osoba;
	}

	// Ubezpieczony tożsamy z ubezpieczającym — w CRM zostawiamy puste pole "ubezpieczony".
	if (out.ubezpieczony_nip && out.ubezpieczony_nip === out.klient_nip) out.ubezpieczony_nazwa = out.klient_nazwa;
}

/**
 * Certyfikat drukuje całą składkę przy wierszu NNW, a klauzula HIV/WZW jest osobno płatnym rozszerzeniem
 * (150 zł NNW + 75 zł klauzula od osoby rocznie). Dzielimy składkę w tej proporcji — także przy kilku
 * osobach i okresie krótszym niż rok, bo obie części Hestia liczy od tych samych osobo-dni — żeby pozycje
 * ryzyk (i mail z polisą do klienta) pokazywały, ile kosztuje NNW, a ile klauzula.
 */
export function rozdzielSkladke(ryzyka: RiskItem[]): void {
	const nnw = ryzyka.find((r) => r.sekcja === 'UBEZPIECZONE RYZYKA' && RYZYKO_NNW.test(r.przedmiot));
	const hiv = ryzyka.find((r) => r.sekcja === 'KLAUZULE DODATKOWE' && KLAUZULA_HIV.test(r.przedmiot));
	if (!nnw || !hiv || nnw.skladka == null || hiv.skladka != null) return;
	const grosze = (n: number) => Math.round(n * 100) / 100;
	hiv.skladka = grosze((nnw.skladka * SKLADKA_HIV_OSOBA) / (SKLADKA_NNW_OSOBA + SKLADKA_HIV_OSOBA));
	nnw.skladka = grosze(nnw.skladka - hiv.skladka);
}

/**
 * Tabela ryzyk (wiersze z symbolem i sumą) oraz klauzule dodatkowe pod nią — klauzula idzie
 * jako pozycja bez sumy, z limitem drukowanym w kolumnie LIMIT („zgodnie z Programem”).
 */
function parseRyzyka(doc: PdfDoc): RiskItem[] {
	const ryzyka: RiskItem[] = [];
	const linie = doc.text.split('\n');
	let wKlauzulach = false;
	let klauzula: RiskItem | null = null;
	for (const linia of linie) {
		if (/^SKŁADKA\s*\/\s*PREMIUM/i.test(linia) || /^INFORMACJE DODATKOWE/i.test(linia)) break;
		const m = linia.match(WIERSZ_RYZYKA);
		if (m) {
			const przedmiot = collapse(m[1]);
			if (!przedmiot) continue;
			ryzyka.push({
				sekcja: 'UBEZPIECZONE RYZYKA',
				przedmiot: `${przedmiot} (${collapse(m[2])})`,
				suma: toAmount(m[3]),
				skladka: toAmount(m[4])
			});
			continue;
		}
		if (/^KLAUZULE DODATKOWE/i.test(linia)) {
			wKlauzulach = true;
			continue;
		}
		if (!wKlauzulach) continue;
		if (/^Klauzula/i.test(linia)) {
			klauzula = { sekcja: 'KLAUZULE DODATKOWE', przedmiot: collapse(linia) ?? linia, suma: null };
			ryzyka.push(klauzula);
		} else if (klauzula) {
			// Dalszy ciąg: wartość kolumny LIMIT („zgodnie z Programem”) albo łamana nazwa klauzuli.
			const limit = collapse(linia) ?? '';
			klauzula.przedmiot = /^(zgodnie|limit|do |bez )/i.test(limit)
				? `${klauzula.przedmiot} — limit: ${limit}`
				: `${klauzula.przedmiot} ${limit}`;
		}
	}
	return ryzyka;
}
