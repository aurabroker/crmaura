import type { Handle } from '@sveltejs/kit';

// Strona aplikacji (HTML) nie może zostać w pamięci przeglądarki: po wdrożeniu stara kopia wskazuje
// pliki /_app/immutable/*, których już nie ma, i aplikacja się nie uruchamia.
export const handle: Handle = async ({ event, resolve }) => {
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
