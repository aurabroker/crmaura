import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import type { RequestHandler } from './$types';

function generatePassword(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export const POST: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAdmin(request);

	const { email, role, imie_nazwisko } = await request.json() as {
		email: string;
		role: string;
		imie_nazwisko: string;
	};

	if (!email || !role) throw error(400, 'Podaj email i rolę');

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
		tenant_id: profile.tenant_id
	});

	if (profileErr) throw error(500, profileErr.message);

	return json({ success: true, userId: userData.user.id, tempPassword });
};
