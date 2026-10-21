import test from 'node:test';
import assert from 'node:assert/strict';
import {
	ZABIEGI_ANKIETA,
	waliduj_wniosek,
	wycenaNowej,
	wycenaWniosku,
	zabiegiWniosku,
	type Apk,
	type Wniosek,
	type Wycena,
	type Zmiany
} from './program.ts';

const apkA: Apk = {
	rodzaje: ['kosmetyczny'],
	osoby: '1-5',
	ochrona_prawna: 'nie',
	szkolenia: 'nie',
	inne_ubezpieczenia: ['brak'],
	uwagi: '',
	oswiadczenie: true
};

const pusteZmiany = (): Zmiany => ({
	wyzsza_suma: null,
	ochrona_prawna: false,
	adres: null,
	nowe_zabiegi: [],
	zabiegi_ankieta: [],
	inne: '',
	rodzaje: [],
	osoby: null,
	wykonawcy: [],
	zmiana_dzialalnosci: false
});
const wn = (z: Partial<Zmiany>): Wniosek => ({ decyzja: 'zmiany', zmiany: { ...pusteZmiany(), ...z }, nie_powod: '', potwierdzenie_nie: false });
const wnNowy = (z: Partial<Zmiany>): Wniosek => ({ ...wn(z), decyzja: 'nowa' });
const kw = (w: Wycena | null) => (w?.rodzaj === 'kwota' ? w.kwota : null);

test('zmiana działalności A→B przy obecnej sumie 200 000 → 790 zł', () =>
	assert.equal(kw(wycenaWniosku(wn({ zmiana_dzialalnosci: true, rodzaje: ['kosmetyczny', 'kosmetologiczny'] }), apkA, 500, false, 200000)), 790));

test('zmiana działalności z inną sumą → składka nowej sumy', () =>
	assert.equal(
		kw(wycenaWniosku(wn({ zmiana_dzialalnosci: true, rodzaje: ['fryzjerski', 'kosmetologiczny'], wyzsza_suma: 300000 }), apkA, 500, false, 200000)),
		1250
	));

test('zmiana działalności przy ochronie prawnej w obecnym certyfikacie → +92 zł', () =>
	assert.equal(kw(wycenaWniosku(wn({ zmiana_dzialalnosci: true, rodzaje: ['kosmetologiczny'] }), apkA, 592, true, 200000)), 882));

test('zmiana działalności i zabiegi z ankiety → indywidualna', () =>
	assert.equal(
		wycenaWniosku(wn({ zmiana_dzialalnosci: true, rodzaje: ['kosmetologiczny'], zabiegi_ankieta: [ZABIEGI_ANKIETA[0]] }), apkA, 500, false, 200000)?.rodzaj,
		'indywidualna'
	));

test('zmiana działalności bez znanej sumy obecnej → indywidualna (brak danych)', () =>
	assert.equal(wycenaWniosku(wn({ zmiana_dzialalnosci: true, rodzaje: ['kosmetologiczny'] }), apkA, null, false, null)?.rodzaj, 'indywidualna'));

test('walidacja: zabiegi z list ignorowane, bez osób i dokumentów', () => {
	const r = waliduj_wniosek({ decyzja: 'zmiany', zmiany: { nowe_zabiegi: ['Mezoterapia igłowa'], zmiana_dzialalnosci: true, rodzaje: ['kosmetologiczny'] } }, apkA);
	assert.equal(r.ok, true);
	assert.deepEqual(r.ok && r.value.zmiany?.nowe_zabiegi, []);
	assert.deepEqual(r.ok && r.value.zmiany?.wykonawcy, []);
	assert.equal(r.ok && r.value.zmiany?.zmiana_dzialalnosci, true);
});

const bledy = (r: ReturnType<typeof waliduj_wniosek>) => (r.ok ? [] : r.bledy);

test('walidacja: zmiana działalności bez rodzaju → błąd', () =>
	assert.deepEqual(bledy(waliduj_wniosek({ decyzja: 'zmiany', zmiany: { zmiana_dzialalnosci: true, rodzaje: [] } }, apkA)), [
		'Zaznacz rodzaj działalności na nowy okres.'
	]));

test('walidacja: zmiana działalności bez APK i bez liczby osób → błąd', () =>
	assert.deepEqual(bledy(waliduj_wniosek({ decyzja: 'zmiany', zmiany: { zmiana_dzialalnosci: true, rodzaje: ['kosmetologiczny'] } }, null)), [
		'Do wyceny nowej składki podaj liczbę osób wykonujących zabiegi.'
	]));

test('walidacja: same zabiegi z list (stary szkic) to nie zmiana → błąd „zaznacz co najmniej jedną zmianę”', () =>
	assert.deepEqual(bledy(waliduj_wniosek({ decyzja: 'zmiany', zmiany: { nowe_zabiegi: ['Manicure'] } }, apkA)), [
		'Zaznacz co najmniej jedną zmianę albo wybierz „tak, bez zmian”.'
	]));

test('dokumenty tylko przy zabiegach z ankiety', () => {
	const z: Zmiany = { ...pusteZmiany(), nowe_zabiegi: ['Manicure'], zabiegi_ankieta: [ZABIEGI_ANKIETA[1]] };
	assert.deepEqual(zabiegiWniosku(z), [ZABIEGI_ANKIETA[1]]);
});

test('pierwsza polisa: składka z rodzajów, bez zmian', () =>
	assert.equal(kw(wycenaNowej(wnNowy({ wyzsza_suma: 200000, rodzaje: ['kosmetologiczny'], osoby: '1-5' }), null)), 790));
