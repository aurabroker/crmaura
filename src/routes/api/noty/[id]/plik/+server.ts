import { error, json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { magazyn, naglowekPobrania } from '$lib/server/pliki';
import { MAKS_PLIK_NOTY, pobierzPlikNoty, zapiszPlikNoty } from '$lib/server/plikiNot';
import type { RequestHandler } from './$types';

// POST multipart/form-data: plik (XLSX, XLS, CSV, PDF) noty prowizyjnej — do Cloudflare R2, opis w crm_noty.
export const POST: RequestHandler = async ({ request, params, platform }) => {
	const kubelek = magazyn(platform);
	const { profile, admin } = await requireAuth(request);
	if (Number(request.headers.get('content-length') ?? 0) > MAKS_PLIK_NOTY + 64 * 1024) {
		throw error(413, `Plik jest za duży (limit ${MAKS_PLIK_NOTY / 1024 / 1024} MB).`);
	}
	const form = await request.formData().catch(() => null);
	const plik = form?.get('plik');
	if (!(plik instanceof File)) throw error(400, 'Brak pliku.');
	const zapisany = await zapiszPlikNoty(admin, kubelek, profile, params.id, { nazwa: plik.name, dane: new Uint8Array(await plik.arrayBuffer()) });
	return json(zapisany);
};

// GET: treść pliku (przeglądarka pobiera ją z nagłówkiem Authorization). PDF otwiera się w karcie, reszta pobiera.
export const GET: RequestHandler = async ({ request, params, platform }) => {
	const kubelek = magazyn(platform);
	const { profile, admin } = await requireAuth(request);
	const { nota, obiekt } = await pobierzPlikNoty(admin, kubelek, profile, params.id);
	const typ = nota.plik_typ ?? 'application/octet-stream';
	return new Response(obiekt.body, {
		headers: {
			'Content-Type': typ,
			'Content-Length': String(obiekt.size),
			'Content-Disposition': naglowekPobrania(nota.plik_nazwa ?? 'zestawienie', typ === 'application/pdf'),
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
