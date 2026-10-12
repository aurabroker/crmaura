import type { Handle } from '@sveltejs/kit';

// Domena plików z maili (np. pliki.auraexpert.pl) podaje wyłącznie /media/* — nie CRM ani jego API.
const DOMENY_PLIKOW = new Set(['pliki.auraexpert.pl']);

// Strona aplikacji (HTML) nie może zostać w pamięci przeglądarki: po wdrożeniu stara kopia wskazuje
// pliki /_app/immutable/*, których już nie ma, i aplikacja się nie uruchamia.
export const handle: Handle = async ({ event, resolve }) => {
	if (DOMENY_PLIKOW.has(event.url.hostname) && !event.url.pathname.startsWith('/media/')) {
		return new Response('Nie ma takiego pliku.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
	}
	const res = await resolve(event);
	if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
	try {
		res.headers.set('cache-control', 'no-store');
		return res;
	} catch {
		// Odpowiedź z niezmiennymi nagłówkami — kopia z nowym nagłówkiem.
		const headers = new Headers(res.headers);
		headers.set('cache-control', 'no-store');
		return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
	}
};
