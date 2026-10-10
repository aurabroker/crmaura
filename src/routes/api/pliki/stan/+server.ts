import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// Czy magazyn plików (Cloudflare R2) jest podpięty — ekran pokazuje wtedy dodawanie PDF.
export const GET: RequestHandler = async ({ request, platform }) => {
	await requireAuth(request);
	return json({ magazyn: !!platform?.env?.POLISY_PDF });
};
