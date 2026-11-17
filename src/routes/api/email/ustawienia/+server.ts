import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { nazwaNadawcy, ustawieniaWysylki } from '$lib/server/emailKlienta';
import type { RequestHandler } from './$types';

// Czy firma może wysyłać e-maile z CRM, z jakiego adresu i z jakim podpisem (bez klucza — ten zostaje na serwerze).
export const GET: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAuth(request);
	const u = await ustawieniaWysylki(admin, profile.tenant_id);
	const odpowiedzi = profile.email && !/\.invalid$/i.test(profile.email) ? profile.email : null;
	return json({ gotowe: u.gotowe, nadawca: u.adres ? `${nazwaNadawcy(profile.imie_nazwisko, u.firma, u.nazwaNadawcy)} <${u.adres}>` : null, odpowiedzi, podpis: u.podpis });
};
