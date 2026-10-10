import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { magazyn, naglowekPobrania, pobierzPlik, usunPlik } from '$lib/server/pliki';
import type { RequestHandler } from './$types';

// GET: treść PDF (przeglądarka pobiera ją z nagłówkiem Authorization i otwiera jako blob).
export const GET: RequestHandler = async ({ request, params, platform, url }) => {
	const kubelek = magazyn(platform);
	const { profile, admin } = await requireAuth(request);
	const { plik, obiekt } = await pobierzPlik(admin, kubelek, profile, params.id);
	return new Response(obiekt.body, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Length': String(obiekt.size),
			'Content-Disposition': naglowekPobrania(plik.nazwa, url.searchParams.get('pobierz') !== '1'),
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};

export const DELETE: RequestHandler = async ({ request, params, platform }) => {
	const kubelek = magazyn(platform);
	const { profile, admin } = await requireAuth(request);
	const plik = await usunPlik(admin, kubelek, profile, params.id);
	return json({ usuniety: plik.id });
};
