import { error, json } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import { klientPortalu, plikiKlienta } from '$lib/server/plikiPortalu';
import type { RequestHandler } from './$types';

// GET: dokumenty polis zalogowanego klienta (panel klienta). Bez podpiętego magazynu — pusta lista.
export const GET: RequestHandler = async ({ request, platform }) => {
	const naglowek = request.headers.get('Authorization');
	if (!naglowek?.startsWith('Bearer ')) throw error(401, 'Brak autoryzacji');
	const admin = getAdminClient();
	const { data: { user } } = await admin.auth.getUser(naglowek.slice(7));
	if (!user) throw error(401, 'Nieprawidłowy token');
	const klient = await klientPortalu(admin, user);
	if (!platform?.env?.POLISY_PDF) return json({ magazyn: false, pliki: [] });
	return json({ magazyn: true, pliki: await plikiKlienta(admin, klient) });
};
