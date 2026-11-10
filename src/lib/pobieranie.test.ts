import test from 'node:test';
import assert from 'node:assert/strict';
import { bezUkosnikow, nazwaPliku } from './pobieranie.ts';

test('nazwa pliku od klienta zostaje, znika tylko ścieżka i znaki niedozwolone w nazwach plików', () => {
	assert.equal(nazwaPliku('Dyplom kosmetologa.pdf'), 'Dyplom kosmetologa.pdf');
	assert.equal(nazwaPliku('C:\\Users\\Anna\\Skany\\certyfikat HIFU.JPG'), 'certyfikat HIFU.JPG');
	assert.equal(nazwaPliku('zgoda: "botoks"?.pdf'), 'zgoda botoks.pdf');
	assert.equal(nazwaPliku('  żółć — ąę.png  '), 'żółć — ąę.png');
});

test('brak rozszerzenia uzupełnia się ze ścieżki w magazynie albo z podanego wzorca', () => {
	assert.equal(nazwaPliku('Skan dyplomu', 'firma/wniosek/zal/3f2a.JPEG'), 'Skan dyplomu.jpeg');
	assert.equal(nazwaPliku('Wniosek 472000146732', '.pdf'), 'Wniosek 472000146732.pdf');
	assert.equal(nazwaPliku('Wniosek 472000146732.pdf', '.pdf'), 'Wniosek 472000146732.pdf');
	// Adres z podpisem: parametry nie są rozszerzeniem.
	assert.equal(nazwaPliku('APK', 'https://x.example/apk-pdfs/a/b.pdf?token=abc.def'), 'APK.pdf');
});

test('pusta nazwa: zapas z rozszerzeniem wzorca; długa nazwa jest skracana bez utraty rozszerzenia', () => {
	assert.equal(nazwaPliku('', 'a/b/apk.pdf'), 'plik.pdf');
	assert.equal(nazwaPliku(null, null, 'dokument'), 'dokument');
	const dluga = nazwaPliku(`${'a'.repeat(300)}.pdf`);
	assert.equal(dluga.length, 180);
	assert.ok(dluga.endsWith('.pdf'));
});

test('numer polisy z ukośnikami w nazwie pliku: ukośniki stają się myślnikami', () => {
	assert.equal(bezUkosnikow('WA50/003353/24/A'), 'WA50-003353-24-A');
	assert.equal(nazwaPliku(`Wniosek ${bezUkosnikow('WA50/003353/24/A')}`, '.pdf'), 'Wniosek WA50-003353-24-A.pdf');
});
