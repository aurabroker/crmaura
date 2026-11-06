import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyExtraction, type ExtractedPolicy } from './types.ts';
import { porownajZWnioskiem, wniosekDoPolisy, type WniosekDoPorownania } from './wniosek.ts';

const bezNbsp = (s: string) => s.replace(/[  ]/g, ' ');

// Wniosek o pierwszą polisę: taryfa pełna (kosmetyka + fryzjerstwo + kosmetologia), 6–8 osób, suma 300 000,
// bez ochrony prawnej → 1 250 zł + 25% = 1 562,50 zł. Dane zmyślone.
const nowa: WniosekDoPorownania = {
	id: 'w1',
	rodzaj: 'nowa',
	status: 'zlozony',
	decyzja: 'nowa',
	polisa_id: null,
	klient_id: 'k1',
	email: 'klient@example.com',
	suma: null,
	skladka: null,
	skladka_nowa: 1562.5,
	okres_do: null,
	zlozono_at: '2026-11-06T18:58:48.655+00:00',
	apk: { rodzaje: ['kosmetyczny', 'fryzjerski', 'kosmetologiczny'], osoby: '6-8', ochrona_prawna: 'nie', szkolenia: 'nie', inne_ubezpieczenia: ['brak'], uwagi: '', oswiadczenie: true },
	wniosek: {
		decyzja: 'nowa',
		zmiany: { wyzsza_suma: 300000, ochrona_prawna: false, adres: null, nowe_zabiegi: [], zabiegi_ankieta: [], inne: '', rodzaje: [], osoby: null, wykonawcy: [], zmiana_dzialalnosci: false },
		nie_powod: '',
		potwierdzenie_nie: false,
		nowa: {
			firma: { nazwa: 'studio.pl Anna Testowa', nip: '1234563218', regon: '', ulica: 'Wojskowa 16', kod: '08-110', miasto: 'Siedlce', email: 'klient@example.com', telefon: '+48500000000' },
			ochrona_od: '2026-11-07',
			oswiadczenia: true
		}
	}
};

function certyfikat(zmiany: Partial<ExtractedPolicy> = {}): ExtractedPolicy {
	return {
		...emptyExtraction(),
		nr_polisy: '472000199999',
		data_od: '2026-11-07',
		data_do: '2027-11-06',
		klient_nip: '1234563218',
		klient_adres: 'Wojskowa 16, 08-110 Siedlce',
		skladka: 1562.5,
		suma_gwarancyjna: 300000,
		ryzyka: [{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'GABINETY KOSMETYCZNE, KOSMETOLOGICZNE, FRYZJERSKIE I PODOLOGICZNE (M30 - 13)', suma: 300000, skladka: 1562.5 }],
		dodatkowe: { 'Klauzule dodatkowe': 'Liczba zatrudnionych od 6 do 8 przy SG 300.000,00 zł' },
		...zmiany
	};
}

test('polisa zgodna z wnioskiem o pierwszą polisę: jedna informacja z listą sprawdzonych elementów', () => {
	const out = porownajZWnioskiem(certyfikat(), nowa);
	assert.equal(out.length, 1);
	assert.equal(out[0].level, 'info');
	assert.equal(
		bezNbsp(out[0].text),
		// pl-PL nie grupuje tysięcy w liczbach czterocyfrowych (1562,50), grupuje od pięciu cyfr.
		'Polisa zgodna ze złożonym wnioskiem (wniosek o pierwszą polisę z 06.11.2026): suma 300.000 zł, składka 1562,50 zł, bez ochrony prawnej, 6–8 osób, zakres „Gabinety kosmetyczne, kosmetologiczne, fryzjerskie i podologiczne”, ochrona od 07.11.2026.'
	);
});

test('certyfikat z innym adresem niż we wniosku: ostrzeżenie o adresie', () => {
	const out = porownajZWnioskiem(certyfikat({ klient_adres: 'ks. Brzóski 26, 08-300 Przywózki' }), nowa);
	assert.deepEqual(
		out.map((i) => [i.level, i.text]),
		[['warn', 'Niezgodność z wnioskiem (wniosek o pierwszą polisę z 06.11.2026): adres na polisie „ks. Brzóski 26, 08-300 Przywózki”, we wniosku „Wojskowa 16, 08-110 Siedlce”.']]
	);
});

test('nieodczytana suma gwarancyjna, inna składka, brak klauzuli 6–8 osób, obca ochrona prawna i inny zakres — osobne ostrzeżenia', () => {
	const e = certyfikat({
		suma_gwarancyjna: null,
		skladka: 1250,
		data_od: '2026-11-10',
		ryzyka: [{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'GABINETY KOSMETOLOGICZNE (M30 - 13)', suma: null, skladka: 1250 }],
		dodatkowe: { 'Klauzule dodatkowe': 'Klauzula kosztów ochrony prawnej (klauzula 7)' }
	});
	const out = porownajZWnioskiem(e, nowa);
	assert.ok(out.every((i) => i.level === 'warn'));
	assert.deepEqual(
		out.map((i) => bezNbsp(i.text).replace('Niezgodność z wnioskiem (wniosek o pierwszą polisę z 06.11.2026): ', '')),
		[
			'nie odczytano sumy gwarancyjnej z polisy, we wniosku 300.000 zł — uzupełnij ją na karcie polisy.',
			'składka na polisie 1250,00 zł, we wniosku 1562,50 zł.',
			'na polisie klauzula ochrony prawnej, której nie było we wniosku.',
			'we wniosku 6–8 osób, na polisie nie ma klauzuli „Liczba zatrudnionych od 6 do 8”.',
			'zakres na polisie „GABINETY KOSMETOLOGICZNE”, z wniosku wynika „Gabinety kosmetyczne, kosmetologiczne, fryzjerskie i podologiczne”.',
			'początek ochrony na polisie 10.11.2026, we wniosku 07.11.2026.'
		]
	);
});

test('odnowienie bez zmian: suma i składka z obecnego certyfikatu, ochrona od dnia po jego końcu', () => {
	const odnowienie: WniosekDoPorownania = {
		...nowa,
		id: 'w2',
		rodzaj: 'odnowienie',
		decyzja: 'bez_zmian',
		polisa_id: 'p-stara',
		suma: 200000,
		skladka: 790,
		skladka_nowa: null,
		okres_do: '2026-12-31',
		apk: { ...nowa.apk!, rodzaje: ['kosmetologiczny'], osoby: '1-5' },
		wniosek: { decyzja: 'bez_zmian', zmiany: null, nie_powod: '', potwierdzenie_nie: false }
	};
	const e = certyfikat({
		data_od: '2027-01-01',
		skladka: 790,
		suma_gwarancyjna: 200000,
		klient_adres: 'Inna 1, 00-001 Warszawa',
		ryzyka: [{ sekcja: 'UBEZPIECZONE RYZYKA', przedmiot: 'GABINETY KOSMETOLOGICZNE (M30 - 13)', suma: 200000, skladka: 790 }],
		dodatkowe: {}
	});
	const out = porownajZWnioskiem(e, odnowienie);
	assert.equal(out.length, 1);
	assert.equal(out[0].level, 'info');
	assert.match(bezNbsp(out[0].text), /^Polisa zgodna ze złożonym wnioskiem \(wniosek o odnowienie z 06\.11\.2026\): suma 200\.000 zł, składka 790,00 zł, bez ochrony prawnej, do 5 osób, zakres „Gabinety kosmetologiczne”, ochrona od 01\.01\.2027\.$/);
});

test('wybór wniosku: rezygnacja pomijana, wniosek z polisą wystawioną po złożeniu pomijany, wniosek do poprzedniej polisy ma pierwszeństwo', () => {
	const rezygnacja: WniosekDoPorownania = { ...nowa, id: 'w0', decyzja: 'nie', zlozono_at: '2026-11-07T10:00:00+00:00' };
	const doPoprzedniej: WniosekDoPorownania = { ...nowa, id: 'w3', rodzaj: 'odnowienie', decyzja: 'bez_zmian', polisa_id: 'p-stara', zlozono_at: '2026-10-01T10:00:00+00:00' };
	const polisy = [{ klient_id: 'k1', deleted_at: null, typ_umowy: 'jednostkowa' as const, created_at: '2026-11-06T21:27:30+00:00', renewal_of: null }];

	assert.equal(wniosekDoPolisy([rezygnacja, nowa], { klientId: 'k1', poprzedniaId: null, policies: [] })?.id, 'w1');
	assert.equal(wniosekDoPolisy([nowa], { klientId: 'k1', poprzedniaId: null, policies: polisy }), null);
	assert.equal(wniosekDoPolisy([nowa, doPoprzedniej], { klientId: 'k1', poprzedniaId: 'p-stara', policies: polisy })?.id, 'w3');
	assert.equal(wniosekDoPolisy([nowa], { klientId: 'k2', poprzedniaId: null, policies: [] }), null);
});
