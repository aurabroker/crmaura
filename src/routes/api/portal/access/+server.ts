import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// Zarządzanie dostępem klienta do Panelu Klienta (logowanie e-mail + hasło).
// Konta klienckie powstają w Supabase Auth i są wiązane z crm_clients.auth_user_id.
// Dostęp do polis/płatności/szkód ogranicza RLS (polityki *_client_select).

// POST: utwórz konto klienta lub ustaw nowe hasło istniejącemu kontu.
export const POST: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAuth(request);

	const { klient_id, email, password } = (await request.json()) as {
		klient_id: string;
		email: string;
		password: string;
	};

	if (!klient_id || !email || !password) throw error(400, 'Podaj klienta, e-mail i hasło');
	if (password.length < 8) throw error(400, 'Hasło musi mieć co najmniej 8 znaków');

	// Klient musi należeć do tenantu zalogowanego pracownika
	const { data: client, error: cErr } = await admin
		.from('crm_clients')
		.select('id, tenant_id, auth_user_id')
		.eq('id', klient_id)
		.single();
	if (cErr || !client) throw error(404, 'Nie znaleziono klienta');
	if (client.tenant_id !== profile.tenant_id) throw error(403, 'Klient spoza Twojej organizacji');

	// Istniejące konto → tylko zmiana hasła / e-maila
	if (client.auth_user_id) {
		const { error: upErr } = await admin.auth.admin.updateUserById(client.auth_user_id, {
			email,
			password,
			email_confirm: true
		});
		if (upErr) throw error(400, upErr.message);
		await admin.from('crm_clients').update({ email }).eq('id', klient_id);
		return json({ success: true, mode: 'updated' });
	}

	// Nowe konto
	const { data: userData, error: createErr } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		user_metadata: { rola: 'KLIENT', klient_id }
	});
	if (createErr) throw error(400, createErr.message);

	const { error: linkErr } = await admin
		.from('crm_clients')
		.update({ auth_user_id: userData.user.id, email })
		.eq('id', klient_id);
	if (linkErr) {
		// rollback konta, gdy nie udało się powiązać
		await admin.auth.admin.deleteUser(userData.user.id);
		throw error(500, linkErr.message);
	}

	return json({ success: true, mode: 'created', userId: userData.user.id });
};

// DELETE: odbierz dostęp (usuń konto auth i odepnij od klienta).
export const DELETE: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAuth(request);
	const { klient_id } = (await request.json()) as { klient_id: string };
	if (!klient_id) throw error(400, 'Podaj klienta');

	const { data: client, error: cErr } = await admin
		.from('crm_clients')
		.select('id, tenant_id, auth_user_id')
		.eq('id', klient_id)
		.single();
	if (cErr || !client) throw error(404, 'Nie znaleziono klienta');
	if (client.tenant_id !== profile.tenant_id) throw error(403, 'Klient spoza Twojej organizacji');
	if (!client.auth_user_id) return json({ success: true, mode: 'noop' });

	await admin.from('crm_clients').update({ auth_user_id: null }).eq('id', klient_id);
	await admin.auth.admin.deleteUser(client.auth_user_id);
	return json({ success: true, mode: 'revoked' });
};
