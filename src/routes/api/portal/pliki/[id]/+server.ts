import { error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import { magazyn, naglowekPobrania } from '$lib/server/pliki';
import { klientPortalu, plikKlienta, zapiszPobranie } from '$lib/server/plikiPortalu';
import type { RequestHandler } from './$types';

// GET: PDF dokumentu polisy dla zalogowanego klienta (panel klienta pobiera go z tokenem i otwiera jako blob).
export const GET: RequestHandler = async ({ request, params, platform }) => {
	const kubelek = magazyn(platform);
	const naglowek = request.headers.get('Authorization');
	if (!naglowek?.startsWith('Bearer ')) throw error(401, 'Brak autoryzacji');
	const admin = getAdminClient();
	const { data: { user } } = await admin.auth.getUser(naglowek.slice(7));
	if (!user) throw error(401, 'Nieprawidłowy token');
	const klient = await klientPortalu(admin, user);
	const plik = await plikKlienta(admin, klient, params.id);
	const obiekt = await kubelek.get(plik.klucz);
	if (!obiekt) throw error(410, 'Dokument jest chwilowo niedostępny — skontaktuj się z doradcą.');
	await zapiszPobranie(admin, klient, user, plik);
	return new Response(obiekt.body, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Length': String(obiekt.size),
			'Content-Disposition': naglowekPobrania(plik.nazwa, true),
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
