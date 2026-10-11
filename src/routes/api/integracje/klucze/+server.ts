import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { nowyKlucz, skrotKlucza } from '$lib/server/zgloszenia';
import type { RequestHandler } from './$types';

// Klucz, którym arkusz zgłoszeń (Apps Script) wysyła zgłoszenia do CRM — tylko administrator firmy.
// GET — aktywny klucz (bez treści) i statystyka zgłoszeń; POST — nowy klucz (poprzedni przestaje działać),
// treść klucza jest zwracana tylko raz; DELETE — wyłączenie klucza.
export const GET: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAdmin(request);
	const [{ data: klucze }, { count: zgloszen }, { data: ostatnie }] = await Promise.all([
		admin
			.from('crm_klucze_integracji')
			.select('id, nazwa, prefiks, created_at, ostatnio_uzyty_at, wylaczony_at')
			.eq('tenant_id', profile.tenant_id)
			.order('created_at', { ascending: false })
			.limit(5),
		admin.from('crm_zgloszenia').select('id', { count: 'exact', head: true }).eq('tenant_id', profile.tenant_id),
		admin
			.from('crm_zgloszenia')
			.select('zgloszono_at, firma, ponowne, historyczne')
			.eq('tenant_id', profile.tenant_id)
			.eq('historyczne', false)
			.order('created_at', { ascending: false })
			.limit(1)
	]);
	const aktywny = (klucze ?? []).find((k) => !k.wylaczony_at) ?? null;
	return json({ aktywny, zgloszen: zgloszen ?? 0, ostatnie: ostatnie?.[0] ?? null });
};

export const POST: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAdmin(request);
	const klucz = nowyKlucz();
	const teraz = new Date().toISOString();
	const { error: blWyl } = await admin
		.from('crm_klucze_integracji')
		.update({ wylaczony_at: teraz })
		.eq('tenant_id', profile.tenant_id)
		.is('wylaczony_at', null);
	if (blWyl) throw error(500, blWyl.message);
	const { data, error: blad } = await admin
		.from('crm_klucze_integracji')
		.insert({ tenant_id: profile.tenant_id, hash: await skrotKlucza(klucz), prefiks: klucz.slice(0, 12), utworzyl: profile.id })
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
		entity_label: 'Klucz formularza zgłoszeń',
		details: { prefiks: data.prefiks }
	});
	return json({ klucz, aktywny: data });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { profile, admin } = await requireAdmin(request);
	const { error: blad } = await admin
		.from('crm_klucze_integracji')
		.update({ wylaczony_at: new Date().toISOString() })
		.eq('tenant_id', profile.tenant_id)
		.is('wylaczony_at', null);
	if (blad) throw error(500, blad.message);
	await admin.from('crm_audit_log').insert({
		tenant_id: profile.tenant_id,
		user_id: profile.id,
		user_email: profile.email ?? null,
		user_name: profile.imie_nazwisko ?? null,
		action: 'integration_key_disabled',
		entity_type: 'integration',
		entity_label: 'Klucz formularza zgłoszeń'
	});
	return json({ ok: true });
};
