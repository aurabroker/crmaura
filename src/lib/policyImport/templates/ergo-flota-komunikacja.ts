// ERGO HESTIA — Flota / Komunikacja: certyfikaty wystawiane pod Umową Generalną
// (wydruk z systemu Cumulus). Jeden plik niesie wiele certyfikatów — po jednym na
// pojazd, każdy na własnej stronie, z własnym numerem, składką i harmonogramem.
// W CRM każdy certyfikat to osobna polisa komunikacyjna podpięta pod UG, a dane
// pojazdu z certyfikatu (rodzaj rejestrowy, liczba miejsc, pierwsza rejestracja,
// wykorzystanie) zasilają zaszeregowanie w kartotece.

// Importy względne z rozszerzeniem, żeby szablon dało się uruchomić w testach node (--experimental-strip-types).
import type { ExtractedPolicy, RiskItem, VehicleData } from '../types.ts';
import { emptyExtraction } from '../types.ts';
import { PdfDoc, type Word } from '../pdfDoc.ts';
import { collapse, grab, grabAll, toAmount, toDate } from '../parse.ts';
import { rodzajKalkulacyjny, uzytkowanieZTekstu } from '../../hestia/pojazd.ts';

const NAZWY_RYZYK: Record<string, string> = {
	OC: 'OC posiadaczy pojazdów mechanicznych',
	AC: 'Autocasco',
	KR: 'Kradzież (KR)',
	NNW: 'NNW kierowcy i pasażerów',
	NNWK: 'NNW kierowcy',
	ASS: 'Assistance',
	ZK: 'Zielona Karta',
	SZYBY: 'Szyby',
	OP: 'Ochrona prawna'
};

/** Parametry ryzyka drukowane pod wierszem składki (głównie AC). */
const PARAMETRY_RYZYKA = [
	'Rodzaj sumy ubezpieczenia',
	'Udział własny',
	'Franszyza integralna',
	'System likwidacji',
	'Konsumpcja sumy ubezpieczenia',
	'Zakres terytorialny',
	'Transport'
];

const NAGLOWEK = /^NUMER CERTYFIKATU/i;

export function detect(doc: PdfDoc): string | null {
	if (!/ERGO Hestia/i.test(doc.text))
		return 'W dokumencie nie znaleziono oznaczeń ERGO Hestii — to nie jest polisa tego towarzystwa.';
	if (!/NUMER CERTYFIKATU/i.test(doc.text) || !/UBEZPIECZONY POJAZD/i.test(doc.text))
		return 'Brak nagłówka „NUMER CERTYFIKATU” z blokiem „UBEZPIECZONY POJAZD” — to nie jest certyfikat komunikacyjny z umowy generalnej.';
	return null;
}

/**
 * Certyfikaty z pliku: strona z nagłówkiem „NUMER CERTYFIKATU” zaczyna certyfikat,
 * strona bez nagłówka (dalszy ciąg ryzyk) należy do poprzedniego.
 */
export function parseMany(doc: PdfDoc): ExtractedPolicy[] {
	const grupy: Word[][] = [];
	for (let p = 1; p <= doc.pageCount; p++) {
		const words = doc.words.filter((w) => w.page === p);
		if (!words.length) continue;
		const naglowek = words.some((w) => NAGLOWEK.test(w.text));
		if (naglowek || !grupy.length) grupy.push(words);
		else grupy[grupy.length - 1].push(...words);
	}
	return grupy
		.filter((g) => g.some((w) => NAGLOWEK.test(w.text)))
		.map((g) => parseCertyfikat(new PdfDoc(g, doc.pageCount, doc.pageWidth)));
}

/** Pierwszy certyfikat z pliku — dla ścieżki jednopolisowej. */
export function parse(doc: PdfDoc): ExtractedPolicy {
	return parseMany(doc)[0] ?? emptyExtraction();
}

function parseCertyfikat(doc: PdfDoc): ExtractedPolicy {
	const out = emptyExtraction();
	// pdf.js oddaje przecinek jako osobne słowo („ODPOWIEDZIALNOŚCIĄ , Uśmiechu”).
	const text = doc.text.replace(/\s+,/g, ',');

	out.nr_polisy =
		grab(text, /CERTIFICATE NUMBER\s*([A-Z0-9]+\/[A-Z0-9/]+)/i) ??
		grab(text, /NUMER CERTYFIKATU[^\n]*?([A-Z0-9]{3,}\/[A-Z0-9/]+)\s*$/im);
	// Numer polisy generalnej pod nagłówkiem; w razie czego z podstawy prawnej albo z numeru
	// certyfikatu (sześć cyfr na końcu to numer pozycji w umowie).
	out.program_ug =
		grab(text, /general policy:\s*([A-Z0-9]+\/[A-Z0-9/]+)/i) ??
		grab(text, /Umowa Generalna nr\s*([A-Z0-9]+\/[A-Z0-9/]+)/i) ??
		(out.nr_polisy ? out.nr_polisy.replace(/\d{6}$/, '') : null);

	const okres = text.match(
		/Period of insurance\s*(\d{2}\.\d{2}\.\d{4})(?:\s*\d{2}:\d{2})?\s*-\s*(\d{2}\.\d{2}\.\d{4})/i
	);
	out.data_od = toDate(okres?.[1]);
	out.data_do = toDate(okres?.[2]);
	// Stopka: „23.06.2026 / 23.06.2026” nad „Data wystawienia / Data zawarcia”.
	out.data_zawarcia = toDate(
		grab(text, /(\d{2}\.\d{2}\.\d{4})\s*\/\s*(\d{2}\.\d{2}\.\d{4})\s*\n[^\n]*Data zawarcia/i, 2)
	);

	parseStrony(text, out);
	out.pojazd = parsePojazd(text, out);
	out.ryzyka = parseRyzyka(text, out);

	out.skladka = toAmount(grab(text, /SKŁADKA\s*\/\s*PREMIUM\s*([\d\s.,]+)\s*zł/i));
	out.raty = grabAll(text, /^(\d{2}\.\d{2}\.\d{4})\s*\/\s*([\d\s.,]+)\s*zł\s*$/gm).map((m) => ({
		data: toDate(m[1])!,
		kwota: toAmount(m[2])
	}));
	out.ilosc_rat = out.raty.length || null;
	out.konto_do_wplat = collapse(grab(text, /rachunek bankowy numer:\s*(\d[\d ]{20,40}\d)/i));

	const owu = [...new Set(grabAll(text, /nr\s+(AB-[A-Z]+-\d+\/\d+)/gi).map((m) => m[1].toUpperCase()))];
	if (owu.length) out.produkt_owu = owu.join(', ');
	const underwriter = grab(text, /Underwriter No\.?:\s*(\d+)/i);
	if (underwriter) out.dodatkowe['Numer underwritera'] = underwriter;

	// Jeden certyfikat = jeden pojazd, więc w CRM to polisa komunikacyjna (nie flota).
	out.rodzaj = 'komunikacja';
	out.przedmiot = buildPrzedmiot(out.pojazd, out.ryzyka);
	return out;
}

type Podmiot = { nazwa: string | null; adres: string | null; nip: string | null; regon: string | null };

/**
 * Certyfikat podaje NIP przy ubezpieczającym, a REGON przy ubezpieczonym. Gdy to ta sama
 * firma, oba numery opisują klienta; gdy ubezpieczonym jest finansujący — idzie do leasingów.
 */
function parseStrony(text: string, out: ExtractedPolicy) {
	const ubezpieczajacy = podmiot(blok(text, /^UBEZPIECZAJĄCY\b/i, /^UBEZPIECZONY\s*\//i));
	const ubezpieczony = podmiot(blok(text, /^UBEZPIECZONY\s*\//i, /^UBEZPIECZONY POJAZD/i));

	out.klient_nazwa = ubezpieczajacy.nazwa;
	out.klient_adres = ubezpieczajacy.adres;
	out.klient_nip = ubezpieczajacy.nip;
	out.klient_regon = ubezpieczajacy.regon;
	if (!ubezpieczony.nazwa) return;

	const tenSam =
		uprosc(ubezpieczony.nazwa) === uprosc(ubezpieczajacy.nazwa) ||
		(!!ubezpieczony.nip && ubezpieczony.nip === ubezpieczajacy.nip);
	out.ubezpieczony_nazwa = ubezpieczony.nazwa;
	out.ubezpieczony_regon = ubezpieczony.regon;
	if (tenSam) {
		out.klient_regon = out.klient_regon ?? ubezpieczony.regon;
		out.ubezpieczony_nip = ubezpieczony.nip ?? out.klient_nip;
		return;
	}
	out.ubezpieczony_nip = ubezpieczony.nip;
	if (/LEASING|LEASE|FINANC|\bBANK\b|FUNDUSZ|\bRENT/i.test(ubezpieczony.nazwa))
		out.leasing = { nazwa: ubezpieczony.nazwa, nip: ubezpieczony.nip, regon: ubezpieczony.regon, adres: ubezpieczony.adres };
}

/** Wiersze między etykietą początkową a końcową (bez nich). */
function blok(text: string, od: RegExp, doEtykiety: RegExp): string {
	const linie = text.split('\n');
	const start = linie.findIndex((l) => od.test(l));
	if (start === -1) return '';
	const wynik: string[] = [];
	for (let i = start + 1; i < linie.length; i++) {
		if (doEtykiety.test(linie[i])) break;
		wynik.push(linie[i]);
	}
	return wynik.join('\n');
}

/** „NAZWA, ulica nr, 00-000 Miasto, NIP: 1234567890” → nazwa, adres, NIP/REGON. */
function podmiot(tresc: string): Podmiot {
	const nip = grab(tresc, /NIP:?\s*(\d{10})/i);
	const regon = grab(tresc, /REGON:?\s*(\d{14}|\d{9})/i);
	const jedna =
		collapse(
			tresc
				.replace(/NIP:?\s*\d{10}/gi, '')
				.replace(/REGON:?\s*\d+/gi, '')
				.split('\n')
				.join(' ')
		) ?? '';
	const czysta = jedna.replace(/[,\s]+$/, '');
	// Nazwa może zawierać przecinki — kotwicą są dwa ostatnie człony: ulica i kod z miejscowością.
	const m = czysta.match(/^(.+),\s*([^,]+),\s*(\d{2}-\d{3}\s+[^,]+)$/);
	if (m) return { nazwa: collapse(m[1]), adres: collapse(`${m[2]}, ${m[3]}`), nip, regon };
	return { nazwa: collapse(czysta) || null, adres: null, nip, regon };
}

/**
 * Blok „UBEZPIECZONY POJAZD”: trzy wiersze etykiet w stałych kolumnach, wartości bywają puste
 * (TYP, LICZBA MIEJSC). Indeks górny „3” z [cm³] pdf.js wkleja między „[cm” a „]:”.
 */
function parsePojazd(text: string, out: ExtractedPolicy): VehicleData | null {
	const l1 = text.match(
		/MARKA:\s*(.*?)\s*DATA I REJESTRACJI:\s*(.*?)\s*NR REJ:\s*(.*?)\s*POJEMNOŚĆ\s*\[cm\s*3?\s*\]:\s*(.*)$/im
	);
	const l2 = text.match(
		/MODEL:\s*(.*?)\s*ROK PRODUKCJI:\s*(.*?)\s*VIN:\s*(.*?)\s*ŁADOWNOŚĆ\s*\[kg\]:\s*(.*)$/im
	);
	const l3 = text.match(/TYP:\s*(.*?)\s*RODZAJ:\s*(.*?)\s*LICZBA MIEJSC:\s*(.*)$/im);
	if (!l1 && !l2) return null;

	const marka = collapse(l1?.[1]);
	const model = collapse(l2?.[1]);
	const rej = collapse(l1?.[3])?.replace(/\s/g, '').toUpperCase() || null;
	const vin = collapse(l2?.[3])?.replace(/\s/g, '').toUpperCase() || null;
	const rokTekst = collapse(l2?.[2]);
	const pojemnosc = toAmount(l1?.[4]);
	const ladownosc = toAmount(l2?.[4]);
	const rodzajRej = collapse(l3?.[2])?.toUpperCase() ?? null;
	const miejscaTekst = collapse(l3?.[3]);
	const typ = collapse(l3?.[1]);

	const wykorzystanie = collapse(grab(text, /WYKORZYSTANIE POJAZDU:\s*(.+)$/im));
	if (wykorzystanie) out.dodatkowe['Wykorzystanie pojazdu'] = wykorzystanie;
	const uzytkowanie = uzytkowanieZTekstu(wykorzystanie);

	return {
		nr_rejestracyjny: rej,
		vin,
		marka_model: collapse([marka, model].filter(Boolean).join(' ')),
		rok_produkcji: rokTekst && /^\d{4}$/.test(rokTekst) ? Number(rokTekst) : null,
		rodzaj_pojazdu: rodzajRej ? rodzajRej.charAt(0) + rodzajRej.slice(1).toLowerCase() : null,
		pojemnosc_silnika: pojemnosc && pojemnosc > 0 ? Math.round(pojemnosc) : null,
		moc: null,
		ladownosc: ladownosc && ladownosc > 0 ? Math.round(ladownosc) : null,
		rodzaj_rejestrowy: rodzajRej,
		rodzaj_kalkulacyjny: rodzajKalkulacyjny(rodzajRej, ladownosc),
		typ_pojazdu: typ,
		liczba_miejsc: miejscaTekst && /^\d+$/.test(miejscaTekst) ? Number(miejscaTekst) : null,
		data_pierwszej_rejestracji: toDate(collapse(l1?.[2])),
		uzytkowanie: Object.keys(uzytkowanie).length ? uzytkowanie : null
	};
}

/**
 * Tabela ryzyk: „OC 35 898 000,00 zł 3 300,00 zł” (suma, składka). Pod wierszem AC idą
 * parametry „etykieta wartość” aż do podstawy prawnej — trafiają do informacji dodatkowych.
 */
function parseRyzyka(text: string, out: ExtractedPolicy): RiskItem[] {
	const ryzyka: RiskItem[] = [];
	const linie = text.split('\n');
	const kody = Object.keys(NAZWY_RYZYK)
		.sort((a, b) => b.length - a.length)
		.join('|');
	const re = new RegExp(String.raw`^(${kody})\s+([\d\s.,]+)\s*zł(?:\s+([\d\s.,]+)\s*zł)?\s*$`, 'i');
	for (let i = 0; i < linie.length; i++) {
		const m = linie[i].match(re);
		if (!m) continue;
		const kod = m[1].toUpperCase();
		ryzyka.push({
			sekcja: 'UBEZPIECZONE RYZYKA',
			przedmiot: NAZWY_RYZYK[kod] ?? kod,
			suma: toAmount(m[2]),
			skladka: toAmount(m[3])
		});
		for (let j = i + 1; j < linie.length && !/^PODSTAWA PRAWNA/i.test(linie[j]) && !re.test(linie[j]); j++) {
			const parametr = PARAMETRY_RYZYKA.find((p) => linie[j].toLowerCase().startsWith(`${p.toLowerCase()} `));
			if (parametr) out.dodatkowe[`${kod} — ${parametr.toLowerCase()}`] = linie[j].slice(parametr.length).trim();
		}
	}
	return ryzyka;
}

function buildPrzedmiot(v: VehicleData | null, ryzyka: RiskItem[]): string | null {
	const czesci: string[] = [];
	if (v)
		czesci.push(
			[[v.nr_rejestracyjny, v.vin].filter(Boolean).join(' / '), v.marka_model].filter(Boolean).join(' — ')
		);
	const zakres = ryzyka.map((r) => r.przedmiot);
	if (zakres.length) czesci.push(`Zakres: ${zakres.join(', ')}`);
	return czesci.join(' | ') || null;
}

function uprosc(raw: string | null | undefined): string {
	return (raw ?? '').toUpperCase().replace(/[^A-ZŁŚĆŻŹÓĄĘŃ0-9]/g, '');
}
