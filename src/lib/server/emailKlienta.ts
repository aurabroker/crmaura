// E-mail do klienta wysłany ręcznie z Panelu 360°. Wychodzi kluczem Resend firmy z adresu firmy
// (crm_tenants.email_from), w imieniu doradcy; odpowiedzi trafiają do doradcy (Reply-To).
// Adresaci tylko spośród adresów klienta i jego osób kontaktowych — CRM nie jest bramką do wysyłki
// na dowolne adresy. Załączniki: PDF polis klienta z magazynu R2. Każda wysyłka trafia do historii
// (crm_client_emails, rodzaj „recznie”) i dziennika audytu.
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMAIL_RE, base64, bezAdresow, esc, wyslijEmail, type Wiadomosc, type WynikWysylki, type Zalacznik } from './mail';
import type { ProfilFirmy } from './pliki';

export const LIMIT_NA_GODZINE = 50;
export const MAKS_ZALACZNIKOW_MB = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ZadanieEmaila = { do?: unknown; temat?: unknown; tresc?: unknown; polisa_ids?: unknown; zalaczniki?: unknown };

/** Adres z pola nadawcy firmy: „Nazwa <adres@domena>” albo sam adres. */
export function adresNadawcy(emailFrom: string | null | undefined): string | null {
	const t = String(emailFrom ?? '').trim();
	const m = t.match(/<([^<>\s]+@[^<>\s]+)>/);
	const adres = (m ? m[1] : t).trim();
	return EMAIL_RE.test(adres) ? adres : null;
}

/** Nazwa wyświetlana nadawcy bez znaków, które psują nagłówek. */
export function nazwaNadawcy(osoba: string | null | undefined, firma: string | null | undefined): string {
	const czysc = (s: string | null | undefined) => String(s ?? '').replace(/["<>\r\n\\]/g, '').trim();
	const o = czysc(osoba);
	const f = czysc(firma);
	return (o && f ? `${o} | ${f}` : o || f || 'CRM').slice(0, 120);
}

/** Treść z formularza (zwykły tekst) → prosty HTML: akapity po pustej linii, <br> w akapicie. */
export function trescHtml(tresc: string, firma: string): string {
	const akapity = tresc
		.replace(/\r\n?/g, '\n')
		.split(/\n{2,}/)
		.map((a) => `<p style="margin:0 0 14px">${esc(a).replace(/\n/g, '<br>')}</p>`)
		.join('');
	return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#121826;max-width:640px">${akapity}` +
		`<p style="margin:24px 0 0;font-size:12px;color:#5E6A7E">Wiadomość wysłana z systemu obsługi klientów ${esc(firma)}.</p></div>`;
}

type Klient = { id: string; nazwa: string; email: string | null };

export function sprawdzZadanie(body: ZadanieEmaila) {
	const lista = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
	const adresy = [...new Set(lista(body.do).map((a) => a.toLowerCase()))];
	const temat = String(body.temat ?? '').replace(/[\r\n]+/g, ' ').trim();
	const tresc = String(body.tresc ?? '').trim();
	const polisaIds = [...new Set(lista(body.polisa_ids))];
	const plikIds = [...new Set(lista(body.zalaczniki))];
	if (!adresy.length) throw error(400, 'Wybierz adresata.');
	if (adresy.length > 5) throw error(400, 'Najwyżej 5 adresatów naraz.');
	if (adresy.some((a) => !EMAIL_RE.test(a))) throw error(400, 'Nieprawidłowy adres e-mail.');
	if (!temat) throw error(400, 'Podaj temat.');
	if (temat.length > 200) throw error(400, 'Temat jest za długi (najwyżej 200 znaków).');
	if (!tresc) throw error(400, 'Wpisz treść wiadomości.');
	if (tresc.length > 10000) throw error(400, 'Treść jest za długa (najwyżej 10 000 znaków).');
	if (polisaIds.length > 20 || polisaIds.some((id) => !UUID.test(id))) throw error(400, 'Nieprawidłowa lista polis.');
	if (plikIds.length > 5 || plikIds.some((id) => !UUID.test(id))) throw error(400, 'Najwyżej 5 załączników.');
	return { adresy, temat, tresc, polisaIds, plikIds };
}

export async function ustawieniaWysylki(admin: SupabaseClient, tenantId: string) {
	const { data } = await admin.from('crm_tenants').select('nazwa, resend_api_key, email_from').eq('id', tenantId).maybeSingle();
	const t = data as { nazwa: string; resend_api_key: string | null; email_from: string | null } | null;
	const adres = adresNadawcy(t?.email_from);
	return { firma: t?.nazwa ?? '', klucz: t?.resend_api_key ?? null, adres, gotowe: !!(t?.resend_api_key && adres) };
}

export async function wyslijEmailKlienta(
	admin: SupabaseClient,
	kubelek: R2Kubelek | null,
	profil: ProfilFirmy,
	klientId: string,
	body: ZadanieEmaila,
	wyslij: (klucz: string, w: Wiadomosc) => Promise<WynikWysylki> = wyslijEmail
) {
	if (!UUID.test(klientId)) throw error(404, 'Nie ma takiego klienta.');
	const z = sprawdzZadanie(body);

	const { data: k } = await admin.from('crm_clients').select('id, nazwa, email').eq('id', klientId).eq('tenant_id', profil.tenant_id).maybeSingle();
	const klient = k as Klient | null;
	if (!klient) throw error(404, 'Nie ma takiego klienta w Twojej firmie.');

	// Adresy klienta i jego osób kontaktowych
	const { data: kontakty } = await admin.from('crm_client_contacts').select('email').eq('klient_id', klient.id).eq('tenant_id', profil.tenant_id);
	const dozwolone = new Set(
		[klient.email, ...((kontakty ?? []) as { email: string | null }[]).map((c) => c.email)].filter(Boolean).map((a) => String(a).trim().toLowerCase())
	);
	const obcy = z.adresy.find((a) => !dozwolone.has(a));
	if (obcy) throw error(400, 'Adresat musi być adresem klienta albo jego osoby kontaktowej — dopisz go najpierw w danych klienta.');

	// Polisy klienta (jako ubezpieczający albo ubezpieczony)
	const { data: pol } = await admin
		.from('crm_policies')
		.select('id')
		.eq('tenant_id', profil.tenant_id)
		.or(`klient_id.eq.${klient.id},ubezpieczony_id.eq.${klient.id}`);
	const polisyKlienta = new Set(((pol ?? []) as { id: string }[]).map((p) => p.id));
	if (z.polisaIds.some((id) => !polisyKlienta.has(id))) throw error(400, 'Wybrana polisa nie należy do tego klienta.');

	const ust = await ustawieniaWysylki(admin, profil.tenant_id);
	if (!ust.gotowe || !ust.klucz || !ust.adres) throw error(400, 'Firma nie ma skonfigurowanej wysyłki e-maili (klucz Resend i adres nadawcy w SAAS Admin).');

	// Limit — ochrona przed przypadkową masową wysyłką
	const godzineTemu = new Date(Date.now() - 3600_000).toISOString();
	const { count } = await admin
		.from('crm_client_emails')
		.select('id', { count: 'exact', head: true })
		.eq('autor_id', profil.id)
		.gte('wyslano_at', godzineTemu);
	if ((count ?? 0) >= LIMIT_NA_GODZINE) throw error(429, `Limit ${LIMIT_NA_GODZINE} e-maili na godzinę — spróbuj za chwilę.`);

	// Załączniki: PDF polis klienta z magazynu
	const zalaczniki: Zalacznik[] = [];
	const nazwy: string[] = [];
	if (z.plikIds.length) {
		if (!kubelek) throw error(503, 'Magazyn plików nie jest skonfigurowany — wyślij bez załączników.');
		const { data: pl } = await admin.from('crm_policy_files').select('id, polisa_id, nazwa, klucz, rozmiar').eq('tenant_id', profil.tenant_id).in('id', z.plikIds);
		const pliki = (pl ?? []) as { id: string; polisa_id: string; nazwa: string; klucz: string; rozmiar: number }[];
		if (pliki.length !== z.plikIds.length || pliki.some((p) => !polisyKlienta.has(p.polisa_id))) throw error(400, 'Załącznik nie należy do polis tego klienta.');
		const suma = pliki.reduce((s, p) => s + Number(p.rozmiar), 0);
		if (suma > MAKS_ZALACZNIKOW_MB * 1024 * 1024) throw error(413, `Załączniki są za duże (razem najwyżej ${MAKS_ZALACZNIKOW_MB} MB).`);
		for (const p of pliki) {
			const obiekt = await kubelek.get(p.klucz);
			if (!obiekt) throw error(410, `Plik „${p.nazwa}” zniknął z magazynu.`);
			zalaczniki.push({ filename: p.nazwa, content: base64(await obiekt.arrayBuffer()), content_type: 'application/pdf' });
			nazwy.push(p.nazwa);
		}
	}

	const odpowiedzi = profil.email && EMAIL_RE.test(profil.email) && !/\.invalid$/i.test(profil.email) ? profil.email : undefined;
	const wynik = await wyslij(ust.klucz, {
		from: `"${nazwaNadawcy(profil.imie_nazwisko, ust.firma)}" <${ust.adres}>`,
		to: z.adresy,
		replyTo: odpowiedzi,
		subject: z.temat,
		html: trescHtml(z.tresc, ust.firma),
		text: z.tresc,
		attachments: zalaczniki
	});
	if (!wynik.ok) throw error(502, `Dostawca e-maili odrzucił wiadomość: ${bezAdresow(wynik.blad)}`);

	const { error: e } = await admin.from('crm_client_emails').insert({
		tenant_id: profil.tenant_id,
		klient_id: klient.id,
		polisa_ids: z.polisaIds,
		rodzaj: 'recznie',
		adres: z.adresy.join(', ').slice(0, 320),
		temat: z.temat.slice(0, 500),
		tresc: z.tresc.slice(0, 20000),
		dostawca_id: wynik.id,
		autor_id: profil.id,
		zalaczniki: nazwy
	});
	if (e) console.error('email klienta: historia:', e.message);
	await admin.from('crm_audit_log').insert({
		tenant_id: profil.tenant_id,
		user_id: profil.id,
		user_email: profil.email ?? null,
		user_name: profil.imie_nazwisko ?? null,
		action: 'client_email_sent',
		entity_type: 'client',
		entity_id: klient.id,
		entity_label: klient.nazwa,
		details: { temat: z.temat, adresatow: z.adresy.length, zalaczniki: nazwy }
	});
	return { id: wynik.id, adresy: z.adresy, odpowiedzi: odpowiedzi ?? null };
}
