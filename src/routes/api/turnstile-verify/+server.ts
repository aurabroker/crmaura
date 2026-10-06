import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// TURNSTILE_SECRET_KEY: zmienna serwerowa (bez przedrostka VITE_). Czytana przy każdym żądaniu
// przez $env/dynamic/private — na Cloudflare Workers zmienne środowiskowe nie istnieją w momencie
// ładowania modułu, a process.env bywa tam puste, więc odczyt na poziomie modułu nie działa.
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.TURNSTILE_SECRET_KEY;
	if (!secret) return json({ success: false, error: 'Turnstile not configured' }, { status: 500 });

	const body = await request.json().catch(() => null);
	const token = body && typeof body === 'object' ? (body as { token?: unknown }).token : undefined;
	if (typeof token !== 'string' || !token) return json({ success: false, error: 'Missing token' }, { status: 400 });

	try {
		const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, response: token })
		});
		const data = await res.json();
		return json({ success: data.success === true });
	} catch (e) {
		console.error('turnstile-verify: błąd połączenia z Cloudflare', e);
		return json({ success: false, error: 'Verification unavailable' }, { status: 502 });
	}
};
