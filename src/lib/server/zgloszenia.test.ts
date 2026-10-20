import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFIKS_KLUCZA, PREFIKS_KLUCZA_AI, czyKluczZgloszen, nowyKlucz, zakresZ } from './zgloszenia.ts';

test('nowy klucz bez zakresu to klucz arkusza zgłoszeń', () => assert.ok(nowyKlucz().startsWith(PREFIKS_KLUCZA)));
test('klucz asystenta AI ma własny prefiks', () => {
	const k = nowyKlucz('asystent_ai');
	assert.equal(PREFIKS_KLUCZA_AI, 'crmai_');
	assert.ok(k.startsWith('crmai_'));
	assert.ok(k.length > 40);
});
test('zakres z parametru: tylko asystent_ai jest rozpoznawany, reszta to zgłoszenia', () => {
	assert.equal(zakresZ('asystent_ai'), 'asystent_ai');
	assert.equal(zakresZ('zgloszenia'), 'zgloszenia');
	assert.equal(zakresZ(null), 'zgloszenia');
	assert.equal(zakresZ('admin'), 'zgloszenia');
});
test('endpoint zgłoszeń przyjmuje tylko klucz arkusza, nie klucz asystenta', () => {
	assert.equal(czyKluczZgloszen(nowyKlucz()), true);
	assert.equal(czyKluczZgloszen(`  ${nowyKlucz()} `), true);
	assert.equal(czyKluczZgloszen(nowyKlucz('asystent_ai')), false);
	assert.equal(czyKluczZgloszen(''), false);
});
