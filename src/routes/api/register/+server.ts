import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// Weryfikacja Cloudflare Turnstile. Gdy sekret nie jest skonfigurowany — pomijamy
// (środowiska bez Turnstile działają jak dotąd). Gdy jest — wymagamy ważnego tokenu.
async function verifyTurnstile(token: string | undefined): Promise<boolean> {
	const secret = env.TURNSTILE_SECRET_KEY;
	if (!secret) return true;
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
	const body = await request.json();
	const { nazwa_firmy, typ, email, imie_nazwisko, password, turnstileToken } = body;
	const tenantTyp = typ === 'agent' ? 'agent' : 'broker';

	if (!nazwa_firmy || !email || !imie_nazwisko || !password) {
		throw error(400, { message: 'Wszystkie pola są wymagane.' });
	}
	if (password.length < 8) {
		throw error(400, { message: 'Hasło musi mieć co najmniej 8 znaków.' });
	}
	if (!(await verifyTurnstile(turnstileToken))) {
		throw error(400, { message: 'Weryfikacja antybotowa nie powiodła się. Odśwież stronę i spróbuj ponownie.' });
	}

	const admin = getAdminClient();

	const { data: authData, error: authErr } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		user_metadata: { imie_nazwisko, rola: 'ADMIN BROKER' }
	});

	if (authErr || !authData.user) {
		throw error(400, { message: authErr?.message ?? 'Nie można utworzyć użytkownika.' });
	}

	const userId = authData.user.id;

	const { data: tenant, error: tenantErr } = await admin
		.from('crm_tenants')
		.insert([{ nazwa: nazwa_firmy, typ: tenantTyp }])
		.select()
		.single();

	if (tenantErr || !tenant) {
		await admin.auth.admin.deleteUser(userId);
		throw error(500, { message: tenantErr?.message ?? 'Nie można utworzyć firmy.' });
	}

	const { error: profileErr } = await admin.from('crm_profiles').insert([{
		id: userId,
		email,
		imie_nazwisko,
		rola: 'ADMIN BROKER',
		tenant_id: tenant.id
	}]);

	if (profileErr) {
		await admin.auth.admin.deleteUser(userId);
		await admin.from('crm_tenants').delete().eq('id', tenant.id);
		throw error(500, { message: profileErr.message });
	}

	return json({ success: true });
};
