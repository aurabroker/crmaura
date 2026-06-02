import { json, error } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SB_URL } from '$lib/supabase';
import type { RequestHandler } from './$types';

const SERVICE_ROLE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY ?? '';

function generatePassword(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
	let pass = '';
	for (let i = 0; i < 12; i++) pass += chars[Math.floor(Math.random() * chars.length)];
	return pass;
}

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

	const tempPassword = generatePassword();

	const { data: userData, error: createErr } = await admin.auth.admin.createUser({
		email,
		password: tempPassword,
		email_confirm: true,
		user_metadata: { imie_nazwisko, rola: role }
	});

	if (createErr) throw error(400, createErr.message);

	const { error: profileErr } = await admin.from('crm_profiles').upsert({
		id: userData.user.id,
		email,
		imie_nazwisko: imie_nazwisko || null,
		rola: role,
		tenant_id
	});

	if (profileErr) throw error(500, profileErr.message);

	return json({ success: true, userId: userData.user.id, tempPassword });
};
