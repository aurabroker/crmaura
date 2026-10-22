import { error, json } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import { linkWnioskuAsystenta, tenantZKluczaAsystenta } from '$lib/server/wniosekAsystenta';
import { originLinkow } from '$lib/renewals/wniosekAsystenta';
import type { RequestHandler } from './$types';

// Link do wniosku online dla przycisku „Wypełnij wniosek online” w mailu HUB: worker konsultacja-agent
// (strona /w/<token>) po kliknięciu klienta pyta o link i przekierowuje do formularza. AuraCRM nie wysyła maila:
// tworzy wniosek (pierwsza polisa albo odnowienie — te same reguły co asystent AI) albo zwraca istniejący.
// Nagłówek x-api-key = klucz „Asystent AI”. Treść: { "klient_id": "<uuid>" } (klient z tokenu maila, po stronie workera).
// Odpowiedź 200: { wynik: link|zlozony|za_wczesnie|do_agenta|brak_adresu|klient_nieaktywny|brak_klienta, rodzaj?, link?, … }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async ({ request, url }) => {
	const klucz = request.headers.get('x-api-key')?.trim();
	if (!klucz) throw error(401, 'Brak klucza integracji (nagłówek x-api-key)');
	const admin = getAdminClient();
	const tenant = await tenantZKluczaAsystenta(admin, klucz);
	if (!tenant) throw error(401, 'Nieprawidłowy klucz integracji');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Treść nie jest poprawnym JSON');
	}
	const klientId = (body as { klient_id?: unknown } | null)?.klient_id;
	if (typeof klientId !== 'string' || !UUID.test(klientId)) throw error(400, 'Nieprawidłowy klient_id');

	try {
		return json(await linkWnioskuAsystenta(admin, tenant, klientId, originLinkow(url)));
	} catch (e) {
		console.error('Link do wniosku z maila:', (e as Error)?.message ?? e);
		throw error(500, 'Nie udało się przygotować wniosku');
	}
};
