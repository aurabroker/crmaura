import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { pobierzPodpisy, skrotApk, skrotWniosku } from '$lib/server/podpis';
import type { RenewalRow } from '$lib/server/renewals';
import type { RequestHandler } from './$types';

// Podpisy klienta pod wnioskiem o odnowienie (karta polisy w CRM): obraz, czas, IP, przeglądarka i zgodność —
// czy treść APK / wniosku w bazie jest nadal taka, jak w chwili podpisu (ten sam skrót SHA-256).
// POST { id } — id wniosku z firmy pracownika.
export const POST: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAuth(request);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const { data } = await admin.from('crm_renewals').select('*').eq('id', String(body?.id ?? '')).eq('tenant_id', profile.tenant_id).maybeSingle();
	if (!data) throw error(404, { message: 'Nie znaleziono wniosku.' });
	const r = data as RenewalRow;
	const [podpisy, sApk, sWniosku] = await Promise.all([pobierzPodpisy(admin, r.id), skrotApk(r), skrotWniosku(r)]);
	return json({
		podpisy: podpisy
			.sort((a, b) => (a.zakres === 'apk' ? -1 : 1) - (b.zakres === 'apk' ? -1 : 1))
			.map((p) => ({
				zakres: p.zakres,
				png: `data:image/png;base64,${p.png}`,
				podpisano_at: p.podpisano_at,
				ip: p.ip,
				user_agent: p.user_agent,
				skrot_tresci: p.skrot_tresci,
				skrot_podpisu: p.skrot_podpisu,
				zgodny: p.skrot_tresci === (p.zakres === 'apk' ? sApk : sWniosku)
			})),
		zgody: r.zgody ?? null
	});
};
