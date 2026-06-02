import { json, error } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SB_URL } from '$lib/supabase';
import type { RequestHandler } from './$types';

const SERVICE_ROLE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY ?? '';

export const POST: RequestHandler = async ({ request }) => {
	if (!SERVICE_ROLE_KEY) throw error(500, 'Service role key not configured');

	const { email, role, imie_nazwisko, tenant_id } = await request.json() as {
		email: string;
		role: string;
		imie_nazwisko: string;
		tenant_id: string;
	};

	if (!email || !role || !tenant_id) throw error(400, 'Missing required fields');

	const admin = createClient(SB_URL, SERVICE_ROLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false }
	});

	// Zaproś użytkownika emailem
	const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
		data: { imie_nazwisko, rola: role }
	});

	if (inviteErr) throw error(400, inviteErr.message);

	// Utwórz profil w crm_profiles
	const { error: profileErr } = await admin.from('crm_profiles').upsert({
		id: inviteData.user.id,
		email,
		imie_nazwisko: imie_nazwisko || null,
		rola: role,
		tenant_id
	});

	if (profileErr) throw error(500, profileErr.message);

	return json({ success: true, userId: inviteData.user.id });
};
