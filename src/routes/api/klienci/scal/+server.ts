import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// Scalenie zdublowanych klientów: POST { docelowy, duplikaty: [] } (administrator firmy).
// Całą pracę robi funkcja w bazie (crm_scal_klientow, jedna transakcja): przepina polisy, wnioski, e-maile,
// zgłoszenia, zgody, zadania, szkody, pojazdy, kontakty i APK, łączy leady, uzupełnia puste pola rekordu
// docelowego, zapamiętuje identyfikatory BEAUTY duplikatów i usuwa je z pełną migawką w dzienniku.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAdmin(request);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const docelowy = String(body?.docelowy ?? '');
	const duplikaty = Array.isArray(body?.duplikaty) ? (body!.duplikaty as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x) && x !== docelowy) : [];
	if (!UUID.test(docelowy) || !duplikaty.length) throw error(400, { message: 'Wskaż klienta docelowego i co najmniej jeden duplikat.' });
	if (duplikaty.length > 20) throw error(400, { message: 'Za jednym razem można scalić najwyżej 20 duplikatów.' });

	const { data, error: e } = await admin.rpc('crm_scal_klientow', {
		p_tenant: profile.tenant_id,
		p_docelowy: docelowy,
		p_duplikaty: duplikaty,
		p_user_id: profile.id,
		p_user_email: profile.email,
		p_user_name: profile.imie_nazwisko
	});
	if (e) {
		console.error('klienci/scal:', e.message, e.hint ?? '');
		// Funkcja zgłasza błędy z podpowiedzią po polsku (hint); inne komunikaty bazy nie są dla pracownika.
		throw error(400, { message: e.hint || 'Nie udało się scalić klientów. Spróbuj ponownie albo zgłoś to administratorowi.' });
	}
	return json(data);
};
