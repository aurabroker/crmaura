import { json } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import { doWyslaniaTeraz, wyslijPodsumowanie } from '$lib/server/podsumowanie';
import type { RequestHandler } from './$types';

// Zadanie godzinne (pg_cron → public.crm_run_podsumowania(), nagłówek x-cron-token z Vault): wysyła codzienne
// podsumowania pracownikom, których godzina (czas Warszawy) właśnie wybiła i którzy dziś jeszcze go nie dostali.
const MAKS = 100;
const CRM = 'https://crmaura.pages.dev';

export const POST: RequestHandler = async ({ request, url }) => {
	const admin = getAdminClient();
	const token = request.headers.get('x-cron-token') ?? '';
	if (!token) return new Response('brak nagłówka x-cron-token', { status: 401 });
	const { data: zgoda, error: e } = await admin.rpc('edge_cron_token_matches', { token });
	if (e) return new Response('nie mogę sprawdzić tokenu', { status: 500 });
	if (zgoda !== true) return new Response('zły nagłówek x-cron-token', { status: 401 });

	const crm = url.hostname.endsWith('.pages.dev') ? CRM : url.origin;
	const wynik = { wyslane: 0, pominiete: 0, bledy: [] as string[] };
	const lista = (await doWyslaniaTeraz(admin)).slice(0, MAKS);
	for (const s of lista) {
		try {
			const w = await wyslijPodsumowanie(admin, s, { crm });
			if (!w.ok) wynik.bledy.push(`${s.id}: ${w.blad}`);
			else if (w.wyslano) wynik.wyslane++;
			else wynik.pominiete++;
		} catch (err) {
			wynik.bledy.push(`${s.id}: ${(err as Error).message}`);
		}
	}
	return json(wynik);
};
