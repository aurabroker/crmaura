// Wbudowane czcionki jsPDF (helvetica itd.) nie mają polskich znaków: „Zażółć” wychodzi w PDF
// jako „Za|óB”. Każdy PDF dostaje więc osadzoną Roboto (SIL OFL 1.1, static/fonts/OFL.txt).

export const PDF_FONT = 'Roboto';

const FILES = {
	normal: 'Roboto-Regular.ttf',
	bold: 'Roboto-Bold.ttf',
	italic: 'Roboto-Italic.ttf'
} as const;

type Style = keyof typeof FILES;
type FontData = Record<Style, string>;

// Minimalny interfejs dokumentu jsPDF używany tutaj (jsPDF ładujemy dynamicznie).
type PdfDoc = {
	addFileToVFS(name: string, data: string): void;
	addFont(file: string, family: string, style: string): void;
	setFont(family: string, style?: string): void;
};

function toBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

// Pliki pobieramy raz na sesję strony; nieudane pobranie nie zostaje w pamięci podręcznej.
let cache: Promise<FontData> | null = null;

// Pobiera plik czcionki (ścieżka względem katalogu static, np. /fonts/Roboto-Regular.ttf).
export type FontFetcher = (path: string) => Promise<Response>;

async function loadFonts(fetchFont: FontFetcher): Promise<FontData> {
	const entries = await Promise.all(
		(Object.entries(FILES) as [Style, string][]).map(async ([style, file]) => {
			const res = await fetchFont(`/fonts/${file}`);
			if (!res.ok) throw new Error(`Nie udało się pobrać czcionki ${file} (HTTP ${res.status})`);
			return [style, toBase64(await res.arrayBuffer())] as const;
		})
	);
	return Object.fromEntries(entries) as FontData;
}

// Osadza Roboto (zwykła, pogrubiona, kursywa) i ustawia ją jako bieżącą czcionkę dokumentu.
// W przeglądarce pliki idą z tej samej domeny; serwer podaje własny `fetchFont` (zasoby statyczne).
export async function applyPdfFont(doc: PdfDoc, fetchFont: FontFetcher = (path) => fetch(path)): Promise<void> {
	if (!cache) {
		cache = loadFonts(fetchFont).catch((e) => {
			cache = null;
			throw e;
		});
	}
	const fonts = await cache;
	for (const style of Object.keys(FILES) as Style[]) {
		doc.addFileToVFS(FILES[style], fonts[style]);
		doc.addFont(FILES[style], PDF_FONT, style);
	}
	doc.setFont(PDF_FONT, 'normal');
}
