import test from 'node:test';
import assert from 'node:assert/strict';
import { czySpam, losoweSlowo, nipZLiterami, powodSpamu, telefonSpozaPolski } from './spamZgloszen.ts';

test('boty z formularza: losowe ciągi liter zamiast nazwy i kontaktu', () => {
	assert.equal(
		powodSpamu({ firma: 'wuYtvHnFxWnjZhpV', kontakt: 'zkNXIrKUgznyPDha VkeNRWYcYgnYhPCUIF', nip: 'hvNoEevJqx', telefon: '+5372266769' }),
		'losowa nazwa i kontakt, litery w NIP, telefon spoza Polski'
	);
	// Wpis z lipca: sama nazwa losowa, NIP z liter, bez telefonu.
	assert.equal(czySpam({ firma: 'WTOnwDyUmOEPZWvxmYH', kontakt: null, nip: 'sFZClqNQiKPtzHLWI', telefon: null }), true);
});

test('prawdziwe firmy z wielkimi literami w środku nazwy zostają', () => {
	for (const firma of ['KAROline Mobilne Usługi Kosmetyczne Karolina Przybyła', 'KamLanTech Sylwia Gajos', 'NovaSkinGlow', 'ChrypINK Rafał Wójcik', 'BeautyPolisa', 'McDonaldsKFC']) {
		assert.equal(czySpam({ firma, kontakt: 'Anna Nowak', nip: '7322017553', telefon: '+48695743548' }), false, firma);
	}
	// Losowa nazwa bez drugiego sygnału (polski telefon, NIP z cyfr) — nie odrzucamy.
	assert.equal(czySpam({ firma: 'wuYtvHnFxWnjZhpV', kontakt: 'Anna Nowak', nip: '7322017553', telefon: '600 111 222' }), false);
	// Zagraniczny telefon sam w sobie to nie spam.
	assert.equal(czySpam({ firma: 'Studio Urody', kontakt: 'Anna Nowak', nip: null, telefon: '+49 151 1234567' }), false);
});

test('sygnały pomocnicze', () => {
	assert.equal(losoweSlowo('hvNoEevJqx'), true);
	assert.equal(losoweSlowo('KamLanTech'), false);
	assert.equal(losoweSlowo('ŻółtyKotekMały'), false);
	assert.equal(losoweSlowo('ABCDEFGHIJ'), false);
	assert.equal(nipZLiterami('PL 732-201-75-53'), false);
	assert.equal(nipZLiterami('hvNoEevJqx'), true);
	assert.equal(telefonSpozaPolski('+48 607 438 263'), false);
	assert.equal(telefonSpozaPolski('607438263'), false);
	assert.equal(telefonSpozaPolski('0048607438263'), false);
	assert.equal(telefonSpozaPolski('+5372266769'), true);
	assert.equal(telefonSpozaPolski(''), false);
});
