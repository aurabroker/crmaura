// WARTA — WNIOSEK-POLISA WARTA EKSTRABIZNES PLUS.
// Dokument jednokolumnowy, sekcje ryzyk oddzielone nagłówkami pisanymi wersalikami.
// Każda sekcja może mieć własną składkę; składka łączna jest w wierszu "Kwota".

import type { ExtractedPolicy, RiskItem } from '../types';
import { emptyExtraction } from '../types';
import type { PdfDoc } from '../pdfDoc';
import { collapse, grab, grabAll, toAmount, toDate } from '../parse';

const SEKCJE = [
	'UBEZPIECZENIE MIENIA OD WSZYSTKICH RYZYK',
	'UBEZPIECZENIE MIENIA OD KRADZIEŻY Z WŁAMANIEM I RABUNKU',
	'UBEZPIECZENIE ELEKTRONIKI OD WSZYSTKICH RYZYK',
	'UBEZPIECZENIE OD PRZESTOJU FIRMY',
	'UBEZPIECZENIE ODPOWIEDZIALNOŚCI CYWILNEJ',
	'UBEZPIECZENIE NASTĘPSTW NIESZCZĘŚLIWYCH WYPADKÓW',
	'ROZSZERZENIE OCHRONY UBEZPIECZENIA MIENIA',
	'PAKIET BEZPIECZEŃSTWA'
];

export function detect(doc: PdfDoc): string | null {
	if (!/WARTA EKSTRABIZNES/i.test(doc.text))
		return 'W dokumencie nie znaleziono nagłówka „WARTA EKSTRABIZNES” — to nie jest polisa tego produktu.';
	return null;
}

export function parse(doc: PdfDoc): ExtractedPolicy {
	const out = emptyExtraction();
	// Strony 1-3 to egzemplarz klienta; strona 4 ("Strona dla WARTY") powiela
	// oświadczenia i zaburzyłaby dopasowania, więc pracujemy bez niej.
	const text = doc
		.textOf((w) => w.page <= 3)
		.split('\n')
		.join('\n');

	out.nr_polisy = grab(text, /WNIOSEK-POLISA WARTA EKSTRABIZNES PLUS NR:\s*([0-9]+)/i);
	out.wznowienie_nr = grab(text, /WZNOWIENIE POLISY NR:\s*([0-9]+)/i);
	out.data_od = toDate(grab(text, /OD:\s*(\d{4}-\d{2}-\d{2})/));
	out.data_do = toDate(grab(text, /DO:\s*(\d{4}-\d{2}-\d{2})/));
	out.data_zawarcia = toDate(grab(text, /Na podstawie wniosku z dnia\s*(\d{4}-\d{2}-\d{2})/));

	parseKlient(doc, out);

	// Składka łączna z wiersza płatności; gdy go brak — suma składek sekcyjnych.
	out.skladka = toAmount(grab(text, /Składka płatna:[^\n]*?Kwota:\s*([\d\s.,]+)\s*zł/i));

	const terminy = grabAll(text, /Składka płatna przelewem do dnia\s*(\d{4}-\d{2}-\d{2})/g).map(
		(m) => toDate(m[1])!
	);
	const jednorazowo = /Składka płatna:\s*JEDNORAZOWO/i.test(text);
	out.raty = terminy.map((data, i) => ({
		data,
		kwota: jednorazowo || terminy.length === 1 ? out.skladka : null
	}));
	out.ilosc_rat = out.raty.length || (jednorazowo ? 1 : null);
	out.konto_do_wplat = collapse(
		grab(text, /na konto TUiR WARTA S\.A\. o numerze:\s*([\d\s]{20,34})/i)
	);

	const { ryzyka, skladkiSekcji } = parseRyzyka(text);
	out.ryzyka = ryzyka;
	if (out.skladka === null) {
		const suma = skladkiSekcji.reduce((s, k) => s + k, 0);
		out.skladka = suma > 0 ? suma : null;
	}

	out.produkt_owu = collapse(
		grab(text, /Ogólnymi Warunkami Ubezpieczenia\s*(WARTA EKSTRABIZNES PLUS\s*\[[^\]]+\])/i)
	);
	out.przedmiot = buildPrzedmiot(out.ryzyka);

	const lokalizacje = grabAll(text, /^\s*(\d+)\.\s*(\d{2}-\d{3}[^\n]+)$/gm)
		.map((m) => collapse(m[2]))
		.filter(Boolean) as string[];
	if (lokalizacje.length) out.dodatkowe['Miejsca ubezpieczenia'] = lokalizacje.join(' | ');

	const dzialalnosc = collapse(grab(text, /PRZYJĘTA DO UBEZPIECZENIA\s*\n([^\n]+)/));
	if (dzialalnosc) out.dodatkowe['Działalność'] = dzialalnosc;

	const wariant = collapse(grab(text, /Zakres ubezpieczenia:\s*wariant\s*([^\n]+)/i));
	if (wariant) out.dodatkowe['Wariant'] = wariant;

	const forma = collapse(grab(text, /Forma płatności:\s*([A-ZŁŚĆŻŹÓĄĘŃ]+)/i));
	if (forma) out.dodatkowe['Forma płatności'] = forma;

	const franszyzy = collapse(grab(text, /Franszyzy redukcyjne:\s*([^\n]+)/i));
	if (franszyzy) out.dodatkowe['Franszyzy'] = franszyzy;

	const agent = collapse(grab(text, /DANE AGENTA\s*\n\s*Nazwa:\s*([^\n]+)/i));
	if (agent) out.dodatkowe['Agent'] = agent;

	const szkody = collapse(grab(text, /(Szkody w ostatnich 3 latach:[^\n]+)/i));
	if (szkody) out.dodatkowe['Szkodowość'] = szkody;

	return out;
}

// Blok danych klienta: nazwa łamana na kilka wierszy, REGON/NIP dopisany
// z prawej strony pierwszego wiersza. Rozdzielamy po współrzędnej X.
function parseKlient(doc: PdfDoc, out: ExtractedPolicy) {
	const naglowek = doc.words.find((w) => w.page === 1 && w.text.startsWith('UBEZPIECZAJĄCY'));
	const okres = doc.words.find((w) => w.page === 1 && w.text.startsWith('OKRES'));
	if (!naglowek) return;

	const yTo = naglowek.y - 2;
	const yFrom = okres ? okres.y + 2 : yTo - 80;
	const blok = doc.region(1, { yFrom, yTo });

	// Identyfikatory bywają w prawej kolumnie — zbieramy z całego bloku.
	out.klient_regon = grab(blok, /REGON:?\s*([\d\s-]{9,17})/i)?.replace(/\D/g, '') ?? null;
	out.klient_nip = grab(blok, /NIP:?\s*([\d\s-]{10,13})/i)?.replace(/\D/g, '') ?? null;
	out.klient_email = grab(blok, /E-mail:\s*(\S+@\S+)/i);
	out.klient_adres = collapse(grab(blok, /Siedziba:\s*([^\n]+)/i));

	// Nazwa = wiersze przed "Siedziba:", z odciętą prawą kolumną identyfikatorów.
	const kolumnaId = doc.words.find(
		(w) => w.page === 1 && w.y <= yTo && w.y >= yFrom && /^(REGON|NIP):?$/i.test(w.text)
	);
	const xTo = kolumnaId ? kolumnaId.x - 5 : Infinity;
	const nazwa = doc
		.region(1, { yFrom, yTo, xTo })
		.split('\n')
		.filter((l) => l && !/^(Siedziba|E-mail|Telefon|Adres)\s*:/i.test(l))
		.join(' ');
	out.klient_nazwa = collapse(nazwa);
	out.ubezpieczony_nazwa = out.klient_nazwa;
	out.ubezpieczony_nip = out.klient_nip;
}

// Kwota w formacie polskim: tysiące rozdzielone spacją, opcjonalne grosze.
// Ścisłe grupowanie jest konieczne, bo nazwy pozycji kończą się cyfrą
// ("... w wariancie Wariant 1 10 000 zł") i luźny wzorzec zlepiłby ją z sumą.
const KWOTA = String.raw`\d{1,3}(?:[  ]\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?`;

interface RyzykaResult {
	ryzyka: RiskItem[];
	/** Składki sekcyjne — do sumowania bez podwajania pozycji w obrębie sekcji. */
	skladkiSekcji: number[];
}

function parseRyzyka(text: string): RyzykaResult {
	const linie = text.split('\n');
	const ryzyka: RiskItem[] = [];
	const skladkiSekcji: number[] = [];
	let sekcja = '';
	let wTabeli = false;

	const reSkladka = new RegExp(String.raw`^SKŁADKA\s+(${KWOTA})\s*zł$`, 'i');
	const rePozycja = new RegExp(String.raw`^(.+?)\s+(${KWOTA})\s*zł(\s*\/\s*miesiąc)?$`, 'i');

	for (const raw of linie) {
		const linia = raw.trim();
		if (!linia) continue;

		const naglowek = SEKCJE.find((s) => linia.toUpperCase().startsWith(s));
		if (naglowek) {
			sekcja = naglowek;
			wTabeli = false;
			continue;
		}
		if (!sekcja) continue;

		if (/^(PRZEDMIOT UBEZPIECZENIA|ZAKRES UBEZPIECZENIA|NAZWA KLAUZULI|LIMIT\/ZAKRES)\b/i.test(linia)) {
			wTabeli = true;
			continue;
		}

		const skladka = linia.match(reSkladka);
		if (skladka) {
			const kwota = toAmount(skladka[1]);
			if (kwota != null) skladkiSekcji.push(kwota);
			// Składka zamyka sekcję — zapisujemy ją przy jej pozycjach dla podglądu.
			for (const r of ryzyka) if (r.sekcja === sekcja && r.skladka == null) r.skladka = kwota;
			// Gdy sekcja nie miała tabeli (np. Pakiet bezpieczeństwa), zapisz samą składkę.
			if (!ryzyka.some((r) => r.sekcja === sekcja))
				ryzyka.push({ sekcja, przedmiot: sekcja, suma: null, skladka: kwota });
			wTabeli = false;
			sekcja = '';
			continue;
		}

		if (!wTabeli) continue;

		const pozycja = linia.match(rePozycja);
		if (pozycja) {
			const przedmiot = collapse(pozycja[1]);
			if (przedmiot)
				ryzyka.push({
					sekcja,
					przedmiot: pozycja[3] && !/miesięczn/i.test(przedmiot) ? `${przedmiot} / miesiąc` : przedmiot,
					suma: toAmount(pozycja[2]),
					skladka: null
				});
		}
	}
	return { ryzyka, skladkiSekcji };
}

function buildPrzedmiot(ryzyka: RiskItem[]): string | null {
	if (!ryzyka.length) return null;
	const wgSekcji = new Map<string, string[]>();
	for (const r of ryzyka) {
		const lista = wgSekcji.get(r.sekcja) ?? [];
		lista.push(r.suma != null ? `${r.przedmiot}: ${r.suma.toLocaleString('pl-PL')} zł` : r.przedmiot);
		wgSekcji.set(r.sekcja, lista);
	}
	return [...wgSekcji.entries()].map(([sekcja, poz]) => `${sekcja} — ${poz.join('; ')}`).join(' | ');
}
