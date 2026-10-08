import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { linkDla } from '$lib/server/renewals';
import type { RequestHandler } from './$types';

// Link do istniejącego, aktywnego wniosku (podpis liczy serwer, w bazie go nie ma).
export const POST: RequestHandler = async ({ request, url }) => {
	const { profile, admin } = await requireAuth(request);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const { data } = await admin
		.from('crm_renewals')
		.select('id, status, wazny_do')
		.eq('id', String(body?.id ?? ''))
		.eq('tenant_id', profile.tenant_id)
		.maybeSingle();
	if (!data || !['utworzony', 'wyslany', 'otwarty', 'apk'].includes(data.status) || Date.parse(data.wazny_do) < Date.now()) {
		throw error(404, { message: 'Ten wniosek nie jest już aktywny — utwórz nowy.' });
	}
	return json({ link: await linkDla(data.id, url.origin) });
};
