// Pliki dodane z dysku w oknie „Wyślij polisę klientowi” (np. ankieta, potwierdzenie, zdjęcie): nie trafiają do magazynu,
// idą tylko w mailu (w historii zostaje ich nazwa). Dozwolone typy dokumentów i zdjęć; treść musi pasować do rozszerzenia
// (plik z podmienioną końcówką, np. program .exe jako .pdf, jest odrzucany).
import { error } from '@sveltejs/kit';

export const MAKS_Z_DYSKU = 5;

export const TYPY_Z_DYSKU: Record<string, string> = {
	pdf: 'application/pdf',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	odt: 'application/vnd.oasis.opendocument.text',
	ods: 'application/vnd.oasis.opendocument.spreadsheet',
	txt: 'text/plain',
	csv: 'text/csv'
};
export const OPIS_TYPOW_Z_DYSKU = 'PDF, JPG, PNG, DOC, DOCX, XLS, XLSX, ODT, ODS, TXT, CSV';

export type PlikZDysku = { nazwa: string; typ: string; rozmiar: number; dane: Uint8Array | null };

/** Sama nazwa pliku (bez ścieżki), bez znaków sterujących i cudzysłowów, do 150 znaków z zachowaniem rozszerzenia. */
export function nazwaZDysku(v: unknown): string {
	const n = String(v ?? '')
		.split(/[\\/]/)
		.pop()!
		.replace(/[\u0000-\u001f\u007f"<>|?*:]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (n.length <= 150) return n;
	const ext = /\.[A-Za-z0-9]{1,5}$/.exec(n)?.[0] ?? '';
	return n.slice(0, 150 - ext.length).trimEnd() + ext;
}

export const rozszerzenie = (nazwa: string) => /\.([A-Za-z0-9]{1,5})$/.exec(nazwa)?.[1]?.toLowerCase() ?? '';

/** Pierwsze bajty pasują do rozszerzenia (PDF, JPG, PNG, dokumenty Office/OpenDocument; tekst bez bajtów zerowych). */
export function zgodnaTresc(b: Uint8Array, ext: string): boolean {
	const zaczyna = (...x: number[]) => b.length >= x.length && x.every((v, i) => b[i] === v);
	switch (ext) {
		case 'pdf':
			return zaczyna(0x25, 0x50, 0x44, 0x46, 0x2d);
		case 'jpg':
		case 'jpeg':
			return zaczyna(0xff, 0xd8, 0xff);
		case 'png':
			return zaczyna(0x89, 0x50, 0x4e, 0x47);
		case 'docx':
		case 'xlsx':
		case 'odt':
		case 'ods':
			return zaczyna(0x50, 0x4b, 0x03, 0x04);
		case 'doc':
		case 'xls':
			return zaczyna(0xd0, 0xcf, 0x11, 0xe0);
		case 'txt':
		case 'csv':
			return !b.subarray(0, 4096).includes(0);
		default:
			return false;
	}
}

function zBase64(s: string): Uint8Array {
	const bin = atob(s.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Lista plików z dysku z żądania: [{ nazwa, rozmiar, dane? (base64) }]. Przy wysyłce (zTrescia) treść jest wymagana
 * i sprawdzana; w podglądzie wystarczy nazwa i rozmiar.
 */
export function sprawdzZDysku(v: unknown, zTrescia: boolean): PlikZDysku[] {
	if (v == null) return [];
	if (!Array.isArray(v)) throw error(400, 'Nieprawidłowa lista plików z dysku.');
	if (v.length > MAKS_Z_DYSKU) throw error(400, `Najwyżej ${MAKS_Z_DYSKU} pliki z dysku.`);
	return v.map((x) => {
		const o = (x ?? {}) as Record<string, unknown>;
		const nazwa = nazwaZDysku(o.nazwa);
		const ext = rozszerzenie(nazwa);
		const typ = TYPY_Z_DYSKU[ext];
		if (!nazwa || !typ) throw error(400, `Plik „${nazwa || 'bez nazwy'}” ma niedozwolony typ — dozwolone: ${OPIS_TYPOW_Z_DYSKU}.`);
		let dane: Uint8Array | null = null;
		let rozmiar = Number(o.rozmiar);
		if (zTrescia) {
			if (typeof o.dane !== 'string' || !o.dane) throw error(400, `Brak treści pliku „${nazwa}” — dodaj go jeszcze raz.`);
			try {
				dane = zBase64(o.dane);
			} catch {
				throw error(400, `Nie udało się odczytać pliku „${nazwa}” — dodaj go jeszcze raz.`);
			}
			rozmiar = dane.length;
			if (rozmiar && !zgodnaTresc(dane, ext)) throw error(400, `Plik „${nazwa}” nie jest prawidłowym plikiem ${ext.toUpperCase()}.`);
		}
		if (!Number.isFinite(rozmiar) || rozmiar <= 0) throw error(400, `Plik „${nazwa}” jest pusty.`);
		return { nazwa, typ, rozmiar, dane };
	});
}
