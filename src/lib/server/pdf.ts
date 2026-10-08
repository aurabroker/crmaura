import { applyPdfFont, PDF_FONT } from '$lib/utils/pdfFonts';

type PdfEvent = { url: URL; platform?: { env?: { ASSETS?: { fetch(req: Request | string): Promise<Response> } } } };

// PDF generowany na serwerze (Cloudflare): czcionki z zasobów statycznych aplikacji (binding ASSETS),
// a poza Cloudflare (vite dev) — zwykłym zapytaniem do własnej domeny.
export async function newServerPdf(event: PdfEvent) {
	const { jsPDF } = await import('jspdf');
	const { default: autoTable } = await import('jspdf-autotable');
	const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	await applyPdfFont(doc, (path) => {
		const url = new URL(path, event.url.origin);
		const assets = event.platform?.env?.ASSETS;
		return assets ? assets.fetch(new Request(url)) : fetch(url);
	});
	return { doc, autoTable, font: PDF_FONT };
}
