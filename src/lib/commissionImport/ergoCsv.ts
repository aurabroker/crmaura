// Odczyt pliku „Szczegóły zestawienia prowizyjnego” z ERGO Hestii (eksport CSV z portalu agenta).
//
// Budowa pliku: kilka wierszy nagłówka (numer zestawienia, agencja, liczba elementów, sumy),
// potem tabela rozdzielana średnikami — jeden wiersz na każde ubezpieczenie (ryzyko) w polisie.
// Kolumny „Podstawa naliczenia prowizji” i pierwsza „Prowizja” powtarzają sumę całej polisy,
// a „Inkaso” i ostatnia „Prowizja” dotyczą pojedynczego ryzyka. Do rozliczenia raty bierzemy
// sumę po ryzykach, więc polisa zgłoszona w kilku typach naliczenia też liczy się raz.

import { toAmount } from '../policyImport/parse';

export interface ErgoCsvPozycja {
	nr_polisy: string;
	ubezpieczajacy: string;
	produkt: string;
	/** Typy naliczenia, np. „Prowizja standardowa”, „Prowizja za współakwizycję”. */
	typy: string[];
	/** Suma inkasa ze wszystkich ryzyk polisy w tym zestawieniu. */
	podstawa: number;
	prowizja: number;
	odnowienie: boolean;
	/** Kody ubezpieczeń (ryzyk) z polisy, np. M30, C02. */
	ryzyka: string[];
}

export interface ErgoCsvZestawienie {
	numer: string;
	/** Miesiąc z numeru zestawienia (B/002/09/26/… → 2026-09) albo null. */
	okres: string | null;
	agencja: string | null;
	pozycje: ErgoCsvPozycja[];
	razem_podstawa: number;
	razem_prowizja: number;
	/** Rozbieżności między sumami z nagłówka pliku a sumą wierszy. */
	ostrzezenia: string[];
}

/** Bajty pliku → tekst. Eksport ERGO jest w UTF-8 z BOM; starsze bywają w Windows-1250. */
export function dekodujCsv(bytes: Uint8Array): string {
	let tekst: string;
	try {
		tekst = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		tekst = new TextDecoder('windows-1250').decode(bytes);
	}
	return tekst.replace(/^﻿/, '');
}

/** Jeden wiersz CSV rozdzielany średnikami, z polami w cudzysłowach ("" = cudzysłów). */
function podzielWiersz(linia: string): string[] {
	const pola: string[] = [];
	let pole = '';
	let wCudzyslowie = false;
	for (let i = 0; i < linia.length; i++) {
		const z = linia[i];
		if (wCudzyslowie) {
			if (z === '"' && linia[i + 1] === '"') { pole += '"'; i++; }
			else if (z === '"') wCudzyslowie = false;
			else pole += z;
		} else if (z === '"') wCudzyslowie = true;
		else if (z === ';') { pola.push(pole.trim()); pole = ''; }
		else pole += z;
	}
	pola.push(pole.trim());
	return pola;
}

const grosze = (n: number) => Math.round(n * 100) / 100;
const zl = (n: number) => `${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

export function parseErgoCsv(tekst: string): ErgoCsvZestawienie {
	const linie = tekst.split(/\r?\n/);
	const iNaglowka = linie.findIndex((l) => /^Typ naliczenia/i.test(l.trim()));

	// Pola nagłówka szukamy tylko nad tabelą — wiersze danych też zaczynają się od „Prowizja …”.
	const naglowek = (re: RegExp) => {
		for (const l of iNaglowka < 0 ? linie : linie.slice(0, iNaglowka)) {
			const m = l.trim().match(re);
			if (m) return m[1].trim();
		}
		return null;
	};

	const numer = naglowek(/zestawienia prowizyjnego nr\s+(\S+)/i);
	if (!numer) throw new Error('To nie jest plik „Szczegóły zestawienia prowizyjnego” ERGO Hestii — brak numeru zestawienia.');
	const m = numer.match(/^[A-Z]+\/\d+\/(\d{2})\/(\d{2})\//i);
	const okres = m ? `20${m[2]}-${m[1]}` : null;
	const agencja = naglowek(/^Wybrane agencje:\s*(.+)$/i);
	const liczbaElementow = Number(naglowek(/^Liczba element\S*:\s*(\d+)/i) ?? NaN);
	const razemPodstawaPlik = toAmount(naglowek(/^Podstawa naliczenia prowizji \S+:\s*(.+)$/i));
	const razemProwizjaPlik = toAmount(naglowek(/^Prowizja \S+:\s*(.+)$/i));

	if (iNaglowka < 0) throw new Error('Nie znaleziono nagłówka tabeli („Typ naliczenia - opis;Nr polisy;…”).');
	const kolumny = podzielWiersz(linie[iNaglowka]);
	const kol = (nazwa: string) => kolumny.findIndex((k) => k === nazwa);
	const kTyp = 0;
	const kNr = kol('Nr polisy');
	const kProdukt = kol('Produkt');
	const kUbezpieczajacy = kol('Ubezpieczający');
	const kUbezpieczenie = kol('Ubezpieczenie');
	const kOdnowienie = kol('Odnowienie');
	const kInkaso = kol('Inkaso');
	const kProwizja = kolumny.lastIndexOf('Prowizja');
	if (kNr < 0 || kInkaso < 0 || kProwizja <= kInkaso) {
		throw new Error('Plik ma inne kolumny niż zestawienie ERGO (brak „Nr polisy”, „Inkaso” lub „Prowizja”).');
	}

	const wgPolisy = new Map<string, ErgoCsvPozycja>();
	for (const linia of linie.slice(iNaglowka + 1)) {
		if (!linia.trim()) continue;
		const r = podzielWiersz(linia);
		const nr = r[kNr] ?? '';
		if (!nr) continue;
		const inkaso = toAmount(r[kInkaso]);
		const prowizja = toAmount(r[kProwizja]);
		if (inkaso === null || prowizja === null) {
			throw new Error(`Nieczytelna kwota w wierszu polisy ${nr}.`);
		}
		const poz = wgPolisy.get(nr) ?? {
			nr_polisy: nr,
			ubezpieczajacy: r[kUbezpieczajacy] ?? '',
			produkt: r[kProdukt] ?? '',
			typy: [],
			podstawa: 0,
			prowizja: 0,
			odnowienie: false,
			ryzyka: []
		};
		const typ = r[kTyp] ?? '';
		if (typ && !poz.typy.includes(typ)) poz.typy.push(typ);
		const ryzyko = r[kUbezpieczenie] ?? '';
		if (ryzyko && !poz.ryzyka.includes(ryzyko)) poz.ryzyka.push(ryzyko);
		if ((r[kOdnowienie] ?? '').toLowerCase() === 'tak') poz.odnowienie = true;
		poz.podstawa = grosze(poz.podstawa + inkaso);
		poz.prowizja = grosze(poz.prowizja + prowizja);
		wgPolisy.set(nr, poz);
	}

	const pozycje = [...wgPolisy.values()];
	const razem_podstawa = grosze(pozycje.reduce((s, p) => s + p.podstawa, 0));
	const razem_prowizja = grosze(pozycje.reduce((s, p) => s + p.prowizja, 0));

	const ostrzezenia: string[] = [];
	if (Number.isFinite(liczbaElementow) && liczbaElementow !== pozycje.length) {
		ostrzezenia.push(`Plik podaje ${liczbaElementow} elementów, a w tabeli jest ${pozycje.length} polis.`);
	}
	if (razemPodstawaPlik !== null && Math.abs(razemPodstawaPlik - razem_podstawa) > 0.01) {
		ostrzezenia.push(`Podstawa w nagłówku pliku: ${zl(razemPodstawaPlik)}, suma wierszy: ${zl(razem_podstawa)}.`);
	}
	if (razemProwizjaPlik !== null && Math.abs(razemProwizjaPlik - razem_prowizja) > 0.01) {
		ostrzezenia.push(`Prowizja w nagłówku pliku: ${zl(razemProwizjaPlik)}, suma wierszy: ${zl(razem_prowizja)}.`);
	}

	return { numer, okres, agencja, pozycje, razem_podstawa, razem_prowizja, ostrzezenia };
}
