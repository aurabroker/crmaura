import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFIKS_KLUCZA, PREFIKS_KLUCZA_AI, czyKluczZgloszen, nowyKlucz, podzielSpam, przyjmijZgloszenia, zakresZ } from './zgloszenia.ts';

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

const BOT = { company: 'wuYtvHnFxWnjZhpV', contact: 'zkNXIrKUgznyPDha VkeNRWYcYgnYhPCUIF', email: 'bot@example.org', phone: '+5372266769', nip: 'hvNoEevJqx', ref: 'Zgloszenia_Polisa_FF_30!1857|hvNoEevJqx|bot@example.org' };
const KLIENT = { company: 'KamLanTech Sylwia Gajos', contact: 'Sylwia Gajos', email: 'klient@example.com', phone: '+48695743548', nip: '7322017553', ref: 'Zgloszenia_Polisa_FF_30!245|7322017553|k' };

test('spam z formularza odpada przed bazą, prawdziwe zgłoszenie przechodzi', () => {
	const { dobre, spam } = podzielSpam([BOT, KLIENT]);
	assert.deepEqual(dobre, [KLIENT]);
	assert.equal(spam.length, 1);
	assert.equal(spam[0].ref, BOT.ref);
});

test('przyjęcie: do bazy idą tylko dobre wiersze, spam w wynikach jako pominięty', async () => {
	let wyslane: unknown = null;
	const admin = {
		rpc: async (_f: string, args: { p_wiersze: unknown[] }) => {
			wyslane = args.p_wiersze;
			return { data: { nowe: args.p_wiersze.length, ponowne: 0, historyczne: 0, duplikaty: 0, pominiete: 0, wyniki: [{ ref: KLIENT.ref, status: 'nowe' }] }, error: null };
		}
	};
	const w = await przyjmijZgloszenia(admin as never, nowyKlucz(), [BOT, KLIENT]);
	assert.deepEqual(wyslane, [KLIENT]);
	assert.equal(w.nowe, 1);
	assert.equal(w.pominiete, 1);
	assert.deepEqual(w.wyniki.map((x) => x.status), ['nowe', 'spam']);
});
