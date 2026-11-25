import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, type Word } from '../pdfDoc.ts';
import { detect, parse } from './ergo-oc-indywidualna.ts';

// Słowa ułożone jak w polisie indywidualnej ERGO (pdf.js): etykiety przy lewym marginesie (x ≈ 47),
// wartości w prawej kolumnie; tabela płatności z datą raty od x ≈ 191. Dane zmyślone.
type Fragment = [x: number, text: string];
function linie(page: number, wiersze: [y: number, ...Fragment[]][]): Word[] {
	const out: Word[] = [];
	for (const [y, ...fragmenty] of wiersze) for (const [x, text] of fragmenty) out.push({ page, x, y, text });
	return out;
}

function polisa(platnosc: [number, ...Fragment[]][]): PdfDoc {
	return new PdfDoc(
		linie(1, [
			[760, [400, 'STU ERGO Hestia SA']],
			[750, [47, 'Polisa nr 436000499999']],
			[705.7, [47, 'Okres ubezpieczenia:'], [144, 'od 26.11.2026 00:00 do 25.11.2027 23:59']],
			[680, [47, 'Ubezpieczający:'], [263, 'Studio Urody Anna Testowa']],
			[668, [263, 'UL. Ciasna 10, 41-209 Sosnowiec, NIP: 1234563218']],
			[640, [47, 'Warunki ubezpieczenia:']],
			[628, [47, 'Ubezpieczenie OC z tytułu wykonywania czynności zawodowych M30-13']],
			[610, [47, 'Suma ubezpieczenia:'], [263, '100 000,00 PLN']],
			[590, [47, 'Składka i sposób płatności:']],
			[575, [47, 'Składka łączna:'], [191, '1 942,00 PLN (słownie: tysiąc dziewięćset czterdzieści dwa złotych 0/100)']],
			[560, [47, 'Składka płatna na rachunek bankowy:'], [191, '78 1240 6960 6013 4360 0045 4746']],
			...platnosc,
			[480, [373, 'Polisę wystawiono w Warszawie, dnia 25.11.2026']]
		]),
		1,
		612
	);
}

test('polisa indywidualna w dwóch ratach: etykieta „Terminy płatności i kwoty rat” (liczba mnoga) daje obie raty', () => {
	const doc = polisa([
		[545, [47, 'Warunki płatności składki:'], [191, 'płatna w 2 ratach']],
		[530, [47, 'Terminy płatności i kwoty rat:'], [191, '09.12.2026'], [335, '971,00 PLN']],
		[515, [191, '02.06.2027'], [335, '971,00 PLN']]
	]);
	assert.equal(detect(doc), null);
	const e = parse(doc);
	assert.equal(e.nr_polisy, '436000499999');
	assert.equal(e.data_od, '2026-11-26');
	assert.equal(e.data_do, '2027-11-25');
	assert.equal(e.dodatkowe['Okres ubezpieczenia'], 'od 26.11.2026 00:00 do 25.11.2027 23:59');
	assert.equal(e.data_zawarcia, '2026-11-25');
	assert.equal(e.klient_nazwa, 'Studio Urody Anna Testowa');
	assert.equal(e.klient_nip, '1234563218');
	assert.equal(e.suma_gwarancyjna, 100000);
	assert.equal(e.skladka, 1942);
	assert.deepEqual(e.raty, [
		{ data: '2026-12-09', kwota: 971 },
		{ data: '2027-06-02', kwota: 971 }
	]);
	assert.equal(e.ilosc_rat, 2);
	assert.equal(e.konto_do_wplat, '78 1240 6960 6013 4360 0045 4746');
	assert.equal(e.dodatkowe['Warunki płatności'], 'płatna w 2 ratach');
	assert.equal(e.ryzyka[0]?.przedmiot, 'Ubezpieczenie OC z tytułu wykonywania czynności zawodowych (M30-13)');
});

test('polisa indywidualna w jednej racie: etykieta „Termin płatności i kwota raty”', () => {
	const e = parse(
		polisa([
			[545, [47, 'Warunki płatności składki:'], [191, 'płatna jednorazowo']],
			[530, [47, 'Termin płatności i kwota raty:'], [191, '09.12.2026'], [335, '1 942,00 PLN']]
		])
	);
	assert.deepEqual(e.raty, [{ data: '2026-12-09', kwota: 1942 }]);
	assert.equal(e.ilosc_rat, 1);
});
