import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAdmin } from '$lib/server/auth';
import { szukajWGus, zalogujGus } from '$lib/server/gus';
import { stanUzupelniania, uzupelnijPaczke } from '$lib/server/gusUzupelnij';
import type { RequestHandler } from './$types';

// Zbiorowe uzupełnianie klientów z GUS (tylko administrator firmy).
// GET — ilu klientów czeka i jakie były dotychczasowe wyniki; POST — kolejna paczka.
export const GET: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAdmin(request);
	return json({ klucz: !!env.GUS_API_KEY, ...(await stanUzupelniania(admin, profile.tenant_id)) });
};

export const POST: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAdmin(request);
	const klucz = env.GUS_API_KEY;
	if (!klucz) throw error(503, 'Brak klucza GUS na serwerze (GUS_API_KEY).');
	let sid: string | null;
	try {
		sid = await zalogujGus(klucz);
	} catch (e) {
		throw error(502, `GUS nie odpowiada (${(e as Error).message}). Spróbuj za chwilę.`);
	}
	if (!sid) throw error(502, 'GUS odrzucił logowanie — sprawdź klucz GUS_API_KEY.');
	return json(await uzupelnijPaczke(admin, profile, szukajWGus(sid)));
};
