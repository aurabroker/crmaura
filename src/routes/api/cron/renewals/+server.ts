import { json } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import {
	DNI_DO_PRZYPOMNIENIA,
	DNI_PRZED_KONCEM,
	dzisWarszawa,
	anulujNieaktualny,
	polisaProgramu,
	trybTestowy,
	usunSierotyPlikow,
	utworzOdnowienie,
	type RenewalRow
} from '$lib/server/renewals';
import { wyslijZaproszenie } from '$lib/server/renewalFlow';
import type { RequestHandler } from './$types';

// Zadanie dzienne (pg_cron → public.crm_run_renewals(), nagłówek x-cron-token z Vault):
// 1) wygasza nieużyte linki po terminie,
// 2) dla firm z włączonym modułem „odnowienia_auto” wysyła wnioski 45 dni przed końcem certyfikatu
//    (w trybie testowym „odnowienia_test” nowych nie zakłada),
// 3) wysyła jedno przypomnienie po 7 dniach bez złożonego wniosku.
const MAKS_ZAPROSZEN = 50;
const MAKS_PRZYPOMNIEN = 50;

export const POST: RequestHandler = async ({ request, url }) => {
	const admin = getAdminClient();
	const token = request.headers.get('x-cron-token') ?? '';
	if (!token) return new Response('brak nagłówka x-cron-token', { status: 401 });
	const { data: zgoda, error: e } = await admin.rpc('edge_cron_token_matches', { token });
	if (e) return new Response('nie mogę sprawdzić tokenu', { status: 500 });
	if (zgoda !== true) return new Response('zły nagłówek x-cron-token', { status: 401 });

	const wynik = { wygaszone: 0, zaproszenia: 0, przypomnienia: 0, pominiete: 0, usunietePliki: 0, bledy: [] as string[] };
	const teraz = new Date().toISOString();

	const { data: wygasle } = await admin
		.from('crm_renewals')
		.update({ status: 'wygasl', updated_at: teraz })
		.in('status', ['utworzony', 'wyslany', 'otwarty', 'apk'])
		.lt('wazny_do', teraz)
		.select('id');
	wynik.wygaszone = wygasle?.length ?? 0;

	// 2) Automatyczne zaproszenia — tylko firmy z włączonym modułem i kluczem Resend.
	const { data: firmy } = await admin.from('crm_tenants').select('id, features, resend_api_key');
	const dzis = dzisWarszawa();
	const granica = dzisWarszawa(DNI_PRZED_KONCEM);
	let wyslane = 0;
	for (const f of (firmy ?? []).filter((t) => t.features?.odnowienia_auto === true && t.resend_api_key)) {
		const { data: umowy } = await admin
			.from('crm_policies')
			.select('id')
			.eq('tenant_id', f.id)
			.eq('typ_umowy', 'generalna')
			.eq('ug_podtyp', 'oc_beauty')
			.is('deleted_at', null);
		const ugIds = (umowy ?? []).map((u) => u.id);
		if (!ugIds.length) continue;
		const { data: certyfikaty } = await admin
			.from('crm_policies')
			.select('id')
			.eq('tenant_id', f.id)
			.in('parent_id', ugIds)
			.is('deleted_at', null)
			.gte('data_do', dzis)
			.lte('data_do', granica)
			.order('data_do');
		// Certyfikat, który miał już jakikolwiek wniosek (także anulowany przez pracownika albo wygasły),
		// nie dostaje automatycznie nowego — ponowne zaproszenie to decyzja doradcy.
		const { data: zajete } = await admin.from('crm_renewals').select('polisa_id').eq('tenant_id', f.id);
		const maWniosek = new Set((zajete ?? []).map((z) => z.polisa_id));

		// Automatyczne wnioski, których e-mail się nie wysłał (np. chwilowy błąd Resend) — ponawiamy.
		const { data: niewyslane } = await admin
			.from('crm_renewals')
			.select('*')
			.eq('tenant_id', f.id)
			.eq('status', 'utworzony')
			.is('wyslano_at', null)
			.is('created_by', null)
			.gt('wazny_do', teraz)
			.limit(MAKS_ZAPROSZEN);
		let zablokowana = false;
		for (const r of (niewyslane ?? []) as RenewalRow[]) {
			if (wyslane >= MAKS_ZAPROSZEN) break;
			if (await anulujNieaktualny(admin, r)) continue;
			const w = await wyslijZaproszenie(admin, r, url.origin);
			if (w.ok) {
				wynik.zaproszenia++;
				wyslane++;
			} else {
				wynik.bledy.push(`ponowne zaproszenie ${r.id}: ${w.status}`);
				if ([401, 403, 422].includes(w.status)) { zablokowana = true; break; }
			}
		}
		if (zablokowana) continue;
		// Tryb testowy: automat nie zakłada nowych wniosków. Wniosek testowy zająłby certyfikat na stałe
		// (powyżej: każdy wniosek blokuje kolejne zaproszenie), a klient nie dostałby prawdziwego linku po testach.
		if (trybTestowy(f)) {
			wynik.pominiete += (certyfikaty ?? []).filter((c) => !maWniosek.has(c.id)).length;
			continue;
		}

		for (const c of certyfikaty ?? []) {
			if (wyslane >= MAKS_ZAPROSZEN) break;
			if (maWniosek.has(c.id)) continue;
			try {
				const p = await polisaProgramu(admin, f.id, c.id);
				if (!p.klient.email) {
					wynik.pominiete++;
					continue;
				}
				const r = await utworzOdnowienie(admin, p, { utworzyl: null });
				const w = await wyslijZaproszenie(admin, r, url.origin);
				if (w.ok) {
					wynik.zaproszenia++;
					wyslane++;
				} else {
					wynik.bledy.push(`zaproszenie ${c.id}: ${w.status}`);
					if ([401, 403, 422].includes(w.status)) break;
				}
			} catch (err) {
				// np. polisa już odnowiona w CRM albo równoległe utworzenie — pomijamy.
				wynik.pominiete++;
				const status = (err as { status?: number })?.status;
				if (status && status >= 500) wynik.bledy.push(`polisa ${c.id}: ${status}`);
			}
		}
	}

	// 3) Przypomnienia: jedno, po 7 dniach od wysłania, gdy wniosek nie jest złożony.
	const { data: doPrzypomnienia } = await admin
		.from('crm_renewals')
		.select('*')
		.in('status', ['wyslany', 'otwarty', 'apk'])
		.is('przypomniano_at', null)
		.not('email', 'is', null)
		.lt('wyslano_at', new Date(Date.now() - DNI_DO_PRZYPOMNIENIA * 86_400_000).toISOString())
		.gt('wazny_do', teraz)
		.limit(MAKS_PRZYPOMNIEN);
	// Firma, której Resend odmówił (zły klucz, niezweryfikowana domena), jest pomijana do końca uruchomienia.
	const zablokowane = new Set<string>();
	for (const r of (doPrzypomnienia ?? []) as RenewalRow[]) {
		if (zablokowane.has(r.tenant_id)) continue;
		if (await anulujNieaktualny(admin, r)) continue;
		// Zajęcie przed wysyłką: nakładające się uruchomienia nie wyślą przypomnienia dwa razy.
		const { data: zajete } = await admin
			.from('crm_renewals')
			.update({ przypomniano_at: new Date().toISOString() })
			.eq('id', r.id)
			.is('przypomniano_at', null)
			.select('id')
			.maybeSingle();
		if (!zajete) continue;
		const w = await wyslijZaproszenie(admin, r, url.origin, { przypomnienie: true });
		if (w.ok) wynik.przypomnienia++;
		else {
			// Nieudana wysyłka zwalnia wniosek — następne uruchomienie spróbuje ponownie.
			await admin.from('crm_renewals').update({ przypomniano_at: null }).eq('id', r.id);
			wynik.bledy.push(`przypomnienie ${r.id}: ${w.status}`);
			if ([401, 403, 422].includes(w.status)) zablokowane.add(r.tenant_id);
		}
	}

	// 4) Pliki bez wpisu we wniosku (w zakończonych wnioskach z ostatnich dni) — sprzątanie magazynu.
	const { data: zakonczone } = await admin
		.from('crm_renewals')
		.select('id, tenant_id, zalaczniki')
		.in('status', ['zlozony', 'anulowany', 'wygasl'])
		.gt('updated_at', new Date(Date.now() - 4 * 86_400_000).toISOString())
		.lt('updated_at', new Date(Date.now() - 3 * 3_600_000).toISOString())
		.limit(MAKS_PRZYPOMNIEN);
	for (const r of zakonczone ?? []) wynik.usunietePliki += await usunSierotyPlikow(admin, r as RenewalRow);

	return json(wynik);
};
