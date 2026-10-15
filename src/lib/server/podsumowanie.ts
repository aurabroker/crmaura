// Codzienne podsumowanie na e-mail pracownika (Ustawienia → Powiadomienia): nowe leady, odnowienia, e-maile
// do klientów, płatności, zadania i nowości w CRM — od poprzedniego podsumowania (najwyżej 3 dni wstecz,
// inaczej ostatnia doba). Wysyła automat co godzinę (/api/cron/podsumowanie) o godzinie wybranej przez
// pracownika albo „Wyślij teraz” z Ustawień. Wychodzi kluczem Resend firmy, zawsze na adres z profilu.
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMAIL_RE, bezAdresow, esc, wyslijEmail, type Wiadomosc, type WynikWysylki } from './mail';
import { ustawieniaWysylki } from './emailKlienta';
import { adresTestowy, dodajDni } from './renewals';
import { ETYKIETA_ZAINTERESOWANIA, ZRODLO_LEADA } from '$lib/sprzedaz';
import { STATUS_ODNOWIENIA_ETYKIETA, etykietaDecyzji } from '$lib/renewals/staffApi';

export const SEKCJE = [
	['leady', 'Nowe leady i ponowne zgłoszenia'],
	['odnowienia', 'Odnowienia — polisy kończące się w 30 dni i wnioski klientów'],
	['maile', 'E-maile wysłane do klientów i ich doręczenie'],
	['platnosci', 'Płatności — raty po terminie, zbliżające się i zaksięgowane'],
	['zadania', 'Twoje zadania na dziś i po terminie'],
	['nowosci', 'Nowe polisy, klienci, szkody i formularze APK']
] as const;
export type Sekcja = (typeof SEKCJE)[number][0];
export const DOMYSLNE_SEKCJE: Record<Sekcja, boolean> = { leady: true, odnowienia: true, maile: true, platnosci: true, zadania: true, nowosci: true };

export type Subskrypcja = {
	id: string;
	tenant_id: string;
	profile_id: string;
	godzina: number;
	sekcje: Partial<Record<Sekcja, boolean>>;
	aktywne: boolean;
	pomin_puste: boolean;
	ostatnio_wyslano_at: string | null;
	ostatni_blad: string | null;
};

const NAJDALEJ_WSTECZ_H = 72;
const DNI_ODNOWIEN = 30;
const DNI_PLATNOSCI = 7;
const ROZLICZONE = ['Opłacona', 'Częściowo opłacona'];
const RODZAJ_MAILA: Record<string, string> = { przypomnienie_platnosci: 'przypomnienie o płatności', odnowienie: 'odnowienie', recznie: 'z Panelu 360°', polisa: 'polisa', inne: 'inny' };
const DOSTAWA: Record<string, string> = { wyslany: 'wysłany', opozniony: 'opóźniony', dostarczony: 'dostarczony', otwarty: 'otwarty', klikniety: 'kliknięty', odbity: 'odbity', spam: 'spam', blad: 'błąd' };
const ZADANIA_OTWARTE = ['otwarte', 'w_toku', 'Oczekujące'];

/** Godzina warszawska (0–23) dla podanej chwili. */
export function godzinaWarszawa(t = new Date()): number {
	return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false }).format(t)) % 24;
}
/** Data warszawska (RRRR-MM-DD) dla chwili. */
export const dataWarszawa = (t: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(t);
const dzien = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '—');
const godz = (iso: string) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const zl = (n: number | string | null | undefined) => `${Math.round(Number(n ?? 0)).toLocaleString('pl-PL')} zł`;
const odmiana = (n: number, jeden: string, kilka: string, wiele: string) => {
	const d = n % 10;
	const s = n % 100;
	return `${n} ${n === 1 ? jeden : d >= 2 && d <= 4 && (s < 12 || s > 14) ? kilka : wiele}`;
};
const dniDo = (dzis: string, data: string) => Math.round((Date.parse(`${data}T12:00:00Z`) - Date.parse(`${dzis}T12:00:00Z`)) / 86_400_000);
const nazwa = (k: { nazwa?: string | null; nazwa_skrocona?: string | null } | null | undefined) => k?.nazwa_skrocona || k?.nazwa || '—';

/** Początek okresu: poprzednie podsumowanie, ale nie dawniej niż 3 dni; bez poprzedniego — ostatnia doba. */
export function poczatekOkresu(s: Pick<Subskrypcja, 'ostatnio_wyslano_at'>, teraz: Date): string {
	const doba = teraz.getTime() - 24 * 3_600_000;
	const ost = s.ostatnio_wyslano_at ? Date.parse(s.ostatnio_wyslano_at) : NaN;
	if (Number.isNaN(ost)) return new Date(doba).toISOString();
	return new Date(Math.max(ost, teraz.getTime() - NAJDALEJ_WSTECZ_H * 3_600_000)).toISOString();
}

type Lead = { id: string; nazwa: string; zrodlo: string | null; branza: string | null; zainteresowania: string[] | null; liczba_zgloszen: number | null; status: string; created_at: string; ostatnie_zgloszenie_at: string | null };
type PolisaK = { id: string; nr_polisy: string; data_do: string; rodzaj: string | null; skladka_przypisana: number | null; crm_clients: { nazwa: string; nazwa_skrocona?: string | null } | null };
type Wniosek = { id: string; polisa_id: string | null; rodzaj: string | null; nr_polisy: string | null; klient_nazwa: string | null; status: string; decyzja: string | null; email: string | null; updated_at: string; okres_do: string | null };
type Mail = { id: string; rodzaj: string; adres: string; temat: string; dostawa: string | null; wyslano_at: string; klient_id: string; crm_clients: { nazwa: string; nazwa_skrocona?: string | null } | null };
type Rata = { id: string; nr_raty: number; data_platnosci: string; kwota: number; status: string; data_oplacenia: string | null; polisa_id: string; crm_policies: { nr_polisy: string; typ_umowy: string | null; rozliczaj_platnosci: boolean | null; crm_clients: { nazwa: string; nazwa_skrocona?: string | null } | null } | null };
type Zadanie = { id: string; tytul: string; termin: string | null; priorytet: string | null; assigned_to: string | null; extra_assignees: string[] | null; crm_clients: { nazwa: string; nazwa_skrocona?: string | null } | null };
type NowaPolisa = { id: string; nr_polisy: string; rodzaj: string | null; data_od: string | null; skladka_przypisana: number | null; crm_clients: { nazwa: string; nazwa_skrocona?: string | null } | null; crm_insurers: { skrot: string | null; nazwa: string } | null };
type NowyKlient = { id: string; nazwa: string; typ: string | null };
type Szkoda = { id: string; nr_szkody: string | null; status: string; wartosc_roszczenia: number | null; crm_clients: { nazwa: string; nazwa_skrocona?: string | null } | null };
type Apk = { id: string; ref_number: string | null; client_name: string | null; client_declined: boolean | null; submitted_at: string | null };

export type Dane = {
	od: string;
	dzis: string;
	leady?: Lead[];
	odnowienia?: { konczace: PolisaK[]; konczaceRazem: number; wnioski: Wniosek[] };
	maile?: Mail[];
	platnosci?: { poTerminie: Rata[]; nowoPoTerminie: Rata[]; sumaPoTerminie: number; zblizajace: Rata[]; sumaZblizajacych: number; zaksiegowane: Rata[]; sumaZaksiegowanych: number };
	zadania?: { moje: Zadanie[]; wFirmie: number };
	nowosci?: { polisy: NowaPolisa[]; klienci: NowyKlient[]; szkody: Szkoda[]; apk: Apk[] };
};

const aktywne = (s: Partial<Record<Sekcja, boolean>>, k: Sekcja) => s[k] ?? DOMYSLNE_SEKCJE[k];

export async function zbierzDane(admin: SupabaseClient, tenantId: string, profilId: string, sekcje: Partial<Record<Sekcja, boolean>>, od: string, dzis: string): Promise<Dane> {
	const d: Dane = { od, dzis };
	const odDzien = od.slice(0, 10);
	// Umowa generalna to ramka — przypis i odnowienia są na polisach pod nią (typ_umowy bywa NULL).
	const BEZ_UG = 'typ_umowy.is.null,typ_umowy.neq.generalna';

	if (aktywne(sekcje, 'leady')) {
		const { data } = await admin.from('crm_prospects')
			.select('id, nazwa, zrodlo, branza, zainteresowania, liczba_zgloszen, status, created_at, ostatnie_zgloszenie_at')
			.eq('tenant_id', tenantId)
			.or(`created_at.gte.${od},ostatnie_zgloszenie_at.gte.${od}`)
			.order('created_at', { ascending: false })
			.limit(50);
		d.leady = (data ?? []) as Lead[];
	}

	if (aktywne(sekcje, 'odnowienia')) {
		const [{ data: pol }, { data: odn }, { data: wn }] = await Promise.all([
			admin
				.from('crm_policies')
				.select('id, nr_polisy, data_do, rodzaj, skladka_przypisana, crm_clients!klient_id(nazwa, nazwa_skrocona)')
				.eq('tenant_id', tenantId)
				.is('deleted_at', null)
				.or(BEZ_UG)
				.gte('data_do', dzis)
				.lte('data_do', dodajDni(dzis, DNI_ODNOWIEN))
				.order('data_do')
				.limit(300),
			admin.from('crm_policies').select('renewal_of').eq('tenant_id', tenantId).is('deleted_at', null).not('renewal_of', 'is', null).limit(5000),
			admin
				.from('crm_renewals')
				.select('id, polisa_id, rodzaj, nr_polisy, klient_nazwa, status, decyzja, email, updated_at, okres_do')
				.eq('tenant_id', tenantId)
				.gte('updated_at', od)
				.order('updated_at', { ascending: false })
				.limit(50)
		]);
		const odnowione = new Set(((odn ?? []) as { renewal_of: string }[]).map((x) => x.renewal_of));
		const konczace = ((pol ?? []) as unknown as PolisaK[]).filter((p) => !odnowione.has(p.id));
		const test = adresTestowy().trim().toLowerCase();
		d.odnowienia = {
			konczace: konczace.slice(0, 15),
			konczaceRazem: konczace.length,
			wnioski: ((wn ?? []) as Wniosek[]).filter((w) => (w.email ?? '').trim().toLowerCase() !== test)
		};
	}

	if (aktywne(sekcje, 'maile')) {
		const { data } = await admin
			.from('crm_client_emails')
			.select('id, rodzaj, adres, temat, dostawa, wyslano_at, klient_id, crm_clients!klient_id(nazwa, nazwa_skrocona)')
			.eq('tenant_id', tenantId)
			.gte('wyslano_at', od)
			.order('wyslano_at', { ascending: false })
			.limit(60);
		d.maile = (data ?? []) as unknown as Mail[];
	}

	if (aktywne(sekcje, 'platnosci')) {
		const kolumny = 'id, nr_raty, data_platnosci, kwota, status, data_oplacenia, polisa_id, crm_policies!inner(nr_polisy, typ_umowy, rozliczaj_platnosci, deleted_at, crm_clients!klient_id(nazwa, nazwa_skrocona))';
		const baza = () => admin.from('crm_policy_payments').select(kolumny).eq('tenant_id', tenantId).is('crm_policies.deleted_at', null);
		const [{ data: po }, { data: zb }, { data: za }] = await Promise.all([
			baza().in('status', ['Zaległa', 'Oczekująca']).lt('data_platnosci', dzis).order('data_platnosci').limit(1000),
			baza().eq('status', 'Oczekująca').gte('data_platnosci', dzis).lte('data_platnosci', dodajDni(dzis, DNI_PLATNOSCI)).order('data_platnosci').limit(200),
			baza().in('status', ROZLICZONE).gte('data_oplacenia', odDzien).order('data_oplacenia', { ascending: false }).limit(100)
		]);
		// UG bez rozliczania płatności ma raty tylko informacyjne — tak jak w Płatnościach.
		const liczona = (r: Rata) => !(r.crm_policies?.typ_umowy === 'generalna' && !r.crm_policies?.rozliczaj_platnosci);
		const poTerminie = ((po ?? []) as unknown as Rata[]).filter(liczona);
		const zblizajace = ((zb ?? []) as unknown as Rata[]).filter(liczona);
		const zaksiegowane = ((za ?? []) as unknown as Rata[]).filter(liczona);
		const suma = (l: Rata[]) => l.reduce((s, r) => s + Number(r.kwota ?? 0), 0);
		d.platnosci = {
			poTerminie,
			nowoPoTerminie: poTerminie.filter((r) => r.data_platnosci >= odDzien),
			sumaPoTerminie: suma(poTerminie),
			zblizajace,
			sumaZblizajacych: suma(zblizajace),
			zaksiegowane,
			sumaZaksiegowanych: suma(zaksiegowane)
		};
	}

	if (aktywne(sekcje, 'zadania')) {
		const { data } = await admin
			.from('crm_tasks')
			.select('id, tytul, termin, priorytet, assigned_to, extra_assignees, crm_clients(nazwa, nazwa_skrocona)')
			.eq('tenant_id', tenantId)
			.in('status', ZADANIA_OTWARTE)
			.lte('termin', dzis)
			.order('termin')
			.limit(500);
		const wszystkie = (data ?? []) as unknown as Zadanie[];
		d.zadania = { moje: wszystkie.filter((z) => z.assigned_to === profilId || (z.extra_assignees ?? []).includes(profilId)).slice(0, 30), wFirmie: wszystkie.length };
	}

	if (aktywne(sekcje, 'nowosci')) {
		const [{ data: pol }, { data: kl }, { data: sz }, { data: apk }] = await Promise.all([
			admin
				.from('crm_policies')
				.select('id, nr_polisy, rodzaj, data_od, skladka_przypisana, crm_clients!klient_id(nazwa, nazwa_skrocona), crm_insurers(skrot, nazwa)')
				.eq('tenant_id', tenantId)
				.is('deleted_at', null)
				.or(BEZ_UG)
				.gte('created_at', od)
				.order('created_at', { ascending: false })
				.limit(40),
			admin.from('crm_clients').select('id, nazwa, typ').eq('tenant_id', tenantId).gte('created_at', od).order('created_at', { ascending: false }).limit(40),
			admin.from('crm_claims').select('id, nr_szkody, status, wartosc_roszczenia, crm_clients(nazwa, nazwa_skrocona)').eq('tenant_id', tenantId).gte('created_at', od).order('created_at', { ascending: false }).limit(20),
			admin.from('apk_forms').select('id, ref_number, client_name, client_declined, submitted_at').eq('tenant_id', tenantId).gte('submitted_at', od).order('submitted_at', { ascending: false }).limit(40)
		]);
		d.nowosci = { polisy: (pol ?? []) as unknown as NowaPolisa[], klienci: (kl ?? []) as NowyKlient[], szkody: (sz ?? []) as unknown as Szkoda[], apk: (apk ?? []) as Apk[] };
	}
	return d;
}

/** Czy w danych jest cokolwiek nowego (do opcji „nie wysyłaj, gdy nic nowego”). */
export function cosNowego(d: Dane): boolean {
	return !!(
		d.leady?.length ||
		d.odnowienia?.wnioski.length ||
		d.odnowienia?.konczace.some((p) => dniDo(d.dzis, p.data_do) <= 7) ||
		d.maile?.length ||
		d.platnosci?.nowoPoTerminie.length ||
		d.platnosci?.zaksiegowane.length ||
		d.zadania?.moje.length ||
		d.nowosci?.polisy.length ||
		d.nowosci?.klienci.length ||
		d.nowosci?.szkody.length ||
		d.nowosci?.apk.length
	);
}

// ---------- Treść ----------

type Blok = { tytul: string; licznik: string; html: string; tekst: string; href: string };

const KOLOR = { tlo: '#f5f6f8', ink: '#121826', ink2: '#3d4758', ink3: '#5E6A7E', akcent: '#2453D6', naglowek: '#2a3b69', linia: '#e5e7eb', ok: '#067647', zly: '#B42318' };

function lista(wiersze: { glowne: string; opis?: string; prawa?: string }[], pusto: string): { html: string; tekst: string } {
	if (!wiersze.length) return { html: `<p style="margin:0;font-size:13px;color:${KOLOR.ink3};">${esc(pusto)}</p>`, tekst: pusto };
	const html = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${wiersze
		.map(
			(w) =>
				`<tr><td style="padding:6px 0;border-top:1px solid ${KOLOR.linia};font-size:13px;line-height:1.45;color:${KOLOR.ink};">${esc(w.glowne)}${w.opis ? `<br><span style="font-size:12px;color:${KOLOR.ink3};">${esc(w.opis)}</span>` : ''}</td>${w.prawa != null ? `<td align="right" valign="top" style="padding:6px 0 6px 12px;border-top:1px solid ${KOLOR.linia};font-size:13px;white-space:nowrap;color:${KOLOR.ink2};">${esc(w.prawa)}</td>` : ''}</tr>`
		)
		.join('')}</table>`;
	const tekst = wiersze.map((w) => `- ${w.glowne}${w.prawa ? ` — ${w.prawa}` : ''}${w.opis ? ` (${w.opis})` : ''}`).join('\n');
	return { html, tekst };
}

function blokLeadow(d: Dane, crm: string): Blok | null {
	if (!d.leady) return null;
	const nowe = d.leady.filter((l) => l.created_at >= d.od);
	const ponowne = d.leady.filter((l) => l.created_at < d.od);
	const w = (l: Lead, ponowny: boolean) => ({
		glowne: `${l.nazwa}${ponowny ? ` — ponowne zgłoszenie (${l.liczba_zgloszen ?? 2}×)` : ''}`,
		opis: [ZRODLO_LEADA[l.zrodlo ?? ''] ?? l.zrodlo, l.branza, (l.zainteresowania ?? []).map((z) => ETYKIETA_ZAINTERESOWANIA[z] ?? z).join(', ')].filter(Boolean).join(' · '),
		prawa: godz(ponowny ? (l.ostatnie_zgloszenie_at ?? l.created_at) : l.created_at)
	});
	const l = lista([...nowe.map((x) => w(x, false)), ...ponowne.map((x) => w(x, true))], 'Brak nowych leadów.');
	return { tytul: 'Leady', licznik: nowe.length || ponowne.length ? `${odmiana(nowe.length, 'nowy', 'nowe', 'nowych')}${ponowne.length ? ` · ${odmiana(ponowne.length, 'ponowne zgłoszenie', 'ponowne zgłoszenia', 'ponownych zgłoszeń')}` : ''}` : 'brak', ...l, href: `${crm}/prospects` };
}

function blokOdnowien(d: Dane, crm: string): Blok | null {
	const o = d.odnowienia;
	if (!o) return null;
	const wnioski = lista(
		o.wnioski.map((w) => ({
			glowne: `${w.klient_nazwa ?? '—'} · ${w.rodzaj === 'nowa' ? 'pierwsza polisa' : (w.nr_polisy ?? '')}`,
			opis: `${STATUS_ODNOWIENIA_ETYKIETA[w.status] ?? w.status}${w.decyzja ? ` — ${etykietaDecyzji(w.decyzja, w.rodzaj)}` : ''}`,
			prawa: godz(w.updated_at)
		})),
		'Brak zmian we wnioskach klientów.'
	);
	const konczace = lista(
		o.konczace.map((p) => {
			const n = dniDo(d.dzis, p.data_do);
			return { glowne: `${nazwa(p.crm_clients)} · ${p.nr_polisy}`, opis: `${(p.rodzaj ?? '').replace(/_/g, ' ')} · składka ${zl(p.skladka_przypisana)}`, prawa: n === 0 ? 'kończy się dziś' : `za ${odmiana(n, 'dzień', 'dni', 'dni')} (${dzien(p.data_do)})` };
		}),
		`Żadna polisa nie kończy się w ciągu ${DNI_ODNOWIEN} dni.`
	);
	const html = `<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${KOLOR.ink3};text-transform:uppercase;letter-spacing:.04em;">Wnioski klientów (zmiany)</p>${wnioski.html}<p style="margin:14px 0 6px;font-size:12px;font-weight:700;color:${KOLOR.ink3};text-transform:uppercase;letter-spacing:.04em;">Kończą się w ciągu ${DNI_ODNOWIEN} dni${o.konczaceRazem > o.konczace.length ? ` (pierwsze ${o.konczace.length} z ${o.konczaceRazem})` : ''}</p>${konczace.html}`;
	const tekst = `Wnioski klientów (zmiany):\n${wnioski.tekst}\n\nKończą się w ciągu ${DNI_ODNOWIEN} dni (${o.konczaceRazem}):\n${konczace.tekst}`;
	return { tytul: 'Odnowienia', licznik: `${odmiana(o.wnioski.length, 'zmiana wniosku', 'zmiany wniosków', 'zmian wniosków')} · ${odmiana(o.konczaceRazem, 'polisa', 'polisy', 'polis')} do odnowienia`, html, tekst, href: `${crm}/renewals` };
}

function blokMaili(d: Dane, crm: string): Blok | null {
	if (!d.maile) return null;
	const l = lista(
		d.maile.map((m) => ({ glowne: `${nazwa(m.crm_clients)} — ${m.temat}`, opis: `${RODZAJ_MAILA[m.rodzaj] ?? m.rodzaj} · ${m.adres}`, prawa: `${godz(m.wyslano_at)} · ${m.dostawa ? (DOSTAWA[m.dostawa] ?? m.dostawa) : 'wysłany'}` })),
		'Nie wysłano żadnego e-maila do klientów.'
	);
	const problemy = d.maile.filter((m) => m.dostawa === 'odbity' || m.dostawa === 'blad' || m.dostawa === 'spam').length;
	return { tytul: 'E-maile do klientów', licznik: `${odmiana(d.maile.length, 'wysłany', 'wysłane', 'wysłanych')}${problemy ? ` · ${odmiana(problemy, 'niedoręczony', 'niedoręczone', 'niedoręczonych')}` : ''}`, ...l, href: `${crm}/clients` };
}

function blokPlatnosci(d: Dane, crm: string): Blok | null {
	const p = d.platnosci;
	if (!p) return null;
	const wiersz = (r: Rata, prawa: string) => ({ glowne: `${nazwa(r.crm_policies?.crm_clients)} · ${r.crm_policies?.nr_polisy ?? ''} · rata ${r.nr_raty}`, opis: zl(r.kwota), prawa });
	const nowe = lista(p.nowoPoTerminie.slice(0, 15).map((r) => wiersz(r, `termin ${dzien(r.data_platnosci)}`)), 'Żadna rata nie przeterminowała się od ostatniego podsumowania.');
	const zbl = lista(p.zblizajace.slice(0, 15).map((r) => wiersz(r, `${dzien(r.data_platnosci)}`)), `Brak rat z terminem w ciągu ${DNI_PLATNOSCI} dni.`);
	const zak = lista(p.zaksiegowane.slice(0, 15).map((r) => wiersz(r, `opłacona ${dzien(r.data_oplacenia)}`)), 'Brak zaksięgowanych wpłat.');
	const sek = (t: string) => `<p style="margin:14px 0 6px;font-size:12px;font-weight:700;color:${KOLOR.ink3};text-transform:uppercase;letter-spacing:.04em;">${esc(t)}</p>`;
	const html = `<p style="margin:0;font-size:13px;color:${KOLOR.ink};">Po terminie razem: <strong style="color:${p.poTerminie.length ? KOLOR.zly : KOLOR.ok};">${odmiana(p.poTerminie.length, 'rata', 'raty', 'rat')} · ${zl(p.sumaPoTerminie)}</strong></p>${sek('Nowo po terminie')}${nowe.html}${sek(`Do zapłaty w ciągu ${DNI_PLATNOSCI} dni (${zl(p.sumaZblizajacych)})`)}${zbl.html}${sek(`Zaksięgowane wpłaty (${zl(p.sumaZaksiegowanych)})`)}${zak.html}`;
	const tekst = `Po terminie razem: ${p.poTerminie.length} rat, ${zl(p.sumaPoTerminie)}\n\nNowo po terminie:\n${nowe.tekst}\n\nDo zapłaty w ciągu ${DNI_PLATNOSCI} dni (${zl(p.sumaZblizajacych)}):\n${zbl.tekst}\n\nZaksięgowane wpłaty (${zl(p.sumaZaksiegowanych)}):\n${zak.tekst}`;
	return { tytul: 'Płatności', licznik: `${odmiana(p.poTerminie.length, 'rata', 'raty', 'rat')} po terminie · ${zl(p.sumaPoTerminie)}`, html, tekst, href: `${crm}/payments?filtr=po-terminie` };
}

function blokZadan(d: Dane, crm: string): Blok | null {
	const z = d.zadania;
	if (!z) return null;
	const l = lista(
		z.moje.map((t) => {
			const n = t.termin ? dniDo(d.dzis, t.termin) : 0;
			return { glowne: `${t.tytul}${t.priorytet === 'wysoki' ? ' (!)' : ''}`, opis: nazwa(t.crm_clients) !== '—' ? nazwa(t.crm_clients) : undefined, prawa: n === 0 ? 'dziś' : `po terminie ${odmiana(-n, 'dzień', 'dni', 'dni')}` };
		}),
		'Nie masz zadań na dziś ani po terminie.'
	);
	const dzisiaj = z.moje.filter((t) => t.termin === d.dzis).length;
	const po = z.moje.length - dzisiaj;
	return { tytul: 'Twoje zadania', licznik: `${odmiana(dzisiaj, 'na dziś', 'na dziś', 'na dziś')} · ${odmiana(po, 'po terminie', 'po terminie', 'po terminie')}${z.wFirmie > z.moje.length ? ` · w firmie łącznie ${z.wFirmie}` : ''}`, ...l, href: `${crm}/calendar` };
}

function blokNowosci(d: Dane, crm: string): Blok | null {
	const n = d.nowosci;
	if (!n) return null;
	const pol = lista(n.polisy.map((p) => ({ glowne: `${nazwa(p.crm_clients)} · ${p.nr_polisy}`, opis: `${(p.rodzaj ?? '').replace(/_/g, ' ')} · ${p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa ?? ''} · od ${dzien(p.data_od)}`, prawa: zl(p.skladka_przypisana) })), 'Brak nowych polis.');
	const kl = lista(n.klienci.map((k) => ({ glowne: k.nazwa, opis: k.typ === 'osoba' ? 'osoba' : 'firma' })), 'Brak nowych klientów.');
	const sz = lista(n.szkody.map((s) => ({ glowne: `${nazwa(s.crm_clients)} · ${s.nr_szkody ?? 'zgłoszenie'}`, opis: s.status, prawa: s.wartosc_roszczenia != null ? zl(s.wartosc_roszczenia) : undefined })), 'Brak nowych szkód.');
	const apk = lista(n.apk.map((a) => ({ glowne: `${a.client_name ?? '—'} · ${a.ref_number ?? ''}`, opis: a.client_declined ? 'odmowa klienta' : 'złożony', prawa: a.submitted_at ? godz(a.submitted_at) : undefined })), 'Brak złożonych formularzy APK.');
	const sek = (t: string) => `<p style="margin:14px 0 6px;font-size:12px;font-weight:700;color:${KOLOR.ink3};text-transform:uppercase;letter-spacing:.04em;">${esc(t)}</p>`;
	const html = `${sek('Nowe polisy').replace('margin:14px', 'margin:0')}${pol.html}${sek('Nowi klienci')}${kl.html}${sek('Nowe szkody')}${sz.html}${sek('Formularze APK')}${apk.html}`;
	const tekst = `Nowe polisy:\n${pol.tekst}\n\nNowi klienci:\n${kl.tekst}\n\nNowe szkody:\n${sz.tekst}\n\nFormularze APK:\n${apk.tekst}`;
	const suma = n.polisy.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0);
	return { tytul: 'Nowości w CRM', licznik: `${odmiana(n.polisy.length, 'polisa', 'polisy', 'polis')}${suma ? ` (${zl(suma)})` : ''} · ${odmiana(n.klienci.length, 'klient', 'klientów', 'klientów')} · ${odmiana(n.szkody.length, 'szkoda', 'szkody', 'szkód')} · ${odmiana(n.apk.length, 'APK', 'APK', 'APK')}`, html, tekst, href: `${crm}/policies` };
}

export function tresc(d: Dane, o: { firma: string; imie: string | null; crm: string; dataPl: string }): { temat: string; html: string; text: string; pusto: boolean } {
	const bloki = [blokLeadow, blokOdnowien, blokMaili, blokPlatnosci, blokZadan, blokNowosci].map((f) => f(d, o.crm)).filter((b): b is Blok => !!b);
	const pusto = !cosNowego(d);
	const powitanie = o.imie ? `Dzień dobry, ${o.imie.split(/\s+/)[0]}` : 'Dzień dobry';
	const okres = `od ${dzien(d.od)} ${godz(d.od)}`;
	const noweLeady = d.leady?.filter((l) => l.created_at >= d.od).length ?? 0;
	const ponowneLeady = (d.leady?.length ?? 0) - noweLeady;
	const skrot = [
		noweLeady ? odmiana(noweLeady, 'nowy lead', 'nowe leady', 'nowych leadów') : '',
		ponowneLeady ? odmiana(ponowneLeady, 'ponowne zgłoszenie', 'ponowne zgłoszenia', 'ponownych zgłoszeń') : '',
		d.odnowienia?.wnioski.length ? odmiana(d.odnowienia.wnioski.length, 'wniosek', 'wnioski', 'wniosków') : '',
		d.maile?.length ? odmiana(d.maile.length, 'e-mail', 'e-maile', 'e-maili') : '',
		d.platnosci?.nowoPoTerminie.length ? `${odmiana(d.platnosci.nowoPoTerminie.length, 'rata', 'raty', 'rat')} po terminie` : '',
		d.zadania?.moje.length ? odmiana(d.zadania.moje.length, 'zadanie', 'zadania', 'zadań') : '',
		d.nowosci?.polisy.length ? odmiana(d.nowosci.polisy.length, 'nowa polisa', 'nowe polisy', 'nowych polis') : ''
	].filter(Boolean);
	const temat = `Podsumowanie ${o.dataPl}: ${skrot.length ? skrot.join(', ') : 'nic nowego'}`;

	const html = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(temat)}</title></head>
<body style="margin:0;padding:0;background:${KOLOR.tlo};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${KOLOR.tlo};"><tr><td align="center" style="padding:24px 12px;">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#fff;border:1px solid ${KOLOR.linia};border-radius:8px;">
<tr><td style="background:${KOLOR.naglowek};padding:18px 24px;border-radius:8px 8px 0 0;">
<p style="margin:0;font-size:12px;color:#c7d2fe;">AuraCRM · ${esc(o.firma)}</p>
<h1 style="margin:4px 0 0;font-size:19px;color:#fff;">Podsumowanie dnia — ${esc(o.dataPl)}</h1>
<p style="margin:6px 0 0;font-size:12px;color:#c7d2fe;">${esc(powitanie)}. Zmiany ${esc(okres)}.</p>
</td></tr>
${bloki
	.map(
		(b) => `<tr><td style="padding:18px 24px 4px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-size:15px;font-weight:700;color:${KOLOR.ink};">${esc(b.tytul)} <span style="font-weight:400;font-size:12px;color:${KOLOR.ink3};">· ${esc(b.licznik)}</span></td>
<td align="right" style="font-size:12px;white-space:nowrap;"><a href="${esc(b.href)}" style="color:${KOLOR.akcent};text-decoration:none;">otwórz w CRM →</a></td>
</tr></table>
<div style="margin-top:8px;">${b.html}</div>
</td></tr>`
	)
	.join('')}
<tr><td style="padding:18px 24px;border-top:1px solid ${KOLOR.linia};font-size:12px;color:${KOLOR.ink3};">
${pusto ? 'Spokojny dzień — od ostatniego podsumowania nic nowego.<br>' : ''}Podsumowanie wysyła AuraCRM według ustawień w <a href="${esc(o.crm)}/settings?tab=powiadomienia" style="color:${KOLOR.akcent};">Ustawienia → Powiadomienia</a>. Godziny w czasie polskim.
</td></tr>
</table></td></tr></table></body></html>`;

	const text = `${powitanie}. Podsumowanie dnia ${o.dataPl} (${o.firma}), zmiany ${okres}.\n\n${bloki.map((b) => `== ${b.tytul} (${b.licznik}) — ${b.href}\n${b.tekst}`).join('\n\n')}\n\n${pusto ? 'Spokojny dzień — od ostatniego podsumowania nic nowego.\n' : ''}Ustawienia: ${o.crm}/settings?tab=powiadomienia`;
	return { temat, html, text, pusto };
}

export type WynikPodsumowania = { ok: true; wyslano: boolean; temat: string; pusto: boolean } | { ok: false; blad: string };

/** Buduje i wysyła podsumowanie dla subskrypcji; zapisuje wynik w wierszu. teraz — chwila wysyłki (testy). */
export async function wyslijPodsumowanie(
	admin: SupabaseClient,
	s: Subskrypcja,
	o: { crm: string; teraz?: Date; wymus?: boolean; wyslij?: (klucz: string, w: Wiadomosc) => Promise<WynikWysylki> }
): Promise<WynikPodsumowania> {
	const teraz = o.teraz ?? new Date();
	const zapisz = async (zmiany: Record<string, unknown>) => {
		await admin.from('crm_podsumowania').update({ ...zmiany, updated_at: new Date().toISOString() }).eq('id', s.id);
	};
	const blad = async (tekst: string): Promise<WynikPodsumowania> => {
		await zapisz({ ostatni_blad: tekst.slice(0, 500) });
		return { ok: false, blad: tekst };
	};

	const { data: p } = await admin.from('crm_profiles').select('id, email, imie_nazwisko, tenant_id').eq('id', s.profile_id).maybeSingle();
	const profil = p as { id: string; email: string; imie_nazwisko: string | null; tenant_id: string } | null;
	if (!profil || profil.tenant_id !== s.tenant_id) return blad('Nie ma takiego pracownika.');
	const adres = (profil.email ?? '').trim();
	if (!EMAIL_RE.test(adres) || /\.invalid$/i.test(adres)) return blad('Konto nie ma prawdziwego adresu e-mail — podsumowanie nie ma dokąd iść.');

	const ust = await ustawieniaWysylki(admin, s.tenant_id);
	if (!ust.gotowe || !ust.klucz || !ust.adres) return blad('Firma nie ma skonfigurowanej wysyłki e-maili (klucz Resend i adres nadawcy w SAAS Admin).');

	const dzis = dataWarszawa(teraz);
	const od = poczatekOkresu(s, teraz);
	const dane = await zbierzDane(admin, s.tenant_id, s.profile_id, s.sekcje ?? {}, od, dzis);
	const t = tresc(dane, { firma: ust.firma, imie: profil.imie_nazwisko, crm: o.crm, dataPl: dzien(dzis) });
	if (t.pusto && s.pomin_puste && !o.wymus) {
		await zapisz({ ostatnio_wyslano_at: teraz.toISOString(), ostatni_blad: null });
		return { ok: true, wyslano: false, temat: t.temat, pusto: true };
	}
	const w = await (o.wyslij ?? wyslijEmail)(ust.klucz, {
		from: `"AuraCRM · ${ust.firma.replace(/["<>\r\n\\]/g, '')}" <${ust.adres}>`,
		to: [adres],
		subject: t.temat,
		html: t.html,
		text: t.text
	});
	if (!w.ok) return blad(`Dostawca e-maili odrzucił wiadomość: ${bezAdresow(w.blad)}`);
	await zapisz({ ostatnio_wyslano_at: teraz.toISOString(), ostatni_blad: null });
	return { ok: true, wyslano: true, temat: t.temat, pusto: t.pusto };
}

/** Automat: subskrypcje, którym właśnie wybiła godzina i które dziś jeszcze nie dostały podsumowania. */
export async function doWyslaniaTeraz(admin: SupabaseClient, teraz = new Date()): Promise<Subskrypcja[]> {
	const godzina = godzinaWarszawa(teraz);
	const dzis = dataWarszawa(teraz);
	const { data } = await admin.from('crm_podsumowania').select('*').eq('aktywne', true).eq('godzina', godzina).limit(200);
	return ((data ?? []) as Subskrypcja[]).filter((s) => !s.ostatnio_wyslano_at || dataWarszawa(new Date(s.ostatnio_wyslano_at)) < dzis);
}

/** Dane z formularza w Ustawieniach → bezpieczny zapis. Zwraca komunikat błędu albo wartości. */
export function sprawdzUstawienia(body: unknown): { blad: string } | { godzina: number; sekcje: Record<Sekcja, boolean>; aktywne: boolean; pomin_puste: boolean } {
	const b = (body ?? {}) as Record<string, unknown>;
	const godzina = Number(b.godzina);
	if (!Number.isInteger(godzina) || godzina < 0 || godzina > 23) return { blad: 'Podaj godzinę 0–23.' };
	const sek = (b.sekcje ?? {}) as Record<string, unknown>;
	const sekcje = Object.fromEntries(SEKCJE.map(([k]) => [k, sek[k] === undefined ? DOMYSLNE_SEKCJE[k] : sek[k] === true])) as Record<Sekcja, boolean>;
	if (!Object.values(sekcje).some(Boolean)) return { blad: 'Zaznacz przynajmniej jedną sekcję.' };
	return { godzina, sekcje, aktywne: b.aktywne !== false, pomin_puste: b.pomin_puste === true };
}

