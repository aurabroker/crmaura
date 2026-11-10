import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GENEROWANA_ANKIETA, PLIKI_PUBLICZNE, plikPubliczny } from './plikiPubliczne.ts';

const SCIEZKA = 'beautypolisa/lista-zabiegow-kosmetyczne-fryzjerskie.pdf';
const KLUCZ = `publiczne/${SCIEZKA}`;
const pdf = (tresc: string) => new TextEncoder().encode(`%PDF-1.7 ${tresc}`);
const tekst = (b: ArrayBuffer) => new TextDecoder().decode(b);

// Atrapa kubełka R2: tylko get / put z metadanymi.
function kubelek(poczatek: Record<string, { dane: Uint8Array; customMetadata?: Record<string, string> }> = {}) {
	const obiekty = new Map(Object.entries(poczatek));
	const zapisy: string[] = [];
	return {
		zapisy,
		obiekty,
		k: {
			async get(klucz: string) {
				const o = obiekty.get(klucz);
				return o ? { body: null as never, size: o.dane.length, customMetadata: o.customMetadata, arrayBuffer: async () => o.dane.buffer.slice(o.dane.byteOffset, o.dane.byteOffset + o.dane.byteLength) as ArrayBuffer } : null;
			},
			async put(klucz: string, dane: ArrayBuffer | Uint8Array, opcje?: { customMetadata?: Record<string, string> }) {
				zapisy.push(klucz);
				obiekty.set(klucz, { dane: dane instanceof Uint8Array ? dane : new Uint8Array(dane), customMetadata: opcje?.customMetadata });
			},
			async delete() {}
		}
	};
}
const zrodlo = PLIKI_PUBLICZNE[SCIEZKA].zrodlo!;
const pobierz = (tresc: string | null, wywolania: string[] = []) => async (z: string) => {
	wywolania.push(z);
	return tresc == null ? new Response('brak', { status: 404 }) : new Response(pdf(tresc));
};

test('listy zabiegów mają źródło w zasobach aplikacji, a pliki leżą w static/', () => {
	for (const s of [SCIEZKA, 'beautypolisa/lista-zabiegow-kosmetologiczne-tatuaze.pdf']) {
		const z = PLIKI_PUBLICZNE[s].zrodlo!;
		assert.match(z, /^\/dokumenty\/beautypolisa\/.+-aneks-5\.pdf$/);
		assert.equal(readFileSync(new URL(`../../../static${z}`, import.meta.url)).subarray(0, 5).toString(), '%PDF-');
	}
});

test('kopia z poprzedniego źródła jest odświeżana, gdy dokument ma nową wersję', async () => {
	const b = kubelek({ [KLUCZ]: { dane: pdf('stara lista'), customMetadata: { zrodlo: 'https://stare.example/lista.pdf' } } });
	const w: string[] = [];
	const plik = await plikPubliczny(b.k, SCIEZKA, pobierz('nowa lista', w));
	assert.equal(tekst(plik!.dane), '%PDF-1.7 nowa lista');
	assert.deepEqual(w, [zrodlo]);
	assert.deepEqual(b.obiekty.get(KLUCZ)?.customMetadata, { zrodlo });
	// Drugie żądanie: kopia jest już z obecnego źródła — bez pobierania.
	await plikPubliczny(b.k, SCIEZKA, pobierz('jeszcze inna', w));
	assert.equal(w.length, 1);
});

test('plik wgrany w Ustawieniach ma pierwszeństwo przed źródłem', async () => {
	const b = kubelek({ [KLUCZ]: { dane: pdf('wgrany przez administratora'), customMetadata: { wgral: 'u1' } } });
	const w: string[] = [];
	const plik = await plikPubliczny(b.k, SCIEZKA, pobierz('z aplikacji', w));
	assert.equal(tekst(plik!.dane), '%PDF-1.7 wgrany przez administratora');
	assert.equal(w.length, 0);
	assert.equal(b.zapisy.length, 0);
});

test('nowe źródło niedostępne albo nie-PDF: zostaje dotychczasowa kopia; bez kopii — brak pliku', async () => {
	const stara = { [KLUCZ]: { dane: pdf('stara lista'), customMetadata: { zrodlo: 'https://stare.example/lista.pdf' } } };
	const b = kubelek(stara);
	assert.equal(tekst((await plikPubliczny(b.k, SCIEZKA, pobierz(null)))!.dane), '%PDF-1.7 stara lista');
	assert.equal(tekst((await plikPubliczny(b.k, SCIEZKA, async () => new Response('<html>błąd</html>')))!.dane), '%PDF-1.7 stara lista');
	assert.equal(tekst((await plikPubliczny(b.k, SCIEZKA, async () => { throw new Error('sieć'); }))!.dane), '%PDF-1.7 stara lista');
	assert.equal(b.zapisy.length, 0);
	assert.equal(await plikPubliczny(kubelek().k, SCIEZKA, pobierz(null)), null);
	assert.equal(await plikPubliczny(kubelek().k, 'beautypolisa/nie-ma-takiego.pdf', pobierz('x')), null);
});

test('pierwsze żądanie bez kopii zapisuje plik ze źródła', async () => {
	const b = kubelek();
	const plik = await plikPubliczny(b.k, SCIEZKA, pobierz('lista'));
	assert.equal(tekst(plik!.dane), '%PDF-1.7 lista');
	assert.deepEqual(b.zapisy, [KLUCZ]);
});

test('czysty formularz ankiety: źródło generowane ze skrótem listy zabiegów, stara kopia z GetResponse jest zastępowana', async () => {
	const sciezka = 'beautypolisa/ankieta-oceny-ryzyka.pdf';
	const klucz = `publiczne/${sciezka}`;
	const z = PLIKI_PUBLICZNE[sciezka].zrodlo!;
	assert.match(z, new RegExp(`^${GENEROWANA_ANKIETA}/u\\d+-[0-9a-f]{8}$`));
	assert.match(PLIKI_PUBLICZNE[sciezka].opis, /Aneks nr 5/);
	const b = kubelek({ [klucz]: { dane: pdf('formularz z dawnymi nazwami'), customMetadata: { zrodlo: 'https://us-wbe-img2.gr-cdn.com/user/x/ankieta.pdf' } } });
	const w: string[] = [];
	const plik = await plikPubliczny(b.k, sciezka, pobierz('formularz wg aneksu', w));
	assert.equal(tekst(plik!.dane), '%PDF-1.7 formularz wg aneksu');
	assert.deepEqual(w, [z]);
	assert.deepEqual(b.obiekty.get(klucz)?.customMetadata, { zrodlo: z });
	// Kopia z obecnej wersji listy: formularz nie jest rysowany ponownie.
	await plikPubliczny(b.k, sciezka, pobierz('kolejny', w));
	assert.equal(w.length, 1);
});
