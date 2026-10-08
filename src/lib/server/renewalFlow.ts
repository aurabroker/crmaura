import type { SupabaseClient } from '@supabase/supabase-js';
import { base64, wyslijEmail, type WynikWysylki, type Zalacznik } from '$lib/server/mail';
import {
	BUCKET,
	PREFIKS_TESTU,
	adresTestowy,
	biuro,
	czyTest,
	dodajDni,
	dzisWarszawa,
	linkDla,
	nadawca,
	ustawieniaFirmy,
	zapiszZdarzenie,
	type Klient,
	type RenewalRow
} from '$lib/server/renewals';
import { mailApk, mailBiuro, mailPotwierdzenie, mailZaproszenie, pdfApk, pdfWniosku, sygnalyApk, DECYZJA_TEKST, opisZmian } from '$lib/server/renewalDocs';

type PdfEvent = Parameters<typeof pdfWniosku>[0];

const AKTYWNE = ['utworzony', 'wyslany', 'otwarty', 'apk'];
// Ścieżka PDF analizy potrzeb w magazynie (karta klienta → Załączniki szuka jej pod tą nazwą).
export const sciezkaPdfApk = (r: Pick<RenewalRow, 'tenant_id' | 'id'>) => `${r.tenant_id}/${r.id}/apk.pdf`;

// Historia e-maili klienta (karta klienta → E-maile). Błąd zapisu nie przerywa wysyłki.
// Zapisuje adres, na który e-mail faktycznie poszedł (w trybie testowym — adres testowy).
async function zapiszEmailKlienta(admin: SupabaseClient, r: RenewalRow, adres: string, temat: string, tresc: string, dostawcaId: string | null) {
	const { error: e } = await admin.from('crm_client_emails').insert({
		tenant_id: r.tenant_id,
		klient_id: r.klient_id,
		polisa_ids: [r.polisa_id],
		rodzaj: 'odnowienie',
		adres: adres.slice(0, 320),
		temat: temat.slice(0, 500),
		tresc: tresc.slice(0, 20000),
		dostawca_id: dostawcaId
	});
	if (e) console.error('renewals: historia e-maili:', e.message);
}

// Wysyła klientowi link do wniosku (albo przypomnienie). Status i daty aktualizuje tylko po udanej wysyłce.
export async function wyslijZaproszenie(
	admin: SupabaseClient,
	r: RenewalRow,
	origin: string,
	o: { przypomnienie?: boolean; kto?: string | null } = {}
): Promise<Exclude<WynikWysylki, { ok: true }> | { ok: true; id: string | null; adres: string; test: boolean }> {
	if (!r.email) return { ok: false, status: 400, blad: 'Klient nie ma adresu e-mail.' };
	const firma = await ustawieniaFirmy(admin, r.tenant_id);
	if (!firma?.resend_api_key) return { ok: false, status: 400, blad: 'Firma nie ma klucza Resend (SAAS Admin).' };

	const link = await linkDla(r.id, origin);
	const m = mailZaproszenie(r, link, o.przypomnienie);
	const test = czyTest(firma, r);
	const adres = test ? adresTestowy() : r.email;
	const temat = (test ? PREFIKS_TESTU : '') + m.temat;
	const wynik = await wyslijEmail(firma.resend_api_key, {
		from: nadawca(),
		to: [adres],
		replyTo: biuro(),
		subject: temat,
		html: m.html,
		text: m.tekst
	});
	if (!wynik.ok) {
		await zapiszZdarzenie(admin, r, o.przypomnienie ? 'blad_przypomnienia' : 'blad_wysylki', null, { status: wynik.status, blad: wynik.blad });
		return wynik;
	}
	const teraz = new Date().toISOString();
	const zmiany: Record<string, unknown> = o.przypomnienie
		? { przypomniano_at: teraz }
		: { wyslano_at: teraz, ...(r.status === 'utworzony' ? { status: 'wyslany' } : {}) };
	// Tylko aktywny wniosek: równoległe anulowanie nie zostanie cofnięte.
	await admin.from('crm_renewals').update({ ...zmiany, updated_at: teraz }).eq('id', r.id).in('status', AKTYWNE);
	await zapiszZdarzenie(admin, r, o.przypomnienie ? 'przypomnienie' : 'wyslanie', null, { przez: o.kto ?? 'automat', ...(test ? { test: adres } : {}) });
	// Link do wniosku nie trafia do historii — to jedyne uprawnienie klienta do formularza.
	await zapiszEmailKlienta(admin, r, adres, temat, m.tekst.replace(link, '[link do wniosku]'), wynik.id);
	return { ...wynik, adres, test };
}

// Po APK (albo świadomej odmowie): PDF analizy potrzeb do magazynu i od razu e-mailem do klienta.
// To osobny dokument — wniosek przychodzi drugim e-mailem po złożeniu. Błędy trafiają do dziennika.
export async function poApk(event: PdfEvent, admin: SupabaseClient, r: RenewalRow, kto: Klient, o: { aktualizacja?: boolean } = {}) {
	let pdf: Uint8Array;
	try {
		pdf = await pdfApk(event, r, kto);
		const { error: e } = await admin.storage.from(BUCKET).upload(sciezkaPdfApk(r), pdf, { contentType: 'application/pdf', upsert: true });
		if (e) throw e;
	} catch (e) {
		console.error('renewals: PDF APK nie powstał:', (e as Error)?.message ?? e);
		await zapiszZdarzenie(admin, r, 'blad_pdf_apk', null, { blad: String((e as Error)?.message ?? e).slice(0, 300) });
		return;
	}
	if (!r.email) return;
	const firma = await ustawieniaFirmy(admin, r.tenant_id);
	if (!firma?.resend_api_key) {
		await zapiszZdarzenie(admin, r, 'blad_email_apk', null, { blad: 'Firma nie ma klucza Resend (SAAS Admin).' });
		return;
	}
	const test = czyTest(firma, r);
	const adres = test ? adresTestowy() : r.email;
	const link = await linkDla(r.id, new URL(event.url).origin);
	const m = mailApk(r, link, o.aktualizacja);
	const temat = (test ? PREFIKS_TESTU : '') + m.temat;
	const nazwa = `APK-${(r.nr_polisy ?? r.id).replace(/[^\w.-]+/g, '_')}.pdf`;
	const w = await wyslijEmail(firma.resend_api_key, {
		from: nadawca(),
		to: [adres],
		replyTo: biuro(),
		subject: temat,
		html: m.html,
		text: m.tekst,
		attachments: [{ filename: nazwa, content: base64(pdf), content_type: 'application/pdf' }]
	});
	await zapiszZdarzenie(admin, r, w.ok ? 'email_apk' : 'blad_email_apk', null, w.ok ? (test ? { test: adres } : null) : { status: w.status, blad: w.blad });
	// Link do wniosku nie trafia do historii — to jedyne uprawnienie klienta do formularza.
	if (w.ok) await zapiszEmailKlienta(admin, r, adres, temat, m.tekst.replace(link, '[link do wniosku]'), w.id);
}

// Po złożeniu wniosku: zadanie dla doradcy (najpierw — jest tanie i najważniejsze), PDF wniosku do magazynu,
// e-mail do klienta (z PDF wniosku) i do biura (same linki do CRM — bez załączników, żeby nie zapychać skrzynki).
// Decyzja jest już zapisana — błędy tutaj trafiają do dziennika, a nie do klienta.
export async function poZlozeniu(event: PdfEvent, admin: SupabaseClient, r: RenewalRow, kto: Klient): Promise<RenewalRow> {
	const firma = await ustawieniaFirmy(admin, r.tenant_id);
	// Tryb testowy: potwierdzenie „dla klienta” i kopia „dla biura” idą na adres testowy.
	const test = czyTest(firma, r);
	const pre = test ? PREFIKS_TESTU : '';
	await zadanieDlaDoradcy(admin, r, test);

	let pdf: Uint8Array | null = null;
	try {
		pdf = await pdfWniosku(event, r, kto);
		const path = `${r.tenant_id}/${r.id}/wniosek-odnowienia.pdf`;
		const { error: e } = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true });
		if (e) throw e;
		await admin.from('crm_renewals').update({ pdf_path: path }).eq('id', r.id);
		r = { ...r, pdf_path: path };
	} catch (e) {
		console.error('renewals: PDF nie powstał:', (e as Error)?.message ?? e);
		await zapiszZdarzenie(admin, r, 'blad_pdf', null, { blad: String((e as Error)?.message ?? e).slice(0, 300) });
	}

	const nazwaPdf = `Wniosek-odnowienia-${(r.nr_polisy ?? r.id).replace(/[^\w.-]+/g, '_')}.pdf`;
	const zalPdf: Zalacznik[] = pdf ? [{ filename: nazwaPdf, content: base64(pdf), content_type: 'application/pdf' }] : [];

	if (firma?.resend_api_key) {
		if (r.email) {
			const m = mailPotwierdzenie(r);
			const adres = test ? adresTestowy() : r.email;
			const temat = pre + m.temat;
			const w = await wyslijEmail(firma.resend_api_key, { from: nadawca(), to: [adres], replyTo: biuro(), subject: temat, html: m.html, text: m.tekst, attachments: zalPdf });
			await zapiszZdarzenie(admin, r, w.ok ? 'email_klient' : 'blad_email_klient', null, w.ok ? (test ? { test: adres } : null) : { status: w.status, blad: w.blad });
			if (w.ok) await zapiszEmailKlienta(admin, r, adres, temat, m.tekst, w.id);
		}

		// Do biura same linki: pliki (PDF APK, PDF wniosku, załączniki klienta) otwiera się w CRM.
		const crm = new URL(event.url).origin;
		const mb = mailBiuro(r, { polisa: `${crm}/policies/${r.polisa_id}`, klient: `${crm}/clients/${r.klient_id}?tab=zalaczniki` }, kto);
		const wb = await wyslijEmail(firma.resend_api_key, {
			from: nadawca(),
			to: [test ? adresTestowy() : biuro()],
			...(r.email ? { replyTo: r.email } : {}),
			subject: pre + mb.temat,
			html: mb.html,
			text: mb.tekst
		});
		await zapiszZdarzenie(admin, r, wb.ok ? 'email_biuro' : 'blad_email_biuro', null, wb.ok ? null : { status: wb.status, blad: wb.blad });
	} else {
		await zapiszZdarzenie(admin, r, 'blad_email_klient', null, { blad: 'Firma nie ma klucza Resend (SAAS Admin).' });
	}
	return r;
}

async function zadanieDlaDoradcy(admin: SupabaseClient, r: RenewalRow, test: boolean) {
	const { data: klient } = await admin.from('crm_clients').select('opiekun_id').eq('id', r.klient_id).maybeSingle();
	const tytul =
		(test ? PREFIKS_TESTU : '') +
		(r.decyzja === 'bez_zmian'
			? `Odnowienie bez zmian: wystaw certyfikat — ${r.klient_nazwa}`
			: r.decyzja === 'zmiany'
				? `Odnowienie ze zmianami: sprawdź i potwierdź składkę — ${r.klient_nazwa}`
				: `Klient rezygnuje z odnowienia — ${r.klient_nazwa}`);
	const zmiany = opisZmian(r.wniosek, r.apk_odmowa ? null : r.apk);
	const sygnaly = sygnalyApk(r);
	// Link gaśnie z końcem ochrony, więc to tylko zabezpieczenie (np. wniosek wysłany tuż przed północą).
	const poTerminie = !!r.okres_do && !!r.zlozono_at && dzisWarszawa() > r.okres_do;
	const opis = [
		...(test ? [`Wniosek testowy — e-maile z tego wniosku poszły na adres testowy (${adresTestowy()}), nie do klienta.`] : []),
		`${DECYZJA_TEKST[r.decyzja as keyof typeof DECYZJA_TEKST] ?? r.decyzja} (wniosek online, certyfikat ${r.nr_polisy ?? '—'}).`,
		...(poTerminie ? [`⚠ Wniosek złożony po końcu ochrony (${r.okres_do}) — sprawdź ciągłość ubezpieczenia.`] : []),
		...zmiany.map((z) => `• ${z}`),
		...sygnaly.map((z) => `• ${z}`),
		...(r.ankieta ? ['• Ankieta Ergo Hestii: czekamy na podpisany egzemplarz od klienta.'] : []),
		...(r.wniosek?.nie_powod ? [`Powód rezygnacji: ${r.wniosek.nie_powod}`] : [])
	].join('\n');
	const { error: e } = await admin.from('crm_tasks').insert({
		tenant_id: r.tenant_id,
		klient_id: r.klient_id,
		polisa_id: r.polisa_id,
		assigned_to: klient?.opiekun_id ?? r.created_by ?? null,
		tytul: tytul.slice(0, 200),
		opis,
		termin: dodajDni(dzisWarszawa(), r.decyzja === 'nie' || poTerminie ? 1 : 2),
		priorytet: poTerminie ? 'pilny' : r.decyzja === 'bez_zmian' && !sygnaly.length ? 'normalny' : 'wysoki',
		// Status jawnie: domyślny w bazie („Oczekujące”) aplikacja nie traktuje jako otwarte zadanie.
		status: 'otwarte'
	});
	if (e) {
		console.error('renewals: zadanie nie utworzone:', e.message);
		await zapiszZdarzenie(admin, r, 'blad_zadania', null, { blad: e.message.slice(0, 300) });
	}
}
