import type { SupabaseClient } from '@supabase/supabase-js';
import { base64, wyslijEmail, type WynikWysylki } from '$lib/server/mail';
import {
	BUCKET,
	biuro,
	dodajDni,
	dzisWarszawa,
	linkDla,
	nadawca,
	ustawieniaFirmy,
	zapiszZdarzenie,
	type Klient,
	type RenewalRow
} from '$lib/server/renewals';
import { mailBiuro, mailPotwierdzenie, mailZaproszenie, pdfWniosku, DECYZJA_TEKST, opisZmian } from '$lib/server/renewalDocs';

type PdfEvent = Parameters<typeof pdfWniosku>[0];

// Wysyła klientowi link do wniosku (albo przypomnienie). Status i daty aktualizuje tylko po udanej wysyłce.
export async function wyslijZaproszenie(
	admin: SupabaseClient,
	r: RenewalRow,
	origin: string,
	o: { przypomnienie?: boolean; kto?: string | null } = {}
): Promise<WynikWysylki> {
	if (!r.email) return { ok: false, status: 400, blad: 'Klient nie ma adresu e-mail.' };
	const firma = await ustawieniaFirmy(admin, r.tenant_id);
	if (!firma?.resend_api_key) return { ok: false, status: 400, blad: 'Firma nie ma klucza Resend (SAAS Admin).' };

	const link = await linkDla(r.id, origin);
	const m = mailZaproszenie(r, link, o.przypomnienie);
	const wynik = await wyslijEmail(firma.resend_api_key, {
		from: nadawca(),
		to: [r.email],
		replyTo: biuro(),
		subject: m.temat,
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
	await admin.from('crm_renewals').update({ ...zmiany, updated_at: teraz }).eq('id', r.id);
	await zapiszZdarzenie(admin, r, o.przypomnienie ? 'przypomnienie' : 'wyslanie', null, { przez: o.kto ?? 'automat' });
	return wynik;
}

// Po złożeniu wniosku: PDF do magazynu, e-mail do klienta i biura (z PDF i załącznikami), zadanie dla
// doradcy. Decyzja jest już zapisana — błędy tutaj trafiają do dziennika, a nie do klienta.
export async function poZlozeniu(event: PdfEvent, admin: SupabaseClient, r: RenewalRow, kto: Klient): Promise<RenewalRow> {
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

	const firma = await ustawieniaFirmy(admin, r.tenant_id);
	const nazwaPdf = `Wniosek-odnowienia-${(r.nr_polisy ?? r.id).replace(/[^\w.-]+/g, '_')}.pdf`;
	const zalPdf = pdf ? [{ filename: nazwaPdf, content: base64(pdf) }] : [];

	if (firma?.resend_api_key) {
		if (r.email) {
			const m = mailPotwierdzenie(r);
			const w = await wyslijEmail(firma.resend_api_key, { from: nadawca(), to: [r.email], replyTo: biuro(), subject: m.temat, html: m.html, text: m.tekst, attachments: zalPdf });
			await zapiszZdarzenie(admin, r, w.ok ? 'email_klient' : 'blad_email_klient', null, w.ok ? null : { status: w.status, blad: w.blad });
		}

		// Do biura dołączamy też pliki od klienta (do 20 MB łącznie); większe zostają w CRM.
		const zalKlienta: { filename: string; content: string }[] = [];
		let rozmiar = pdf?.length ?? 0;
		for (const z of r.zalaczniki ?? []) {
			if (rozmiar + z.rozmiar > 20 * 1024 * 1024) break;
			const { data: plik } = await admin.storage.from(BUCKET).download(z.path);
			if (!plik) continue;
			rozmiar += z.rozmiar;
			zalKlienta.push({ filename: z.nazwa, content: base64(await plik.arrayBuffer()) });
		}
		const linkCrm = `${new URL(event.url).origin}/policies/${r.polisa_id}`;
		const mb = mailBiuro(r, linkCrm, kto);
		const wb = await wyslijEmail(firma.resend_api_key, {
			from: nadawca(),
			to: [biuro()],
			...(r.email ? { replyTo: r.email } : {}),
			subject: mb.temat,
			html: mb.html,
			text: mb.tekst,
			attachments: [...zalPdf, ...zalKlienta]
		});
		await zapiszZdarzenie(admin, r, wb.ok ? 'email_biuro' : 'blad_email_biuro', null, wb.ok ? null : { status: wb.status, blad: wb.blad });
	} else {
		await zapiszZdarzenie(admin, r, 'blad_email_klient', null, { blad: 'Firma nie ma klucza Resend (SAAS Admin).' });
	}

	await zadanieDlaDoradcy(admin, r);
	return r;
}

async function zadanieDlaDoradcy(admin: SupabaseClient, r: RenewalRow) {
	const { data: klient } = await admin.from('crm_clients').select('opiekun_id').eq('id', r.klient_id).maybeSingle();
	const tytul =
		r.decyzja === 'bez_zmian'
			? `Odnowienie bez zmian: wystaw certyfikat — ${r.klient_nazwa}`
			: r.decyzja === 'zmiany'
				? `Odnowienie ze zmianami: sprawdź i potwierdź składkę — ${r.klient_nazwa}`
				: `Klient rezygnuje z odnowienia — ${r.klient_nazwa}`;
	const zmiany = opisZmian(r.wniosek, r.apk_odmowa ? null : r.apk);
	const opis = [
		`${DECYZJA_TEKST[r.decyzja as keyof typeof DECYZJA_TEKST] ?? r.decyzja} (wniosek online, certyfikat ${r.nr_polisy ?? '—'}).`,
		...zmiany.map((z) => `• ${z}`),
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
		termin: dodajDni(dzisWarszawa(), r.decyzja === 'nie' ? 1 : 2),
		priorytet: r.decyzja === 'bez_zmian' ? 'normalny' : 'wysoki'
	});
	if (e) {
		console.error('renewals: zadanie nie utworzone:', e.message);
		await zapiszZdarzenie(admin, r, 'blad_zadania', null, { blad: e.message.slice(0, 300) });
	}
}
