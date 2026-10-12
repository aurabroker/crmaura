// Pliki publiczne (grafiki i PDF-y z maili BeautyPolisy) w kubełku R2, pod kluczem publiczne/<ścieżka>.
// W mailach adres https://pliki.auraexpert.pl/media/<ścieżka> (ta domena podaje tylko /media — hooks.server.ts).
// Lista jest zamknięta: adres spoza niej to 404, więc trasa nie udostępnia żadnych innych obiektów kubełka
// (pliki polis mają klucze <tenant>/…). Część plików pochodzi z GetResponse, z którego rezygnujemy — przy
// pierwszym żądaniu serwer kopiuje je jednorazowo ze starego adresu. Dokumenty bez źródła (zrodlo: null)
// wgrywa administrator programu w Ustawieniach → Dokumenty; podmiana pliku nie zmienia adresu.

type PlikPubliczny = {
	zrodlo: string | null;
	typ: string;
	nazwa: string;
	/** Opis na liście w Ustawieniach. */
	opis: string;
	/** Program (crm_policies.ug_podtyp umowy generalnej), którego administratorzy mogą podmieniać plik. */
	program: string;
};

const GR_ZDJECIA = 'https://us-ms.gr-cdn.com/getresponse-VnDsp/photos';
const GR_PLIKI = 'https://us-wbe-img2.gr-cdn.com/user/fbd8f5a9-6595-4640-bd21-ab95d01fa5ca';
const PNG = 'image/png';
const JPG = 'image/jpeg';
const PDF = 'application/pdf';
const BEAUTY = 'oc_beauty';

export const PLIKI_PUBLICZNE: Record<string, PlikPubliczny> = {
	'beautypolisa/baner-beauty-polisa.png': { zrodlo: `${GR_ZDJECIA}/3f6d750e-5f81-4999-80d5-f25d411f8e99.png`, typ: PNG, nazwa: 'baner-beauty-polisa.png', opis: 'Baner Beauty Polisa (nagłówek maili)', program: BEAUTY },
	'beautypolisa/beauty-polisa.jpg': { zrodlo: `${GR_ZDJECIA}/86e18830-cc6d-4696-9a77-83ba79bd99a8.jpg`, typ: JPG, nazwa: 'beauty-polisa.jpg', opis: 'Grafika Beauty Polisa', program: BEAUTY },
	'beautypolisa/agent-aura-expert.png': { zrodlo: `${GR_ZDJECIA}/4fb947e4-c950-467b-9363-5a0493fb2451.png`, typ: PNG, nazwa: 'agent-aura-expert.png', opis: 'Zdjęcie agenta Aura Expert', program: BEAUTY },
	'beautypolisa/facebook.png': { zrodlo: 'https://us-as.gr-cdn.com/images/common/templates/messages/v2/social/facebook1.png', typ: PNG, nazwa: 'facebook.png', opis: 'Ikona Facebooka', program: BEAUTY },
	// Logo z maila Tax Protect — wcześniej wklejone jako załącznik na GitHubie
	'beautypolisa/logo-colonnade.png': { zrodlo: 'https://github.com/user-attachments/assets/cabd8c8d-1d72-4e25-88b1-f8d98a570a37', typ: PNG, nazwa: 'logo-colonnade.png', opis: 'Logo Colonnade', program: BEAUTY },
	'beautypolisa/lista-zabiegow-kosmetyczne-fryzjerskie.pdf': { zrodlo: `${GR_PLIKI}/34ba33fc-299f-4df6-b8ec-eb9ac8543b9e.pdf`, typ: PDF, nazwa: 'Lista zabiegów - kosmetyczne, fryzjerskie.pdf', opis: 'Lista zabiegów – kosmetyczne, fryzjerskie', program: BEAUTY },
	'beautypolisa/lista-zabiegow-kosmetologiczne-tatuaze.pdf': { zrodlo: `${GR_PLIKI}/3e42aa27-f9ab-4a96-8011-d81c205194cf.pdf`, typ: PDF, nazwa: 'Lista zabiegów - kosmetyczne, kosmetologiczne, tatuaże.pdf', opis: 'Lista zabiegów – kosmetologiczne, tatuaże', program: BEAUTY },
	'beautypolisa/lista-zabiegow-podologiczne.pdf': { zrodlo: `${GR_PLIKI}/c507c6c6-b126-4098-a3f6-630164e0f74c.pdf`, typ: PDF, nazwa: 'Lista zabiegów - podologiczne.pdf', opis: 'Lista zabiegów – podologiczne', program: BEAUTY },
	'beautypolisa/ankieta-oceny-ryzyka.pdf': { zrodlo: `${GR_PLIKI}/91e7a9d4-4357-4e29-9cc9-2386092033ce.pdf`, typ: PDF, nazwa: 'Ankieta oceny ryzyka.pdf', opis: 'Ankieta oceny ryzyka', program: BEAUTY },
	'beautypolisa/informacja-o-dystrybutorze-aura-expert.pdf': { zrodlo: `${GR_PLIKI}/e8560860-e79c-409e-8ce6-ed85ab666017.pdf`, typ: PDF, nazwa: 'Informacja o dystrybutorze Aura Expert.pdf', opis: 'Z001 – Informacja o dystrybutorze (Aura Expert)', program: BEAUTY },
	'beautypolisa/informacja-rodo-aura-expert.pdf': { zrodlo: `${GR_PLIKI}/3a250c30-f6ee-4fd1-aa01-c2845aa42c41.pdf`, typ: PDF, nazwa: 'Informacja RODO Aura Expert.pdf', opis: 'Z002 – Informacja RODO (Aura Expert)', program: BEAUTY },
	// Dokumenty linkowane w mailu z wystawioną polisą (szablon Resend „beauty-polisa-wystawiona”)
	'beautypolisa/pelnomocnictwo-likwidacja-szkod.pdf': { zrodlo: null, typ: PDF, nazwa: 'Pełnomocnictwo - likwidacja szkód.pdf', opis: 'Z003 – Wzór pełnomocnictwa brokerskiego (likwidacja szkód)', program: BEAUTY },
	'beautypolisa/wyciag-z-programu-beauty-razem.pdf': { zrodlo: null, typ: PDF, nazwa: 'Wyciąg z programu Beauty Razem.pdf', opis: 'Z004 – Wyciąg z programu ubezpieczeniowego Beauty Razem', program: BEAUTY },
	'beautypolisa/owu-oc-zawodowe-ergo-hestia.pdf': { zrodlo: null, typ: PDF, nazwa: 'OWU OC z tytułu wykonywania czynności zawodowych.pdf', opis: 'OWU OC z tytułu wykonywania czynności zawodowych (ERGO Hestia)', program: BEAUTY },
	'beautypolisa/warunki-ubezpieczenia-ulotka.pdf': { zrodlo: null, typ: PDF, nazwa: 'Warunki ubezpieczenia - ulotka.pdf', opis: 'Warunki ubezpieczenia OC zawodowego – ulotka', program: BEAUTY },
	'beautypolisa/klauzula-reklamacyjna.pdf': { zrodlo: null, typ: PDF, nazwa: 'Klauzula reklamacyjna.pdf', opis: 'Klauzula reklamacyjna', program: BEAUTY },
	'beautypolisa/oswiadczenie-administratora-danych.pdf': { zrodlo: null, typ: PDF, nazwa: 'Oświadczenie Administratora Danych Osobowych.pdf', opis: 'Oświadczenie Administratora Danych Osobowych', program: BEAUTY }
};

export const MAKS_PLIKU_PUBLICZNEGO = 15 * 1024 * 1024;
export const ADRES_PLIKOW = 'https://pliki.auraexpert.pl/media/';

const klucz = (sciezka: string) => `publiczne/${sciezka}`;

/** Treść zgadza się z typem: %PDF-, nagłówek PNG albo JPEG (żeby nie zapisać strony błędu jako pliku). */
export function zgodnyTyp(b: Uint8Array, typ: string): boolean {
	if (typ === PDF) return b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
	if (typ === PNG) return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
	if (typ === JPG) return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
	return false;
}

/** Plik z R2; gdy go nie ma — jednorazowa kopia ze starego adresu. null, gdy ścieżki nie ma na liście albo pliku nie ma skąd wziąć. */
export async function plikPubliczny(kubelek: R2Kubelek, sciezka: string): Promise<{ dane: ArrayBuffer; opis: PlikPubliczny } | null> {
	const opis = PLIKI_PUBLICZNE[sciezka];
	if (!opis) return null;
	const zapisany = await kubelek.get(klucz(sciezka));
	if (zapisany) return { dane: await zapisany.arrayBuffer(), opis };
	if (!opis.zrodlo) return null;

	const odp = await fetch(opis.zrodlo, { redirect: 'follow' });
	if (!odp.ok) return null;
	const dane = await odp.arrayBuffer();
	if (dane.byteLength === 0 || dane.byteLength > MAKS_PLIKU_PUBLICZNEGO || !zgodnyTyp(new Uint8Array(dane), opis.typ)) return null;
	await kubelek.put(klucz(sciezka), dane, { httpMetadata: { contentType: opis.typ }, customMetadata: { zrodlo: opis.zrodlo } });
	return { dane, opis };
}

export type StanPliku = { sciezka: string; adres: string; opis: string; typ: string; w_magazynie: boolean; rozmiar: number | null; wgrano: string | null; ze_zrodla: boolean };

/** Lista plików programów, które użytkownik może podmieniać (bez treści — tylko stan w kubełku). */
export async function stanPlikow(kubelek: R2Kubelek, programy: string[]): Promise<StanPliku[]> {
	const wpisy = Object.entries(PLIKI_PUBLICZNE).filter(([, p]) => programy.includes(p.program));
	return Promise.all(
		wpisy.map(async ([sciezka, p]) => {
			const meta = kubelek.head ? await kubelek.head(klucz(sciezka)) : await kubelek.get(klucz(sciezka));
			return {
				sciezka,
				adres: ADRES_PLIKOW + sciezka,
				opis: p.opis,
				typ: p.typ,
				w_magazynie: !!meta,
				rozmiar: meta?.size ?? null,
				wgrano: meta && 'uploaded' in meta && meta.uploaded ? new Date(meta.uploaded).toISOString() : null,
				ze_zrodla: !!p.zrodlo
			};
		})
	);
}

/** Wgranie / podmiana pliku z listy. Zwraca komunikat błędu albo null. */
export async function zapiszPlikPubliczny(kubelek: R2Kubelek, sciezka: string, dane: Uint8Array, autor: string): Promise<string | null> {
	const opis = PLIKI_PUBLICZNE[sciezka];
	if (!opis) return 'Nie ma takiego pliku na liście.';
	if (!dane.length) return 'Plik jest pusty.';
	if (dane.length > MAKS_PLIKU_PUBLICZNEGO) return `Plik jest za duży (limit ${MAKS_PLIKU_PUBLICZNEGO / 1024 / 1024} MB).`;
	if (!zgodnyTyp(dane, opis.typ)) return opis.typ === PDF ? 'To nie jest plik PDF.' : `Plik musi być typu ${opis.typ}.`;
	await kubelek.put(klucz(sciezka), dane, { httpMetadata: { contentType: opis.typ }, customMetadata: { wgral: autor } });
	return null;
}
