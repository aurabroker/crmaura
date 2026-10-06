import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import { createTenantWithAdmin } from '$lib/server/tenants';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// Weryfikacja Cloudflare Turnstile. Rejestracja jest publiczna i zakłada konto z automatycznym
// potwierdzeniem e-maila, więc BEZ skonfigurowanego sekretu odmawiamy (fail-closed) — wcześniej
// brak TURNSTILE_SECRET_KEY po cichu wyłączał ochronę przed botami.
// Lokalnie można użyć kluczy testowych Cloudflare (sekret 1x0000000000000000000000000000000AA).
async function verifyTurnstile(token: string | undefined): Promise<boolean> {
	const secret = env.TURNSTILE_SECRET_KEY;
	if (!secret) {
		console.error('TURNSTILE_SECRET_KEY nie jest ustawiony — rejestracja wyłączona');
		throw error(503, { message: 'Rejestracja jest chwilowo niedostępna.' });
	}
	if (!token) return false;
	const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ secret, response: token })
	});
	const data = await res.json().catch(() => ({ success: false }));
	return data.success === true;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, { message: 'Nieprawidłowe dane.' });

	const { turnstileToken, ...input } = body as Record<string, unknown> & { turnstileToken?: string };

	if (!(await verifyTurnstile(typeof turnstileToken === 'string' ? turnstileToken : undefined))) {
		throw error(400, { message: 'Weryfikacja antybotowa nie powiodła się. Odśwież stronę i spróbuj ponownie.' });
	}

	await createTenantWithAdmin(getAdminClient(), {
		nazwa_firmy: String(input.nazwa_firmy ?? ''),
		typ: String(input.typ ?? ''),
		email: String(input.email ?? ''),
		imie_nazwisko: String(input.imie_nazwisko ?? ''),
		password: String(input.password ?? '')
	});

	return json({ success: true });
};
