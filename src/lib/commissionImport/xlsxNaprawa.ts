// SheetJS 0.18.5 psuje polskie litery w komórkach typu „str” (tekst zapisany jak wynik formuły), gdy plik
// koduje je encjami XML, np. „Jasi&#324;ska”: biblioteka dekoduje tekst drugi raz jak UTF-8, więc z „ń”
// zostaje „D” (Node) albo znak spoza zakresu, który zjada kolejne litery (przeglądarka). Tak zapisuje
// nazwiska zestawienie Leadenhall. Czytamy wtedy surowy XML arkusza i nadpisujemy wartości takich komórek.
// Kwot i numerów polis to nie dotyczy (same cyfry), ale nazwiska w podglądzie importu muszą być poprawne.

type Ksiazka = { SheetNames: string[]; Sheets: Record<string, Record<string, { v?: unknown; w?: string } | undefined>>; Directory?: { sheets?: string[] } };
type Biblioteka = {
	CFB: { read: (d: Uint8Array, o: { type: 'array' }) => unknown; find: (c: unknown, p: string) => { content?: ArrayLike<number> } | null };
	utils: { decode_col: (c: string) => number; encode_cell: (a: { r: number; c: number }) => string };
};

const ENCJE: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function dekodujXml(t: string): string {
	return t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (calosc, e: string) => {
		if (e[0] !== '#') return ENCJE[e.toLowerCase()] ?? calosc;
		const kod = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
		return Number.isFinite(kod) && kod > 0 && kod <= 0x10ffff ? String.fromCodePoint(kod) : calosc;
	});
}

/** Poprawia teksty komórek „str” zakodowanych encjami w arkuszu o danym indeksie. Zwraca liczbę poprawek. */
export function naprawKomorkiStr(XLSX: Biblioteka, dane: Uint8Array, wb: Ksiazka, indeks = 0): number {
	const sciezka = wb.Directory?.sheets?.[indeks];
	const ws = wb.Sheets[wb.SheetNames[indeks]];
	if (!sciezka || !ws) return 0;
	let xml: string;
	try {
		const plik = XLSX.CFB.find(XLSX.CFB.read(dane, { type: 'array' }), sciezka);
		if (!plik?.content) return 0;
		xml = new TextDecoder('utf-8').decode(new Uint8Array(plik.content));
	} catch {
		return 0;
	}
	let poprawione = 0;
	// Adres komórki: z atrybutu r, a gdy go nie ma (tak zapisuje Leadenhall) — z kolejności wierszy i komórek.
	let wiersz = 0;
	for (const mw of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
		const [, atrWiersza, komorki] = mw;
		const nrWiersza = atrWiersza.match(/\br="(\d+)"/)?.[1];
		wiersz = nrWiersza ? Number(nrWiersza) : wiersz + 1;
		if (komorki == null) continue;
		let kolumna = 0;
		for (const mk of komorki.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const [, atrybuty, wnetrze] = mk;
			const ref = atrybuty.match(/\br="([A-Z]+)\d+"/)?.[1];
			kolumna = ref ? XLSX.utils.decode_col(ref) + 1 : kolumna + 1;
			if (wnetrze == null || !/\bt="str"/.test(atrybuty)) continue;
			const surowe = wnetrze.match(/<v>([\s\S]*?)<\/v>/)?.[1];
			if (surowe == null || !surowe.includes('&#')) continue;
			const komorka = ws[XLSX.utils.encode_cell({ r: wiersz - 1, c: kolumna - 1 })];
			const tekst = dekodujXml(surowe);
			if (komorka && komorka.v !== tekst) {
				komorka.v = tekst;
				komorka.w = tekst;
				poprawione++;
			}
		}
	}
	return poprawione;
}
