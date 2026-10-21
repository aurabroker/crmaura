import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { nowyKlucz, skrotKlucza, zakresZ, type ZakresKlucza } from '$lib/server/zgloszenia';
import type { RequestHandler } from './$types';

// Klucze integracji firmy — tylko administrator. Parametr ?zakres= wybiera klucz:
// „zgloszenia” (domyślnie) — arkusz zgłoszeń (Apps Script), „asystent_ai” — worker konsultacji AI.
// GET — aktywny klucz (bez treści), dla arkusza też statystyka zgłoszeń; POST — nowy klucz (poprzedni klucz
// tego zakresu przestaje działać), treść klucza jest zwracana tylko raz; DELETE — wyłączenie klucza zakresu.
const ETYKIETA: Record<ZakresKlucza, string> = {
	zgloszenia: 'Klucz formularza zgłoszeń',
	asystent_ai: 'Klucz asystenta AI (konsultacja)'
};

export const GET: RequestHandler = async ({ request, url }) => {
	const { profile, admin } = await requireAdmin(request);
	const zakres = zakresZ(url.searchParams.get('zakres'));
	const { data: klucze } = await admin
		.from('crm_klucze_integracji')
		.select('id, nazwa, prefiks, created_at, ostatnio_uzyty_at, wylaczony_at')
		.eq('tenant_id', profile.tenant_id)
		.eq('zakres', zakres)
		.order('created_at', { ascending: false })
		.limit(5);
	const aktywny = (klucze ?? []).find((k) => !k.wylaczony_at) ?? null;
	if (zakres === 'asystent_ai') return json({ aktywny });
	const [{ count: zgloszen }, { data: ostatnie }] = await Promise.all([
		admin.from('crm_zgloszenia').select('id', { count: 'exact', head: true }).eq('tenant_id', profile.tenant_id),
		admin
			.from('crm_zgloszenia')
			.select('zgloszono_at, firma, ponowne, historyczne')
			.eq('tenant_id', profile.tenant_id)
			.eq('historyczne', false)
			.order('created_at', { ascending: false })
			.limit(1)
	]);
	return json({ aktywny, zgloszen: zgloszen ?? 0, ostatnie: ostatnie?.[0] ?? null });
};

export const POST: RequestHandler = async ({ request, url }) => {
	const { profile, admin } = await requireAdmin(request);
	const zakres = zakresZ(url.searchParams.get('zakres'));
	const klucz = nowyKlucz(zakres);
	const teraz = new Date().toISOString();
	const { error: blWyl } = await admin
		.from('crm_klucze_integracji')
		.update({ wylaczony_at: teraz })
		.eq('tenant_id', profile.tenant_id)
		.eq('zakres', zakres)
		.is('wylaczony_at', null);
	if (blWyl) throw error(500, blWyl.message);
	const { data, error: blad } = await admin
		.from('crm_klucze_integracji')
		.insert({
			tenant_id: profile.tenant_id,
			zakres,
			...(zakres === 'asystent_ai' ? { nazwa: 'Asystent AI (konsultacja)' } : {}),
			hash: await skrotKlucza(klucz),
			prefiks: klucz.slice(0, 12),
			utworzyl: profile.id
		})
		.select('id, nazwa, prefiks, created_at, ostatnio_uzyty_at, wylaczony_at')
		.single();
	if (blad) throw error(500, blad.message);
	await admin.from('crm_audit_log').insert({
		tenant_id: profile.tenant_id,
		user_id: profile.id,
		user_email: profile.email ?? null,
		user_name: profile.imie_nazwisko ?? null,
		action: 'integration_key_created',
		entity_type: 'integration',
		entity_id: data.id,
		entity_label: ETYKIETA[zakres],
		details: { prefiks: data.prefiks, zakres }
	});
	return json({ klucz, aktywny: data });
};

export const DELETE: RequestHandler = async ({ request, url }) => {
	const { profile, admin } = await requireAdmin(request);
	const zakres = zakresZ(url.searchParams.get('zakres'));
	const { error: blad } = await admin
		.from('crm_klucze_integracji')
		.update({ wylaczony_at: new Date().toISOString() })
		.eq('tenant_id', profile.tenant_id)
		.eq('zakres', zakres)
		.is('wylaczony_at', null);
	if (blad) throw error(500, blad.message);
	await admin.from('crm_audit_log').insert({
		tenant_id: profile.tenant_id,
		user_id: profile.id,
		user_email: profile.email ?? null,
		user_name: profile.imie_nazwisko ?? null,
		action: 'integration_key_disabled',
		entity_type: 'integration',
		entity_label: ETYKIETA[zakres],
		details: { zakres }
	});
	return json({ ok: true });
};
