import test from 'node:test';
import assert from 'node:assert/strict';
import { nazwaZDysku, sprawdzZDysku, zgodnaTresc } from './zalacznikiZDysku.ts';

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const PDF = new TextEncoder().encode('%PDF-1.7 test');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

test('plik z dysku: nazwa bez ścieżki i znaków niedozwolonych, typ z rozszerzenia, treść sprawdzona', () => {
	const [a, b, c] = sprawdzZDysku(
		[
			{ nazwa: 'C:\\Skany\\Ankieta ERGO.pdf', rozmiar: 1, dane: b64(PDF) },
			{ nazwa: 'potwierdzenie "przelewu".png', rozmiar: 1, dane: `data:image/png;base64,${b64(PNG)}` },
			{ nazwa: 'Wniosek.DOCX', rozmiar: 1, dane: b64(DOCX) }
		],
		true
	);
	assert.deepEqual([a.nazwa, a.typ, a.rozmiar], ['Ankieta ERGO.pdf', 'application/pdf', PDF.length]);
	assert.equal(b.nazwa, 'potwierdzenie przelewu .png');
	assert.equal(b.typ, 'image/png');
	assert.equal(c.typ, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('plik z dysku: odrzucony program z podmienioną końcówką, niedozwolony typ, pusty plik i więcej niż 5 plików', () => {
	assert.throws(() => sprawdzZDysku([{ nazwa: 'polisa.pdf', rozmiar: 4, dane: b64(EXE) }], true), /nie jest prawidłowym plikiem PDF/);
	assert.throws(() => sprawdzZDysku([{ nazwa: 'instalator.exe', rozmiar: 4, dane: b64(EXE) }], true), /niedozwolony typ/);
	assert.throws(() => sprawdzZDysku([{ nazwa: 'pusty.pdf', rozmiar: 0, dane: '' }], true), /Brak treści/);
	assert.throws(() => sprawdzZDysku(Array.from({ length: 6 }, (_, i) => ({ nazwa: `${i}.pdf`, rozmiar: 1 })), false), /Najwyżej 5/);
});

test('podgląd: wystarczy nazwa i rozmiar, bez treści', () => {
	const [p] = sprawdzZDysku([{ nazwa: 'Załącznik.pdf', rozmiar: 2048 }], false);
	assert.equal(p.rozmiar, 2048);
	assert.equal(p.dane, null);
	assert.deepEqual(sprawdzZDysku(undefined, true), []);
});

test('nazwa i treść: długa nazwa zachowuje rozszerzenie, tekst bez bajtów zerowych', () => {
	const n = nazwaZDysku(`${'a'.repeat(200)}.pdf`);
	assert.equal(n.length, 150);
	assert.ok(n.endsWith('.pdf'));
	assert.equal(zgodnaTresc(new TextEncoder().encode('a;b;c\n1;2;3'), 'csv'), true);
	assert.equal(zgodnaTresc(new Uint8Array([0x61, 0x00, 0x62]), 'txt'), false);
});
