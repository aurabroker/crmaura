import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTenantPatch } from './tenants.ts';

const ID = '9dabd3a0-f1ee-43bc-92a1-6137ac814100';
const odrzuca = (body: unknown) => assert.throws(() => parseTenantPatch(body), (e: { status?: number }) => e?.status === 400);

test('SMSAPI: token i pole nadawcy', () => {
	const token = 'AbCdEf0123456789AbCdEf0123456789AbCdEf01';
	assert.deepEqual(parseTenantPatch({ tenant_id: ID, smsapi_token: `  ${token} ` }).patch, { smsapi_token: token });
	assert.deepEqual(parseTenantPatch({ tenant_id: ID, smsapi_token: null }).patch, { smsapi_token: null });
	assert.deepEqual(parseTenantPatch({ tenant_id: ID, sms_nadawca: 'AuraExpert' }).patch, { sms_nadawca: 'AuraExpert' });
	assert.deepEqual(parseTenantPatch({ tenant_id: ID, sms_nadawca: '' }).patch, { sms_nadawca: null });
	odrzuca({ tenant_id: ID, smsapi_token: 'za krótki' });
	odrzuca({ tenant_id: ID, smsapi_token: 'token ze spacjami w środku 1234567890' });
	odrzuca({ tenant_id: ID, sms_nadawca: 'Za długi nadawca' });
	odrzuca({ tenant_id: ID, sms_nadawca: 'Zażółć' });
});

test('Nazwa nadawcy i podpis w mailach do klientów', () => {
	assert.deepEqual(parseTenantPatch({ tenant_id: ID, email_nazwa_nadawcy: ' Beauty❤️Polisa / Płatności ', email_podpis: 'Zespół Beauty❤️Polisa' }).patch, {
		email_nazwa_nadawcy: 'Beauty❤️Polisa / Płatności',
		email_podpis: 'Zespół Beauty❤️Polisa'
	});
	assert.deepEqual(parseTenantPatch({ tenant_id: ID, email_nazwa_nadawcy: '', email_podpis: null }).patch, { email_nazwa_nadawcy: null, email_podpis: null });
	odrzuca({ tenant_id: ID, email_nazwa_nadawcy: 'Aura "Expert"' });
	odrzuca({ tenant_id: ID, email_nazwa_nadawcy: 'Aura <x@y.pl>' });
	odrzuca({ tenant_id: ID, email_podpis: 'Linia 1\nLinia 2' });
	odrzuca({ tenant_id: ID, email_nazwa_nadawcy: 'x'.repeat(81) });
});

test('Adres CRM w linkach dla klientów', () => {
	assert.deepEqual(parseTenantPatch({ tenant_id: ID, adres_crm: 'crm2.auraconsulting.pl/' }).patch, { adres_crm: 'https://crm2.auraconsulting.pl' });
	assert.deepEqual(parseTenantPatch({ tenant_id: ID, adres_crm: '' }).patch, { adres_crm: null });
	odrzuca({ tenant_id: ID, adres_crm: 'http://crm2.auraconsulting.pl' });
	odrzuca({ tenant_id: ID, adres_crm: 'localhost' });
});
