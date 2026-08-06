// UNIQA — nowy układ polisy komunikacyjnej Flota (generator Quadient Inspire).
// Dokument jest "kartowy": nagłówki nad wartościami, dane stron w blokach
// etykietowanych (Ubezpieczający / Ubezpieczony / Współubezpieczony),
// a pojazdy w tabeli "Wykaz pojazdów" na osobnej stronie.

import type { ExtractedPolicy, RiskItem, VehicleData } from '../types';
import { emptyExtraction } from '../types';
import type { PdfDoc } from '../pdfDoc';
import { collapse, digits, grab, grabAll, toAmount, toDate } from '../parse';

const NAZWY_RYZYK: Record<string, string> = {
	OC: 'OC posiadaczy pojazdów mechanicznych',
	AC: 'Auto Casco',
	ASS: 'Assistance',
	NNW: 'NNW kierowców i pasażerów',
	NNWK: 'NNW kierowcy',
	ZK: 'Zielona Karta'
};

/** Rozpoznaje nowy układ — odróżnia go od klasycznego „Auto & Przestrzeń". */
export function czyNowyUklad(doc: PdfDoc): boolean {
	return /NUMER UMOWY GENERALNEJ/i.test(doc.text) || /Wykaz pojazdów/i.test(doc.text);
}

export function parse(doc: PdfDoc): ExtractedPolicy {
	const out = emptyExtraction();
	const text = doc.text;

	// Nagłówek: numer polisy i numer umowy generalnej w jednym wierszu pod etykietami.
	out.nr_polisy = grab(text, /NUMER POLISY\s+NUMER UMOWY GENERALNEJ\s*\n\s*(\S+)\s+(\S+)/i, 1);
	out.program_ug = grab(text, /NUMER POLISY\s+NUMER UMOWY GENERALNEJ\s*\n\s*(\S+)\s+(\S+)/i, 2);
	if (!out.nr_polisy) out.nr_polisy = grab(text, /NUMER POLISY\s*\n?\s*(\d{10,})/i);

	out.data_od = toDate(grab(text, /(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/, 1));
	out.data_do = toDate(grab(text, /(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/, 2));
	out.data_zawarcia = toDate(
		grab(text, /DATA WYSTAWIENIA POLISY\s*\n?\s*(\d{2}\.\d{2}\.\d{4})/i) ??
			grab(text, /^[A-ZŁŚĆŻŹÓĄĘŃa-złśćżźóąęń]+,\s*(\d{2}\.\d{2}\.\d{4})/m)
	);

	parseStrony(doc, out);

	out.skladka =
		toAmount(grab(text, /Składka łączna przy płatności jednorazowej\s*([\d\s.,]+)\s*zł/i)) ??
		toAmount(grab(text, /SKŁADKA ŁĄCZNA\s*([\d\s.,]+)\s*zł/i));

	const termin = toDate(grab(text, /Termin płatności\s*(\d{4}-\d{2}-\d{2})/i));
	const kwotaRaty = toAmount(grab(text, /^Płatność\s+([\d\s.,]+)\s*zł$/im));
	if (termin) out.raty = [{ data: termin, kwota: kwotaRaty ?? out.skladka }];
	out.ilosc_rat = out.raty.length || null;

	out.konto_do_wplat = collapse(
		grab(text, /PRZELEW NA RACHUNEK BANKOWY\s*\n\s*(\d{20,32})/i)
	);

	out.ryzyka = parseRyzyka(text);

	const pojazdy = parseWykazPojazdow(text);
	if (pojazdy.length === 1) {
		out.pojazd = pojazdy[0];
		out.rodzaj = 'komunikacja';
	} else if (pojazdy.length > 1) {
		// Wykaz wielopojazdowy: w CRM polisa wskazuje jeden pojazd, więc taka
		// polisa jest flotą, a spis pojazdów trafia do opisu przedmiotu.
		out.rodzaj = 'flota';
		out.dodatkowe['Liczba pojazdów w wykazie'] = String(pojazdy.length);
	}
	out.przedmiot = buildPrzedmiot(pojazdy, out.ryzyka);

	const owu = grab(text, /OWU wz\.?\s*(\d{3,4})/i);
	if (owu) out.produkt_owu = `UNIQA OWU wz. ${owu}`;

	const sumaNnw = toAmount(grab(text, /•\s*Suma ubezpieczenia:\s*([\d\s.,]+)\s*zł/i));
	if (sumaNnw) out.dodatkowe['Suma NNW na osobę'] = `${sumaNnw.toLocaleString('pl-PL')} zł`;

	const broker = collapse(grab(text, /^Broker\s+(.+)$/im));
	if (broker) out.dodatkowe['Pośrednik'] = broker;

	const wystawiajacy = collapse(grab(text, /^Wystawiający\s+(.+)$/im));
	if (wystawiajacy) out.dodatkowe['Wystawiający'] = wystawiajacy;

	const liczba = grab(text, /•\s*Liczba pojazdów:\s*(\d+)/i);
	if (liczba) out.dodatkowe['Liczba pojazdów (OC)'] = liczba;

	if (out.program_ug) out.dodatkowe['Nr Umowy generalnej'] = out.program_ug;

	const uwagi = collapse(grab(text, /Uwagi do polisy\s*\n([^\n]+)/i));
	if (uwagi && !/^Załączniki/i.test(uwagi)) out.dodatkowe['Uwagi do polisy'] = uwagi;

	return out;
}

/**
 * Bloki stron umowy są etykietowane, a dane ciągną się przez łamanie stron
 * (Ubezpieczony zaczyna się na stronie 1, a kończy na 2). Dlatego zbieramy
 * wiersze w kolejności dokumentu, między etykietami, biorąc tylko pola danych.
 */
function parseStrony(doc: PdfDoc, out: ExtractedPolicy) {
	const ubezpieczajacy = blokDanych(doc, /^Ubezpieczający$/i, /^Ubezpieczony$/i);
	if (ubezpieczajacy) {
		out.klient_nazwa = collapse(grab(ubezpieczajacy, /^Nazwa\s+(.+)$/im));
		out.klient_adres = collapse(grab(ubezpieczajacy, /^Adres\s+(.+)$/im));
		out.klient_regon = digits(grab(ubezpieczajacy, /^REGON\s+([\d\s]+)$/im));
		out.klient_nip = digits(grab(ubezpieczajacy, /^NIP\s+([\d\s-]+)$/im));
	}

	const ubezpieczony = blokDanych(doc, /^Ubezpieczony$/i, /^(Współubezpieczony|Pośrednik)$/i);
	if (ubezpieczony) {
		out.ubezpieczony_nazwa = collapse(grab(ubezpieczony, /^Nazwa\s+(.+)$/im));
		out.ubezpieczony_regon = digits(grab(ubezpieczony, /^REGON\s+([\d\s]+)$/im));
		out.ubezpieczony_nip = digits(grab(ubezpieczony, /^NIP\s+([\d\s-]+)$/im));
	}
}

function blokDanych(doc: PdfDoc, od: RegExp, doEtykiety: RegExp): string | null {
	const start = doc.lines.findIndex((l) => od.test(l.text));
	if (start === -1) return null;
	const wiersze: string[] = [];
	for (let i = start + 1; i < doc.lines.length; i++) {
		const t = doc.lines[i].text;
		if (doEtykiety.test(t)) break;
		// Stopka i nagłówki stron przeplatają blok — bierzemy wyłącznie pola danych.
		if (/^(Nazwa|Adres|REGON|NIP|PESEL)\s+\S/i.test(t)) wiersze.push(t);
	}
	return wiersze.length ? wiersze.join('\n') : null;
}

// Harmonogram płatności zawiera składkę per ryzyko: "OC 428,00 zł".
function parseRyzyka(text: string): RiskItem[] {
	const kody = Object.keys(NAZWY_RYZYK).join('|');
	const re = new RegExp(String.raw`^(${kody})\s+([\d\s.,]+)\s*zł$`, 'gim');
	const widziane = new Set<string>();
	const ryzyka: RiskItem[] = [];
	for (const m of grabAll(text, re)) {
		const kod = m[1].toUpperCase();
		if (widziane.has(kod)) continue;
		const skladka = toAmount(m[2]);
		if (skladka == null || skladka <= 0) continue;
		widziane.add(kod);
		ryzyka.push({
			sekcja: 'Harmonogram płatności',
			przedmiot: NAZWY_RYZYK[kod] ?? kod,
			suma: null,
			skladka
		});
	}
	return ryzyka;
}

/**
 * Wiersz wykazu: marka, model, nr rejestracyjny, VIN, rok produkcji, a dalej
 * kolumny składek. Rejestracja i 17-znakowy VIN kotwiczą podział, więc model
 * może zawierać spacje.
 */
function parseWykazPojazdow(text: string): VehicleData[] {
	const rodzaje = grabAll(text, /^[A-Z]\s*-\s*(.+)$/gm).map((m) => collapse(m[1]));
	const rodzaj = rodzaje.length === 1 ? rodzaje[0] : null;

	return grabAll(
		text,
		/^(\S+)\s+(.+?)\s+([A-Z0-9]{4,10})\s+([A-HJ-NPR-Z0-9]{17})\s+(\d{4})\b/gim
	).map((m) => ({
		nr_rejestracyjny: m[3].toUpperCase(),
		vin: m[4].toUpperCase(),
		marka_model: collapse(`${m[1]} ${m[2]}`),
		rok_produkcji: Number(m[5]),
		rodzaj_pojazdu: rodzaj,
		pojemnosc_silnika: null,
		moc: null,
		ladownosc: null
	}));
}

function buildPrzedmiot(pojazdy: VehicleData[], ryzyka: RiskItem[]): string | null {
	const czesci: string[] = [];
	if (pojazdy.length === 1) {
		const p = pojazdy[0];
		czesci.push(
			[[p.nr_rejestracyjny, p.vin].filter(Boolean).join(' / '), p.marka_model]
				.filter(Boolean)
				.join(' — ')
		);
	} else if (pojazdy.length > 1) {
		czesci.push(
			`Wykaz ${pojazdy.length} pojazdów: ` +
				pojazdy.map((p) => `${p.nr_rejestracyjny} (${p.marka_model})`).join(', ')
		);
	}
	const zakres = ryzyka.map((r) => r.przedmiot);
	if (zakres.length) czesci.push(`Zakres: ${zakres.join(', ')}`);
	return czesci.join(' | ') || null;
}
