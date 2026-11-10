import test from 'node:test';
import assert from 'node:assert/strict';
import {
	ZABIEGI_ANKIETA,
	polisaIndywidualna,
	kategoriaZRodzajow,
	waliduj_apk,
	ZABIEGI_LISTA_1,
	ZABIEGI_LISTA_2,
	ZABIEGI_LISTY,
	czyZabieg,
	zabiegAnkietyAktualny,
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

test('polisa indywidualna: znacznik importu, a bez niego seria numeru 436 (certyfikaty programu: 472)', () => {
	assert.equal(polisaIndywidualna({ nr_polisy: '436000416447' }), true);
	assert.equal(polisaIndywidualna({ nr_polisy: '436000413518' }), true); // składka 950 zł wygląda jak taryfa, ale to polisa indywidualna
	assert.equal(polisaIndywidualna({ nr_polisy: '472000154126' }), false); // certyfikat ze składką 55,89 zł spoza taryfy
	assert.equal(polisaIndywidualna({ nr_polisy: '472000165393', dane_importu: { owu: 'AB-OCZL-01/25' } }), false);
	assert.equal(polisaIndywidualna({ nr_polisy: 'X1', dane_importu: { owu: 'AB-OCZB-01/25' } }), true);
	assert.equal(polisaIndywidualna({ nr_polisy: 'X1', dane_importu: { zrodlo: { produkt: 'OC zawodowe — polisa indywidualna (po ocenie ryzyka)' } } }), true);
	assert.equal(polisaIndywidualna({ nr_polisy: '436000450758', dane_importu: { owu: 'AB-OCZL-01/25' } }), false); // OWU rozstrzyga przed numerem
	assert.equal(polisaIndywidualna({ nr_polisy: null }), false);
});

test('salon masażu: taryfa podstawowa; salon tatuażu: jak kosmetologia (tatuaż w Załączniku nr 2)', () => {
	assert.equal(kategoriaZRodzajow(['masaz']), 'kosmetyczny_fryzjerski');
	assert.equal(kategoriaZRodzajow(['masaz', 'kosmetologiczny']), 'kosmetologiczny');
	assert.equal(kategoriaZRodzajow(['masaz', 'podologiczny']), 'pelny');
	assert.equal(kategoriaZRodzajow(['tatuaz']), 'kosmetologiczny');
	assert.equal(kategoriaZRodzajow(['tatuaz', 'kosmetyczny', 'masaz']), 'kosmetologiczny');
	assert.equal(kategoriaZRodzajow(['tatuaz', 'fryzjerski']), 'pelny');
	// Pierwsza polisa, suma 200 000 zł: masaż 500 zł, tatuaż 790 zł (taryfa kosmetologiczna).
	assert.equal(kw(wycenaNowej(wnNowy({ wyzsza_suma: 200000 }), { ...apkA, rodzaje: ['masaz'] })), 500);
	assert.equal(kw(wycenaNowej(wnNowy({ wyzsza_suma: 200000 }), { ...apkA, rodzaje: ['tatuaz'] })), 790);
	// Odnowienie ze zmianą działalności na salon tatuażu przy obecnej sumie 100 000 zł.
	assert.equal(kw(wycenaWniosku(wn({ zmiana_dzialalnosci: true, rodzaje: ['tatuaz'] }), apkA, 400, false, 100000)), 650);
	// APK przyjmuje nowe rodzaje.
	const v = waliduj_apk({ ...apkA, rodzaje: ['masaz', 'tatuaz', 'nieznany'] });
	assert.deepEqual(v.ok ? v.value.rodzaje : null, ['masaz', 'tatuaz']);
});

test('Aneks nr 5: Załącznik nr 1 ma 49 pozycji, Załącznik nr 2 — 63', () => {
	assert.equal(ZABIEGI_LISTA_1.length, 49);
	assert.equal(new Set(ZABIEGI_LISTA_1).size, 49);
	for (const z of ['Warkocze syntetyczne', 'Masaż kobido', 'Masaż mięśniowo-powięziowy', 'Masaż transbukalny', 'Suche igłowanie', 'Opalanie natryskowe'])
		assert.ok((ZABIEGI_LISTA_1 as readonly string[]).includes(z), z);
	assert.equal(ZABIEGI_LISTA_1[41], 'Zabiegi wykorzystujące terapeutyczne działanie światła – światło LED i jego pochodnych');
	assert.equal(ZABIEGI_LISTA_1[48], 'Opalanie natryskowe');

	assert.equal(ZABIEGI_LISTA_2.length, 63);
	assert.equal(new Set(ZABIEGI_LISTA_2).size, 63);
	for (const z of ['Tatuaż', 'Masaż transbukalny', 'Masaż mięśniowo-powięziowy', 'Suche igłowanie', 'Needle shaping'])
		assert.ok((ZABIEGI_LISTA_2 as readonly string[]).includes(z), z);
	assert.equal(ZABIEGI_LISTA_2[47], 'Tatuaż');
	assert.equal(ZABIEGI_LISTA_2[62], 'Needle shaping');
	// Wersja robocza listy miała „Stymulatory tkankowe” — w aneksie tej pozycji nie ma.
	assert.equal((ZABIEGI_LISTA_2 as readonly string[]).includes('Stymulatory tkankowe'), false);

	// Lista łączna: „Masaż kobido” i „Masaż Kobido” to jedna pozycja.
	assert.equal(ZABIEGI_LISTY.filter((z) => z.toLowerCase() === 'masaż kobido').length, 1);
	assert.equal(ZABIEGI_LISTY.length, new Set(ZABIEGI_LISTY.map((z) => z.toLowerCase())).size);
});

test('Aneks nr 5: zabiegi do indywidualnej oceny — 8 pozycji w kolejności a–h, dawne nazwy przechodzą na nowe', () => {
	assert.deepEqual([...ZABIEGI_ANKIETA], [
		'Zabiegi z użyciem wypełniaczy na bazie kwasu hialuronowego',
		'Zabiegi lipolizy iniekcyjnej',
		'Zabiegi z użyciem fibryny, osocza bogatopłytkowego i wypełniaczy autologicznych',
		'Zabiegi urządzeniami opartymi na technologii HIFU (skupiona wiązka fal ultradźwiękowych o dużym natężeniu)',
		'Zabiegi z użyciem urządzeń wykorzystujących technologię PLASMA',
		'Zabiegi laserami ablacyjnymi i frakcyjno-ablacyjnymi',
		'Zabiegi z użyciem nici PDO, PLLA i PLA/CL',
		'Zabiegi z użyciem toksyny botulinowej'
	]);
	assert.equal(zabiegAnkietyAktualny('Zabiegi z użyciem nici PDO'), 'Zabiegi z użyciem nici PDO, PLLA i PLA/CL');
	assert.equal(zabiegAnkietyAktualny('Zabiegi laserem ablacyjnym'), 'Zabiegi laserami ablacyjnymi i frakcyjno-ablacyjnymi');
	assert.equal(zabiegAnkietyAktualny('Zabiegi z użyciem toksyny botulinowej'), 'Zabiegi z użyciem toksyny botulinowej');
	assert.equal(czyZabieg('Zabiegi z użyciem nici PDO'), false);
	assert.equal(czyZabieg('Zabiegi z użyciem nici PDO, PLLA i PLA/CL'), true);
	assert.equal(czyZabieg('Warkocze syntetyczne'), true);

	// Wniosek wysłany z otwartej karty sprzed zmiany: dawne nazwy (także u osób wykonujących) stają się obecnymi.
	const v = waliduj_wniosek(
		{
			decyzja: 'zmiany',
			zmiany: {
				...pusteZmiany(),
				zabiegi_ankieta: ['Zabiegi z użyciem osocza bogatopłytkowego', 'Zabiegi z użyciem toksyny botulinowej', 'nieznany'],
				wykonawcy: [{ id: 'a1', imie_nazwisko: 'Anna Testowa', zabiegi: ['Zabiegi z użyciem osocza bogatopłytkowego', 'Zabiegi z użyciem toksyny botulinowej'] }]
			}
		},
		apkA
	);
	assert.ok(v.ok, v.ok ? '' : v.bledy.join(' | '));
	const nowe = ['Zabiegi z użyciem fibryny, osocza bogatopłytkowego i wypełniaczy autologicznych', 'Zabiegi z użyciem toksyny botulinowej'];
	assert.deepEqual(v.ok ? v.value.zmiany?.zabiegi_ankieta : null, nowe);
	assert.deepEqual(v.ok ? v.value.zmiany?.wykonawcy[0].zabiegi : null, nowe);
});
