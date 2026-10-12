import { error, json } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth } from '$lib/server/auth';
import { magazyn } from '$lib/server/pliki';
import { MAKS_PLIKU_PUBLICZNEGO, PLIKI_PUBLICZNE, stanPlikow, zapiszPlikPubliczny } from '$lib/server/plikiPubliczne';
import type { RequestHandler } from './$types';

// Pliki publiczne z maili (pliki.auraexpert.pl/media/…): lista ze stanem w magazynie i podmiana pliku.
// Widzą je pracownicy firmy prowadzącej dany program (umowa generalna z ug_podtyp), podmieniają
// administratorzy tej firmy; SAAS Admin widzi i podmienia wszystkie.

const ROLE_ADMINA = ['ADMIN GOD', 'ADMIN BROKER', 'BOARD'];

async function programyFirmy(admin: SupabaseClient, profil: { tenant_id: string; rola: string }): Promise<string[]> {
	const wszystkie = [...new Set(Object.values(PLIKI_PUBLICZNE).map((p) => p.program))];
	if (profil.rola === 'ADMIN GOD') return wszystkie;
	const { data } = await admin
		.from('crm_policies')
		.select('ug_podtyp')
		.eq('tenant_id', profil.tenant_id)
		.eq('typ_umowy', 'generalna')
		.is('deleted_at', null)
		.in('ug_podtyp', wszystkie);
	return [...new Set(((data ?? []) as { ug_podtyp: string }[]).map((r) => r.ug_podtyp))];
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const kubelek = magazyn(platform);
	const { profile, admin } = await requireAuth(request);
	const programy = await programyFirmy(admin, profile);
	return json({ pliki: await stanPlikow(kubelek, programy), moze_zmieniac: ROLE_ADMINA.includes(profile.rola) && programy.length > 0 });
};

// POST multipart/form-data: sciezka (z listy), plik.
export const POST: RequestHandler = async ({ request, platform }) => {
	const kubelek = magazyn(platform);
	const { profile, admin } = await requireAuth(request);
	if (!ROLE_ADMINA.includes(profile.rola)) throw error(403, 'Pliki w mailach może podmieniać tylko administrator.');
	if (Number(request.headers.get('content-length') ?? 0) > MAKS_PLIKU_PUBLICZNEGO + 64 * 1024) throw error(413, 'Plik jest za duży.');
	const form = await request.formData().catch(() => null);
	const sciezka = String(form?.get('sciezka') ?? '');
	const plik = form?.get('plik');
	if (!(plik instanceof File)) throw error(400, 'Brak pliku.');
	const opis = PLIKI_PUBLICZNE[sciezka];
	if (!opis || !(await programyFirmy(admin, profile)).includes(opis.program)) throw error(404, 'Nie ma takiego pliku.');

	const blad = await zapiszPlikPubliczny(kubelek, sciezka, new Uint8Array(await plik.arrayBuffer()), profile.id);
	if (blad) throw error(400, blad);
	await admin.from('crm_audit_log').insert({
		tenant_id: profile.tenant_id,
		user_id: profile.id,
		user_email: profile.email ?? null,
		user_name: profile.imie_nazwisko ?? null,
		action: 'public_file_replaced',
		entity_type: 'public_file',
		entity_id: null,
		entity_label: sciezka,
		details: { plik: plik.name, rozmiar: plik.size }
	});
	const [stan] = await stanPlikow(kubelek, [opis.program]).then((l) => l.filter((p) => p.sciezka === sciezka));
	return json({ plik: stan });
};
