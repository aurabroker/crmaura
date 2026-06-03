import { json, error } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SB_URL } from '$lib/supabase';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { nazwa_firmy, email, imie_nazwisko, password } = body;

	if (!nazwa_firmy || !email || !imie_nazwisko || !password) {
		throw error(400, { message: 'Wszystkie pola są wymagane.' });
	}
	if (password.length < 8) {
		throw error(400, { message: 'Hasło musi mieć co najmniej 8 znaków.' });
	}

	const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
	if (!serviceKey) {
		throw error(500, { message: 'Brak konfiguracji serwera.' });
	}

	const admin = createClient(SB_URL, serviceKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});

	// Create auth user
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

	// Create tenant
	const { data: tenant, error: tenantErr } = await admin
		.from('crm_tenants')
		.insert([{ nazwa: nazwa_firmy }])
		.select()
		.single();

	if (tenantErr || !tenant) {
		// Rollback user
		await admin.auth.admin.deleteUser(userId);
		throw error(500, { message: tenantErr?.message ?? 'Nie można utworzyć firmy.' });
	}

	const tenant_id = tenant.id;

	// Create profile
	const { error: profileErr } = await admin.from('crm_profiles').insert([{
		id: userId,
		email,
		imie_nazwisko,
		rola: 'ADMIN BROKER',
		tenant_id
	}]);

	if (profileErr) {
		await admin.auth.admin.deleteUser(userId);
		await admin.from('crm_tenants').delete().eq('id', tenant_id);
		throw error(500, { message: profileErr.message });
	}

	return json({ success: true });
};
