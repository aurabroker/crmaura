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
