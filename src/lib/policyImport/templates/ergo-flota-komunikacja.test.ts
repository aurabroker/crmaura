import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, type Word } from '../pdfDoc.ts';
import { detect, parse, parseMany } from './ergo-flota-komunikacja.ts';

// Słowa ułożone jak w wydruku z Cumulusa (pdf.js): etykiety w stałych kolumnach, przecinek
// jako osobne słowo, indeks górny „3” z [cm³] na własnej linii bazowej. Dane zmyślone.
type Fragment = [x: number, text: string];
function linie(page: number, wiersze: [y: number, ...Fragment[]][]): Word[] {
	const out: Word[] = [];
	for (const [y, ...fragmenty] of wiersze) for (const [x, text] of fragmenty) out.push({ page, x, y, text });
	return out;
}

const UG = 'TEST01234/26/KOM/A';
const NAZWA: Fragment[] = [[74, 'FIRMA'], [110, 'TESTOWA'], [150, 'SP. Z O.O.'], [200, ','], [210, 'Przykładowa'], [260, '12, 00-001 Warszawa,']];

function naglowek(page: number, nr: string): Word[] {
	return linie(page, [
		[763, [196, 'NUMER CERTYFIKATU / CERTIFICATE NUMBER'], [406.5, nr]],
		[747.7, [139.4, 'stanowiący'], [184.8, 'integralną'], [225.3, 'część'], [249.3, 'polisy generalnej / which constitutes an integral part of the general policy:']],
		[739.4, [458.4, UG]],
		[725.5, [390.3, 'Numer Underwritera/Underwriter No.: 001602']],
		[707.9, [74, 'UBEZPIECZAJĄCY'], [139.4, '/ POLICYHOLDER']],
		[700.8, ...NAZWA],
		[693.9, [74, 'NIP: 1234563218']],
		[683.7, [74, 'UBEZPIECZONY / INSURED']],
		[676.6, ...NAZWA],
		[669.7, [74, 'REGON: 123456785']],
		[655.6, [74, 'UBEZPIECZONY POJAZD / VEHICLE INSURED']]
	]);
}

function stopka(page: number, nr: string, skladka: string): Word[] {
	return linie(page, [
		[495.2, [398.2, 'SKŁADKA'], [429.2, '/ PREMIUM'], [496.9, skladka], [521.9, 'zł']],
		[481.1, [70.8, 'PŁATNOŚĆ'], [111.3, 'SKŁADKI']],
		[471.7, [70.8, 'Składka'], [93.9, 'płatna'], [111.9, 'przelewem na rachunek bankowy numer:'], [222.9, '33 1240 5400 1111 0000 4916 5924'], [319.7, ', w tytule przelewu'], [370.7, 'należy'], [389.7, 'wpisać'], [409.7, 'nr polisy'], [433.7, nr], [517.1, '.']],
		[457.9, [70.8, 'Płatności należy dokonać zgodnie z poniższym harmonogramem (termin płatności/kwota).']],
		[448, [74, '09.07.2026'], [110, '/'], [120, skladka], [150, 'zł']],
		[400, [300, '23.06.2026'], [340, '/'], [350, '23.06.2026']],
		[390, [300, 'Data wystawienia / Data zawarcia'], [420, 'Podpis Przedstawiciela STU ERGO Hestia SA']],
		[100, [500, 'Strona 1 z 1']]
	]);
}

const OKRES_I_TABELA: [number, ...Fragment[]][] = [
	[612.6, [74, 'Okres ubezpieczenia/'], [135.1, 'Period of insurance'], [194.5, '25.06.2026'], [231.5, '00:00'], [248.5, '- 24.06.2027'], [289.7, '24:00']],
	[598.7, [70.8, 'UBEZPIECZONE RYZYKA / RISKS INSURED']],
	[585.8, [74, 'ZAKRES UBEZPIECZENIA'], [393.2, 'SUMA UBEZPIECZENIA'], [497.2, 'SKŁADKA']],
	[578.9, [74, 'SCOPE OF COVER'], [418.9, 'SUM INSURED'], [498.2, 'PREMIUM']]
];

// Certyfikat 1: ciągnik siodłowy, OC + NNW, z wykorzystaniem pojazdu.
const CERT1 = 'TEST01234/26/KOM/A000004';
const strona1: Word[] = [
	...naglowek(1, CERT1),
	...linie(1, [
		[650.3, [464.9, '3']],
		[648.5, [74, 'MARKA:'], [106.3, 'MAN'], [187.4, 'DATA I REJESTRACJI: 11.04.2012'], [300.8, 'NR REJ:'], [333.1, 'WX12345'], [414.2, 'POJEMNOŚĆ'], [454.3, '[cm'], [467.2, ']:'], [474.8, '10 518']],
		[641.6, [74, 'MODEL:'], [106.3, 'TGX 18.440'], [187.4, 'ROK PRODUKCJI:'], [255.1, '2012'], [300.8, 'VIN:'], [333.1, 'WMA06XZZ8CP000001'], [414.2, 'ŁADOWNOŚĆ'], [455.9, '[kg]:'], [474.8, '10 180']],
		[634.7, [74, 'TYP:'], [255.1, 'RODZAJ:'], [300.8, 'CIĄGNIK'], [327.8, 'SAMOCHODOWY'], [414.2, 'LICZBA MIEJSC:'], [474.8, '2']],
		[627, [74, 'WYKORZYSTANIE POJAZDU: pojazd zastępczy na zasadach innych niż wynajem (ASO)']],
		...OKRES_I_TABELA,
		[566.3, [74, 'OC'], [414.5, '35 898 000,00'], [454.6, 'zł']],
		[566.7, [496.4, '3 300,00'], [521.4, 'zł']],
		[552.3, [85.1, 'PODSTAWA PRAWNA'], [150.4, 'Ustawa z 22 maja 2003 o Ubezpieczeniach Obowiązkowych, Ubezpieczeniowym Funduszu Gwarancyjnym i Polskim']],
		[544.4, [85.1, 'Biurze Ubezpieczycieli Komunikacyjnych oraz Umowa Generalna nr'], [267.2, UG]],
		[530.4, [74, 'NNW'], [426.2, '10 000,00'], [454.6, 'zł']],
		[530.9, [504.8, '55,00'], [521.4, 'zł']],
		[516.4, [85.1, 'PODSTAWA PRAWNA'], [150.4, 'Ogólne Warunki Ubezpieczenia Następstw Nieszczęśliwych Wypadków Kierowcy i Pasażerów nr AB-NNWK-01/25 z']],
		[508.6, [85.1, 'dnia 1.04.2025 r. oraz Umowa Generalna nr'], [203.8, UG]]
	]),
	...stopka(1, CERT1, '3 355,00')
];

// Certyfikat 2: ciężarowy z AC (parametry pod wierszem składki), KR, NNW; ryzyko ASS na stronie
// bez nagłówka — dalszy ciąg tego samego certyfikatu.
const CERT2 = 'TEST01234/26/KOM/A000005';
const strona2: Word[] = [
	...naglowek(2, CERT2),
	...linie(2, [
		[650.3, [464.9, '3']],
		[648.5, [74, 'MARKA:'], [106.3, 'Ford'], [187.4, 'DATA I REJESTRACJI: 31.08.2016'], [300.8, 'NR REJ:'], [333.1, 'WX22222'], [414.2, 'POJEMNOŚĆ'], [454.3, '[cm'], [467.2, ']:'], [474.8, '2 198']],
		[641.6, [74, 'MODEL:'], [106.3, 'Transit'], [187.4, 'ROK PRODUKCJI:'], [255.1, '2016'], [300.8, 'VIN:'], [333.1, 'WF0XXXTTGXGC00002'], [414.2, 'ŁADOWNOŚĆ'], [455.9, '[kg]:'], [474.8, '1 180']],
		[634.7, [74, 'TYP:'], [255.1, 'RODZAJ:'], [300.8, 'SAMOCHÓD'], [327.8, 'CIĘŻAROWY'], [414.2, 'LICZBA MIEJSC:'], [474.8, '3']],
		...OKRES_I_TABELA,
		[566.3, [74, 'OC'], [414.5, '35 898 000,00'], [454.6, 'zł']],
		[566.7, [496.4, '1 600,00'], [521.4, 'zł']],
		[552.3, [85.1, 'PODSTAWA PRAWNA'], [150.4, 'Ustawa z 22 maja 2003 oraz Umowa Generalna nr'], [400, UG]],
		[540, [74, 'AC'], [420, '59 940,00'], [454.6, 'zł'], [496.4, '1 019,00'], [521.4, 'zł']],
		[532, [85.1, 'Rodzaj sumy ubezpieczenia'], [480, 'VAT50%']],
		[525, [85.1, 'Udział własny'], [460, 'Kwotowa 0,00 zł']],
		[518, [85.1, 'System likwidacji'], [480, 'serwisowy']],
		[510, [85.1, 'PODSTAWA PRAWNA'], [150.4, 'Ogólne Warunki Autocasco nr AB-AC-01/25 z dnia 1.04.2025 r. oraz Umowa Generalna nr'], [450, UG]],
		[500, [74, 'KR'], [420, '59 940,00'], [454.6, 'zł'], [500, '180,00'], [521.4, 'zł']],
		[492, [85.1, 'PODSTAWA PRAWNA'], [150.4, 'Ogólne Warunki Autocasco nr AB-AC-01/25']],
		[484, [74, 'NNW'], [426.2, '10 000,00'], [454.6, 'zł'], [504.8, '55,00'], [521.4, 'zł']],
		[476, [85.1, 'PODSTAWA PRAWNA'], [150.4, 'OWU NNW nr AB-NNWK-01/25']]
	])
];
const strona3: Word[] = [
	...linie(3, [
		[760, [74, 'ASS'], [420, '15 000,00'], [454.6, 'zł'], [500, '120,00'], [521.4, 'zł']],
		[750, [85.1, 'PODSTAWA PRAWNA'], [150.4, 'OWU Assistance']]
	]),
	...stopka(3, CERT2, '2 974,00')
];

const doc = new PdfDoc([...strona1, ...strona2, ...strona3], 3, 595);

test('detect rozpoznaje certyfikat komunikacyjny Hestii i odrzuca inne dokumenty', () => {
	assert.equal(detect(doc), null);
	const obcy = new PdfDoc(linie(1, [[700, [74, 'Polisa nr 123'], [300, 'Podpis Przedstawiciela STU ERGO Hestia SA']]]), 1, 595);
	assert.match(detect(obcy) ?? '', /NUMER CERTYFIKATU/);
	const inneTu = new PdfDoc(linie(1, [[700, [74, 'NUMER CERTYFIKATU'], [300, 'UBEZPIECZONY POJAZD']]]), 1, 595);
	assert.match(detect(inneTu) ?? '', /ERGO Hestii/);
});

test('plik wielocertyfikatowy: strona z nagłówkiem zaczyna certyfikat, strona bez nagłówka go kontynuuje', () => {
	const lista = parseMany(doc);
	assert.equal(lista.length, 2);
	assert.deepEqual(lista.map((e) => e.nr_polisy), [CERT1, CERT2]);
	assert.equal(parse(doc).nr_polisy, CERT1);
	// ASS ze strony 3 należy do certyfikatu 2.
	assert.deepEqual(lista[1].ryzyka.map((r) => r.przedmiot), [
		'OC posiadaczy pojazdów mechanicznych',
		'Autocasco',
		'Kradzież (KR)',
		'NNW kierowcy i pasażerów',
		'Assistance'
	]);
});

test('certyfikat: numer, umowa generalna, okres, strony, składka, raty, konto, OWU', () => {
	const e = parseMany(doc)[0];
	assert.equal(e.program_ug, UG);
	assert.equal(e.data_od, '2026-06-25');
	assert.equal(e.data_do, '2027-06-24');
	assert.equal(e.data_zawarcia, '2026-06-23');
	assert.equal(e.skladka, 3355);
	assert.equal(e.klient_nazwa, 'FIRMA TESTOWA SP. Z O.O.');
	assert.equal(e.klient_adres, 'Przykładowa 12, 00-001 Warszawa');
	assert.equal(e.klient_nip, '1234563218');
	// REGON stoi przy ubezpieczonym, ale to ta sama firma — opisuje klienta.
	assert.equal(e.klient_regon, '123456785');
	assert.equal(e.ubezpieczony_nip, '1234563218');
	assert.equal(e.leasing, null);
	assert.deepEqual(e.raty, [{ data: '2026-07-09', kwota: 3355 }]);
	assert.equal(e.ilosc_rat, 1);
	assert.equal(e.konto_do_wplat, '33 1240 5400 1111 0000 4916 5924');
	assert.equal(e.produkt_owu, 'AB-NNWK-01/25');
	assert.equal(e.rodzaj, 'komunikacja');
	assert.equal(e.dodatkowe['Numer underwritera'], '001602');
	assert.deepEqual(e.ryzyka, [
		{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'OC posiadaczy pojazdów mechanicznych', suma: 35898000, skladka: 3300 },
		{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'NNW kierowcy i pasażerów', suma: 10000, skladka: 55 }
	]);
	assert.equal(e.przedmiot, 'WX12345 / WMA06XZZ8CP000001 — MAN TGX 18.440 | Zakres: OC posiadaczy pojazdów mechanicznych, NNW kierowcy i pasażerów');
});

test('pojazd z certyfikatu niesie pełne zaszeregowanie wg Cumulus', () => {
	const [c1, c2] = parseMany(doc);
	assert.deepEqual(c1.pojazd, {
		nr_rejestracyjny: 'WX12345',
		vin: 'WMA06XZZ8CP000001',
		marka_model: 'MAN TGX 18.440',
		rok_produkcji: 2012,
		rodzaj_pojazdu: 'Ciągnik samochodowy',
		pojemnosc_silnika: 10518,
		moc: null,
		ladownosc: 10180,
		rodzaj_rejestrowy: 'CIĄGNIK SAMOCHODOWY',
		rodzaj_kalkulacyjny: 'Ciągniki siodłowe',
		typ_pojazdu: null,
		liczba_miejsc: 2,
		data_pierwszej_rejestracji: '2012-04-11',
		uzytkowanie: { zastepczy_aso: true }
	});
	assert.equal(c1.dodatkowe['Wykorzystanie pojazdu'], 'pojazd zastępczy na zasadach innych niż wynajem (ASO)');
	assert.equal(c2.pojazd?.rodzaj_kalkulacyjny, 'Ciężarowe o ładowności pow. 850kg do 2500kg');
	assert.equal(c2.pojazd?.liczba_miejsc, 3);
	assert.equal(c2.pojazd?.uzytkowanie, null);
});

test('parametry AC pod wierszem składki trafiają do informacji dodatkowych', () => {
	const e = parseMany(doc)[1];
	assert.equal(e.skladka, 2974);
	assert.equal(e.dodatkowe['AC — rodzaj sumy ubezpieczenia'], 'VAT50%');
	assert.equal(e.dodatkowe['AC — udział własny'], 'Kwotowa 0,00 zł');
	assert.equal(e.dodatkowe['AC — system likwidacji'], 'serwisowy');
	assert.equal(e.produkt_owu, 'AB-AC-01/25, AB-NNWK-01/25');
	const ac = e.ryzyka.find((r) => r.przedmiot === 'Autocasco');
	assert.deepEqual(ac, { sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'Autocasco', suma: 59940, skladka: 1019 });
});
