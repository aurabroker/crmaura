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
	linkDla,
	dodajDni,
	zapiszZdarzenie,
	type RenewalRow
} from '$lib/server/renewals';
import { wyslijZaproszenie } from '$lib/server/renewalFlow';
import {
	decyzjaLinku,
	decyzjaWniosku,
	sciezkaWniosku,
	type Decyzja,
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

// Wspólne przygotowanie dla obu dróg (Monika wysyła maila, mail z HUB daje link): klient, ścieżka
// (pierwsza polisa / odnowienie), dane do nowego wniosku i decyzja o istniejącym wniosku.
type Przygotowanie =
	| { koniec: OdpowiedzWnioskuAsystenta }
	| {
			odnowienie: boolean;
			dopisek: { rodzaj: 'nowa' } | { rodzaj: 'odnowienie'; ochrona_do: string };
			utworz: (zastap: boolean) => Promise<RenewalRow>;
			istniejacy: RenewalRow | null;
			decyzja: Decyzja;
			polisaId: string | null;
	  };

async function przygotuj(admin: SupabaseClient, tenantId: string, klientId: string, przez: string): Promise<Przygotowanie> {
	const { data: klient } = await admin
		.from('crm_clients')
		.select('id, aktywny')
		.eq('id', klientId)
		.eq('tenant_id', tenantId)
		.maybeSingle();
	if (!klient) return { koniec: { wynik: 'brak_klienta' } };
	if ((klient as { aktywny?: boolean }).aktywny === false) return { koniec: { wynik: 'klient_nieaktywny' } };

	const firma = await ustawieniaFirmy(admin, tenantId);
	// Jak zadanie odnowień (api/cron/renewals): automat działa tylko z modułem „odnowienia_auto” i kluczem Resend.
	const automat = firma?.features?.odnowienia_auto === true && !!firma?.resend_api_key;
	const sciezka = sciezkaWniosku(await certyfikatyKlienta(admin, tenantId, klientId), {
		dzis: dzisWarszawa(),
		dniPrzedKoncem: DNI_PRZED_KONCEM,
		automat
	});
	if (sciezka.rodzaj === 'za_wczesnie' || sciezka.rodzaj === 'do_agenta') {
		return { koniec: { wynik: sciezka.rodzaj, rodzaj: 'odnowienie', ochrona_do: sciezka.ochrona_do } };
	}
	const odnowienie = sciezka.rodzaj === 'odnowienie';
	const dopisek = odnowienie ? ({ rodzaj: 'odnowienie', ochrona_do: sciezka.ochrona_do } as const) : ({ rodzaj: 'nowa' } as const);

	// Dane do wniosku: certyfikat albo klient. Odmowy z kartoteki (polisa zakończona, odnowiona…) → doradca.
	let utworz: (zastap: boolean) => Promise<RenewalRow>;
	if (odnowienie) {
		let p;
		try {
			p = await polisaProgramu(admin, tenantId, sciezka.polisa_id);
		} catch (e) {
			if (status(e) === 400 || status(e) === 404) return { koniec: { wynik: 'do_agenta', ...dopisek } };
			throw e;
		}
		if (!p.klient.email) return { koniec: { wynik: 'brak_adresu', ...dopisek } };
		utworz = (zastap) => utworzOdnowienie(admin, p, { utworzyl: null, przez, zastap });
	} else {
		let k;
		try {
			k = await klientDoWniosku(admin, tenantId, klientId);
		} catch (e) {
			if (status(e) === 404) return { koniec: { wynik: 'brak_klienta' } };
			if (status(e) === 400) return { koniec: { wynik: 'klient_nieaktywny' } };
			throw e;
		}
		if (!k.email) return { koniec: { wynik: 'brak_adresu', ...dopisek } };
		utworz = (zastap) => utworzNowyWniosek(admin, k, { utworzyl: null, przez, zastap });
	}

	const polisaId = odnowienie && sciezka.rodzaj === 'odnowienie' ? sciezka.polisa_id : null;
	const istniejacy = await ostatniAktywny(admin, polisaId ? { polisa_id: polisaId } : { klient_id: klientId });
	const decyzja = decyzjaWniosku(opisIstniejacego(istniejacy), { teraz: Date.now(), trybTestowy: trybTestowy(firma) });
	return { odnowienie, dopisek, utworz, istniejacy, decyzja, polisaId };
}

const opisIstniejacego = (r: RenewalRow | null) =>
	r
		? {
				status: r.status,
				wyslano_at: r.wyslano_at ?? null,
				przypomniano_at: r.przypomniano_at ?? null,
				wazny_do: r.wazny_do,
				testowy: wniosekTestowy(r.email),
				rezygnacja: r.decyzja === 'nie'
			}
		: null;

export async function wyslijWniosekAsystenta(
	admin: SupabaseClient,
	tenantId: string,
	klientId: string,
	origin: string
): Promise<OdpowiedzWnioskuAsystenta> {
	const p = await przygotuj(admin, tenantId, klientId, KTO);
	if ('koniec' in p) return p.koniec;
	const { odnowienie, dopisek, utworz, istniejacy, decyzja } = p;
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

// ---------- Link do wniosku z maila HUB (klient klika przycisk; AuraCRM nie wysyła maila) ----------

export type OdpowiedzLinkuAsystenta = {
	wynik: 'link' | 'zlozony' | 'za_wczesnie' | 'do_agenta' | 'brak_adresu' | 'klient_nieaktywny' | 'brak_klienta';
	rodzaj?: 'nowa' | 'odnowienie';
	link?: string;
	wniosek_id?: string;
	wazny_do?: string;
	ochrona_do?: string;
};

const KTO_LINK = 'link_z_maila';

// Sprawa dla agenta po kliknięciu w mail (rezygnacja, koniec ochrony, polisa zakończona…): jedno otwarte
// zadanie na klienta — kolejne kliknięcia go nie mnożą.
async function zadanieDlaAgenta(admin: SupabaseClient, tenantId: string, klientId: string, polisaId: string | null, ochronaDo: string | undefined) {
	const { data: k } = await admin.from('crm_clients').select('nazwa, opiekun_id').eq('id', klientId).eq('tenant_id', tenantId).maybeSingle();
	const klient = k as { nazwa: string | null; opiekun_id: string | null } | null;
	const tytul = `Klient z maila prosi o wniosek online — ${klient?.nazwa ?? 'klient'}`.slice(0, 200);
	const { data: jest } = await admin
		.from('crm_tasks')
		.select('id')
		.eq('tenant_id', tenantId)
		.eq('klient_id', klientId)
		.eq('tytul', tytul)
		.eq('status', 'otwarte')
		.limit(1);
	if ((jest ?? []).length) return;
	const opis = [
		'Klient kliknął w mailu przycisk „Wypełnij wniosek online”, ale wniosku nie da się otworzyć automatycznie.',
		ochronaDo ? `Certyfikat programu OC beauty: ochrona do ${ochronaDo}.` : null,
		'Powód: koniec ochrony, polisa zakończona decyzją, wcześniejszy wniosek anulowany, wygasły albo z rezygnacją. Decyzja i ewentualne odnowienie ręczne po Twojej stronie.'
	]
		.filter(Boolean)
		.join('\n');
	const { error: e } = await admin.from('crm_tasks').insert({
		tenant_id: tenantId,
		klient_id: klientId,
		polisa_id: polisaId,
		typy: ['wniosek'],
		assigned_to: klient?.opiekun_id ?? null,
		tytul,
		opis,
		termin: dodajDni(dzisWarszawa(), 1),
		priorytet: 'wysoki',
		// Status jawnie: domyślny w bazie („Oczekujące”) aplikacja nie traktuje jako otwarte zadanie.
		status: 'otwarte'
	});
	if (e) console.error('Link z maila: zadanie nie utworzone:', e.message);
}

export async function linkWnioskuAsystenta(
	admin: SupabaseClient,
	tenantId: string,
	klientId: string,
	origin: string
): Promise<OdpowiedzLinkuAsystenta> {
	const p = await przygotuj(admin, tenantId, klientId, KTO_LINK);
	if ('koniec' in p) {
		const k = p.koniec;
		if (k.wynik === 'do_agenta') await zadanieDlaAgenta(admin, tenantId, klientId, null, k.ochrona_do);
		return { wynik: k.wynik as OdpowiedzLinkuAsystenta['wynik'], rodzaj: k.rodzaj, ochrona_do: k.ochrona_do };
	}
	const { dopisek, utworz, istniejacy, polisaId } = p;
	const d = decyzjaLinku(p.decyzja);
	if (d === 'zlozony') return { wynik: 'zlozony', ...dopisek, ...(istniejacy ? { wniosek_id: istniejacy.id } : {}) };
	if (d === 'do_agenta') {
		await zadanieDlaAgenta(admin, tenantId, klientId, polisaId, 'ochrona_do' in dopisek ? dopisek.ochrona_do : undefined);
		return { wynik: 'do_agenta', ...dopisek, ...(istniejacy ? { wniosek_id: istniejacy.id } : {}) };
	}

	let r: RenewalRow;
	if (d === 'uzyj') r = istniejacy!;
	else {
		try {
			r = await utworz(d === 'zastap');
		} catch (e) {
			// Równoległe kliknięcie (409): drugi wniosek nie powstał — bierzemy ten, który właśnie utworzono.
			if (status(e) === 409) {
				const teraz = await ostatniAktywny(admin, polisaId ? { polisa_id: polisaId } : { klient_id: klientId });
				if (teraz && teraz.status !== 'zlozony') r = teraz;
				else return { wynik: teraz ? 'zlozony' : 'do_agenta', ...dopisek };
			} else if (status(e) === 400) {
				await zadanieDlaAgenta(admin, tenantId, klientId, polisaId, 'ochrona_do' in dopisek ? dopisek.ochrona_do : undefined);
				return { wynik: 'do_agenta', ...dopisek };
			} else throw e;
		}
	}
	await zapiszZdarzenie(admin, r, KTO_LINK, null, null);
	return { wynik: 'link', ...dopisek, link: await linkDla(r.id, origin), wniosek_id: r.id, wazny_do: r.wazny_do };
}
