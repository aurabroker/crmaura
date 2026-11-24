import test from 'node:test';
import assert from 'node:assert/strict';
import { PORTAL_BEAUTY, adresLinkow, normalizujAdresCrm } from './adresCrm.ts';

test('adres CRM z panelu: sama domena z https, bez ukośnika i ścieżki', () => {
	assert.equal(normalizujAdresCrm('crm2.auraconsulting.pl'), 'https://crm2.auraconsulting.pl');
	assert.equal(normalizujAdresCrm(' https://CRM2.AuraConsulting.pl/ '), 'https://crm2.auraconsulting.pl');
	assert.equal(normalizujAdresCrm('https://crm2.auraconsulting.pl/login'), 'https://crm2.auraconsulting.pl');
	assert.equal(normalizujAdresCrm(''), null);
	assert.equal(normalizujAdresCrm(null), null);
	assert.throws(() => normalizujAdresCrm('http://crm2.auraconsulting.pl'), /https/);
	assert.throws(() => normalizujAdresCrm('https://crm2.auraconsulting.pl:8443'), /portu/);
	assert.throws(() => normalizujAdresCrm('localhost'), /Nieprawidłowy/);
	assert.throws(() => normalizujAdresCrm('https://10.0.0.1'), /Nieprawidłowy/);
	assert.throws(() => normalizujAdresCrm('crm2 aura'), /Nieprawidłowy/);
});

test('baza linków: adres firmy przed adresem żądania', () => {
	assert.equal(adresLinkow('https://crm2.auraconsulting.pl', new URL('https://portal.beautypolisa.eu/api/renewals')), 'https://crm2.auraconsulting.pl');
	assert.equal(adresLinkow(null, new URL('https://crmaura.pages.dev/api/cron/renewals')), PORTAL_BEAUTY);
	assert.equal(adresLinkow('', new URL('https://crm2.auraconsulting.pl/api/sms')), 'https://crm2.auraconsulting.pl');
	assert.equal(adresLinkow(undefined, new URL('https://portal.beautypolisa.eu/api/sms')), 'https://portal.beautypolisa.eu');
});
