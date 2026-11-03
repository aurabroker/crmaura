import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/auth';
import { EMAIL_RE, base64, bezAdresow, esc, wyslijEmail, type Zalacznik } from '$lib/server/mail';
import { nazwaNadawcy, ustawieniaWysylki } from '$lib/server/emailKlienta';
import type { RequestHandler } from './$types';

// „Zgłoś wyrejestrowanie pojazdu” — e-mail do towarzystwa.
//
// Adresaci: dwa adresy ustawione przy towarzystwie (crm_insurers.email_wyrej_1/2),
// kopia: adres CC brokera/agenta (domyślnie z profilu, edytowalny przy wysyłce).
// Wychodzi kluczem Resend firmy z adresu firmy (jak e-mail do klienta z Panelu 360°),
// w imieniu doradcy; odpowiedzi trafiają do doradcy (Reply-To).
//
// Ślad przy kliencie: crm_vehicle_deregistrations (kto, kiedy, do kogo, z jakim
// dowodem — także nieudana próba) oraz crm_client_emails (rodzaj „inne” — słownik
// rodzajów w bazie nie ma osobnej wartości), dzięki czemu webhook Resend dopisuje
// stan dostawy, a zakładka „E-maile” klienta pokazuje wiadomość razem z resztą
// korespondencji. Dowody wyrejestrowania (umowa
// sprzedaży, faktura, decyzja o złomowaniu) idą w załączniku i do prywatnego
// bucketa „wyrejestrowania” (ścieżka zaczyna się od tenant_id — RLS).

const POWODY: Record<string, string> = {
	sprzedaz: 'sprzedaż pojazdu',
	zlomowanie: 'złomowanie / kasacja pojazdu',
	kradziez: 'kradzież pojazdu',
	inne: 'inne'
};

const MAX_ZALACZNIK = 10 * 1024 * 1024; // 10 MB na plik
const MAX_LACZNIE = 25 * 1024 * 1024; // Resend przyjmuje do 40 MB na wiadomość
const DOZWOLONE_TYPY = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bezpiecznaNazwa(nazwa: string): string {
	return nazwa.replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, '_').slice(0, 120) || 'dowod';
}

type PolisaSkrot = { id: string; nr_polisy: string; data_od: string; data_do: string; parent_id: string | null };

type Pojazd = {
	id: string;
	klient_id: string;
	nr_rejestracyjny: string | null;
	vin: string | null;
	nr_nadwozia: string | null;
	nr_silnika: string | null;
	marka_model: string | null;
	rok_produkcji: number | null;
	rodzaj_kalkulacyjny: string | null;
	bez_rejestracji: boolean | null;
};

export const POST: RequestHandler = async ({ request }) => {
	const { user, profile, admin } = await requireAuth(request);

	const form = await request.formData();
	const pojazd_id = String(form.get('pojazd_id') ?? '');
	const tu_id = String(form.get('tu_id') ?? '');
	const polisa_id = String(form.get('polisa_id') ?? '') || null;
	const powod = String(form.get('powod') ?? '');
	const data_zdarzenia = String(form.get('data_zdarzenia') ?? '') || null;
	const tresc = String(form.get('tresc') ?? '').trim() || null;
	const ccRaw = String(form.get('cc') ?? '').trim();

	if (!UUID.test(pojazd_id) || !UUID.test(tu_id)) throw error(400, 'Wskaż pojazd i towarzystwo.');
	if (polisa_id && !UUID.test(polisa_id)) throw error(400, 'Nieprawidłowa polisa.');
	if (!POWODY[powod]) throw error(400, 'Nieprawidłowy powód wyrejestrowania.');
	if (data_zdarzenia && !/^\d{4}-\d{2}-\d{2}$/.test(data_zdarzenia)) throw error(400, 'Nieprawidłowa data zdarzenia.');
	if (tresc && tresc.length > 5000) throw error(400, 'Dodatkowa treść jest za długa (najwyżej 5 000 znaków).');

	const cc = [...new Set(ccRaw ? ccRaw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean) : [])];
	if (cc.length > 5) throw error(400, 'Najwyżej 5 adresów w kopii.');
	for (const adres of cc) if (!EMAIL_RE.test(adres)) throw error(400, `Nieprawidłowy adres CC: ${adres}`);

	// --- dane z bazy (klient admin, ale wszystko zawężone do firmy) ---
	const [{ data: p }, { data: t }, ust] = await Promise.all([
		admin.from('crm_vehicles').select('id, klient_id, nr_rejestracyjny, vin, nr_nadwozia, nr_silnika, marka_model, rok_produkcji, rodzaj_kalkulacyjny, bez_rejestracji').eq('id', pojazd_id).eq('tenant_id', profile.tenant_id).maybeSingle(),
		admin.from('crm_insurers').select('id, nazwa, skrot, email_wyrej_1, email_wyrej_2').eq('id', tu_id).eq('tenant_id', profile.tenant_id).maybeSingle(),
		ustawieniaWysylki(admin, profile.tenant_id)
	]);
	const pojazd = p as Pojazd | null;
	const tu = t as { id: string; nazwa: string; skrot: string | null; email_wyrej_1: string | null; email_wyrej_2: string | null } | null;
	if (!pojazd) throw error(404, 'Nie ma takiego pojazdu w Twojej firmie.');
	if (!tu) throw error(404, 'Nie ma takiego towarzystwa w Twojej firmie.');
	if (!ust.gotowe || !ust.klucz || !ust.adres)
		throw error(400, 'Firma nie ma skonfigurowanej wysyłki e-maili (klucz Resend i adres nadawcy w SAAS Admin).');

	const adresaci = [...new Set([tu.email_wyrej_1, tu.email_wyrej_2].map((s) => String(s ?? '').trim().toLowerCase()).filter((s) => s && EMAIL_RE.test(s)))];
	if (!adresaci.length)
		throw error(400, `Towarzystwo ${tu.nazwa} nie ma ustawionego adresu do zgłoszeń wyrejestrowania. Uzupełnij go w Ustawieniach → System → Towarzystwa.`);

	const { data: k } = await admin.from('crm_clients').select('id, nazwa, nip, regon').eq('id', pojazd.klient_id).eq('tenant_id', profile.tenant_id).maybeSingle();
	const klient = k as { id: string; nazwa: string; nip: string | null; regon: string | null } | null;
	if (!klient) throw error(404, 'Nie ma klienta tego pojazdu w Twojej firmie.');

	let polisa: PolisaSkrot | null = null;
	let ugNr: string | null = null;
	if (polisa_id) {
		const { data } = await admin.from('crm_policies').select('id, nr_polisy, data_od, data_do, parent_id').eq('id', polisa_id).eq('tenant_id', profile.tenant_id).maybeSingle();
		polisa = (data as PolisaSkrot | null) ?? null;
		if (polisa?.parent_id) {
			const { data: ug } = await admin.from('crm_policies').select('nr_polisy').eq('id', polisa.parent_id).eq('tenant_id', profile.tenant_id).maybeSingle();
			ugNr = (ug as { nr_polisy: string } | null)?.nr_polisy ?? null;
		}
	}

	// --- dowody wyrejestrowania ---
	const pliki = form.getAll('zalaczniki').filter((f): f is File => f instanceof File && f.size > 0);
	if (!pliki.length) throw error(400, 'Dołącz dowód wyrejestrowania — umowę sprzedaży, fakturę albo decyzję o złomowaniu.');
	if (pliki.length > 10) throw error(400, 'Najwyżej 10 załączników.');
	let lacznie = 0;
	for (const f of pliki) {
		if (f.size > MAX_ZALACZNIK) throw error(413, `Plik ${f.name} przekracza 10 MB.`);
		if (!DOZWOLONE_TYPY.has(f.type)) throw error(400, `Niedozwolony typ pliku: ${f.name} (${f.type || 'nieznany'}). Dozwolone: PDF, JPG, PNG, WEBP, HEIC.`);
		lacznie += f.size;
	}
	if (lacznie > MAX_LACZNIE) throw error(413, 'Załączniki łącznie przekraczają 25 MB.');

	const zgloszenieId = crypto.randomUUID();
	const zalaczniki: { nazwa: string; sciezka: string; rozmiar: number; typ: string }[] = [];
	const attachments: Zalacznik[] = [];
	const nazwy = new Set<string>();

	for (const f of pliki) {
		const buf = await f.arrayBuffer();
		let nazwa = bezpiecznaNazwa(f.name);
		// Dwa pliki o tej samej nazwie nie mogą się nadpisać w buckecie.
		for (let i = 2; nazwy.has(nazwa); i++) nazwa = nazwa.replace(/(\.[^.]*)?$/, `-${i}$1`);
		nazwy.add(nazwa);
		const sciezka = `${profile.tenant_id}/${klient.id}/${zgloszenieId}/${nazwa}`;
		const { error: upErr } = await admin.storage.from('wyrejestrowania').upload(sciezka, buf, { contentType: f.type, upsert: false });
		if (upErr) throw error(500, `Nie udało się zapisać załącznika ${f.name}: ${upErr.message}`);
		zalaczniki.push({ nazwa, sciezka, rozmiar: f.size, typ: f.type });
		attachments.push({ filename: nazwa, content: base64(buf), content_type: f.type });
	}

	// --- treść wiadomości ---
	const rej = pojazd.bez_rejestracji ? 'bez rejestracji' : (pojazd.nr_rejestracyjny ?? '—');
	const identyfikator = pojazd.bez_rejestracji ? (pojazd.vin ? `VIN ${pojazd.vin}` : pojazd.nr_nadwozia ? `nadwozie ${pojazd.nr_nadwozia}` : `silnik ${pojazd.nr_silnika ?? '—'}`) : rej;
	const pojazdOpis = `${identyfikator} — ${pojazd.marka_model ?? ''}${!pojazd.bez_rejestracji && pojazd.vin ? ` (VIN ${pojazd.vin})` : ''}`.trim();
	const nadawcaNazwa = profile.imie_nazwisko ?? user.email ?? '';
	const temat = `Zgłoszenie wyrejestrowania pojazdu ${identyfikator} — ${klient.nazwa}`.replace(/[\r\n]+/g, ' ').slice(0, 200);

	const pola: [string, string | null | undefined][] = [
		['Ubezpieczający', klient.nazwa],
		['NIP', klient.nip],
		['REGON', klient.regon],
		['Pojazd', pojazdOpis],
		['Nr rejestracyjny', pojazd.bez_rejestracji ? null : pojazd.nr_rejestracyjny],
		['VIN', pojazd.vin],
		['Nr nadwozia / ramy', pojazd.nr_nadwozia],
		['Nr silnika', pojazd.nr_silnika],
		['Rok produkcji', pojazd.rok_produkcji ? String(pojazd.rok_produkcji) : null],
		['Kalkulacyjny rodzaj pojazdu', pojazd.rodzaj_kalkulacyjny],
		['Polisa', polisa ? `${polisa.nr_polisy} (${polisa.data_od} — ${polisa.data_do})` : null],
		['Umowa generalna', ugNr]
	];
	const wypelnione = pola.filter((x): x is [string, string] => !!x[1]);
	const wstep = `w imieniu Ubezpieczającego zgłaszam wyrejestrowanie pojazdu z ochrony ubezpieczeniowej z powodu: ${POWODY[powod]}${data_zdarzenia ? ` (data zdarzenia: ${data_zdarzenia})` : ''}.`;
	const prosba = 'Proszę o potwierdzenie przyjęcia zgłoszenia i rozliczenie składki za niewykorzystany okres ochrony.';
	const zalacznikiOpis = `W załączeniu dokumenty potwierdzające: ${zalaczniki.map((z) => z.nazwa).join(', ')}.`;

	const html = `<!DOCTYPE html><html lang="pl"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#121826;max-width:640px;margin:auto;padding:24px">
<p>Dzień dobry,</p>
<p>${esc(wstep)}</p>
<table style="border-collapse:collapse;margin:16px 0;font-size:14px">
${wypelnione.map(([k, v]) => `<tr><td style="padding:4px 10px;color:#5E6A7E;white-space:nowrap">${esc(k)}</td><td style="padding:4px 10px"><strong>${esc(v)}</strong></td></tr>`).join('\n')}
</table>
${tresc ? `<p style="white-space:pre-wrap">${esc(tresc)}</p>` : ''}
<p>${esc(zalacznikiOpis)}</p>
<p>${esc(prosba)}</p>
<p style="margin-top:24px">Z poważaniem,<br><strong>${esc(nadawcaNazwa)}</strong><br>${esc(ust.firma)}<br>${esc(user.email ?? '')}</p>
<p style="margin:24px 0 0;font-size:12px;color:#5E6A7E">Wiadomość wysłana z systemu obsługi klientów ${esc(ust.firma)}.</p>
</body></html>`;

	const text = [
		'Dzień dobry,',
		'',
		wstep,
		'',
		...wypelnione.map(([k, v]) => `${k}: ${v}`),
		'',
		...(tresc ? [tresc, ''] : []),
		zalacznikiOpis,
		prosba,
		'',
		'Z poważaniem,',
		nadawcaNazwa,
		ust.firma,
		user.email ?? ''
	].join('\n');

	// --- wysyłka (jak e-mail do klienta: od firmy, w imieniu doradcy, odpowiedzi do doradcy) ---
	const odpowiedzi = profile.email && EMAIL_RE.test(profile.email) && !/\.invalid$/i.test(profile.email) ? profile.email : undefined;
	const nadawca = ust.adres;
	const wynik = await wyslijEmail(ust.klucz, {
		from: `"${nazwaNadawcy(profile.imie_nazwisko, ust.firma)}" <${nadawca}>`,
		to: adresaci,
		cc,
		replyTo: odpowiedzi,
		subject: temat,
		html,
		text,
		attachments
	});
	const blad = wynik.ok ? null : bezAdresow(wynik.blad);
	const resendId = wynik.ok ? wynik.id : null;

	// --- ślad przy kliencie (również nieudanej próby — musi zostać) ---
	const { error: insErr } = await admin.from('crm_vehicle_deregistrations').insert([
		{
			id: zgloszenieId,
			tenant_id: profile.tenant_id,
			klient_id: klient.id,
			pojazd_id: pojazd.id,
			polisa_id: polisa?.id ?? null,
			tu_id: tu.id,
			powod,
			data_zdarzenia,
			tresc,
			pojazd_opis: pojazdOpis,
			adresaci,
			cc,
			nadawca,
			temat,
			zalaczniki,
			status: blad ? 'blad' : 'wyslane',
			resend_id: resendId,
			blad,
			wyslal_id: profile.id,
			wyslal_nazwa: nadawcaNazwa
		}
	]);
	if (insErr) throw error(500, `Wysyłka ${blad ? 'nie powiodła się' : 'poszła'}, ale nie udało się zapisać zgłoszenia: ${insErr.message}`);

	if (!blad) {
		await admin.from('crm_vehicles').update({ wyrejestrowany_at: data_zdarzenia ?? new Date().toISOString().slice(0, 10) }).eq('id', pojazd.id).eq('tenant_id', profile.tenant_id);

		// Historia e-maili klienta: stan dostawy dopisze webhook Resend po dostawca_id.
		const { error: emErr } = await admin.from('crm_client_emails').insert({
			tenant_id: profile.tenant_id,
			klient_id: klient.id,
			polisa_ids: polisa ? [polisa.id] : [],
			rodzaj: 'inne',
			adres: [...adresaci, ...cc.map((a) => `CC: ${a}`)].join(', ').slice(0, 320),
			temat: temat.slice(0, 500),
			tresc: text.slice(0, 20000),
			dostawca_id: resendId,
			autor_id: profile.id,
			zalaczniki: zalaczniki.map((z) => z.nazwa)
		});
		if (emErr) console.error('wyrejestrowanie: historia e-maili:', emErr.message);
	}

	await admin.from('crm_audit_log').insert([
		{
			tenant_id: profile.tenant_id,
			user_id: profile.id,
			user_email: profile.email ?? null,
			user_name: profile.imie_nazwisko ?? null,
			action: blad ? 'vehicle_deregistration_failed' : 'vehicle_deregistration_sent',
			entity_type: 'vehicle',
			entity_id: pojazd.id,
			entity_label: pojazdOpis,
			details: { zgloszenie: zgloszenieId, klient: klient.nazwa, tu: tu.nazwa, adresatow: adresaci.length, cc: cc.length, powod, zalaczniki: zalaczniki.map((z) => z.nazwa), blad }
		}
	]);

	if (blad) throw error(502, `Dostawca e-maili odrzucił zgłoszenie: ${blad}. Próba została zapisana przy kliencie.`);

	return json({ success: true, id: zgloszenieId, resend_id: resendId, adresaci, cc });
};
