import { json, error } from '@sveltejs/kit';
import { requireSaasAdmin } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { admin } = await requireSaasAdmin(request);

	const body = await request.json();
	const { user_id, password } = body;

	if (!user_id || !password) throw error(400, 'Brakuje user_id lub password');
	if (password.length < 8) throw error(400, 'Hasło musi mieć co najmniej 8 znaków');

	const { error: updateErr } = await admin.auth.admin.updateUserById(user_id, { password });
	if (updateErr) throw error(500, updateErr.message);

	return json({ success: true });
};
