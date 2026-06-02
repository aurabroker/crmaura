import { json, error } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SB_URL } from '$lib/supabase';
import type { RequestHandler } from './$types';

const SERVICE_ROLE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY ?? '';

export const POST: RequestHandler = async ({ request }) => {
	if (!SERVICE_ROLE_KEY) throw error(500, 'Service role key not configured');

	const { user_id, role, imie_nazwisko, stanowisko } = await request.json() as {
		user_id: string;
		role: string;
		imie_nazwisko: string;
		stanowisko: string;
	};

	const admin = createClient(SB_URL, SERVICE_ROLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false }
	});

	const { error: err } = await admin.from('crm_profiles').update({
		rola: role,
		imie_nazwisko: imie_nazwisko || null,
		stanowisko: stanowisko || null
	}).eq('id', user_id);

	if (err) throw error(500, err.message);

	return json({ success: true });
};
