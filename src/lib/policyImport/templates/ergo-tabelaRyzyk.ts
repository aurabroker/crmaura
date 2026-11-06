// Tabela „UBEZPIECZONE RYZYKA / RISKS INSURED” certyfikatów ERGO Hestii z programu (OC zawodowe, NNW):
// kolumny ZAKRES UBEZPIECZENIA | SYMBOL | SUMA UBEZPIECZENIA | SKŁADKA. Długa nazwa ryzyka łamie wiersz —
// pdf.js oddaje wtedy nazwę ze składką w jednej linii, a symbol z sumą w następnej (albo nazwę w dwóch
// liniach), więc czytanie wiersza jednym wyrażeniem gubi pozycję (polisa bez sumy gwarancyjnej). Dlatego
// kolumny rozpoznajemy po pozycji X słów, a pozycję domykamy dopiero, gdy ma nazwę i symbol.
//
// Importy względne z rozszerzeniem, żeby szablony dało się uruchomić w testach node.

import type { PdfDoc, Word } from '../pdfDoc.ts';
import type { RiskItem } from '../types.ts';
import { collapse, toAmount } from '../parse.ts';

export const SEKCJA_RYZYK = 'UBEZPIECZONE RYZYKA';
const SYMBOL = /^[A-Z]\d{2}\s*-\s*\d+$/;
/** Lewe krawędzie kolumn (pt) z certyfikatów 2025–2026 — używane, gdy w tabeli nie ma nagłówka. */
const KOLUMNY = { symbol: 338, suma: 388, skladka: 492 };
/** Pierwsza linia pod tabelą ryzyk. */
const KONIEC_TABELI = /^(ZAKRES UBEZPIECZENIA\s*\/\s*SCOPE|KLAUZULE DODATKOWE|SKŁADKA\s*\/\s*PREMIUM|INFORMACJE DODATKOWE|PŁATNOŚĆ)/i;

const tekst = (ws: Word[]) => collapse(ws.map((w) => w.text).join(' '));
const kwota = (ws: Word[]) => toAmount(tekst(ws)?.replace(/zł/gi, '') ?? null);

type Pozycja = { nazwa: string[]; symbol: string | null; suma: number | null; skladka: number | null };

/** Pozycje tabeli ryzyk (nazwa z symbolem, suma, składka) w kolejności z dokumentu. */
export function tabelaRyzyk(doc: PdfDoc): RiskItem[] {
	const start = doc.lines.findIndex((l) => new RegExp(`^${SEKCJA_RYZYK}`, 'i').test(l.text));
	if (start < 0) return [];
	const page = doc.lines[start].page;
	const granice = { ...KOLUMNY };
	let naglowekOdczytany = false;
	const ryzyka: RiskItem[] = [];
	let biezaca: Pozycja | null = null;
	const domknij = () => {
		if (biezaca?.nazwa.length && biezaca.symbol)
			ryzyka.push({ sekcja: SEKCJA_RYZYK, przedmiot: `${collapse(biezaca.nazwa.join(' '))} (${biezaca.symbol})`, suma: biezaca.suma, skladka: biezaca.skladka });
		biezaca = null;
	};

	for (const l of doc.lines.slice(start + 1)) {
		if (l.page !== page || KONIEC_TABELI.test(l.text)) break;
		// Nagłówek (polski, potem angielski): granice kolumn bierzemy z pierwszego.
		const symbolNaglowka = l.words.find((w) => /^SYMBOL$/i.test(w.text));
		if (symbolNaglowka) {
			if (!naglowekOdczytany) {
				naglowekOdczytany = true;
				granice.symbol = symbolNaglowka.x - 4;
				const suma = l.words.find((w) => /^(SUMA|SUM)\b/i.test(w.text));
				const skladka = l.words.find((w) => /^(SKŁADKA|PREMIUM)$/i.test(w.text));
				if (suma) granice.suma = suma.x - 4;
				if (skladka) granice.skladka = skladka.x - 4;
			}
			continue;
		}
		const nazwa = tekst(l.words.filter((w) => w.x < granice.symbol));
		const symbol = tekst(l.words.filter((w) => w.x >= granice.symbol && w.x < granice.suma));
		const suma = kwota(l.words.filter((w) => w.x >= granice.suma && w.x < granice.skladka));
		const skladka = kwota(l.words.filter((w) => w.x >= granice.skladka));
		if (!nazwa && !symbol && suma == null && skladka == null) continue;
		// Nazwa zaczyna nową pozycję, chyba że poprzednia nie ma jeszcze symbolu — wtedy to dalszy ciąg nazwy.
		if (nazwa && (!biezaca || biezaca.symbol)) {
			domknij();
			biezaca = { nazwa: [], symbol: null, suma: null, skladka: null };
		}
		if (!biezaca) continue;
		if (nazwa) biezaca.nazwa.push(nazwa);
		if (symbol && SYMBOL.test(symbol)) biezaca.symbol = symbol.replace(/\s*-\s*/, ' - ');
		if (suma != null) biezaca.suma = suma;
		if (skladka != null) biezaca.skladka = skladka;
	}
	domknij();
	return ryzyka;
}
