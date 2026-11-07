import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { krotkiLinkDla, linkDla, originKlienta, smsDostepny } from '$lib/server/renewals';
import type { LinkWniosku } from '$lib/renewals/staffApi';
import type { RequestHandler } from './$types';

// Link do istniejącego, aktywnego wniosku (podpis liczy serwer, w bazie go nie ma) i krótki link do SMS-a.
export const POST: RequestHandler = async ({ request, url }) => {
	const { profile, admin } = await requireAuth(request);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const { data } = await admin
		.from('crm_renewals')
		.select('id, tenant_id, email, status, wazny_do, kod_krotki')
		.eq('id', String(body?.id ?? ''))
		.eq('tenant_id', profile.tenant_id)
		.maybeSingle();
	if (!data || !['utworzony', 'wyslany', 'otwarty', 'apk'].includes(data.status) || Date.parse(data.wazny_do) < Date.now()) {
		throw error(404, { message: 'Ten wniosek nie jest już aktywny — utwórz nowy.' });
	}
	const origin = originKlienta(url);
	const odp: LinkWniosku = {
		id: data.id,
		link: await linkDla(data.id, origin),
		krotki_link: await krotkiLinkDla(admin, data, origin),
		wazny_do: data.wazny_do,
		sms: await smsDostepny(admin, data)
	};
	return json(odp);
};
