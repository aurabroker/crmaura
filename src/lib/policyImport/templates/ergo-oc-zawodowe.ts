// ERGO HESTIA — OC z tytułu wykonywania czynności zawodowych.
// Nagłówek jest dwukolumnowy: etykiety po lewej (x < 330), wartości po prawej.
// Certyfikaty wystawiane pod Programem Ubezpieczenia niosą jego numer w treści —
// mapper wiąże po nim polisę z Umową Generalną.

// Importy względne z rozszerzeniem, żeby szablon dało się uruchomić w testach node (--experimental-strip-types).
import type { ExtractedPolicy } from '../types.ts';
import { emptyExtraction } from '../types.ts';
import type { PdfDoc } from '../pdfDoc.ts';
import { collapse, grab, grabAll, toAmount, toDate } from '../parse.ts';
import { OKRES_CERTYFIKATU, tabelaRyzyk } from './ergo-tabelaRyzyk.ts';

const X_PRAWA_KOLUMNA = 330;
/** Kolumna LIMIT w sekcjach zakresu i klauzul (nagłówek „LIMIT” przy x≈445). */
const X_LIMIT = 400;

export function detect(doc: PdfDoc): string | null {
	if (!/ERGO Hestia/i.test(doc.text))
		return 'W dokumencie nie znaleziono oznaczeń ERGO Hestii — to nie jest polisa tego towarzystwa.';
	if (!/POLISA\/POLICY/i.test(doc.text)) {
		if (/^Polisa nr\s+\d+/m.test(doc.text) && /^Warunki ubezpieczenia:/m.test(doc.text))
			return 'To polisa wystawiona indywidualnie, nie certyfikat z programu — wybierz produkt „OC zawodowe — polisa indywidualna”.';
		return 'Brak nagłówka „POLISA/POLICY” — to nie jest certyfikat OC zawodowego w tym układzie.';
	}
	// Ten sam układ ma certyfikat NNW z programu — gdy w tabeli ryzyk jest tylko NNW, to nie OC.
	const nazwyRyzyk = tabelaRyzyk(doc).map((r) => r.przedmiot);
	if (nazwyRyzyk.length && nazwyRyzyk.every((n) => /NIESZCZ[ĘE][ŚS]LIWYCH WYPADK/i.test(n)))
		return 'To certyfikat NNW z programu — wybierz produkt „NNW — certyfikat z programu (Biznes & Podróż)”.';
	return null;
}

export function parse(doc: PdfDoc): ExtractedPolicy {
	const out = emptyExtraction();
	const text = doc.text;

	out.nr_polisy = grab(text, /POLISA\/POLICY:\s*([A-Z0-9/-]+)/i);
	// Okres bywa z godzinami („14.11.2026 23:55 - 13.11.2027 24:00” — certyfikat wystawiony w dniu początku
	// ochrony); do CRM idą same daty.
	const okres = text.match(OKRES_CERTYFIKATU);
	out.data_od = toDate(okres?.[1]);
	out.data_do = toDate(okres?.[2]);
	// Godziny zostają w parametrach (jak w polisie indywidualnej) — ochrona nie zaczyna się o północy.
	const zGodzinami = okres && /\d{1,2}:\d{2}/.test(okres[0]) ? collapse(okres[0].replace(/^Period of insurance\s*/i, '')) : null;
	if (zGodzinami) out.dodatkowe['Okres ubezpieczenia'] = zGodzinami;
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

	// Tabela ryzyk po pozycji kolumn — długa nazwa („GABINETY KOSMETYCZNE, KOSMETOLOGICZNE, FRYZJERSKIE
	// I PODOLOGICZNE”) łamie wiersz i symbol z sumą lądują linię niżej.
	out.ryzyka = tabelaRyzyk(doc);
	out.przedmiot = out.ryzyka.length
		? out.ryzyka
				.map((r) =>
					r.suma != null ? `${r.przedmiot}: ${r.suma.toLocaleString('pl-PL')} zł` : r.przedmiot
				)
				.join('; ')
		: null;
	// Pierwsza pozycja to OC zawodowe — jej suma jest sumą gwarancyjną certyfikatu.
	out.suma_gwarancyjna = out.ryzyka[0]?.suma ?? null;

	out.program_ug = grab(text, /Programem Ubezpieczenia nr\s*([A-Z0-9/]+?)\.?\s*$/im);
	out.produkt_owu = grab(text, /nr\s+(AB-[A-Z]+-\d+\/\d+)/i);

	const klauzule = parseKlauzule(doc);
	if (klauzule.length) out.dodatkowe['Klauzule dodatkowe'] = klauzule.join(' | ');

	// Zakres terytorialny, underwriter, liczba ubezpieczonych i numer programu (certyfikat jest
	// podpięty pod Umowę Generalną) nie wnoszą nic do karty — zostają tylko franszyza i klauzule.
	const franszyza = collapse(grab(text, /Franszyza redukcyjna:\s*([^\n]+)/i));
	if (franszyza) out.dodatkowe['Franszyza'] = franszyza;

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

/**
 * Sekcja „KLAUZULE DODATKOWE / ADDITIONAL CLAUSES”: numerowane pozycje do franszyzy albo składki. Nie każda
 * zaczyna się od „Klauzula” — np. „1. Liczba zatrudnionych od 6 do 8 przy SG 300.000,00 zł” (dopłata
 * za 6–8 osób z programu beauty). Wartość z kolumny LIMIT („2. Klauzula Ochrony Prawnej | 100000”) idzie
 * jako „— limit: 100 000 zł”. Linia bez numeru to dalszy ciąg poprzedniej.
 */
function parseKlauzule(doc: PdfDoc): string[] {
	const start = doc.lines.findIndex((l) => /^KLAUZULE DODATKOWE/i.test(l.text));
	if (start < 0) return [];
	const out: string[] = [];
	for (const l of doc.lines.slice(start + 1)) {
		if (/^(Franszyza|SKŁADKA\s*\/\s*PREMIUM|INFORMACJE DODATKOWE|PŁATNOŚĆ)/i.test(l.text)) break;
		const nazwa = collapse(l.words.filter((w) => w.x < X_LIMIT).map((w) => w.text).join(' ')) ?? '';
		const limit = formatLimit(collapse(l.words.filter((w) => w.x >= X_LIMIT).map((w) => w.text).join(' ')));
		const m = nazwa.match(/^\d+\.\s*(.+)$/);
		if (m) out.push(limit ? `${m[1].trim()} — limit: ${limit}` : m[1].trim());
		else if (nazwa && out.length) out[out.length - 1] = `${out[out.length - 1]} ${nazwa}`.trim();
	}
	return out;
}

/** Limit z kolumny: kwota („100000”, „100 000,00 zł”) jako „100 000 zł”, inny tekst bez zmian, „null” z PDF-a to brak. */
function formatLimit(raw: string | null): string | null {
	if (!raw || /^null$/i.test(raw)) return null;
	if (!/^[\d\s.,]+(?:\s*zł)?$/i.test(raw)) return raw;
	const kwota = toAmount(raw);
	return kwota == null ? raw : `${kwota.toLocaleString('pl-PL')} zł`;
}
