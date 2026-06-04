import type { ApkForm } from '$lib/types/database';
import { sb } from '$lib/supabase';

function buildPdfDoc(form: ApkForm, jsPDF: any, autoTable: any) {
	const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	const now = new Date();
	const generated = now.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });

	doc.setFontSize(18);
	doc.setFont('helvetica', 'bold');
	doc.text('Analiza Potrzeb Klienta (APK)', 14, 20);

	doc.setFontSize(9);
	doc.setFont('helvetica', 'normal');
	doc.setTextColor(120);
	doc.text('Formularz zgodny z art. 8 Ustawy o dystrybucji ubezpieczeń (KNF)', 14, 27);
	doc.text(`Wygenerowano: ${generated}`, 196, 27, { align: 'right' });
	doc.setTextColor(0);

	doc.setDrawColor(200);
	doc.line(14, 30, 196, 30);

	autoTable(doc, {
		startY: 34,
		head: [],
		body: [
			['Nr Ref:', form.ref_number, 'Data:', form.form_date],
			['Klient:', form.crm_clients?.nazwa ?? form.client_name, 'Doradca:', form.advisor_name ?? '—'],
			['Status:', form.status === 'submitted' ? 'Złożony' : 'Szkic', 'Złożony:', form.submitted_at ? form.submitted_at.slice(0, 16).replace('T', ' ') : '—'],
			['Tryb:', form.mode === 'client' ? 'Klient wypełnia sam' : 'Doradca z klientem', '', ''],
		],
		columnStyles: {
			0: { fontStyle: 'bold', cellWidth: 28, fillColor: [248, 249, 250] },
			1: { cellWidth: 66 },
			2: { fontStyle: 'bold', cellWidth: 28, fillColor: [248, 249, 250] },
			3: { cellWidth: 66 },
		},
		styles: { fontSize: 9, cellPadding: 3 },
		theme: 'plain',
	});

	const afterMeta = (doc as any).lastAutoTable.finalY + 6;
	const formData = form.form_data as Record<string, unknown>;
	const entries = Object.entries(formData ?? {});

	if (entries.length > 0) {
		doc.setFontSize(11);
		doc.setFont('helvetica', 'bold');
		doc.text('Dane z formularza', 14, afterMeta);

		autoTable(doc, {
			startY: afterMeta + 4,
			head: [['Pytanie / Pole', 'Odpowiedź']],
			body: entries.map(([key, val]) => [
				key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
				Array.isArray(val) ? val.join(', ') : val == null ? '—' : String(val),
			]),
			columnStyles: {
				0: { cellWidth: 80, fontStyle: 'bold', fillColor: [248, 249, 250] },
				1: { cellWidth: 108 },
			},
			styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
			headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 9 },
			theme: 'striped',
		});
	} else {
		doc.setFontSize(10);
		doc.setFont('helvetica', 'italic');
		doc.setTextColor(150);
		doc.text('Formularz nie zawiera jeszcze wypełnionych danych.', 14, afterMeta + 8);
		doc.setTextColor(0);
	}

	const pageCount = (doc as any).internal.getNumberOfPages();
	for (let i = 1; i <= pageCount; i++) {
		doc.setPage(i);
		doc.setFontSize(8);
		doc.setTextColor(160);
		doc.text(`FRANK67 CRM — APK ${form.ref_number}`, 14, 290);
		doc.text(`Strona ${i} z ${pageCount}`, 196, 290, { align: 'right' });
	}

	return doc;
}

export async function downloadApkPdf(form: ApkForm) {
	const { jsPDF } = await import('jspdf');
	const { default: autoTable } = await import('jspdf-autotable');
	const doc = buildPdfDoc(form, jsPDF, autoTable);
	doc.save(`APK_${form.ref_number}_${form.form_date}.pdf`);
}

export async function saveApkPdf(form: ApkForm): Promise<string | null> {
	const { jsPDF } = await import('jspdf');
	const { default: autoTable } = await import('jspdf-autotable');
	const doc = buildPdfDoc(form, jsPDF, autoTable);

	const blob = doc.output('blob');
	const fileName = `${form.tenant_id}/${form.ref_number}_${form.form_date}.pdf`;

	const { error: uploadErr } = await sb.storage.from('apk-pdfs').upload(fileName, blob, {
		contentType: 'application/pdf',
		upsert: true,
	});
	if (uploadErr) throw uploadErr;

	const { data: urlData } = sb.storage.from('apk-pdfs').getPublicUrl(fileName);
	const pdfUrl = urlData?.publicUrl ?? null;

	await sb.from('apk_forms').update({ pdf_url: pdfUrl }).eq('id', form.id);

	return pdfUrl;
}
