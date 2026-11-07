import test from 'node:test';
import assert from 'node:assert/strict';
import { KOD_RE, hrefSms, liczbaSms, losowyKod, numerSms, trescSms } from './sms.ts';

test('kod krótkiego linku: 10 znaków z alfabetu bez mylących znaków', () => {
	const kody = new Set(Array.from({ length: 2000 }, losowyKod));
	assert.equal(kody.size, 2000);
	for (const k of kody) assert.match(k, KOD_RE);
	assert.equal([...kody].join('').match(/[0O1lI]/), null);
	assert.equal(KOD_RE.test('abcDEF2345'), true);
	assert.equal(KOD_RE.test('abcDEF234O'), false);
	assert.equal(KOD_RE.test('abc'), false);
});

test('numer do SMS-a', () => {
	assert.equal(numerSms('600 111 222'), '+48600111222');
	assert.equal(numerSms('+48 600-111-222'), '+48600111222');
	assert.equal(numerSms('48600111222'), '+48600111222');
	assert.equal(numerSms('0048 600 111 222'), '+48600111222');
	assert.equal(numerSms('+44 7700 900123'), '+447700900123');
	assert.equal(numerSms('22 123'), null);
	assert.equal(numerSms(null), null);
});

test('treść SMS-a mieści się w jednym SMS-ie i nie ma polskich znaków', () => {
	const link = 'https://portal.beautypolisa.eu/w/AbCdEf2345';
	for (const nowa of [true, false]) {
		const t = trescSms(link, { nowa, waznyDo: '2026-12-07T22:59:59Z' });
		assert.ok(t.includes(link));
		assert.ok(t.includes('wazny do 07.12.2026'));
		assert.equal(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(t), false);
		assert.equal(liczbaSms(t), 1, `${t.length} znaków`);
	}
	assert.equal(liczbaSms('zażółć'), 1);
	assert.equal(liczbaSms('ą'.repeat(71)), 2);
	assert.equal(liczbaSms('a'.repeat(161)), 2);
});

test('link do aplikacji SMS', () => {
	assert.equal(hrefSms('+48600111222', 'a b&c'), 'sms:+48600111222?&body=a%20b%26c');
});
