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
import { mailBiuro, mailPotwierdzenie, mailZaproszenie, pdfWniosku, sygnalyApk, DECYZJA_TEKST, opisZmian } from '$lib/server/renewalDocs';

type PdfEvent = Parameters<typeof pdfWniosku>[0];

const AKTYWNE = ['utworzony', 'wyslany', 'otwarty', 'apk'];
// Łączny rozmiar załączników e-maila do biura (PDF wniosku + pliki klienta, przed base64).
const BUDZET_ZALACZNIKOW = 10 * 1024 * 1024;

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

// Typ pliku po pierwszych bajtach — klient deklaruje typ sam, więc sprawdzamy zawartość.
function typZawartosci(b: Uint8Array): string | null {
	const ascii = (od: number, dl: number) => String.fromCharCode(...b.subarray(od, od + dl));
	if (ascii(0, 5) === '%PDF-') return 'application/pdf';
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
	if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
	if (ascii(4, 4) === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(8, 4))) return 'image/heic';
	return null;
}
const ROZSZERZENIE: Record<string, string> = {
	'application/pdf': 'pdf',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/heic': 'heic',
	'image/heif': 'heic'
};

// Pliki klienta do e-maila biura: nazwa nadana przez serwer (rodzaj + numer + rozszerzenie z typu),
// typ sprawdzony po zawartości, rozmiar liczony z pobranych bajtów (nie z deklaracji klienta).
async function zalacznikiKlienta(admin: SupabaseClient, r: RenewalRow, budzet: number): Promise<{ pliki: Zalacznik[]; pominiete: string[] }> {
	const pliki: Zalacznik[] = [];
	const pominiete: string[] = [];
	let rozmiar = 0;
	let n = 0;
	for (const z of r.zalaczniki ?? []) {
		const { data: plik } = await admin.storage.from(BUCKET).download(z.path);
		if (!plik) continue;
		const bajty = new Uint8Array(await plik.arrayBuffer());
		const typ = typZawartosci(bajty);
		const zgodny = typ && (typ === z.mime || (typ === 'image/heic' && z.mime === 'image/heif'));
		if (!zgodny) {
			pominiete.push(`${z.nazwa} (zawartość nie jest plikiem ${z.mime})`);
			continue;
		}
		if (rozmiar + bajty.length > budzet) {
			pominiete.push(`${z.nazwa} (za duży do e-maila — jest w CRM)`);
			continue;
		}
		rozmiar += bajty.length;
		n++;
		pliki.push({ filename: `${z.typ}-${n}.${ROZSZERZENIE[typ!] ?? 'bin'}`, content: base64(bajty), content_type: typ! });
	}
	return { pliki, pominiete };
}

// Po złożeniu wniosku: zadanie dla doradcy (najpierw — jest tanie i najważniejsze), PDF do magazynu,
// e-mail do klienta i biura (z PDF i plikami klienta). Decyzja jest już zapisana — błędy tutaj trafiają
// do dziennika, a nie do klienta.
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

		// Do biura dołączamy też pliki od klienta (do 10 MB łącznie z PDF); pozostałe zostają w CRM.
		const { pliki, pominiete } = await zalacznikiKlienta(admin, r, BUDZET_ZALACZNIKOW - (pdf?.length ?? 0));
		const linkCrm = `${new URL(event.url).origin}/policies/${r.polisa_id}`;
		const mb = mailBiuro(r, linkCrm, kto, pominiete);
		const wb = await wyslijEmail(firma.resend_api_key, {
			from: nadawca(),
			to: [test ? adresTestowy() : biuro()],
			...(r.email ? { replyTo: r.email } : {}),
			subject: pre + mb.temat,
			html: mb.html,
			text: mb.tekst,
			attachments: [...zalPdf, ...pliki]
		});
		await zapiszZdarzenie(admin, r, wb.ok ? 'email_biuro' : 'blad_email_biuro', null, wb.ok ? (pominiete.length ? { pominiete } : null) : { status: wb.status, blad: wb.blad });
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
	// Złożony po końcu ochrony (link jest ważny min. 14 dni): ciągłość ochrony do sprawdzenia od razu.
	const poTerminie = !!r.okres_do && !!r.zlozono_at && dzisWarszawa() > r.okres_do;
	const opis = [
		...(test ? [`Wniosek testowy — e-maile z tego wniosku poszły na adres testowy (${adresTestowy()}), nie do klienta.`] : []),
		`${DECYZJA_TEKST[r.decyzja as keyof typeof DECYZJA_TEKST] ?? r.decyzja} (wniosek online, certyfikat ${r.nr_polisy ?? '—'}).`,
		...(poTerminie ? [`⚠ Wniosek złożony po końcu ochrony (${r.okres_do}) — sprawdź ciągłość ubezpieczenia.`] : []),
		...zmiany.map((z) => `• ${z}`),
		...sygnaly.map((z) => `• ${z}`),
		...(r.ankieta ? ['• Ankieta ERGO Hestii: czekamy na podpisany egzemplarz od klienta.'] : []),
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
