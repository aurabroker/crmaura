// Wczytanie pliku PDF w przeglądarce. Plik nie opuszcza komputera brokera —
// warstwa tekstowa jest czytana lokalnie przez pdf.js.

import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PdfDoc, type Word } from './pdfDoc';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export { PdfDoc } from './pdfDoc';
export type { Word, Line } from './pdfDoc';

export async function readPdf(file: File): Promise<PdfDoc> {
	const data = new Uint8Array(await file.arrayBuffer());
	const task = pdfjs.getDocument({ data, useSystemFonts: true });
	const words: Word[] = [];
	let pageWidth = 595;
	let pageCount = 0;

	try {
		const doc = await task.promise;
		pageCount = doc.numPages;
		for (let p = 1; p <= pageCount; p++) {
			const page = await doc.getPage(p);
			if (p === 1) pageWidth = page.getViewport({ scale: 1 }).width;
			const content = await page.getTextContent();
			for (const item of content.items) {
				if (!('str' in item)) continue;
				const text = item.str.trim();
				if (!text) continue;
				words.push({ page: p, x: item.transform[4], y: item.transform[5], text });
			}
		}
	} finally {
		// Zwalnia workera pdf.js — bez tego każdy wgrany plik zostawia go w pamięci.
		await task.destroy();
	}

	if (!words.length)
		throw new Error(
			'Ten PDF nie ma warstwy tekstowej (prawdopodobnie skan). Moduł obsługuje wyłącznie polisy generowane elektronicznie.'
		);

	return new PdfDoc(words, pageCount, pageWidth);
}
