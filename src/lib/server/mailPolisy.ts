// Polisa wysłana klientowi z karty polisy. Polisa z programu (ug_podtyp umowy generalnej) ma własny szablon
// w Resend (firma poprawia go sama w Resend; pozostałe dokumenty programu są w treści jako linki do
// pliki.auraexpert.pl). Każda inna polisa idzie z ogólnego szablonu „polisa-wystawiona” z Resend firmy, a gdy
// go nie ma — z wbudowanej treści CRM (dane polisy, okres, składka, termin płatności). CRM podstawia dane
// polisy i dołącza z magazynu R2 PDF polisy oraz OWU (z polisy albo jej Umowy Generalnej). Adresaci tylko
// spośród adresów klienta i jego osób kontaktowych (jak e-mail z Panelu 360°). Każda wysyłka trafia do
// historii (crm_client_emails, rodzaj „polisa” — status dostarczenia z webhooka Resend) i audytu.
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMAIL_RE, base64, bezAdresow, esc, wyslijEmail, type Wiadomosc, type WynikWysylki, type Zalacznik } from './mail';
import { LIMIT_NA_GODZINE, adresNadawcy, ustawieniaWysylki } from './emailKlienta';
import type { ProfilFirmy } from './pliki';
import { nazwaRodzaju } from '$lib/statusPolisy';

/** Program (ug_podtyp umowy generalnej) → alias szablonu w Resend. */
export const SZABLON_PROGRAMU: Record<string, string> = { oc_beauty: 'beauty-polisa-wystawiona' };
/** Alias ogólnego szablonu w Resend dla polis spoza programów; bez niego — wbudowana treść CRM. */
export const SZABLON_OGOLNY = 'polisa-wystawiona';
export const SZABLON_WBUDOWANY = 'wbudowany';
export const MAKS_ZALACZNIKOW_MB = 20;
/** Najwyżej tyle załączników w mailu z polisą (PDF polisy + OWU). */
export const MAKS_ZALACZNIKOW = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ROZLICZONE = ['Opłacona', 'Częściowo opłacona'];
const MIESIACE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

/** 2025-10-29 → „29 października 2025” (jak w treści szablonu: „przypada … roku”). */
export function dataSlownie(iso: string): string {
	const [r, m, d] = iso.slice(0, 10).split('-').map(Number);
	return `${d} ${MIESIACE[m - 1]} ${r}`;
}

/** 2025-10-15 → 15.10.2025 */
export const dataKropki = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');

/**
 * Propozycja powitania z imienia osoby kontaktowej: imiona na -a w wołaczu (Anna → „Szanowna Pani Anno”,
 * Kasia → „Szanowna Pani Kasiu”). Bez imienia albo przy innym zakończeniu — neutralne „Dzień dobry”.
 * To tylko podpowiedź — doradca widzi ją i poprawia w oknie wysyłki.
 */
export function powitanieDomyslne(imieNazwisko: string | null | undefined): string {
	const imie = String(imieNazwisko ?? '').trim().split(/\s+/)[0] ?? '';
	if (!/^\p{Lu}\p{Ll}+a$/u.test(imie)) return 'Dzień dobry';
	const zdrobnienie = (/(?:si|zi|ci|ni)a$/.test(imie) && imie.length <= 5) || (/la$/.test(imie) && imie.length <= 3);
	return `Szanowna Pani ${imie.slice(0, -1)}${zdrobnienie ? 'u' : 'o'}`;
}

export type SzablonResend = {
	subject?: string | null;
	from?: string | null;
	reply_to?: string | string[] | null;
	html?: string | null;
	text?: string | null;
	status?: string | null;
	published_at?: string | null;
	variables?: { key: string; fallback_value?: string | number | null }[] | null;
};

/** Opublikowany szablon z Resend (kluczem firmy). Szkic nie nadaje się do wysyłki; `brakOk` — brak szablonu to null, nie błąd. */
export async function pobierzSzablon(klucz: string, alias: string, f: typeof fetch = fetch, brakOk = false): Promise<SzablonResend | null> {
	let res: Response;
	try {
		res = await f(`https://api.resend.com/templates/${encodeURIComponent(alias)}`, { headers: { Authorization: `Bearer ${klucz}` } });
	} catch {
		throw error(502, 'Nie udało się połączyć z Resend — spróbuj za chwilę.');
	}
	if (res.status === 404 && brakOk) return null;
	if (res.status === 404) throw error(400, `W Resend nie ma szablonu „${alias}” — utwórz go na koncie Resend, którego klucz ma firma.`);
	if (!res.ok) throw error(502, `Resend nie oddał szablonu „${alias}” (błąd ${res.status}).`);
	const t = (await res.json().catch(() => null)) as SzablonResend | null;
	if (!t?.html) throw error(502, `Szablon „${alias}” w Resend nie ma treści HTML.`);
	if (t.status && t.status !== 'published' && !t.published_at) throw error(400, `Szablon „${alias}” w Resend jest szkicem — opublikuj go w Resend.`);
	return t;
}

/** Podstawia {{{ZMIENNA}}} (i {{ZMIENNA}}). Nieznane zmienne → wartość zastępcza z szablonu albo pusto. */
export function wypelnijSzablon(tekst: string, zmienne: Record<string, string>, html: boolean, zastepcze: Record<string, string> = {}): string {
	return tekst.replace(/\{\{\{\s*([A-Za-z0-9_]+)\s*\}\}\}|\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_c, a: string | undefined, b: string | undefined) => {
		const k = (a ?? b) as string;
		const v = k in zmienne ? zmienne[k] : (zastepcze[k] ?? '');
		return html ? esc(v) : v;
	});
}

/**
 * Wbudowana treść maila z polisą spoza programu — te same zmienne co w szablonach Resend, więc firma może
 * ją zastąpić własnym szablonem „polisa-wystawiona” (POWITANIE, NR_POLISY, RODZAJ, TU, PRZEDMIOT, OKRES_OD,
 * OKRES_DO, SKLADKA, TERMIN_PLATNOSCI, KLIENT, DORADCA, FIRMA, OWU).
 * bezPlatnosci: polisa „Nie wysyłaj klientowi informacji o płatnościach” (np. Leadenhall — składka w CRM bez opłat
 * dystrybucyjnych, klient płaci brutto): bez wierszy „Składka” i „Termin płatności” i bez prośby o opłacenie.
 */
export function szablonWbudowany(bezPlatnosci = false): SzablonResend {
	const p = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
	const w = (etykieta: string, wartosc: string) =>
		`<tr><td style="padding:4px 12px 4px 0;color:#5E6A7E;white-space:nowrap">${etykieta}</td><td style="padding:4px 0;font-weight:600">${wartosc}</td></tr>`;
	const html =
		`<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#121826;max-width:640px">` +
		p('{{{POWITANIE}}},') +
		p('w załączeniu przesyłamy polisę <strong>{{{RODZAJ}}}</strong> nr <strong>{{{NR_POLISY}}}</strong> zawartą w {{{TU}}}{{{PRZEDMIOT_ZDANIE}}}.') +
		`<table style="border-collapse:collapse;margin:0 0 14px;font-size:15px">` +
		w('Okres ubezpieczenia', '{{{OKRES_OD}}} – {{{OKRES_DO}}}') +
		(bezPlatnosci ? '' : w('Składka', '{{{SKLADKA}}} zł') + w('Termin płatności', '{{{TERMIN_PLATNOSCI}}}')) +
		`</table>` +
		p(bezPlatnosci ? 'Prosimy o sprawdzenie danych na polisie.{{{OWU_ZDANIE}}}' : 'Prosimy o sprawdzenie danych na polisie i opłacenie składki w terminie.{{{OWU_ZDANIE}}}') +
		p('W razie pytań jesteśmy do dyspozycji.') +
		p('Z poważaniem,<br>{{{DORADCA}}}<br>{{{FIRMA}}}') +
		`<p style="margin:24px 0 0;font-size:12px;color:#5E6A7E">Wiadomość wysłana z systemu obsługi klientów {{{FIRMA}}}.</p></div>`;
	return { subject: 'Polisa nr {{{NR_POLISY}}} — {{{RODZAJ}}}, {{{TU}}}', html, text: null, from: null, reply_to: null, status: 'published', variables: [] };
}

/** Składka w mailu: 17 480,36 */
export const kwotaSlownie = (n: number | string | null | undefined) =>
	(Number(n) || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Zapasowa wersja tekstowa, gdy szablon jej nie ma. */
export function htmlNaTekst(html: string): string {
	return html
		.replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
		.replace(/<li[^>]*>/gi, '- ')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, ' ')
		.replace(/\n\s*\n+/g, '\n\n')
		.trim();
}

type Polisa = {
	id: string; nr_polisy: string; data_od: string | null; data_do: string | null; klient_id: string; parent_id: string | null;
	rodzaj?: string | null; przedmiot?: string | null; skladka_przypisana?: number | string | null; typ_umowy?: string | null;
	bez_info_platnosci?: boolean | null;
	crm_insurers?: { nazwa: string; skrot: string | null } | null;
};
type Plik = { id: string; polisa_id?: string; nazwa: string; klucz: string; rozmiar: number; rodzaj: string; created_at: string };

/** Polisa firmy + szablon (programu albo ogólny), klient, adresy, pliki (z OWU umowy generalnej), raty i wcześniejsze wysyłki. */
async function wczytaj(admin: SupabaseClient, profil: ProfilFirmy, polisaId: string) {
	if (!UUID.test(polisaId)) throw error(404, 'Nie ma takiej polisy.');
	const { data: p } = await admin
		.from('crm_policies')
		.select('id, nr_polisy, data_od, data_do, klient_id, parent_id, rodzaj, przedmiot, skladka_przypisana, typ_umowy, bez_info_platnosci, crm_insurers(nazwa, skrot)')
		.eq('id', polisaId)
		.eq('tenant_id', profil.tenant_id)
		.is('deleted_at', null)
		.maybeSingle();
	const polisa = p as Polisa | null;
	if (!polisa) throw error(404, 'Nie ma takiej polisy w Twojej firmie.');
	if (polisa.typ_umowy === 'generalna') throw error(400, 'Umowy generalnej nie wysyła się klientowi jak polisy — wyślij polisę zawartą w ramach umowy.');

	// Polisa z programu ma własny szablon w Resend; każda inna — ogólny (albo wbudowaną treść CRM).
	let szablon: string | null = null;
	if (polisa.parent_id) {
		const { data: ug } = await admin.from('crm_policies').select('typ_umowy, ug_podtyp').eq('id', polisa.parent_id).eq('tenant_id', profil.tenant_id).maybeSingle();
		const u = ug as { typ_umowy: string | null; ug_podtyp: string | null } | null;
		if (u?.typ_umowy === 'generalna' && u.ug_podtyp) szablon = SZABLON_PROGRAMU[u.ug_podtyp] ?? null;
	}
	const ogolny = !szablon;
	if (!szablon) szablon = SZABLON_OGOLNY;

	// Pliki polisy i OWU z jej Umowy Generalnej (OWU wgrane raz na umowie dziedziczy każda polisa z umowy).
	const plikiZ = [polisa.id, ...(polisa.parent_id ? [polisa.parent_id] : [])];
	const [{ data: k }, { data: kontakty }, { data: pl }, { data: raty }, { data: wys }] = await Promise.all([
		admin.from('crm_clients').select('id, nazwa, email').eq('id', polisa.klient_id).eq('tenant_id', profil.tenant_id).maybeSingle(),
		admin.from('crm_client_contacts').select('imie_nazwisko, email').eq('klient_id', polisa.klient_id).eq('tenant_id', profil.tenant_id).order('created_at'),
		admin.from('crm_policy_files').select('id, polisa_id, nazwa, klucz, rozmiar, rodzaj, created_at').in('polisa_id', plikiZ).eq('tenant_id', profil.tenant_id).order('created_at', { ascending: false }),
		admin.from('crm_policy_payments').select('data_platnosci, status').eq('polisa_id', polisa.id).order('data_platnosci'),
		admin
			.from('crm_client_emails')
			.select('wyslano_at, adres, dostawa')
			.eq('tenant_id', profil.tenant_id)
			.eq('rodzaj', 'polisa')
			.contains('polisa_ids', [polisa.id])
			.order('wyslano_at', { ascending: false })
			.limit(10)
	]);
	const klient = k as { id: string; nazwa: string; email: string | null } | null;
	if (!klient) throw error(404, 'Polisa nie ma klienta w Twojej firmie.');
	const osoby = (kontakty ?? []) as { imie_nazwisko: string | null; email: string | null }[];

	const adresy: { adres: string; opis: string }[] = [];
	const dodaj = (adres: string | null | undefined, opis: string) => {
		const a = String(adres ?? '').trim().toLowerCase();
		if (EMAIL_RE.test(a) && !adresy.some((x) => x.adres === a)) adresy.push({ adres: a, opis });
	};
	dodaj(klient.email, klient.nazwa);
	for (const o of osoby) dodaj(o.email, o.imie_nazwisko || 'Osoba kontaktowa');

	const rat = (raty ?? []) as { data_platnosci: string | null; status: string | null }[];
	const terminy = rat.filter((r) => r.data_platnosci && !ROZLICZONE.includes(r.status ?? ''));
	const termin = (terminy[0] ?? rat.find((r) => r.data_platnosci))?.data_platnosci ?? null;
	// Z Umowy Generalnej bierzemy tylko OWU — polisa umowy czy aneksy umowy nie są dokumentami tej polisy.
	const pliki = ((pl ?? []) as Plik[]).filter((f) => !f.polisa_id || f.polisa_id === polisa.id || f.rodzaj === 'owu');

	return {
		polisa,
		szablon,
		ogolny,
		klient,
		adresy,
		pliki,
		powitanie: powitanieDomyslne(osoby.find((o) => o.imie_nazwisko)?.imie_nazwisko),
		termin: termin ? termin.slice(0, 10) : null,
		wyslane: (wys ?? []) as { wyslano_at: string; adres: string; dostawa: string | null }[]
	};
}

/** Domyślne załączniki: PDF polisy i OWU (najwyżej MAKS_ZALACZNIKOW, razem do MAKS_ZALACZNIKOW_MB). */
export function domyslneZalaczniki(pliki: Plik[], polisaId: string): string[] {
	const pdf = pliki.find((p) => p.rodzaj === 'polisa' && (!p.polisa_id || p.polisa_id === polisaId));
	const owu = pliki.filter((p) => p.rodzaj === 'owu');
	const out: Plik[] = [];
	let suma = 0;
	for (const p of [pdf, ...owu]) {
		if (!p || out.length >= MAKS_ZALACZNIKOW || suma + Number(p.rozmiar) > MAKS_ZALACZNIKOW_MB * 1024 * 1024) continue;
		out.push(p);
		suma += Number(p.rozmiar);
	}
	return out.map((p) => p.id);
}

/** Dane do okna „Wyślij polisę klientowi”. */
export async function kontekstMailaPolisy(admin: SupabaseClient, profil: ProfilFirmy, polisaId: string) {
	const w = await wczytaj(admin, profil, polisaId);
	const bezPlatnosci = !!w.polisa.bez_info_platnosci;
	return {
		szablon: w.szablon,
		/** Polisa spoza programu: ogólny szablon „polisa-wystawiona” z Resend albo wbudowana treść CRM. */
		ogolny: w.ogolny,
		/** „Nie wysyłaj klientowi informacji o płatnościach”: wbudowana treść bez składki i terminu, termin niepotrzebny. */
		bez_info_platnosci: bezPlatnosci,
		polisa: { nr_polisy: w.polisa.nr_polisy, data_od: w.polisa.data_od, data_do: w.polisa.data_do },
		klient: w.klient.nazwa,
		adresy: w.adresy,
		pliki: w.pliki.map((p) => ({ id: p.id, nazwa: p.nazwa, rozmiar: Number(p.rozmiar), rodzaj: p.rodzaj, zUmowy: !!p.polisa_id && p.polisa_id !== w.polisa.id })),
		domyslne: { do: w.adresy.slice(0, 1).map((a) => a.adres), powitanie: w.powitanie, termin_platnosci: bezPlatnosci ? null : w.termin, pliki: domyslneZalaczniki(w.pliki, w.polisa.id) },
		wyslane: w.wyslane
	};
}

export type ZadanieMailaPolisy = { do?: unknown; powitanie?: unknown; termin_platnosci?: unknown; pliki?: unknown; podglad?: unknown };

/** terminWymagany: false przy polisie „bez informacji o płatnościach” — mail idzie bez terminu płatności. */
export function sprawdzZadanie(body: ZadanieMailaPolisy, { terminWymagany = true }: { terminWymagany?: boolean } = {}) {
	const lista = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
	const adresy = [...new Set(lista(body.do).map((a) => a.toLowerCase()))];
	const powitanie = String(body.powitanie ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/[,;:\s]+$/, '');
	const termin = String(body.termin_platnosci ?? '').trim();
	const pliki = [...new Set(lista(body.pliki))];
	if (!adresy.length) throw error(400, 'Wybierz adresata.');
	if (adresy.length > 5) throw error(400, 'Najwyżej 5 adresatów naraz.');
	if (adresy.some((a) => !EMAIL_RE.test(a))) throw error(400, 'Nieprawidłowy adres e-mail.');
	if (!powitanie) throw error(400, 'Wpisz powitanie (np. „Szanowna Pani Anno”).');
	if (powitanie.length > 120) throw error(400, 'Powitanie jest za długie (najwyżej 120 znaków).');
	if (terminWymagany && (!ISO.test(termin) || Number.isNaN(Date.parse(termin)))) throw error(400, 'Podaj termin płatności składki.');
	if (!pliki.length) throw error(400, 'Zaznacz PDF polisy do załączenia.');
	if (pliki.length > MAKS_ZALACZNIKOW || pliki.some((id) => !UUID.test(id))) throw error(400, `Najwyżej ${MAKS_ZALACZNIKOW} załączniki.`);
	return { adresy, powitanie, termin: terminWymagany ? termin : '', pliki, podglad: body.podglad === true };
}

/** Podgląd (podglad: true) albo wysyłka maila z polisą. */
export async function mailPolisy(
	admin: SupabaseClient,
	kubelek: R2Kubelek | null,
	profil: ProfilFirmy,
	polisaId: string,
	body: ZadanieMailaPolisy,
	o: { wyslij?: (klucz: string, w: Wiadomosc) => Promise<WynikWysylki>; f?: typeof fetch } = {}
) {
	const w = await wczytaj(admin, profil, polisaId);
	const bezPlatnosci = !!w.polisa.bez_info_platnosci;
	const z = sprawdzZadanie(body, { terminWymagany: !bezPlatnosci });
	const dozwolone = new Set(w.adresy.map((a) => a.adres));
	if (z.adresy.some((a) => !dozwolone.has(a))) throw error(400, 'Adresat musi być adresem klienta albo jego osoby kontaktowej — dopisz go najpierw w danych klienta.');
	const pliki = z.pliki.map((id) => w.pliki.find((p) => p.id === id));
	if (pliki.some((p) => !p)) throw error(400, 'Załącznik nie należy do tej polisy.');
	const wybrane = pliki as Plik[];
	const suma = wybrane.reduce((s, p) => s + Number(p.rozmiar), 0);
	if (suma > MAKS_ZALACZNIKOW_MB * 1024 * 1024) throw error(413, `Załączniki są za duże (razem najwyżej ${MAKS_ZALACZNIKOW_MB} MB).`);

	const ust = await ustawieniaWysylki(admin, profil.tenant_id);
	if (!ust.klucz) throw error(400, 'Firma nie ma skonfigurowanej wysyłki e-maili (klucz Resend w SAAS Admin).');
	// Program: szablon programu musi być w Resend. Poza programem: ogólny szablon firmy, a bez niego wbudowana treść.
	// Polisa bez informacji o płatnościach: zawsze wbudowana treść bez składki i terminu (szablon z Resend mógłby je mieć).
	const zResend = bezPlatnosci ? null : await pobierzSzablon(ust.klucz, w.szablon, o.f, w.ogolny);
	const t = zResend ?? szablonWbudowany(bezPlatnosci);
	const nazwaSzablonu = zResend ? w.szablon : SZABLON_WBUDOWANY;

	const owu = wybrane.filter((p) => p.rodzaj === 'owu').map((p) => p.nazwa);
	const przedmiot = String(w.polisa.przedmiot ?? '').trim();
	const zmienne: Record<string, string> = {
		POWITANIE: z.powitanie,
		NR_POLISY: w.polisa.nr_polisy,
		OKRES_OD: dataKropki(w.polisa.data_od),
		OKRES_DO: dataKropki(w.polisa.data_do),
		TERMIN_PLATNOSCI: bezPlatnosci ? '' : dataSlownie(z.termin),
		KLIENT: w.klient.nazwa,
		RODZAJ: nazwaRodzaju(w.polisa.rodzaj ?? ''),
		TU: w.polisa.crm_insurers?.nazwa ?? w.polisa.crm_insurers?.skrot ?? 'towarzystwie ubezpieczeń',
		PRZEDMIOT: przedmiot,
		PRZEDMIOT_ZDANIE: przedmiot && !przedmiot.startsWith('{') ? ` (${przedmiot})` : '',
		SKLADKA: bezPlatnosci ? '' : kwotaSlownie(w.polisa.skladka_przypisana),
		OWU: owu.join(', '),
		OWU_ZDANIE: owu.length ? ' Załączamy też Ogólne Warunki Ubezpieczenia (OWU).' : '',
		DORADCA: profil.imie_nazwisko ?? '',
		FIRMA: ust.firma
	};
	const zastepcze = Object.fromEntries((t.variables ?? []).map((v) => [v.key, v.fallback_value == null ? '' : String(v.fallback_value)]));
	const html = wypelnijSzablon(t.html ?? '', zmienne, true, zastepcze);
	const text = t.text ? wypelnijSzablon(t.text, zmienne, false, zastepcze) : htmlNaTekst(html);
	const temat = wypelnijSzablon(t.subject || `[POLISA {{{NR_POLISY}}}] Twoja polisa`, zmienne, false, zastepcze).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
	const od = (t.from && adresNadawcy(t.from) ? t.from : null) ?? (ust.adres ? `"${ust.firma.replace(/["<>\r\n\\]/g, '')}" <${ust.adres}>` : null);
	if (!od) throw error(400, 'Brak adresu nadawcy — ustaw „From” w szablonie Resend albo adres nadawcy firmy w SAAS Admin.');
	const zSzablonu = (Array.isArray(t.reply_to) ? t.reply_to : t.reply_to ? [t.reply_to] : []).map((a) => adresNadawcy(a)).filter((a): a is string => !!a);
	const doradca = profil.email && EMAIL_RE.test(profil.email) && !/\.invalid$/i.test(profil.email) ? profil.email : null;
	const odpowiedz = zSzablonu[0] ?? doradca ?? undefined;
	const nazwy = wybrane.map((p) => p.nazwa);

	if (z.podglad) return { podglad: true as const, temat, html, od, odpowiedz: odpowiedz ?? null, zalaczniki: wybrane.map((p) => ({ nazwa: p.nazwa, rozmiar: Number(p.rozmiar) })) };

	if (!kubelek) throw error(503, 'Magazyn plików nie jest skonfigurowany — nie da się dołączyć PDF polisy.');
	const godzineTemu = new Date(Date.now() - 3600_000).toISOString();
	const { count } = await admin.from('crm_client_emails').select('id', { count: 'exact', head: true }).eq('autor_id', profil.id).gte('wyslano_at', godzineTemu);
	if ((count ?? 0) >= LIMIT_NA_GODZINE) throw error(429, `Limit ${LIMIT_NA_GODZINE} e-maili na godzinę — spróbuj za chwilę.`);

	const zalaczniki: Zalacznik[] = [];
	for (const p of wybrane) {
		const obiekt = await kubelek.get(p.klucz);
		if (!obiekt) throw error(410, `Plik „${p.nazwa}” zniknął z magazynu.`);
		zalaczniki.push({ filename: p.nazwa, content: base64(await obiekt.arrayBuffer()), content_type: 'application/pdf' });
	}

	const wynik = await (o.wyslij ?? wyslijEmail)(ust.klucz, { from: od, to: z.adresy, replyTo: odpowiedz, subject: temat, html, text, attachments: zalaczniki });
	if (!wynik.ok) throw error(502, `Dostawca e-maili odrzucił wiadomość: ${bezAdresow(wynik.blad)}`);

	const { error: e } = await admin.from('crm_client_emails').insert({
		tenant_id: profil.tenant_id,
		klient_id: w.klient.id,
		polisa_ids: [w.polisa.id],
		rodzaj: 'polisa',
		adres: z.adresy.join(', ').slice(0, 320),
		temat: temat.slice(0, 500),
		tresc: text.slice(0, 20000),
		dostawca_id: wynik.id,
		autor_id: profil.id,
		zalaczniki: nazwy
	});
	if (e) console.error('mail z polisą: historia:', e.message);
	await admin.from('crm_audit_log').insert({
		tenant_id: profil.tenant_id,
		user_id: profil.id,
		user_email: profil.email ?? null,
		user_name: profil.imie_nazwisko ?? null,
		action: 'policy_email_sent',
		entity_type: 'policy',
		entity_id: w.polisa.id,
		entity_label: w.polisa.nr_polisy,
		details: { szablon: nazwaSzablonu, adresatow: z.adresy.length, zalaczniki: nazwy, termin_platnosci: z.termin }
	});
	return { podglad: false as const, id: wynik.id, adresy: z.adresy };
}
