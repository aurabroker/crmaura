import { error, json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { ustawieniaWysylki } from '$lib/server/emailKlienta';
import { DOMYSLNE_SEKCJE, SEKCJE, sprawdzUstawienia, wyslijPodsumowanie, type Subskrypcja } from '$lib/server/podsumowanie';
import type { RequestHandler } from './$types';

// Ustawienia codziennego podsumowania zalogowanego pracownika (Ustawienia → Powiadomienia).
// GET — bieżące ustawienia (albo domyślne), adres z profilu, czy firma ma wysyłkę; PUT — zapis;
// POST — „Wyślij teraz” (na zapisanych ustawieniach, zawsze, nawet gdy nic nowego).

async function subskrypcja(admin: Awaited<ReturnType<typeof requireAuth>>['admin'], profilId: string) {
	const { data } = await admin.from('crm_podsumowania').select('*').eq('profile_id', profilId).maybeSingle();
	return data as Subskrypcja | null;
}

export const GET: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAuth(request);
	const [s, ust] = await Promise.all([subskrypcja(admin, profile.id), ustawieniaWysylki(admin, profile.tenant_id)]);
	return json({
		sekcje_lista: SEKCJE,
		ustawienia: s
			? { godzina: s.godzina, sekcje: { ...DOMYSLNE_SEKCJE, ...s.sekcje }, aktywne: s.aktywne, pomin_puste: s.pomin_puste, zapisane: true, ostatnio_wyslano_at: s.ostatnio_wyslano_at, ostatni_blad: s.ostatni_blad }
			: { godzina: 7, sekcje: DOMYSLNE_SEKCJE, aktywne: false, pomin_puste: false, zapisane: false, ostatnio_wyslano_at: null, ostatni_blad: null },
		adres: profile.email,
		wysylka_gotowa: ust.gotowe
	});
};

export const PUT: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAuth(request);
	const u = sprawdzUstawienia(await request.json().catch(() => null));
	if ('blad' in u) throw error(400, u.blad);
	const { error: e } = await admin
		.from('crm_podsumowania')
		.upsert({ tenant_id: profile.tenant_id, profile_id: profile.id, ...u, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' });
	if (e) throw error(500, 'Nie udało się zapisać ustawień.');
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ request, url }) => {
	const { profile, admin } = await requireAuth(request);
	const s = await subskrypcja(admin, profile.id);
	if (!s) throw error(400, 'Najpierw zapisz ustawienia.');
	const w = await wyslijPodsumowanie(admin, s, { crm: url.origin, wymus: true });
	if (!w.ok) throw error(400, w.blad);
	return json({ ok: true, temat: w.temat, pusto: w.pusto });
};
