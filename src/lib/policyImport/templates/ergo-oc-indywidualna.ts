// ERGO HESTIA — polisa OC z tytułu wykonywania czynności zawodowych wystawiana indywidualnie,
// po ocenie ryzyka (np. OC beauty z włączeniem zabiegów spoza listy programu). Inny układ niż
// certyfikat z Programu („POLISA/POLICY”): etykiety przy lewym marginesie, wartości w prawej
// kolumnie; wartość wielowierszowa ciągnie się w tej kolumnie aż do następnej etykiety.
// Polisa powołuje się na Program Ubezpieczenia — mapper wiąże ją po numerze z Umową Generalną.

import type { ExtractedPolicy, Installment, RiskItem } from '../types';
import { emptyExtraction } from '../types';
import type { Line, PdfDoc } from '../pdfDoc';
import { collapse, digits, grab, toAmount, toDate } from '../parse';

/**
 * Wartości stoją od tej pozycji (zwykle x ≈ 263, w tabeli płatności data raty już od x ≈ 191);
 * wiersz zaczynający się bliżej lewego marginesu (etykiety: x ≈ 47) to nowa etykieta.
 */
const X_WARTOSCI = 150;
/** Stopka (numer strony, dane spółki) leży poniżej — pomijamy ją, żeby nie rozcinała sekcji między stronami. */
const Y_STOPKA = 70;
/** Największy odstęp linii bazowych (pt) uznawany za ciągłość listy — większy zaczyna nowy akapit. */
const ODSTEP_LISTY = 15;
/** Koniec postanowień underwritera: następny nagłówek sekcji (także drugie „Postanowienia dodatkowe:” i lista ubezpieczonych). */
const KONIEC_POSTANOWIEN = /^(?:Klauzule dodatkowe|Postanowienia dodatkowe|Treść klauzul dodatkowych|Składka i sposób płatności|Ubezpieczeni):$/m;

export function detect(doc: PdfDoc): string | null {
	if (!/ERGO Hestia/i.test(doc.text))
		return 'W dokumencie nie znaleziono oznaczeń ERGO Hestii — to nie jest polisa tego towarzystwa.';
	if (/POLISA\/POLICY/i.test(doc.text))
		return 'To certyfikat wystawiony z Programu Ubezpieczenia — wybierz produkt „OC zawodowe — certyfikat z programu”.';
	if (!/^Polisa nr\s+\d+/m.test(doc.text) || !/^Warunki ubezpieczenia:/m.test(doc.text))
		return 'Brak nagłówka „Polisa nr …” z sekcją „Warunki ubezpieczenia” — to nie jest polisa OC zawodowego w tym układzie.';
	return null;
}

export function parse(doc: PdfDoc): ExtractedPolicy {
	const out = emptyExtraction();
	const linie = doc.lines.filter((l) => l.y > Y_STOPKA);
	const tresc = linie.map((l) => l.text).join('\n');

	out.nr_polisy = grab(tresc, /^Polisa nr\s+(\d+)/m);

	// „od 10.02.2026 14:30 do 09.02.2027 23:59” — godziny nie mają kolumny, zostają w parametrach.
	const okres = grab(tresc, /^Okres ubezpieczenia:\s*(.+)$/m) ?? '';
	out.data_od = toDate(grab(okres, /od\s+(\d{2}\.\d{2}\.\d{4})/));
	out.data_do = toDate(grab(okres, /do\s+(\d{2}\.\d{2}\.\d{4})/));
	if (/\d{2}:\d{2}/.test(okres)) out.dodatkowe['Okres ubezpieczenia'] = okres;
	out.data_zawarcia = toDate(grab(tresc, /Polisę wystawiono[^\n]*?dnia\s+(\d{2}\.\d{2}\.\d{4})/i));

	const ubezpieczajacy = strona(linie, /^Ubezpieczający:\s*/);
	out.klient_nazwa = ubezpieczajacy?.nazwa ?? null;
	out.klient_nip = ubezpieczajacy?.nip ?? null;
	out.klient_regon = ubezpieczajacy?.regon ?? null;
	out.klient_adres = ubezpieczajacy?.adres ?? null;
	const ubezpieczony = strona(linie, /^Ubezpieczony:\s*/);
	out.ubezpieczony_nazwa = ubezpieczony?.nazwa ?? null;
	out.ubezpieczony_nip = ubezpieczony?.nip ?? null;
	out.ubezpieczony_regon = ubezpieczony?.regon ?? null;

	const suma = toAmount(grab(tresc, /^Suma ubezpieczenia:\s*([\d\s.,]+)\s*PLN/m));
	out.suma_gwarancyjna = suma;
	out.skladka =
		toAmount(grab(tresc, /^Składka łączna:\s*([\d\s.,]+)\s*PLN/m)) ??
		toAmount(grab(tresc, /^Składka:\s*([\d\s.,]+)\s*PLN/m));

	// Pierwszy wiersz pod „Warunki ubezpieczenia:” to produkt z symbolem taryfowym („… M30-13”).
	const produkt = collapse(grab(tresc, /^Warunki ubezpieczenia:\s*\n(.+)$/m));
	if (produkt) {
		const m = produkt.match(/^(.+?)\s+([A-Z]\d{2}\s*-\s*\d+)$/);
		out.ryzyka.push({
			sekcja: 'Warunki ubezpieczenia',
			przedmiot: m ? `${collapse(m[1])} (${collapse(m[2])})` : produkt,
			suma,
			skladka: out.skladka
		});
	}
	out.ryzyka.push(...parseKlauzule(tresc));
	// Nagłówek „Postanowienia dodatkowe:” stoi dwa razy: postanowienia underwritera (str. 1, przed klauzulami)
	// i stały akapit „Umowę ubezpieczenia zawarto…” przed listą ubezpieczonych — ten drugi to nie postanowienia.
	let postanowienia = blok(tresc, /^Postanowienia dodatkowe:$/m, KONIEC_POSTANOWIEN);
	if (/^\s*Umowę ubezpieczenia zawarto/.test(postanowienia)) postanowienia = '';
	out.ryzyka.push(...parseSublimity(postanowienia));
	out.przedmiot = out.ryzyka[0]
		? out.ryzyka[0].suma != null
			? `${out.ryzyka[0].przedmiot}: ${out.ryzyka[0].suma.toLocaleString('pl-PL')} zł`
			: out.ryzyka[0].przedmiot
		: null;

	out.raty = parseRaty(linie);
	out.ilosc_rat = out.raty.length || null;
	out.konto_do_wplat = collapse(grab(tresc, /rachunek bankowy:\s*([\d\s]{20,34})/i));

	out.program_ug = grab(tresc, /Program(?:u|em) Ubezpieczenia(?:\s+OC)?\s+nr\s+([A-Z0-9/]+?)[,.;]?(?:\s|$)/i);
	out.produkt_owu = grab(tresc, /kod\s+(AB-[A-Z]+-\d+\/\d+)/i);

	// Parametry bez kolumn w crm_policies — w kolejności, w jakiej stoją na polisie.
	const pola: [string, RegExp][] = [
		['Przedmiot ubezpieczenia', /^Przedmiot ubezpieczenia:\s*/],
		['Działalność przyjęta do ubezpieczenia', /^Działalność przyjęta do ubezpieczenia:\s*/],
		['Podstawa zawarcia umowy', /^Podstawa zawarcia umowy:\s*/],
		['Zakres terytorialny', /^Zakres terytorialny:\s*/],
		['Zakres ubezpieczenia', /^Zakres ubezpieczenia:\s*/],
		['Franszyza', /^Franszyza:\s*/]
	];
	for (const [nazwa, etykieta] of pola) {
		const w = collapse(pole(linie, etykieta)?.join(' '));
		if (w) out.dodatkowe[nazwa] = w;
	}

	const postanowieniaTekst = collapse(postanowienia);
	if (postanowieniaTekst) out.dodatkowe['Postanowienia dodatkowe'] = postanowieniaTekst;

	const klauzule = out.ryzyka.filter((r) => r.sekcja === 'Klauzule dodatkowe').map((r) => r.przedmiot);
	if (klauzule.length) out.dodatkowe['Klauzule dodatkowe'] = klauzule.join(' | ');

	const oferta = grab(tresc, /na podstawie oferty\s*\n?\s*([A-Z0-9/]+)\./i);
	if (oferta) out.dodatkowe['Oferta'] = oferta;

	const ubezpieczeni = lista(linie, /^Ubezpieczeni:$/);
	if (ubezpieczeni.length) {
		out.dodatkowe['Ubezpieczeni'] = ubezpieczeni.join('; ');
		out.dodatkowe['Liczba ubezpieczonych'] = String(ubezpieczeni.length);
	}

	const platnosc = collapse(grab(tresc, /^Warunki płatności składki:\s*(.+)$/m));
	if (platnosc) out.dodatkowe['Warunki płatności'] = platnosc;
	if (out.program_ug) out.dodatkowe['Program ubezpieczenia'] = out.program_ug;

	const przygotowal = collapse(grab(tresc, /^Umowa przygotowana przez:\s*(.+)$/m));
	if (przygotowal) out.dodatkowe['Umowę przygotował(a)'] = przygotowal;
	const posrednik = grab(tresc, /^Numer Pośrednika:\s*(\d+)/m);
	if (posrednik) out.dodatkowe['Numer pośrednika'] = posrednik;

	return out;
}

/** Wiersze wartości pola: reszta wiersza z etykietą i kolejne wiersze stojące w kolumnie wartości. */
function pole(linie: Line[], etykieta: RegExp): string[] | null {
	const i = linie.findIndex((l) => etykieta.test(l.text));
	if (i < 0) return null;
	const wynik: string[] = [];
	const pierwszy = collapse(linie[i].text.replace(etykieta, ''));
	if (pierwszy) wynik.push(pierwszy);
	// Wartość może przejść na następną stronę — kończy ją dopiero wiersz przy lewym marginesie (etykieta).
	for (let j = i + 1; j < linie.length && linie[j].words[0].x >= X_WARTOSCI; j++) wynik.push(linie[j].text);
	return wynik;
}

/** Pozycje listy pod nagłówkiem (np. „Ubezpieczeni:”): wiersze aż do pierwszego większego odstępu. */
function lista(linie: Line[], naglowek: RegExp): string[] {
	const i = linie.findIndex((l) => naglowek.test(l.text));
	if (i < 0) return [];
	const wynik: string[] = [];
	for (let j = i + 1; j < linie.length; j++) {
		const poprzednia = linie[j - 1];
		const l = linie[j];
		// Na przełomie strony odstęp nic nie mówi — lista trwa, dopóki wiersz wygląda jak pozycja, a nie akapit czy nagłówek.
		if (l.page !== poprzednia.page ? l.text.length > 80 || /:$/.test(l.text) : poprzednia.y - l.y > ODSTEP_LISTY) break;
		wynik.push(l.text);
	}
	return wynik;
}

/** Tekst między nagłówkiem sekcji a następnym nagłówkiem (bez obu nagłówków). */
function blok(tresc: string, od: RegExp, do_: RegExp): string {
	const start = tresc.match(od);
	if (start?.index == null) return '';
	const reszta = tresc.slice(start.index + start[0].length);
	const koniec = reszta.match(do_);
	return koniec?.index == null ? reszta : reszta.slice(0, koniec.index);
}

/** Nazwa, identyfikatory i adres strony umowy z bloku „Ubezpieczający:” / „Ubezpieczony:”. */
function strona(linie: Line[], etykieta: RegExp) {
	const w = pole(linie, etykieta);
	if (!w?.length) return null;
	let nip: string | null = null;
	let regon: string | null = null;
	const adres: string[] = [];
	// Długa nazwa (spółka) łamie się na dwa wiersze — identyfikatory i adres zaczynają się
	// od pierwszego wiersza z NIP/REGON/PESEL albo kodem pocztowym.
	const odDanych = w.findIndex((l, k) => k > 0 && (/\b(?:NIP|REGON|PESEL)\b/i.test(l) || /\b\d{2}-\d{3}\b/.test(l)));
	const dane = odDanych > 0 ? odDanych : 1;
	for (const wiersz of w.slice(dane)) {
		nip ??= digits(grab(wiersz, /NIP:?\s*([\d\s-]{10,13})(?!\d)/i));
		regon ??= digits(grab(wiersz, /REGON:?\s*(\d{9}(?:\d{5})?)/i));
		const bezId = collapse(wiersz.replace(/(?:NIP|REGON|PESEL):?\s*[\d\s-]+/gi, '').replace(/^[\s,;]+|[\s,;]+$/g, ''));
		if (bezId) adres.push(bezId);
	}
	return { nazwa: collapse(w.slice(0, dane).join(' ')), nip, regon, adres: adres.length ? adres.join(', ') : null };
}

// Sekcja „Klauzule dodatkowe:”: tytuł klauzuli (bywa łamany na dwa wiersze), pod nim limit
// odpowiedzialności i ewentualne postanowienia do klauzuli. Klauzula bez limitu ma sumę pustą.
function parseKlauzule(tresc: string): RiskItem[] {
	const sekcja = blok(tresc, /^Klauzule dodatkowe:$/m, /^(?:Postanowienia dodatkowe|Treść klauzul dodatkowych|Składka i sposób płatności):$/m);
	const ryzyka: RiskItem[] = [];
	let tytul: string[] = [];
	let limit: number | null = null;
	let pelny = false;
	const zamknij = () => {
		const przedmiot = collapse(tytul.join(' '));
		if (przedmiot) ryzyka.push({ sekcja: 'Klauzule dodatkowe', przedmiot, suma: limit });
		tytul = [];
		limit = null;
		pelny = false;
	};
	for (const wiersz of sekcja.split('\n')) {
		if (/^Klauzula\b/.test(wiersz)) {
			zamknij();
			tytul.push(wiersz);
		} else if (/^Limit odpowiedzialności:/.test(wiersz)) {
			limit = toAmount(grab(wiersz, /^Limit odpowiedzialności:\s*([\d\s.,]+)\s*PLN/));
			pelny = true;
		} else if (/^Postanowienia dodatkowe do klauzuli:/.test(wiersz)) {
			pelny = true;
		} else if (tytul.length && !pelny) {
			tytul.push(wiersz);
		}
	}
	zamknij();
	return ryzyka;
}

// Sublimity z postanowień dodatkowych („W zakresie niniejszej klauzuli wprowadza się sublimit
// w wysokości: 50.000 PLN”) — nazwą jest najbliższy wcześniejszy nagłówek akapitu.
function parseSublimity(postanowienia: string): RiskItem[] {
	const ryzyka: RiskItem[] = [];
	let naglowek: string | null = null;
	const wiersze = postanowienia.split('\n').map((w) => w.trim()).filter(Boolean);
	for (let k = 0; k < wiersze.length; k++) {
		const w = wiersze[k];
		if (w.split(/\s+/).length <= 6 && !/[.:;,”"]$/.test(w) && !/^\d/.test(w)) naglowek = w;
		// Zdanie o sublimicie bywa łamane między etykietą a kwotą — dopasowujemy na parze wierszy,
		// licząc tylko dopasowanie zaczynające się w bieżącym.
		const m = `${w} ${wiersze[k + 1] ?? ''}`.match(/sublimit w wysokości:?\s*([\d\s.,]+)\s*PLN/i);
		const sublimit = m && (m.index ?? 0) < w.length ? toAmount(m[1]) : null;
		if (sublimit != null)
			ryzyka.push({ sekcja: 'Postanowienia dodatkowe', przedmiot: `${naglowek ?? 'Sublimit'} — sublimit`, suma: sublimit });
	}
	return ryzyka;
}

// „Termin płatności i kwota raty:” — każda rata w osobnym wierszu: data i kwota.
function parseRaty(linie: Line[]): Installment[] {
	const wiersze = pole(linie, /^Termin płatności i kwota raty:\s*/) ?? [];
	const raty: Installment[] = [];
	for (const w of wiersze) {
		const m = w.match(/^(\d{2}\.\d{2}\.\d{4})\s+([\d\s.,]+)\s*PLN/);
		if (!m) continue;
		const data = toDate(m[1]);
		if (data) raty.push({ data, kwota: toAmount(m[2]) });
	}
	return raty;
}
