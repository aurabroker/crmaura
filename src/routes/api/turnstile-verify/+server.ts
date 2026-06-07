import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// TURNSTILE_SECRET_KEY must be set in .env (server-only, no VITE_ prefix)
const SECRET = process.env.TURNSTILE_SECRET_KEY ?? '';

export const POST: RequestHandler = async ({ request }) => {
	if (!SECRET) return json({ success: false, error: 'Turnstile not configured' }, { status: 500 });

	const { token } = await request.json();
	if (!token) return json({ success: false, error: 'Missing token' }, { status: 400 });

	const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ secret: SECRET, response: token })
	});
	const data = await res.json();
	return json({ success: data.success });
};
