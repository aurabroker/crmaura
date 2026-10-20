import test from 'node:test';
import assert from 'node:assert/strict';
import { decyzjaWniosku, sciezkaWniosku, type CertyfikatKlienta, type IstniejacyWniosek } from './wniosekAsystenta.ts';

// ---------- Decyzja dla istniejącego wniosku ----------
const teraz = Date.parse('2026-10-20T12:00:00Z');
const h = (n: number) => new Date(teraz + n * 3_600_000).toISOString();
const o = { teraz, trybTestowy: false };
const w = (x: Partial<IstniejacyWniosek> = {}): IstniejacyWniosek => ({
	status: 'wyslany',
	wyslano_at: h(-48),
	przypomniano_at: null,
	wazny_do: h(24 * 20),
	testowy: false,
	...x
});

test('brak wniosku → nowy', () => assert.equal(decyzjaWniosku(null, o), 'nowy'));
test('złożony → zlozony', () => assert.equal(decyzjaWniosku(w({ status: 'zlozony' }), o), 'zlozony'));
test('testowy przy wyłączonym trybie → zastap', () => assert.equal(decyzjaWniosku(w({ testowy: true }), o), 'zastap'));
test('testowy przy włączonym trybie, wysłany 2 h temu → juz_wyslany', () =>
	assert.equal(decyzjaWniosku(w({ testowy: true, wyslano_at: h(-2) }), { ...o, trybTestowy: true }), 'juz_wyslany'));
test('po terminie ważności → zastap', () => assert.equal(decyzjaWniosku(w({ wazny_do: h(-1) }), o), 'zastap'));
test('utworzony bez wysyłki → wyslij', () => assert.equal(decyzjaWniosku(w({ status: 'utworzony', wyslano_at: null }), o), 'wyslij'));
test('wysłany 23 h temu → juz_wyslany', () => assert.equal(decyzjaWniosku(w({ wyslano_at: h(-23) }), o), 'juz_wyslany'));
test('wysłany 25 h temu → przypomnij', () => assert.equal(decyzjaWniosku(w({ wyslano_at: h(-25) }), o), 'przypomnij'));
test('przypomnienie 1 h temu po wysyłce sprzed 3 dni → juz_wyslany', () =>
	assert.equal(decyzjaWniosku(w({ wyslano_at: h(-72), przypomniano_at: h(-1) }), o), 'juz_wyslany'));
test('APK w trakcie, wysłany 2 dni temu → przypomnij', () => assert.equal(decyzjaWniosku(w({ status: 'apk', wyslano_at: h(-48) }), o), 'przypomnij'));

// ---------- Ścieżka: pierwsza polisa albo odnowienie ----------
const p = { dzis: '2026-10-20', dniPrzedKoncem: 45 };
const c = (x: Partial<CertyfikatKlienta> = {}): CertyfikatKlienta => ({
	id: 'c1',
	data_do: '2026-11-30',
	zakonczona: false,
	odnowiona: false,
	byl_wniosek: false,
	...x
});

test('bez certyfikatu → nowa', () => assert.deepEqual(sciezkaWniosku([], p), { rodzaj: 'nowa' }));
test('koniec za 41 dni → odnowienie', () => assert.equal(sciezkaWniosku([c()], p).rodzaj, 'odnowienie'));
test('koniec dokładnie za 45 dni → odnowienie', () => assert.equal(sciezkaWniosku([c({ data_do: '2026-12-04' })], p).rodzaj, 'odnowienie'));
test('koniec za pół roku → za_wczesnie z datą', () =>
	assert.deepEqual(sciezkaWniosku([c({ data_do: '2027-04-30' })], p), { rodzaj: 'za_wczesnie', polisa_id: 'c1', ochrona_do: '2027-04-30' }));
test('ochrona skończona wczoraj → do_agenta', () => assert.equal(sciezkaWniosku([c({ data_do: '2026-10-19' })], p).rodzaj, 'do_agenta'));
test('polisa zakończona decyzją → do_agenta', () => assert.equal(sciezkaWniosku([c({ zakonczona: true })], p).rodzaj, 'do_agenta'));
test('był wniosek anulowany albo wygasły → do_agenta', () => assert.equal(sciezkaWniosku([c({ byl_wniosek: true })], p).rodzaj, 'do_agenta'));
test('stary certyfikat odnowiony w CRM, bierze nowy', () =>
	assert.deepEqual(sciezkaWniosku([c({ id: 'stary', data_do: '2025-11-30', odnowiona: true }), c({ id: 'nowy' })], p), {
		rodzaj: 'odnowienie',
		polisa_id: 'nowy',
		ochrona_do: '2026-11-30'
	}));
test('jedyny certyfikat już odnowiony w CRM → do_agenta', () => assert.equal(sciezkaWniosku([c({ odnowiona: true })], p).rodzaj, 'do_agenta'));
