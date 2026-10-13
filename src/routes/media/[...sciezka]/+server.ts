// Publiczne pliki z maili (BeautyPolisa): /media/beautypolisa/<nazwa>. Tylko pliki z listy PLIKI_PUBLICZNE,
// treść z kubełka R2 (patrz $lib/server/plikiPubliczne). Bez logowania — linki trafiają do klientów.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { plikPubliczny } from '$lib/server/plikiPubliczne';

export const GET: RequestHandler = async ({ params, platform }) => {
	const kubelek = platform?.env?.POLISY_PDF;
	if (!kubelek) throw error(503, 'Magazyn plików nie jest skonfigurowany.');
	const plik = await plikPubliczny(kubelek, params.sciezka);
	// Brak pliku nie może zostać w pamięci przeglądarki ani Cloudflare — po wgraniu dokumentu link ma działać od razu.
	if (!plik) return new Response('Nie ma takiego pliku.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
	const pdf = plik.opis.typ === 'application/pdf';
	return new Response(plik.dane, {
		headers: {
			'content-type': plik.opis.typ,
			'content-length': String(plik.dane.byteLength),
			// Dokument można podmienić pod tym samym adresem (Ustawienia → Dokumenty) — krótka pamięć podręczna
			'cache-control': 'public, max-age=3600',
			'x-content-type-options': 'nosniff',
			...(pdf ? { 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(plik.opis.nazwa)}` } : {})
		}
	});
};
