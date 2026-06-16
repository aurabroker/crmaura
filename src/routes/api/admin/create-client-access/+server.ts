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

	const { klient_id, action } = await request.json() as { klient_id: string; action: 'create' | 'reset' };
	if (!klient_id) throw error(400, 'Podaj klienta');

	const { data: client } = await admin.from('crm_clients').select('id, email, auth_user_id, nazwa').eq('id', klient_id).eq('tenant_id', profile.tenant_id).single();
	if (!client) throw error(404, 'Klient nie istnieje');
	if (!client.email) throw error(400, 'Klient nie ma adresu e-mail — uzupełnij go przed utworzeniem dostępu.');

	const tempPassword = generatePassword();

	if (action === 'reset') {
		if (!client.auth_user_id) throw error(400, 'Klient nie ma jeszcze dostępu do Panelu Klienta.');
		const { error: updErr } = await admin.auth.admin.updateUserById(client.auth_user_id, { password: tempPassword });
		if (updErr) throw error(400, updErr.message);
		return json({ success: true, email: client.email, tempPassword });
	}

	if (client.auth_user_id) throw error(400, 'Klient już ma dostęp do Panelu Klienta.');

	const { data: userData, error: createErr } = await admin.auth.admin.createUser({
		email: client.email,
		password: tempPassword,
		email_confirm: true,
		user_metadata: { nazwa: client.nazwa, typ: 'client' }
	});
	if (createErr) throw error(400, createErr.message);

	const { error: linkErr } = await admin.from('crm_clients').update({ auth_user_id: userData.user.id }).eq('id', client.id);
	if (linkErr) throw error(500, linkErr.message);

	return json({ success: true, email: client.email, tempPassword });
};
