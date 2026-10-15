import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import {
	czyTest,
	klientDoWniosku,
	linkDla,
	polisaProgramu,
	trybTestowy,
	ustawieniaFirmy,
	utworzNowyWniosek,
	utworzOdnowienie,
	zapiszZdarzenie,
	type RenewalRow
} from '$lib/server/renewals';
import { wyslijZaproszenie } from '$lib/server/renewalFlow';
import type { OdnowienieUtworzone } from '$lib/renewals/staffApi';
import type { RequestHandler } from './$types';

// Wniosek z panelu CRM: e-mail do klienta albo sam link (np. do wysłania SMS-em).
//  - { polisa_id }  odnowienie certyfikatu z programu OC beauty,
//  - { klient_id }  pierwsza polisa dla klienta bez certyfikatu (karta klienta, karta leada).
export const POST: RequestHandler = async ({ request, url }) => {
	const { user, profile, admin } = await requireAuth(request);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const tryb = body?.tryb === 'link' ? 'link' : body?.tryb === 'email' ? 'email' : null;
	if (!body || !tryb) throw error(400, { message: 'Nieprawidłowe dane.' });
	const polisaId = typeof body.polisa_id === 'string' ? body.polisa_id : '';
	const klientId = typeof body.klient_id === 'string' ? body.klient_id : '';
	if (!polisaId && !klientId) throw error(400, { message: 'Wskaż polisę (odnowienie) albo klienta (pierwsza polisa).' });

	// Karta CRM otwarta przy włączonym trybie testowym pokazuje „adres testowy”. Gdy tryb wyłączono w międzyczasie,
	// nie wysyłamy do klienta na podstawie nieaktualnego ekranu — pracownik odświeża stronę i widzi prawdziwy adres.
	if (body.oczekiwany_test === true && !trybTestowy(await ustawieniaFirmy(admin, profile.tenant_id))) {
		throw error(409, { message: 'Tryb testowy odnowień został wyłączony — odśwież stronę (F5). Wniosek pójdzie teraz do klienta.', tryb_zmieniony: true } as App.Error);
	}

	const bezEmaila = () => error(400, { message: 'Klient nie ma poprawnego adresu e-mail. Uzupełnij go na karcie klienta albo utwórz link.' });
	let r: RenewalRow;
	if (polisaId) {
		const polisa = await polisaProgramu(admin, profile.tenant_id, polisaId);
		if (tryb === 'email' && !polisa.klient.email) throw bezEmaila();
		r = await utworzOdnowienie(admin, polisa, { zastap: body.zastap === true, utworzyl: user.id });
	} else {
		const klient = await klientDoWniosku(admin, profile.tenant_id, klientId);
		if (tryb === 'email' && !klient.email) throw bezEmaila();
		r = await utworzNowyWniosek(admin, klient, { zastap: body.zastap === true, utworzyl: user.id });
	}
	const link = await linkDla(r.id, url.origin);

	if (tryb === 'email') {
		const w = await wyslijZaproszenie(admin, r, url.origin, { kto: user.id });
		if (!w.ok) {
			// Wniosek zostaje (link działa), ale e-mail nie wyszedł — pracownik może wysłać link sam.
			throw error(w.status === 400 ? 400 : 502, { message: `Wniosek utworzony, ale e-mail nie został wysłany: ${w.blad}` });
		}
		const odp: OdnowienieUtworzone = { id: r.id, link, status: 'wyslany', wyslano: true, adres: w.adres, test: w.test };
		return json(odp);
	}
	// Wniosek utworzony w trybie testowym ma zapisany adres testowy.
	const odp: OdnowienieUtworzone = { id: r.id, link, status: 'utworzony', wyslano: false, test: czyTest(null, r) };
	return json(odp);
};

// Anulowanie: link przestaje działać, wniosek zostaje w historii.
export const DELETE: RequestHandler = async ({ request }) => {
	const { user, profile, admin } = await requireAuth(request);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const id = String(body?.id ?? '');
	const { data } = await admin
		.from('crm_renewals')
		.update({ status: 'anulowany', updated_at: new Date().toISOString() })
		.eq('id', id)
		.eq('tenant_id', profile.tenant_id)
		.in('status', ['utworzony', 'wyslany', 'otwarty', 'apk', 'zlozony'])
		.select('id, tenant_id')
		.maybeSingle();
	if (!data) throw error(404, { message: 'Nie znaleziono aktywnego wniosku.' });
	await zapiszZdarzenie(admin, data, 'anulowanie', null, { przez: user.id });
	return json({ ok: true });
};
