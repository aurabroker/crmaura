import { json, error } from '@sveltejs/kit';
import { requireAdmin, assertAssignableRole } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAdmin(request);

	const { user_id, role, imie_nazwisko, stanowisko } = await request.json() as {
		user_id: string;
		role: string;
		imie_nazwisko: string;
		stanowisko: string;
	};

	if (!user_id || !role) throw error(400, 'Podaj user_id i rolę');
	// Blokada eskalacji uprawnień — m.in. nadania roli ADMIN GOD przez admina tenanta.
	assertAssignableRole(role, profile.rola);

	const { data: target } = await admin.from('crm_profiles')
		.select('tenant_id')
		.eq('id', user_id)
		.single();

	if (!target || target.tenant_id !== profile.tenant_id) {
		throw error(403, 'Nie możesz edytować użytkowników spoza swojej firmy');
	}

	const { error: err } = await admin.from('crm_profiles').update({
		rola: role,
		imie_nazwisko: imie_nazwisko || null,
		stanowisko: stanowisko || null
	}).eq('id', user_id);

	if (err) throw error(500, err.message);

	return json({ success: true });
};
