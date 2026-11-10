// Publiczne pliki z maili (BeautyPolisa): /media/beautypolisa/<nazwa>. Tylko pliki z listy PLIKI_PUBLICZNE,
// treść z kubełka R2 (patrz $lib/server/plikiPubliczne). Bez logowania — linki trafiają do klientów.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GENEROWANA_ANKIETA, plikPubliczny } from '$lib/server/plikiPubliczne';
import { pdfAnkietaPusta } from '$lib/server/renewalDocs';

export const GET: RequestHandler = async ({ params, platform, url }) => {
	const kubelek = platform?.env?.POLISY_PDF;
	if (!kubelek) throw error(503, 'Magazyn plików nie jest skonfigurowany.');
	// Źródło „/dokumenty/…” to zasób statyczny aplikacji (binding ASSETS, jak czcionki w $lib/server/pdf).
	const plik = await plikPubliczny(kubelek, params.sciezka, async (zrodlo) => {
		// Czysty formularz ankiety powstaje tutaj — raz na wersję listy zabiegów, potem leży w kubełku.
		if (zrodlo.startsWith(GENEROWANA_ANKIETA)) return new Response(new Blob([(await pdfAnkietaPusta({ url, platform })) as BlobPart]));
		if (!zrodlo.startsWith('/')) return fetch(zrodlo, { redirect: 'follow' });
		const adres = new URL(zrodlo, url.origin);
		const assets = platform?.env?.ASSETS;
		return assets ? assets.fetch(new Request(adres)) : fetch(adres);
	});
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
