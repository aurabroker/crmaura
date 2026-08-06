// UNIQA — Auto & Przestrzeń, ubezpieczenia komunikacyjne (w tym Flota).
// Układ etykieta–wartość: etykieta w lewej kolumnie (x < 140), wartości od x ≈ 142.
// Certyfikat pojedynczego pojazdu w ramach Floty niesie numer Umowy generalnej,
// a jako ubezpieczonego wskazuje finansującego (leasing) — ubezpieczającym jest klient.

import type { ExtractedPolicy, LeasingData, RiskItem, VehicleData } from '../types';
import { emptyExtraction } from '../types';
import type { PdfDoc } from '../pdfDoc';
import { collapse, digits, grab, toAmount, toDate } from '../parse';
import { czyNowyUklad, parse as parseNowyUklad } from './uniqa-flota-2026';

const X_WARTOSCI = 140;

/** Kody ryzyk UNIQA użyte w tabeli składek → czytelne nazwy. */
const RYZYKA: Record<string, string> = {
	'KOCF, KZK-1': 'OC posiadaczy pojazdów mechanicznych',
	KOCF: 'OC posiadaczy pojazdów mechanicznych',
	KACF: 'Auto Casco',
	KASSIF: 'Assistance',
	KASSITF: 'Assistance — wariant rozszerzony',
	KGLASF: 'Ubezpieczenie szyb',
	OKNWF: 'NNW kierowcy i pasażerów',
	OKNWKF: 'NNW kierowcy',
	KREHF: 'Ubezpieczenie opon / pomoc'
};

export function detect(doc: PdfDoc): string | null {
	if (!/UNIQA/i.test(doc.text))
		return 'W dokumencie nie znaleziono oznaczeń UNIQA — to nie jest polisa tego towarzystwa.';
	if (!/Ubezpieczenia komunikacyjne|POJAZD|Wykaz pojazdów/i.test(doc.text))
		return 'To nie jest polisa komunikacyjna UNIQA — brak sekcji pojazdu.';
	return null;
}

/**
 * UNIQA wystawia polisy komunikacyjne w dwóch układach: starszym
 * „Auto & Przestrzeń" (etykieta z lewej, wartość z prawej) i nowszym,
 * kartowym z wykazem pojazdów. Broker wybiera jeden produkt, a układ
 * rozpoznajemy z treści dokumentu.
 */
export function parse(doc: PdfDoc): ExtractedPolicy {
	return czyNowyUklad(doc) ? parseNowyUklad(doc) : parseAutoPrzestrzen(doc);
}

function parseAutoPrzestrzen(doc: PdfDoc): ExtractedPolicy {
	const out = emptyExtraction();
	const text = doc.text;

	out.nr_polisy = grab(text, /^\s*Nr\s+(\d{8,})\s*$/m) ?? grab(text, /Polisa Nr\s+(\d{8,})/i);
	out.data_od = toDate(
		grab(text, /na okres:?\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/i, 1)
	);
	out.data_do = toDate(
		grab(text, /na okres:?\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/i, 2)
	);
	out.data_zawarcia = toDate(
		grab(text, /Data wystawienia polisy:\s*(\d{2}\.\d{2}\.\d{4})/i) ??
			grab(text, /^\s*(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}\s*$/m)
	);

	// Numer Umowy generalnej = klucz do podpięcia pod UG w CRM.
	out.program_ug =
		grab(text, /Nr Umowy generalnej\s*([A-Z0-9/]+)/i) ?? grab(text, /Sygnatura\s*([A-Z0-9/]+)/i);

	parseStrony(doc, out);
	out.pojazd = parsePojazd(doc);

	// Pojedynczy pojazd w ramach Floty pozostaje polisą komunikacyjną —
	// flotę reprezentuje Umowa generalna, pod którą polisa zostanie podpięta.
	const wRamachFloty = /w ramach Floty/i.test(text);
	out.rodzaj = wRamachFloty || out.pojazd ? 'komunikacja' : null;

	out.skladka =
		toAmount(grab(text, /Składka łączna:\s*([\d\s.,]+)\s*zł/i)) ??
		toAmount(grab(text, /Kwota I raty:\s*([\d\s.,]+)\s*zł/i));

	const termin = toDate(grab(text, /do dnia:\s*(\d{2}-\d{2}-\d{4})/i));
	if (termin) out.raty = [{ data: termin, kwota: out.skladka }];
	out.ilosc_rat = out.raty.length || null;
	out.konto_do_wplat = collapse(grab(text, /na konto nr\s*([\d\s]{20,34})/i));

	out.ryzyka = parseSkladki(doc);
	out.przedmiot = buildPrzedmiot(out.pojazd, out.ryzyka);

	out.produkt_owu = collapse(grab(text, /(UNIQA wz\.?\s*\d{4})/i));

	const wariantAc = collapse(grab(text, /Wariant ubezpieczenia\s+([^\n]+)/i));
	if (wariantAc) out.dodatkowe['Wariant AC'] = wariantAc;

	// Polisa wylicza oba warianty AC; obowiązuje ten z niezerową liczbą pojazdów.
	const wierszAc = [
		...text.matchAll(
			/Zakres:\s*(pełny|ograniczony)\s*Liczba pojazdów:\s*(\d+)\s*Suma ubezpieczenia netto:\s*([\d\s.,]+)\s*zł/gi
		)
	].find((m) => Number(m[2]) > 0);
	if (wierszAc) {
		out.dodatkowe['Zakres AC'] = wierszAc[1];
		const sumaAc = toAmount(wierszAc[3]);
		if (sumaAc)
			out.dodatkowe['Suma ubezpieczenia AC (netto)'] = `${sumaAc.toLocaleString('pl-PL')} zł`;
	}

	const franszyza = collapse(grab(text, /(Franszyza integralna[^\n]+)/i));
	if (franszyza) out.dodatkowe['Franszyza'] = franszyza;

	const nnw = toAmount(grab(text, /Suma ubezpieczenia na osobę:\s*([\d\s.,]+)\s*zł/i));
	if (nnw) out.dodatkowe['Suma NNW na osobę'] = `${nnw.toLocaleString('pl-PL')} zł`;

	const posrednik = collapse(grab(text, /BROKER\s+([^\n]+)/i));
	if (posrednik) out.dodatkowe['Pośrednik'] = posrednik;

	const wystawiajacy = collapse(grab(text, /WYSTAWIAJĄCY\s+([^\n]+)/i));
	if (wystawiajacy) out.dodatkowe['Wystawiający'] = wystawiajacy;

	const miejsca = grab(text, /Liczba miejsc:\s*(\d+)/i);
	if (miejsca) out.dodatkowe['Liczba miejsc'] = miejsca;

	const grupa = grab(text, /Kod Grupy pojazdu:?\s*([A-Z0-9]+)/i);
	if (grupa) out.dodatkowe['Kod grupy pojazdu'] = grupa;

	if (out.program_ug) out.dodatkowe['Nr Umowy generalnej'] = out.program_ug;
	if (out.leasing?.nazwa)
		out.dodatkowe['Ubezpieczony (finansujący)'] =
			`${out.leasing.nazwa}${out.leasing.regon ? ` — REGON ${out.leasing.regon}` : ''}`;

	return out;
}

// UBEZPIECZAJĄCY to klient; UBEZPIECZONY przy leasingu to finansujący,
// więc zgodność z kartoteką sprawdzamy zawsze po ubezpieczającym.
function parseStrony(doc: PdfDoc, out: ExtractedPolicy) {
	const blokUbezpieczajacy = blokPoEtykiecie(doc, 'UBEZPIECZAJĄCY', 24);
	if (blokUbezpieczajacy) {
		out.klient_regon = digits(grab(blokUbezpieczajacy, /REGON\s*([\d\s]{9,17})/i));
		out.klient_nip = digits(grab(blokUbezpieczajacy, /NIP\s*([\d\s-]{10,13})/i));
		const [pierwszy, ...reszta] = blokUbezpieczajacy.split('\n');
		out.klient_nazwa = collapse(pierwszy.replace(/\s*(REGON|NIP)\s*[\d\s-]+$/i, ''));
		out.klient_adres = collapse(reszta.join(', '));
	}

	const blokUbezpieczony = blokPoEtykiecie(doc, 'UBEZPIECZONY', 24);
	if (blokUbezpieczony) {
		const [pierwszy, ...reszta] = blokUbezpieczony.split('\n');
		out.ubezpieczony_nazwa = collapse(pierwszy.replace(/\s*(REGON|NIP)\s*[\d\s-]+$/i, ''));
		out.ubezpieczony_regon = digits(grab(blokUbezpieczony, /REGON\s*([\d\s]{9,17})/i));
		out.ubezpieczony_nip = digits(grab(blokUbezpieczony, /NIP\s*([\d\s-]{10,13})/i));

		const leasing: LeasingData = {
			nazwa: out.ubezpieczony_nazwa,
			nip: out.ubezpieczony_nip,
			regon: out.ubezpieczony_regon,
			adres: collapse(reszta.join(', '))
		};
		// Finansującego rozpoznajemy po formie prawnej w nazwie — przy polisie
		// bez leasingu ubezpieczonym jest po prostu właściciel pojazdu.
		if (leasing.nazwa && /leasing|bank|fleet|finance/i.test(leasing.nazwa)) out.leasing = leasing;
	}
}

/**
 * Wartości należące do etykiety z lewej kolumny: wszystko na prawo od niej,
 * od jej wiersza w dół, aż do wiersza kolejnej etykiety.
 */
function blokPoEtykiecie(doc: PdfDoc, etykieta: string, wysokosc: number): string | null {
	const lbl = doc.words.find((w) => w.page === 1 && w.text === etykieta && w.x < X_WARTOSCI);
	if (!lbl) return null;
	const nastepna = doc.words
		.filter((w) => w.page === 1 && w.x < X_WARTOSCI && w.y < lbl.y - 1)
		.sort((a, b) => b.y - a.y)[0];
	const dol = nastepna ? Math.max(nastepna.y + 1, lbl.y - wysokosc) : lbl.y - wysokosc;
	const blok = doc.region(1, { yFrom: dol, yTo: lbl.y + 1, xFrom: X_WARTOSCI });
	return blok || null;
}

function parsePojazd(doc: PdfDoc): VehicleData | null {
	const blok = blokPojazdu(doc);
	if (!blok) return null;

	const pojazd: VehicleData = {
		nr_rejestracyjny: collapse(grab(blok, /Numer rejestracyjny:\s*([A-Z0-9]+)/i))?.toUpperCase() ?? null,
		vin: collapse(grab(blok, /Numer seryjny:\s*([A-Z0-9]+)/i))?.toUpperCase() ?? null,
		marka_model: collapse(grab(blok, /Marka i model:\s*(.+?)(?:\s{2,}|$)/im)),
		rok_produkcji: intOrNull(grab(blok, /Rok produkcji:\s*(\d{4})/i)),
		rodzaj_pojazdu: collapse(grab(blok, /Rodzaj pojazdu:\s*(.+?)$/im)),
		pojemnosc_silnika: intOrNull(grab(blok, /Pojemność:\s*([\d\s]+)\s*ccm/i)),
		moc: intOrNull(grab(blok, /Moc:\s*([\d\s]+)\s*(?:kW|KM)/i)),
		ladownosc: intOrNull(grab(blok, /Ładowność:\s*([\d\s]+)\s*kg/i))
	};
	return pojazd.nr_rejestracyjny || pojazd.vin ? pojazd : null;
}

/**
 * Sekcja pojazdu ma dwie pary etykieta–wartość w jednym wierszu
 * ("Marka i model: … | Liczba miejsc: …"). Czytana wierszami skleiłaby obie
 * pary, więc rozcinamy ją na kolumny po pozycji drugiej kolumny etykiet.
 */
function blokPojazdu(doc: PdfDoc): string | null {
	const lbl = doc.words.find((w) => w.page === 1 && w.text === 'POJAZD' && w.x < X_WARTOSCI);
	if (!lbl) return null;
	const yTo = lbl.y + 1;
	const yFrom = lbl.y - 50;

	const xDrugiejKolumny = Math.min(
		...doc.words
			.filter((w) => w.page === 1 && w.y >= yFrom && w.y <= yTo && w.x > 300 && w.text.endsWith(':'))
			.map((w) => w.x),
		Infinity
	);
	const granica = Number.isFinite(xDrugiejKolumny) ? xDrugiejKolumny - 5 : Infinity;

	const lewa = doc.region(1, { yFrom, yTo, xFrom: X_WARTOSCI, xTo: granica });
	const prawa = Number.isFinite(granica) ? doc.region(1, { yFrom, yTo, xFrom: granica }) : '';
	const blok = [lewa, prawa].filter(Boolean).join('\n');
	return blok || null;
}

/**
 * Tabela składek: wiersz kodów ryzyk i wiersz kwot pod nim.
 * Kwoty są wyrównane do prawej, więc zamiast dopasowania po X zestawiamy
 * je po kolejności — liczba kolumn musi się zgadzać, inaczej pomijamy tabelę.
 */
function parseSkladki(doc: PdfDoc): RiskItem[] {
	const naglowek = doc.lines.find((l) => l.page === 1 && /^SKŁADKA\s+KOCF/i.test(l.text));
	if (!naglowek) return [];

	const kody = naglowek.words
		.filter((w) => w.x >= X_WARTOSCI)
		.map((w) => w.text)
		.join(' ')
		.split(/\s+(?=[A-Z]{4,}|KOCF)/)
		.map((s) => s.trim())
		.filter(Boolean);

	// Wiersz kwot: pierwszy poniżej nagłówka zbudowany wyłącznie z kwot.
	const wiersz = doc.lines.find(
		(l) => l.page === 1 && l.y < naglowek.y && l.y > naglowek.y - 20 && /^[\d\s.,]+zł(\s|$)/.test(l.text)
	);
	if (!wiersz) return [];

	const kwoty = wiersz.words
		.map((w) => w.text)
		.join(' ')
		.split(/\s*zł\s*/)
		.map((s) => toAmount(s))
		.filter((n): n is number => n != null);

	if (kody.length !== kwoty.length) return [];

	return kody
		.map((kod, i) => ({
			sekcja: 'Składka',
			przedmiot: RYZYKA[kod] ?? kod,
			suma: null,
			skladka: kwoty[i]
		}))
		.filter((r) => (r.skladka ?? 0) > 0);
}

function buildPrzedmiot(pojazd: VehicleData | null, ryzyka: RiskItem[]): string | null {
	const czesci: string[] = [];
	if (pojazd) {
		const opis = [pojazd.nr_rejestracyjny, pojazd.vin].filter(Boolean).join(' / ');
		czesci.push(pojazd.marka_model ? `${opis} — ${pojazd.marka_model}` : opis);
	}
	const zakres = ryzyka.map((r) => r.przedmiot).filter(Boolean);
	if (zakres.length) czesci.push(`Zakres: ${zakres.join(', ')}`);
	return czesci.join(' | ') || null;
}

function intOrNull(raw: string | null | undefined): number | null {
	const d = digits(raw);
	if (!d) return null;
	const n = parseInt(d, 10);
	return Number.isFinite(n) ? n : null;
}
