import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, type Word } from '../pdfDoc.ts';
import { detect, parse } from './ergo-nnw-program.ts';
import { detect as detectOc } from './ergo-oc-zawodowe.ts';

// Słowa ułożone jak w certyfikacie NNW z programu (pdf.js): etykiety po lewej, wartości w prawej
// kolumnie, składka ryzyka o 1 pt wyżej niż reszta wiersza. Dane zmyślone.
type Fragment = [x: number, text: string];
function linie(page: number, wiersze: [y: number, ...Fragment[]][]): Word[] {
	const out: Word[] = [];
	for (const [y, ...fragmenty] of wiersze) for (const [x, text] of fragmenty) out.push({ page, x, y, text });
	return out;
}

const strona1 = linie(1, [
	[775.8, [415, 'POLISA/POLICY: 470000099999']],
	[743.8, [390.3, 'Numer Underwritera/Underwriter No.: 001905']],
	[729.4, [338.5, 'Gabinet Kosmetyczny Anna Testowa,']],
	[721.9, [338.5, 'Długa'], [356.8, '13/2,']],
	[714.7, [70.8, 'UBEZPIECZAJĄCY'], [136.2, '/ POLICY HOLDER']],
	[714.5, [338.5, '49-306 Brzeg, POLSKA NIP: 1234563218']],
	[702.5, [70.8, 'Okres ubezpieczenia/'], [131.9, 'Period of insurance'], [191.3, '05.11.2026 - 04.11.2027'], [338.5, 'Ubezpieczony'], [380.2, '(imię'], [395.8, 'i nazwisko/adres/PESEL)'], [466.9, '/Insured']],
	[692.2, [70.8, 'Łączna'], [92.9, 'liczba ubezpieczonych'], [191.3, '1'], [338.5, 'ANNA TESTOWA | Data urodzenia: 25.12.1981']],
	[686.2, [70.8, 'Total number of insured persons']],
	[676.1, [70.8, 'Łączna'], [92.9, 'liczba osobo-dni'], [191.3, '365']],
	[670.1, [70.8, 'Total number of person-days']],
	[652.8, [70.8, 'UBEZPIECZONE RYZYKA/RISKS INSURED']],
	[640.6, [74, 'ZAKRES UBEZPIECZENIA'], [341.7, 'SYMBOL'], [393.2, 'SUMA UBEZPIECZENIA'], [497.2, 'SKŁADKA']],
	[633.7, [74, 'SCOPE OF COVER'], [342, 'SYMBOL'], [418.9, 'SUM INSURED'], [498.2, 'PREMIUM']],
	[617.1, [501.9, '225,00'], [521.9, 'zł']],
	[616.1, [74, 'UBEZPIECZENIE'], [132, 'NASTĘPSTW'], [177.9, 'NIESZCZĘŚLIWYCH'], [246.7, 'WYPADKÓW'], [343, 'A05 - 12'], [424.5, '100 000,00'], [456.2, 'zł']],
	[602.1, [85, 'ZAKRES UBEZPIECZENIA / SCOPE OF COVER'], [445.2, 'LIMIT']],
	[581.4, [85, 'KLAUZULE DODATKOWE / ADDITIONAL CLAUSES'], [445.2, 'LIMIT']],
	[574.5, [85, 'Klauzula ubezpieczenia na wypadek'], [183.4, 'zakażenia'], [212.1, 'wirusem HIV i WZW podczas wykonywania'], [328.8, 'czynności'], [356.8, 'zawodowych']],
	[567.6, [325.2, 'zgodnie z Programem']],
	[555, [398.2, 'SKŁADKA'], [429.2, '/ PREMIUM'], [501.9, '225,00'], [521.9, 'zł']],
	[540, [70.8, 'INFORMACJE DODATKOWE']],
	[530, [70.8, 'Zakres terytorialny: Cały świat, Zakres czasowy: Pełny (całodobowy), Zakres świadczeń: system świadczeń proporcjonalnych, Klasa ryzyka: Klasa I, Zakres KL: . Umowę']],
	[522, [70.8, 'ubezpieczenia zawarto na podstawie OGÓLNE WARUNKI UBEZPIECZENIA BIZNES & PODRÓŻ NR PAT/OW071/2503 Z DNIA 01 KWIETNIA 2025 R.']],
	[505, [70.8, 'PŁATNOŚĆ SKŁADKI']],
	[497, [70.8, 'Składka płatna przelewem na konto STU Ergo Hestia SA, 81-731 Sopot, ul. Hestii 1, Bank Pekao S.A.,']],
	[489, [70.8, 'numer konta: 64 1240 6960 6013 4700 0007 1953 w tytule przelewu należy wpisać nr polisy 470000099999.']],
	[475, [70.8, 'Płatności należy dokonać zgodnie z poniższym harmonogramem (termin płatności/kwota).']],
	[467, [74, '19.11.2026 / 225,00 zł']],
	[300, [300, '04.11.2026 / 04.11.2026']],
	[285, [70.8, 'Podpis Ubezpieczającego'], [300, 'Data wystawienia / Data zawarcia'], [430, 'Podpis Przedstawiciela STU ERGO Hestia SA']]
]);
const doc = new PdfDoc(strona1, 1, 595);

test('detect: certyfikat NNW Hestii tak, certyfikat OC zawodowego i obce dokumenty nie', () => {
	assert.equal(detect(doc), null);
	const oc = new PdfDoc(
		linie(1, [
			[775, [415, 'POLISA/POLICY: 472000165381']],
			[616, [74, 'UBEZPIECZENIE ODPOWIEDZIALNOŚCI CYWILNEJ'], [343, 'M30 - 13'], [424, '100 000,00'], [456, 'zł'], [502, '790,00'], [522, 'zł']],
			[285, [430, 'Podpis Przedstawiciela STU ERGO Hestia SA']]
		]),
		1,
		595
	);
	assert.match(detect(oc) ?? '', /NNW/);
	assert.match(detect(new PdfDoc(linie(1, [[700, [74, 'Polisa nr 123'], [300, 'STU ERGO Hestia SA']]]), 1, 595)) ?? '', /POLISA\/POLICY/);
	assert.match(detect(new PdfDoc(linie(1, [[700, [74, 'POLISA/POLICY: 1'], [300, 'NNW']]]), 1, 595)) ?? '', /Hestii/);
});

test('certyfikat NNW jest odrzucany przez szablon OC zawodowego', () => {
	assert.match(detectOc(doc) ?? '', /certyfikat NNW/);
});

test('certyfikat NNW: numer, okres, zawarcie, strony, składka, rata, konto, OWU, parametry', () => {
	const e = parse(doc);
	assert.equal(e.nr_polisy, '470000099999');
	assert.equal(e.data_od, '2026-11-05');
	assert.equal(e.data_do, '2027-11-04');
	assert.equal(e.data_zawarcia, '2026-11-04');
	assert.equal(e.klient_nazwa, 'Gabinet Kosmetyczny Anna Testowa');
	assert.equal(e.klient_adres, 'Długa 13/2, 49-306 Brzeg');
	assert.equal(e.klient_nip, '1234563218');
	// Ubezpieczona osoba bez NIP — nie wiąże się z kartoteką, zostaje w parametrach.
	assert.equal(e.ubezpieczony_nazwa, 'ANNA TESTOWA');
	assert.equal(e.ubezpieczony_nip, null);
	assert.equal(e.dodatkowe['Ubezpieczony'], 'ANNA TESTOWA (ur. 25.12.1981)');
	assert.equal(e.skladka, 225);
	assert.deepEqual(e.raty, [{ data: '2026-11-19', kwota: 225 }]);
	assert.equal(e.ilosc_rat, 1);
	assert.equal(e.konto_do_wplat, '64 1240 6960 6013 4700 0007 1953');
	assert.equal(e.produkt_owu, 'OGÓLNE WARUNKI UBEZPIECZENIA BIZNES & PODRÓŻ NR PAT/OW071/2503');
	// Numeru programu nie ma — umowę generalną dobiera mapper po podtypie produktu.
	assert.equal(e.program_ug, null);
	assert.equal(e.rodzaj, 'nnw');
	assert.equal(e.suma_gwarancyjna, 100000);
	assert.equal(e.dodatkowe['Liczba ubezpieczonych'], '1');
	assert.equal(e.dodatkowe['Liczba osobo-dni'], '365');
	assert.equal(e.dodatkowe['Zakres terytorialny'], 'Cały świat');
	assert.equal(e.dodatkowe['Zakres czasowy'], 'Pełny (całodobowy)');
	assert.equal(e.dodatkowe['Zakres świadczeń'], 'system świadczeń proporcjonalnych');
	assert.equal(e.dodatkowe['Klasa ryzyka'], 'Klasa I');
});

test('certyfikat NNW: ryzyko z symbolem i sumą oraz klauzula z limitem jako pozycje ryzyk', () => {
	const e = parse(doc);
	assert.deepEqual(e.ryzyka, [
		{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'UBEZPIECZENIE NASTĘPSTW NIESZCZĘŚLIWYCH WYPADKÓW (A05 - 12)', suma: 100000, skladka: 225 },
		{
			sekcja: 'KLAUZULE DODATKOWE',
			przedmiot: 'Klauzula ubezpieczenia na wypadek zakażenia wirusem HIV i WZW podczas wykonywania czynności zawodowych — limit: zgodnie z Programem',
			suma: null
		}
	]);
	// toLocaleString('pl-PL') rozdziela tysiące wąską spacją niełamliwą — porównujemy po zwykłej spacji.
	assert.equal(
		e.przedmiot?.replace(/[  ]/g, ' '),
		'UBEZPIECZENIE NASTĘPSTW NIESZCZĘŚLIWYCH WYPADKÓW (A05 - 12): 100 000 zł; Klauzula ubezpieczenia na wypadek zakażenia wirusem HIV i WZW podczas wykonywania czynności zawodowych — limit: zgodnie z Programem'
	);
});
