import { error, json } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import { tenantZKluczaAsystenta, wyslijWniosekAsystenta } from '$lib/server/wniosekAsystenta';
import type { RequestHandler } from './$types';

// Asystent AI (worker konsultacja-agent) prosi o wysłanie klientowi linku do wniosku online: pierwsza polisa
// albo odnowienie certyfikatu programu — rodzaj wybiera kartoteka. Nagłówek x-api-key = klucz „Asystent AI”
// z Ustawień → System. Treść: { "klient_id": "<uuid>" } (klient z sesji rozmowy, nie z modelu).
// Odpowiedź 200: { wynik, rodzaj?, wniosek_id?, wazny_do?, ochrona_do?, test? } — kontrakt w planie wdrożenia.
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
		return json(await wyslijWniosekAsystenta(admin, tenant, klientId, url.origin));
	} catch (e) {
		console.error('Wniosek asystenta AI:', (e as Error)?.message ?? e);
		throw error(500, 'Nie udało się wysłać wniosku');
	}
};
