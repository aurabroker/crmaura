import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { czyTest, krotkiLinkDla, linkDla, originKlienta, smsFirmy, zapiszZdarzenie, type RenewalRow } from '$lib/server/renewals';
import { wyslijSms } from '$lib/server/sms';
import { numerSms, trescSms } from '$lib/renewals/sms';
import type { SmsWyslany } from '$lib/renewals/staffApi';
import type { RequestHandler } from './$types';

// SMS do klienta z krótkim linkiem do aktywnego wniosku (APK i wniosek o pierwszą polisę albo o odnowienie),
// wysyłany przez SMSAPI firmy na prośbę pracownika. Treść składa serwer (ta sama co w podglądzie na karcie),
// więc przez ten adres nie da się wysłać dowolnego tekstu. Każda wysyłka trafia do dziennika wniosku.
const ODSTEP_MS = 60_000;

export const POST: RequestHandler = async ({ request, url }) => {
	const { user, profile, admin } = await requireAuth(request);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const numer = numerSms(typeof body?.numer === 'string' ? body.numer : '');
	if (!numer) throw error(400, { message: 'Podaj poprawny numer telefonu (np. 600 111 222).' });

	const { data } = await admin
		.from('crm_renewals')
		.select('*')
		.eq('id', String(body?.renewal_id ?? ''))
		.eq('tenant_id', profile.tenant_id)
		.maybeSingle();
	const r = data as RenewalRow | null;
	if (!r || !['utworzony', 'wyslany', 'otwarty', 'apk'].includes(r.status) || Date.parse(r.wazny_do) < Date.now()) {
		throw error(404, { message: 'Ten wniosek nie jest już aktywny — utwórz nowy link.' });
	}

	const firma = await smsFirmy(admin, profile.tenant_id);
	if (!firma.token) throw error(400, { message: 'Firma nie ma tokenu SMSAPI — dodaj go w SAAS Admin albo wyślij SMS z telefonu.' });
	if (czyTest({ features: firma.features }, r)) {
		throw error(409, { message: 'Tryb testowy odnowień: SMS do klienta nie wychodzi. Wyłącz tryb testowy albo wyślij SMS z telefonu.' });
	}

	// Podwójne kliknięcie (albo dwie karty) nie wyśle dwóch SMS-ów pod rząd.
	const { data: ostatnie } = await admin
		.from('crm_renewal_events')
		.select('id')
		.eq('renewal_id', r.id)
		.eq('zdarzenie', 'sms')
		.gt('at', new Date(Date.now() - ODSTEP_MS).toISOString())
		.limit(1);
	if (ostatnie?.length) throw error(429, { message: 'SMS do tego wniosku wysłano przed chwilą — odczekaj minutę.' });

	const origin = originKlienta(url);
	const link = (await krotkiLinkDla(admin, r, origin)) ?? (await linkDla(r.id, origin));
	const tresc = trescSms(link, { nowa: r.rodzaj === 'nowa', waznyDo: r.wazny_do });
	const w = await wyslijSms(firma.token, { numer, tresc, nadawca: firma.nadawca });
	if (!w.ok) {
		await zapiszZdarzenie(admin, r, 'blad_sms', null, { numer, przez: user.id, status: w.status, blad: w.blad });
		throw error(w.status === 401 || w.status === 402 ? 400 : 502, { message: w.blad });
	}
	await zapiszZdarzenie(admin, r, 'sms', null, { numer, przez: user.id, id: w.id, punkty: w.punkty });
	const odp: SmsWyslany = { ok: true, numer };
	return json(odp);
};
