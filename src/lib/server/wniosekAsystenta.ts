// Wysyłka wniosku online na prośbę asystenta AI (worker konsultacja-agent, klucz integracji „asystent_ai”).
// Klienta wskazuje sesja rozmowy po stronie workera, nigdy model. Rodzaj wniosku wybiera kartoteka:
// klient z certyfikatem programu OC beauty dostaje odnowienie tego certyfikatu, pozostali — pierwszą polisę.
// Odnowienie podlega regułom automatu (okno 45 dni, decyzja doradcy po anulowanym wniosku, koniec ochrony).
import type { SupabaseClient } from '@supabase/supabase-js';
import { PREFIKS_KLUCZA_AI, skrotKlucza } from '$lib/server/zgloszenia';
import {
	DNI_PRZED_KONCEM,
	dzisWarszawa,
	klientDoWniosku,
	polisaProgramu,
	trybTestowy,
	ustawieniaFirmy,
	utworzNowyWniosek,
	utworzOdnowienie,
	wniosekTestowy,
	type RenewalRow
} from '$lib/server/renewals';
import { wyslijZaproszenie } from '$lib/server/renewalFlow';
import {
	decyzjaWniosku,
	sciezkaWniosku,
	type CertyfikatKlienta,
	type WynikWnioskuAsystenta
} from '$lib/renewals/wniosekAsystenta';

export type OdpowiedzWnioskuAsystenta = {
	wynik: WynikWnioskuAsystenta;
	rodzaj?: 'nowa' | 'odnowienie';
	wniosek_id?: string;
	wazny_do?: string;
	ochrona_do?: string;
	test?: boolean;
};

const KTO = 'asystent_ai';
const NIEAKTYWNE = '(wygasl,anulowany)';

/** Firma z klucza asystenta AI albo null (zły, wyłączony albo klucz arkusza). Zapisuje ostatnie użycie. */
export async function tenantZKluczaAsystenta(admin: SupabaseClient, klucz: string): Promise<string | null> {
	const k = klucz.trim();
	if (!k.startsWith(PREFIKS_KLUCZA_AI)) return null;
	const hash = await skrotKlucza(k);
	const { data } = await admin
		.from('crm_klucze_integracji')
		.select('id, tenant_id')
		.eq('hash', hash)
		.eq('zakres', 'asystent_ai')
		.is('wylaczony_at', null)
		.maybeSingle();
	if (!data) return null;
	await admin.from('crm_klucze_integracji').update({ ostatnio_uzyty_at: new Date().toISOString() }).eq('id', data.id);
	return data.tenant_id as string;
}

const status = (e: unknown) => (e as { status?: number })?.status;

// Certyfikaty klienta w programie OC beauty z tym, czego potrzebuje sciezkaWniosku.
async function certyfikatyKlienta(admin: SupabaseClient, tenantId: string, klientId: string): Promise<CertyfikatKlienta[]> {
	const { data: umowy } = await admin
		.from('crm_policies')
		.select('id')
		.eq('tenant_id', tenantId)
		.eq('typ_umowy', 'generalna')
		.eq('ug_podtyp', 'oc_beauty')
		.is('deleted_at', null);
	const ugIds = (umowy ?? []).map((u) => u.id as string);
	if (!ugIds.length) return [];
	const { data: polisy } = await admin
		.from('crm_policies')
		.select('id, data_do, zakonczona_od')
		.eq('tenant_id', tenantId)
		.eq('klient_id', klientId)
		.in('parent_id', ugIds)
		.is('deleted_at', null)
		.not('data_do', 'is', null);
	const lista = (polisy ?? []) as { id: string; data_do: string; zakonczona_od: string | null }[];
	if (!lista.length) return [];
	const ids = lista.map((p) => p.id);
	const [{ data: nastepcy }, { data: wnioski }] = await Promise.all([
		admin.from('crm_policies').select('renewal_of').in('renewal_of', ids).is('deleted_at', null),
		admin.from('crm_renewals').select('polisa_id, status, email').eq('tenant_id', tenantId).in('polisa_id', ids)
	]);
	const odnowione = new Set((nastepcy ?? []).map((n) => n.renewal_of as string));
	const w = (wnioski ?? []) as { polisa_id: string; status: string; email: string | null }[];
	return lista.map((p) => {
		const jego = w.filter((x) => x.polisa_id === p.id);
		const aktywny = jego.some((x) => x.status !== 'anulowany' && x.status !== 'wygasl');
		// Jak automat (podzielWnioski): prawdziwy wniosek anulowany albo wygasły (testowy — tylko anulowany przez
		// pracownika) zostawia certyfikat doradcy. Gdy jest już nowszy aktywny wniosek, decyduje on.
		const zostawiony = jego.some((x) => x.status === 'anulowany' || (x.status === 'wygasl' && !wniosekTestowy(x.email)));
		return {
			id: p.id,
			data_do: String(p.data_do).slice(0, 10),
			zakonczona: !!p.zakonczona_od,
			odnowiona: odnowione.has(p.id),
			byl_wniosek: !aktywny && zostawiony,
			aktywny_wniosek: aktywny
		};
	});
}

async function ostatniAktywny(admin: SupabaseClient, filtr: { polisa_id: string } | { klient_id: string }): Promise<RenewalRow | null> {
	let q = admin.from('crm_renewals').select('*').not('status', 'in', NIEAKTYWNE);
	q = 'polisa_id' in filtr ? q.eq('polisa_id', filtr.polisa_id) : q.eq('klient_id', filtr.klient_id).is('polisa_id', null).eq('rodzaj', 'nowa');
	const { data } = await q.order('created_at', { ascending: false }).limit(1);
	return ((data ?? [])[0] as RenewalRow | undefined) ?? null;
}

export async function wyslijWniosekAsystenta(
	admin: SupabaseClient,
	tenantId: string,
	klientId: string,
	origin: string
): Promise<OdpowiedzWnioskuAsystenta> {
	const { data: klient } = await admin
		.from('crm_clients')
		.select('id, aktywny')
		.eq('id', klientId)
		.eq('tenant_id', tenantId)
		.maybeSingle();
	if (!klient) return { wynik: 'brak_klienta' };
	if ((klient as { aktywny?: boolean }).aktywny === false) return { wynik: 'klient_nieaktywny' };

	const firma = await ustawieniaFirmy(admin, tenantId);
	// Jak zadanie odnowień (api/cron/renewals): automat działa tylko z modułem „odnowienia_auto” i kluczem Resend.
	const automat = firma?.features?.odnowienia_auto === true && !!firma?.resend_api_key;
	const sciezka = sciezkaWniosku(await certyfikatyKlienta(admin, tenantId, klientId), {
		dzis: dzisWarszawa(),
		dniPrzedKoncem: DNI_PRZED_KONCEM,
		automat
	});
	if (sciezka.rodzaj === 'za_wczesnie' || sciezka.rodzaj === 'do_agenta') {
		return { wynik: sciezka.rodzaj, rodzaj: 'odnowienie', ochrona_do: sciezka.ochrona_do };
	}
	const odnowienie = sciezka.rodzaj === 'odnowienie';
	const rodzaj = odnowienie ? 'odnowienie' : 'nowa';
	const dopisek = odnowienie ? { rodzaj, ochrona_do: sciezka.ochrona_do } as const : { rodzaj } as const;

	// Dane do wniosku: certyfikat albo klient. Odmowy z kartoteki (polisa zakończona, odnowiona…) → doradca.
	let utworz: (zastap: boolean) => Promise<RenewalRow>;
	if (odnowienie) {
		let p;
		try {
			p = await polisaProgramu(admin, tenantId, sciezka.polisa_id);
		} catch (e) {
			if (status(e) === 400 || status(e) === 404) return { wynik: 'do_agenta', ...dopisek };
			throw e;
		}
		if (!p.klient.email) return { wynik: 'brak_adresu', ...dopisek };
		utworz = (zastap) => utworzOdnowienie(admin, p, { utworzyl: null, przez: KTO, zastap });
	} else {
		let k;
		try {
			k = await klientDoWniosku(admin, tenantId, klientId);
		} catch (e) {
			if (status(e) === 404) return { wynik: 'brak_klienta' };
			if (status(e) === 400) return { wynik: 'klient_nieaktywny' };
			throw e;
		}
		if (!k.email) return { wynik: 'brak_adresu', ...dopisek };
		utworz = (zastap) => utworzNowyWniosek(admin, k, { utworzyl: null, przez: KTO, zastap });
	}

	const istniejacy = await ostatniAktywny(admin, odnowienie ? { polisa_id: sciezka.polisa_id } : { klient_id: klientId });
	const decyzja = decyzjaWniosku(
		istniejacy
			? {
					status: istniejacy.status,
					wyslano_at: istniejacy.wyslano_at ?? null,
					przypomniano_at: istniejacy.przypomniano_at ?? null,
					wazny_do: istniejacy.wazny_do,
					testowy: wniosekTestowy(istniejacy.email),
					rezygnacja: istniejacy.decyzja === 'nie'
				}
			: null,
		{ teraz: Date.now(), trybTestowy: trybTestowy(firma) }
	);
	// Klient zrezygnował z odnowienia we wniosku, a teraz prosi o link — decyduje agent (mail do biura).
	if (decyzja === 'rezygnacja') return { wynik: 'do_agenta', ...dopisek, ...(istniejacy ? { wniosek_id: istniejacy.id } : {}) };
	if (decyzja === 'zlozony' || decyzja === 'juz_wyslany') {
		return { wynik: decyzja, ...dopisek, ...(istniejacy ? { wniosek_id: istniejacy.id, wazny_do: istniejacy.wazny_do } : {}) };
	}

	let r: RenewalRow;
	if (decyzja === 'nowy' || decyzja === 'zastap') {
		try {
			r = await utworz(decyzja === 'zastap');
		} catch (e) {
			// Równoległe utworzenie (409) albo koniec ochrony certyfikatu (400) — sprawa dla doradcy.
			if (status(e) === 409 || status(e) === 400) return { wynik: odnowienie ? 'do_agenta' : 'blad_wysylki', ...dopisek };
			throw e;
		}
	} else r = istniejacy!;

	const przypomnienie = decyzja === 'przypomnij';
	const w = await wyslijZaproszenie(admin, r, origin, { przypomnienie, kto: KTO });
	if (!w.ok) {
		return { wynik: r.email ? 'blad_wysylki' : 'brak_adresu', ...dopisek, wniosek_id: r.id, wazny_do: r.wazny_do };
	}
	return { wynik: przypomnienie ? 'wyslany_ponownie' : 'wyslany', ...dopisek, wniosek_id: r.id, wazny_do: r.wazny_do, test: w.test };
}
