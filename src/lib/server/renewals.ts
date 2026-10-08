import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { EMAIL_RE } from '$lib/server/mail';
import type { WidokOdnowienia, Zalacznik } from '$lib/renewals/api';
import { ADRES_TESTOWY } from '$lib/renewals/staffApi';
import { ochronaPrawnaWSkladce, sumaZeSkladki, type Apk, type Ankieta, type Wniosek } from '$lib/renewals/program';

// Odnowienia polis OC beauty — logika serwera wspólna dla trasy klienta (/api/odnowienie/[klucz]),
// panelu CRM (/api/renewals) i zadania dziennego (/api/cron/renewals). Wszystko działa kluczem
// service_role, więc każda funkcja sama pilnuje firmy (tenant_id) i stanu wniosku.

export const BUCKET = 'renewal-files';
export const DNI_PRZED_KONCEM = 45;
export const DNI_DO_PRZYPOMNIENIA = 7;
const AKTYWNE = ['utworzony', 'wyslany', 'otwarty', 'apk'] as const;

export type RenewalRow = {
	id: string;
	tenant_id: string;
	polisa_id: string;
	klient_id: string;
	status: string;
	decyzja: string | null;
	email: string | null;
	nr_polisy: string | null;
	tu_nazwa: string | null;
	program: string | null;
	klient_nazwa: string | null;
	suma: number | null;
	skladka: number | null;
	okres_od: string | null;
	okres_do: string | null;
	apk: Apk | null;
	apk_odmowa: boolean;
	wniosek: Wniosek | null;
	ankieta: Ankieta | null;
	zalaczniki: (Zalacznik & { path: string; at: string })[];
	skladka_nowa: number | null;
	pdf_path: string | null;
	wyslano_at: string | null;
	otwarto_at: string | null;
	apk_at: string | null;
	zlozono_at: string | null;
	przypomniano_at: string | null;
	wazny_do: string;
	created_by: string | null;
	updated_at: string;
};

// ---------- Link: /odnowienie/<id>.<podpis> ----------
// Podpis HMAC liczy tylko serwer; w bazie nie ma nic, co pozwala go odtworzyć. Ten sam link
// można więc wysłać ponownie (przypomnienie), a nowy wniosek ma nowy identyfikator i nowy link.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const enc = new TextEncoder();

function sekretLinku(): string {
	const s = env.RENEWAL_LINK_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
	if (!s) throw error(500, 'Brak konfiguracji serwera');
	return s;
}

async function podpis(id: string): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey('raw', enc.encode(sekretLinku()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const pelny = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`crm-odnowienie:v1:${id}`)));
	return pelny.slice(0, 16);
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function kluczDla(id: string): Promise<string> {
	return `${id}.${b64url(await podpis(id))}`;
}

// Zwraca id odnowienia, gdy klucz jest prawdziwy; inaczej null (bez ujawniania powodu).
export async function sprawdzKlucz(klucz: string): Promise<string | null> {
	const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/.exec(klucz ?? '');
	if (!m || !UUID.test(m[1])) return null;
	const oczekiwany = b64url(await podpis(m[1]));
	if (oczekiwany.length !== m[2].length) return null;
	let roznica = 0;
	for (let i = 0; i < oczekiwany.length; i++) roznica |= oczekiwany.charCodeAt(i) ^ m[2].charCodeAt(i);
	return roznica === 0 ? m[1] : null;
}

export function bazaLinku(origin: string): string {
	return (env.RENEWAL_LINK_BASE || origin).replace(/\/$/, '');
}

export async function linkDla(id: string, origin: string): Promise<string> {
	return `${bazaLinku(origin)}/odnowienie/${await kluczDla(id)}`;
}

// ---------- Daty (czas polski) ----------

export function dzisWarszawa(dni = 0): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date(Date.now() + dni * 86_400_000));
}

export function dodajDni(data: string, dni: number): string {
	const d = new Date(`${data}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + dni);
	return d.toISOString().slice(0, 10);
}

// Nowy okres: od dnia po końcu obecnej polisy, na 12 miesięcy.
export function nowyOkres(okresDo: string): { od: string; do: string } {
	const od = dodajDni(okresDo, 1);
	const d = new Date(`${od}T12:00:00Z`);
	d.setUTCFullYear(d.getUTCFullYear() + 1);
	d.setUTCDate(d.getUTCDate() - 1);
	return { od, do: d.toISOString().slice(0, 10) };
}

// Koniec dnia w Warszawie (z uwzględnieniem czasu letniego) jako znacznik UTC.
export function koniecDniaWarszawa(data: string): string {
	const poludnie = new Date(`${data}T12:00:00Z`);
	const godzWarszawa = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hourCycle: 'h23' }).format(poludnie));
	const przesuniecie = godzWarszawa - 12;
	return new Date(Date.parse(`${data}T23:59:59Z`) - przesuniecie * 3_600_000).toISOString();
}

// ---------- Polisa w programie OC beauty ----------

export type PolisaProgramu = {
	id: string;
	tenant_id: string;
	klient_id: string;
	nr_polisy: string | null;
	data_od: string | null;
	data_do: string;
	skladka_przypisana: number | null;
	suma_gwarancyjna: number | null;
	program_nr: string;
	tu_nazwa: string | null;
	klient: { id: string; nazwa: string; email: string | null; opiekun_id: string | null };
};

// Wczytuje certyfikat z programu OC beauty (umowa generalna ug_podtyp = oc_beauty) i sprawdza,
// czy można dla niego otworzyć wniosek o odnowienie. Rzuca 400/404 z komunikatem dla pracownika.
export async function polisaProgramu(admin: SupabaseClient, tenantId: string, polisaId: string): Promise<PolisaProgramu> {
	if (!UUID.test(polisaId ?? '')) throw error(400, { message: 'Nieprawidłowa polisa.' });
	const { data: p, error: e1 } = await admin
		.from('crm_policies')
		.select('id, tenant_id, klient_id, nr_polisy, data_od, data_do, skladka_przypisana, suma_gwarancyjna, parent_id, deleted_at, crm_insurers(nazwa)')
		.eq('id', polisaId)
		.eq('tenant_id', tenantId)
		.maybeSingle();
	if (e1) throw error(500, { message: 'Nie udało się wczytać polisy.' });
	if (!p || p.deleted_at) throw error(404, { message: 'Nie znaleziono polisy.' });
	if (!p.parent_id) throw error(400, { message: 'Wniosek o odnowienie dotyczy certyfikatów z programu OC beauty.' });

	const { data: ug } = await admin
		.from('crm_policies')
		.select('nr_polisy, typ_umowy, ug_podtyp, tenant_id')
		.eq('id', p.parent_id)
		.maybeSingle();
	if (!ug || ug.tenant_id !== tenantId || ug.typ_umowy !== 'generalna' || ug.ug_podtyp !== 'oc_beauty') {
		throw error(400, { message: 'Wniosek o odnowienie dotyczy certyfikatów z programu OC beauty.' });
	}
	if (!p.data_do) throw error(400, { message: 'Polisa nie ma daty końca ochrony.' });

	const { data: nastepca } = await admin
		.from('crm_policies')
		.select('id')
		.eq('renewal_of', p.id)
		.is('deleted_at', null)
		.limit(1);
	if (nastepca?.length) throw error(400, { message: 'Ta polisa została już odnowiona w CRM.' });

	const { data: klient } = await admin
		.from('crm_clients')
		.select('id, nazwa, email, opiekun_id, tenant_id')
		.eq('id', p.klient_id)
		.maybeSingle();
	if (!klient || klient.tenant_id !== tenantId) throw error(400, { message: 'Polisa nie ma klienta.' });

	const insurer = Array.isArray(p.crm_insurers) ? p.crm_insurers[0] : p.crm_insurers;
	// Numer programu bez dopisku roku („WA50/003353/24/A_2026” → „WA50/003353/24/A”).
	const programNr = String(ug.nr_polisy ?? '').replace(/_\d{4}$/, '');
	return {
		id: p.id,
		tenant_id: p.tenant_id,
		klient_id: p.klient_id,
		nr_polisy: p.nr_polisy,
		data_od: p.data_od,
		data_do: p.data_do,
		skladka_przypisana: p.skladka_przypisana,
		suma_gwarancyjna: p.suma_gwarancyjna,
		program_nr: programNr,
		tu_nazwa: (insurer as { nazwa?: string } | null)?.nazwa ?? null,
		klient: { id: klient.id, nazwa: klient.nazwa, email: EMAIL_RE.test(klient.email ?? '') ? klient.email!.trim() : null, opiekun_id: klient.opiekun_id }
	};
}

// Tworzy wniosek (status „utworzony”). Gdy polisa ma aktywny wniosek: przy `zastap` unieważnia go,
// inaczej rzuca 409 { aktywny: true }.
export async function utworzOdnowienie(
	admin: SupabaseClient,
	p: PolisaProgramu,
	o: { zastap?: boolean; utworzyl?: string | null }
): Promise<RenewalRow> {
	const { data: aktywne } = await admin
		.from('crm_renewals')
		.select('id, status')
		.eq('polisa_id', p.id)
		.not('status', 'in', '(wygasl,anulowany)');
	if (aktywne?.length) {
		if (!o.zastap) throw error(409, { message: 'Ta polisa ma już aktywny wniosek o odnowienie.', aktywny: true } as App.Error);
		for (const a of aktywne) {
			await admin.from('crm_renewals').update({ status: 'anulowany', updated_at: new Date().toISOString() }).eq('id', a.id);
			await zapiszZdarzenie(admin, { id: a.id, tenant_id: p.tenant_id }, 'anulowanie', null, { powod: 'zastąpiony nowym wnioskiem', przez: o.utworzyl ?? null });
		}
	}

	const minWaznosc = Date.now() + 14 * 86_400_000;
	const koniec = koniecDniaWarszawa(p.data_do);
	const wazny_do = Date.parse(koniec) > minWaznosc ? koniec : new Date(minWaznosc).toISOString();
	const test = trybTestowy(await ustawieniaFirmy(admin, p.tenant_id));

	const { data, error: e } = await admin
		.from('crm_renewals')
		.insert({
			tenant_id: p.tenant_id,
			polisa_id: p.id,
			klient_id: p.klient_id,
			status: 'utworzony',
			email: test ? adresTestowy() : p.klient.email,
			nr_polisy: p.nr_polisy,
			tu_nazwa: p.tu_nazwa,
			program: `Program Ubezpieczenia OC nr ${p.program_nr}`,
			klient_nazwa: p.klient.nazwa,
			suma: p.suma_gwarancyjna,
			skladka: p.skladka_przypisana,
			okres_od: p.data_od,
			okres_do: p.data_do,
			wazny_do,
			created_by: o.utworzyl ?? null
		})
		.select('*')
		.single();
	if (e || !data) {
		if (e?.code === '23505') throw error(409, { message: 'Ta polisa ma już aktywny wniosek o odnowienie.', aktywny: true } as App.Error);
		throw error(500, { message: 'Nie udało się utworzyć wniosku.' });
	}
	await zapiszZdarzenie(admin, data, 'utworzenie', null, { przez: o.utworzyl ?? 'automat' });
	if (test) await zapiszZdarzenie(admin, data, 'tryb_testowy', null, { adres: adresTestowy() });
	return data as RenewalRow;
}

// ---------- Dziennik zdarzeń ----------

export type Klient = { ip: string | null; ua: string | null };

export function klientZadania(request: Request, getClientAddress?: () => string): Klient {
	let ip = request.headers.get('cf-connecting-ip');
	if (!ip && getClientAddress) {
		try {
			ip = getClientAddress();
		} catch {
			ip = null;
		}
	}
	return { ip: ip?.slice(0, 64) ?? null, ua: request.headers.get('user-agent')?.slice(0, 500) ?? null };
}

export async function zapiszZdarzenie(
	admin: SupabaseClient,
	r: { id: string; tenant_id: string },
	zdarzenie: string,
	kto: Klient | null,
	szczegoly: Record<string, unknown> | null = null
) {
	const { error: e } = await admin.from('crm_renewal_events').insert({
		renewal_id: r.id,
		tenant_id: r.tenant_id,
		zdarzenie,
		ip: kto?.ip ?? null,
		user_agent: kto?.ua ?? null,
		szczegoly
	});
	if (e) console.error(`renewals: zdarzenie ${zdarzenie} nie zapisane: ${e.message}`);
}

// ---------- Wczytanie po kluczu (strona klienta) ----------

export async function odnowieniePoKluczu(admin: SupabaseClient, klucz: string): Promise<RenewalRow | null> {
	const id = await sprawdzKlucz(klucz);
	if (!id) return null;
	const { data } = await admin.from('crm_renewals').select('*').eq('id', id).maybeSingle();
	if (!data) return null;
	const r = data as RenewalRow;
	// Link po terminie gaśnie przy pierwszym użyciu (i w zadaniu dziennym).
	if ((AKTYWNE as readonly string[]).includes(r.status) && Date.parse(r.wazny_do) < Date.now()) {
		await admin.from('crm_renewals').update({ status: 'wygasl', updated_at: new Date().toISOString() }).eq('id', r.id).in('status', [...AKTYWNE]);
		r.status = 'wygasl';
	}
	if ((AKTYWNE as readonly string[]).includes(r.status) && (await anulujNieaktualny(admin, r))) r.status = 'anulowany';
	return r;
}

// Certyfikat odnowiony w CRM inną drogą (polisa z renewal_of) albo usunięty: wniosek online jest
// nieaktualny — anulujemy go, żeby klient nie składał wniosku i nie dostawał przypomnień.
export async function anulujNieaktualny(admin: SupabaseClient, r: Pick<RenewalRow, 'id' | 'tenant_id' | 'polisa_id'>): Promise<boolean> {
	const [{ data: nastepca }, { data: polisa }] = await Promise.all([
		admin.from('crm_policies').select('id').eq('renewal_of', r.polisa_id).is('deleted_at', null).limit(1),
		admin.from('crm_policies').select('id, deleted_at').eq('id', r.polisa_id).maybeSingle()
	]);
	const powod = nastepca?.length ? 'polisa odnowiona w CRM' : !polisa || polisa.deleted_at ? 'polisa usunięta' : null;
	if (!powod) return false;
	const { data } = await admin
		.from('crm_renewals')
		.update({ status: 'anulowany', updated_at: new Date().toISOString() })
		.eq('id', r.id)
		.in('status', [...AKTYWNE])
		.select('id');
	if (data?.length) await zapiszZdarzenie(admin, r, 'anulowanie', null, { powod, przez: 'automat' });
	return true;
}

export const czyAktywny = (r: RenewalRow) => (AKTYWNE as readonly string[]).includes(r.status);

// Pliki w folderze wniosku, których nie ma na liście załączników (usunięte z listy albo wgrane
// jednorazowym adresem po złożeniu) — kasujemy, żeby nie zostawały w magazynie bez śladu w CRM.
export async function usunSierotyPlikow(admin: SupabaseClient, r: Pick<RenewalRow, 'id' | 'tenant_id' | 'zalaczniki'>): Promise<number> {
	const folder = `${r.tenant_id}/${r.id}`;
	const { data: pliki } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
	const zostaja = new Set([...(r.zalaczniki ?? []).map((z) => z.path.split('/').pop()), 'wniosek-odnowienia.pdf']);
	const sieroty = (pliki ?? []).filter((p) => p.id && !zostaja.has(p.name)).map((p) => `${folder}/${p.name}`);
	if (sieroty.length) await admin.storage.from(BUCKET).remove(sieroty);
	return sieroty.length;
}

// Obecna suma gwarancyjna: z polisy, a gdy jej brak — odczytana ze składki (tylko jednoznacznie).
export const sumaObecna = (r: Pick<RenewalRow, 'suma' | 'skladka'>): number | null =>
	r.suma != null ? Number(r.suma) : sumaZeSkladki(r.skladka != null ? Number(r.skladka) : null);
// Czy obecny certyfikat ma już ochronę prawną (składka = stawka z tabeli + 92 zł).
export const opObecnie = (r: Pick<RenewalRow, 'suma' | 'skladka'>): boolean =>
	ochronaPrawnaWSkladce(r.skladka != null ? Number(r.skladka) : null, sumaObecna(r));

export function widok(r: RenewalRow): WidokOdnowienia {
	if (r.status === 'anulowany') return { stan: 'anulowany' };
	if (r.status === 'wygasl') return { stan: 'wygasl' };
	if (r.status === 'zlozony') {
		return { stan: 'zlozony', klient: r.klient_nazwa ?? '', nr_polisy: r.nr_polisy, decyzja: r.decyzja as 'bez_zmian', zlozono_at: r.zlozono_at ?? '' };
	}
	return {
		stan: 'aktywny',
		status: r.status as 'otwarty',
		klient: r.klient_nazwa ?? '',
		nr_polisy: r.nr_polisy,
		ubezpieczyciel: r.tu_nazwa,
		program: r.program,
		suma: sumaObecna(r),
		skladka: r.skladka,
		okres_obecny: { od: r.okres_od, do: r.okres_do },
		okres_nowy: nowyOkres(r.okres_do ?? dzisWarszawa()),
		wazny_do: r.wazny_do,
		apk_wypelniona: !!r.apk_at && !r.apk_odmowa,
		apk_odmowa: r.apk_odmowa,
		ochrona_prawna_obecnie: opObecnie(r),
		apk: r.apk_odmowa ? null : r.apk,
		zalaczniki: (r.zalaczniki ?? []).map(({ id, typ, nazwa, rozmiar, mime }) => ({ id, typ, nazwa, rozmiar, mime }))
	};
}

// Zapis z kontrolą wersji (updated_at): dwa równoległe żądania klienta nie nadpiszą sobie zmian.
export async function zapiszZWersja(
	admin: SupabaseClient,
	r: RenewalRow,
	zmiany: Partial<RenewalRow>
): Promise<RenewalRow | null> {
	const { data } = await admin
		.from('crm_renewals')
		.update({ ...zmiany, updated_at: new Date().toISOString() })
		.eq('id', r.id)
		.eq('updated_at', r.updated_at)
		.in('status', [...AKTYWNE])
		.select('*')
		.maybeSingle();
	return (data as RenewalRow) ?? null;
}

export async function ustawieniaFirmy(admin: SupabaseClient, tenantId: string) {
	const { data } = await admin.from('crm_tenants').select('id, nazwa, resend_api_key, features').eq('id', tenantId).maybeSingle();
	return data as { id: string; nazwa: string; resend_api_key: string | null; features: Record<string, boolean> | null } | null;
}

export const nadawca = () => env.RENEWAL_EMAIL_FROM || 'BeautyPolisa <odnowienia@beautypolisa.eu>';
export const biuro = () => env.RENEWAL_OFFICE_EMAIL || 'odnowienia@auraexpert.pl';

// Tryb testowy (moduł „odnowienia_test” w SAAS Admin): każdy e-mail odnowień — do klienta i do biura —
// trafia na adres testowy, z dopiskiem [TEST] w temacie. Wniosek utworzony w trybie testowym ma
// adres testowy zapisany zamiast adresu klienta, więc nie napisze do klienta także po wyłączeniu trybu.
export const adresTestowy = () => env.RENEWAL_TEST_EMAIL || ADRES_TESTOWY;
export const trybTestowy = (firma: { features?: Record<string, boolean> | null } | null) => firma?.features?.odnowienia_test === true;
// Wniosek jest testowy, gdy firma ma włączony tryb albo wniosek powstał w trybie testowym (adres testowy).
export const czyTest = (firma: { features?: Record<string, boolean> | null } | null, r: Pick<RenewalRow, 'email'>) =>
	trybTestowy(firma) || (!!r.email && r.email.trim().toLowerCase() === adresTestowy().trim().toLowerCase());
export const PREFIKS_TESTU = '[TEST] ';
