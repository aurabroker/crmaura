import { error, json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { MAKS_PDF, magazyn, zapiszPlikPolisy } from '$lib/server/pliki';
import type { RequestHandler } from './$types';

// POST multipart/form-data: plik (PDF), rodzaj (polisa | aneks | owu | inne), zrodlo (import_pdf | recznie).
// Plik trafia do Cloudflare R2, opis do crm_policy_files — wszystko po sprawdzeniu firmy użytkownika.
export const POST: RequestHandler = async ({ request, params, platform }) => {
	const kubelek = magazyn(platform);
	const { profile, admin } = await requireAuth(request);
	const dlugosc = Number(request.headers.get('content-length') ?? 0);
	if (dlugosc > MAKS_PDF + 64 * 1024) throw error(413, `Plik jest za duży (limit ${MAKS_PDF / 1024 / 1024} MB).`);
	const form = await request.formData().catch(() => null);
	const plik = form?.get('plik');
	if (!(plik instanceof File)) throw error(400, 'Brak pliku.');
	const zapisany = await zapiszPlikPolisy(
		admin,
		kubelek,
		profile,
		params.id,
		{ nazwa: plik.name, dane: new Uint8Array(await plik.arrayBuffer()) },
		{ rodzaj: String(form?.get('rodzaj') ?? ''), zrodlo: String(form?.get('zrodlo') ?? '') }
	);
	return json({ plik: zapisany });
};
