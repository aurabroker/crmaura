import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, type Word } from '../pdfDoc.ts';
import { detect, parse } from './ergo-oc-zawodowe.ts';
import { tabelaRyzyk } from './ergo-tabelaRyzyk.ts';

// Słowa ułożone jak w certyfikacie OC z programu beauty (pdf.js): długa nazwa zakresu łamie wiersz tabeli
// ryzyk — nazwa ze składką w jednej linii, symbol z sumą w następnej. Dane zmyślone.
type Fragment = [x: number, text: string];
function linie(page: number, wiersze: [y: number, ...Fragment[]][]): Word[] {
	const out: Word[] = [];
	for (const [y, ...fragmenty] of wiersze) for (const [x, text] of fragmenty) out.push({ page, x, y, text });
	return out;
}
const bezNbsp = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');

const naglowek: [number, ...Fragment[]][] = [
	[775.8, [415, 'POLISA/POLICY: 472000199999']],
	[743.8, [390, 'Numer Underwritera/Underwriter No.: 001905']],
	[729.4, [338, 'studio.pl'], [368, 'Anna'], [387, 'Testowa, ks. Brzóski 26,']],
	[722.2, [71, 'UBEZPIECZAJĄCY'], [136, '/ POLICY HOLDER'], [338, '08-300 Przywózki, POLSKA NIP: 1234563218']],
	[709.9, [71, 'Okres ubezpieczenia/'], [132, 'Period of insurance'], [191, '07.11.2026 - 06.11.2027'], [338, 'Ubezpieczony'], [380, '(imię'], [396, 'i nazwisko/adres/PESEL)'], [467, '/Insured']],
	[699.6, [71, 'Łączna'], [93, 'liczba ubezpieczonych'], [191, '1'], [338, 'studio.pl'], [367, 'Anna'], [385, 'Testowa | NIP: 1234563218']],
	[693.6, [71, 'Total number of insured persons']],
	[676.3, [71, 'UBEZPIECZONE RYZYKA/RISKS INSURED']],
	[664.1, [74, 'ZAKRES UBEZPIECZENIA'], [342, 'SYMBOL'], [393, 'SUMA UBEZPIECZENIA'], [497, 'SKŁADKA']],
	[657.2, [74, 'SCOPE OF COVER'], [342, 'SYMBOL'], [419, 'SUM INSURED'], [498, 'PREMIUM']]
];
const stopka: [number, ...Fragment[]][] = [
	[618.8, [85, 'ZAKRES UBEZPIECZENIA / SCOPE OF COVER'], [445, 'LIMIT']],
	[611.9, [85, 'Postanowienia dodatkowe zgodnie z Programem Ubezpieczenia nr WA50/003353/24/A.'], [452, 'null']],
	[602.7, [85, 'KLAUZULE DODATKOWE / ADDITIONAL CLAUSES'], [445, 'LIMIT']],
	[595.8, [85, '1. Liczba zatrudnionych od 6 do 8 przy SG 300.000,00'], [231, 'zł']],
	[580.8, [85, 'Franszyza redukcyjna: 300,00 PLN dla szkód w mieniu']],
	[560.8, [398, 'SKŁADKA'], [429, '/ PREMIUM'], [497, '1 562,50'], [522, 'zł']],
	[543.2, [71, 'INFORMACJE DODATKOWE']],
	[533.8, [71, 'Zakres terytorialny: Polska.'], [145, 'Umowę'], [167, 'ubezpieczenia zawarto na podstawie'], [267, 'Ubezpieczenie'], [310, 'Odpowiedzialności'], [366, 'Cywilnej z'], [396, 'tytułu'], [414, 'wykonywania'], [455, 'czynności'], [485, 'zawodowych']],
	[526.9, [71, '(B) nr AB-OCZL-01/25']],
	[520.0, [71, 'Postanowienia dodatkowe zgodnie z Programem Ubezpieczenia nr WA50/003353/24/A.']],
	[505.3, [71, 'PŁATNOŚĆ'], [111, 'SKŁADKI']],
	[495.9, [71, 'Składka'], [94, 'płatna'], [112, 'przelewem na konto STU Ergo Hestia SA, 81-731 Sopot, ul. Hestii 1, Bank Pekao S.A.,']],
	[489.0, [71, 'numer konta:'], [108, '08 1240 6960 6013 4720 0016 7371'], [206, 'w tytule przelewu'], [254, 'należy'], [273, 'wpisać'], [293, 'nr polisy'], [317, '472000199999'], [357, '.']],
	[475.2, [71, 'Płatności'], [97, 'należy'], [116, 'dokonać'], [140, 'zgodnie z'], [168, 'poniższym'], [198, 'harmonogramem (termin'], [265, 'płatności/kwota).']],
	[463.2, [76, '21.11.2026 / 1 562,50'], [136, 'zł']],
	[243.8, [259, '06.11.2026 / 06.11.2026']],
	[217.5, [73, 'Podpis'], [94, 'Ubezpieczającego'], [250, 'Data wystawienia / Data zawarcia'], [403, 'Podpis Przedstawiciela STU ERGO Hestia SA']]
];
// Wiersz ryzyka złamany na dwie linie (taryfa pełna, 6–8 osób: 1 250 zł + 25%).
const lamany: [number, ...Fragment[]][] = [
	[639.7, [74, 'GABINETY KOSMETYCZNE, KOSMETOLOGICZNE, FRYZJERSKIE I PODOLOGICZNE'], [497, '1 562,50'], [522, 'zł']],
	[632.6, [343, 'M30 - 13'], [425, '300 000,00'], [456, 'zł']]
];
const doc = new PdfDoc(linie(1, [...naglowek, ...lamany, ...stopka]), 1, 595);

test('detect: certyfikat OC z programu tak, obce dokumenty nie', () => {
	assert.equal(detect(doc), null);
	assert.match(detect(new PdfDoc(linie(1, [[700, [74, 'Polisa nr 123'], [300, 'Warta']]]), 1, 595)) ?? '', /ERGO Hestii/);
});

test('certyfikat OC: nazwa ryzyka złamana na dwie linie — pozycja z symbolem, sumą i składką, suma gwarancyjna z niej', () => {
	const e = parse(doc);
	assert.deepEqual(e.ryzyka, [
		{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'GABINETY KOSMETYCZNE, KOSMETOLOGICZNE, FRYZJERSKIE I PODOLOGICZNE (M30 - 13)', suma: 300000, skladka: 1562.5 }
	]);
	assert.equal(e.suma_gwarancyjna, 300000);
	assert.equal(bezNbsp(e.przedmiot), 'GABINETY KOSMETYCZNE, KOSMETOLOGICZNE, FRYZJERSKIE I PODOLOGICZNE (M30 - 13): 300 000 zł');
});

test('certyfikat OC: numer, okres, zawarcie, strony, składka, rata, konto, program, OWU, klauzule, franszyza', () => {
	const e = parse(doc);
	assert.equal(e.nr_polisy, '472000199999');
	assert.equal(e.data_od, '2026-11-07');
	assert.equal(e.data_do, '2027-11-06');
	assert.equal(e.data_zawarcia, '2026-11-06');
	assert.equal(e.klient_nazwa, 'studio.pl Anna Testowa');
	assert.equal(e.klient_adres, 'ks. Brzóski 26, 08-300 Przywózki');
	assert.equal(e.klient_nip, '1234563218');
	assert.equal(e.ubezpieczony_nip, '1234563218');
	assert.equal(e.skladka, 1562.5);
	assert.deepEqual(e.raty, [{ data: '2026-11-21', kwota: 1562.5 }]);
	assert.equal(e.konto_do_wplat, '08 1240 6960 6013 4720 0016 7371');
	assert.equal(e.program_ug, 'WA50/003353/24/A');
	assert.equal(e.produkt_owu, 'AB-OCZL-01/25');
	// Klauzula bez słowa „Klauzula” w nazwie — dopłata za 6–8 osób.
	assert.equal(e.dodatkowe['Klauzule dodatkowe'], 'Liczba zatrudnionych od 6 do 8 przy SG 300.000,00 zł');
	assert.equal(e.dodatkowe['Franszyza'], '300,00 PLN dla szkód w mieniu');
});

test('tabela ryzyk: wiersz w jednej linii, kilka pozycji i nazwa w dwóch liniach bez składki w pierwszej', () => {
	const jedna = new PdfDoc(
		linie(1, [...naglowek, [639.7, [74, 'GABINETY KOSMETOLOGICZNE'], [343, 'M30 - 13'], [425, '200 000,00'], [456, 'zł'], [497, '790,00'], [522, 'zł']], ...stopka]),
		1,
		595
	);
	assert.deepEqual(tabelaRyzyk(jedna), [{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'GABINETY KOSMETOLOGICZNE (M30 - 13)', suma: 200000, skladka: 790 }]);

	const dwie = new PdfDoc(
		linie(1, [
			...naglowek,
			[639.7, [74, 'GABINETY KOSMETYCZNE'], [120, 'I FRYZJERSKIE'], [343, 'M30 - 13'], [425, '100 000,00'], [456, 'zł'], [497, '400,00'], [522, 'zł']],
			[629.0, [74, 'KOSZTY OCHRONY PRAWNEJ (KLAUZULA 7)']],
			[621.9, [343, 'M30'], [360, '-'], [368, '21'], [425, '100 000,00'], [456, 'zł'], [497, '92,00'], [522, 'zł']],
			...stopka
		]),
		1,
		595
	);
	assert.deepEqual(tabelaRyzyk(dwie), [
		{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'GABINETY KOSMETYCZNE I FRYZJERSKIE (M30 - 13)', suma: 100000, skladka: 400 },
		{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'KOSZTY OCHRONY PRAWNEJ (KLAUZULA 7) (M30 - 21)', suma: 100000, skladka: 92 }
	]);
});
