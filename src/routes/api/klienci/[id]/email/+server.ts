import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { wyslijEmailKlienta, type ZadanieEmaila } from '$lib/server/emailKlienta';
import type { RequestHandler } from './$types';

// POST { do: string[], temat, tresc, polisa_ids?: string[], zalaczniki?: string[] } — e-mail z Panelu 360°.
export const POST: RequestHandler = async ({ request, params, platform }) => {
	const { profile, admin } = await requireAuth(request);
	const body = ((await request.json().catch(() => null)) ?? {}) as ZadanieEmaila;
	const wynik = await wyslijEmailKlienta(admin, platform?.env?.POLISY_PDF ?? null, profile, params.id, body);
	return json({ ok: true, ...wynik });
};
