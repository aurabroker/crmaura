import { json } from '@sveltejs/kit';
import { requireSaasAdmin } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	const { admin } = await requireSaasAdmin(request);

	const [tRes, pRes] = await Promise.all([
		admin.from('crm_tenants').select('*').order('created_at', { ascending: false }),
		admin.from('crm_profiles').select('id, email, imie_nazwisko, rola, tenant_id')
	]);

	return json({
		tenants: tRes.data ?? [],
		profiles: pRes.data ?? []
	});
};
