import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { pdfApkNaZadanie } from '$lib/server/renewalFlow';
import type { RenewalRow } from '$lib/server/renewals';
import type { RequestHandler } from './$types';

// PDF APK wniosku dla panelu CRM. Gdy pliku nie ma (wniosek złożony przed osobnym PDF APK albo błąd przy APK),
// serwer tworzy go teraz z zapisanych odpowiedzi. Zwraca ścieżkę w buckecie renewal-files.
export const POST: RequestHandler = async (event) => {
	const { profile, admin } = await requireAuth(event.request);
	const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
	const { data } = await admin
		.from('crm_renewals')
		.select('*')
		.eq('id', String(body?.id ?? ''))
		.eq('tenant_id', profile.tenant_id)
		.maybeSingle();
	if (!data) throw error(404, { message: 'Nie znaleziono wniosku.' });
	const r = data as RenewalRow;
	if (!r.apk_at) throw error(400, { message: 'Klient nie wypełnił jeszcze APK.' });
	const path = await pdfApkNaZadanie(event, admin, r, profile.id);
	if (!path) throw error(500, { message: 'Nie udało się utworzyć PDF APK — spróbuj ponownie za chwilę.' });
	return json({ path });
};
