import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { kontekstMailaPolisy, mailPolisy, type ZadanieMailaPolisy } from '$lib/server/mailPolisy';
import type { RequestHandler } from './$types';

// GET: dane do okna „Wyślij polisę klientowi” (adresaci, PDF polisy, powitanie, termin płatności, wcześniejsze wysyłki).
export const GET: RequestHandler = async ({ request, params }) => {
	const { profile, admin } = await requireAuth(request);
	return json(await kontekstMailaPolisy(admin, profile, params.id));
};

// POST { do: string[], powitanie, termin_platnosci: 'RRRR-MM-DD', pliki: string[], podglad?: true }
// — podgląd (treść z szablonu Resend z danymi polisy) albo wysyłka z PDF polisy w załączniku.
export const POST: RequestHandler = async ({ request, params, platform }) => {
	const { profile, admin } = await requireAuth(request);
	const body = ((await request.json().catch(() => null)) ?? {}) as ZadanieMailaPolisy;
	return json(await mailPolisy(admin, platform?.env?.POLISY_PDF ?? null, profile, params.id, body));
};
