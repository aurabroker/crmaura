// Pliki publiczne (grafiki i PDF-y z maili BeautyPolisy) w kubełku R2, pod kluczem publiczne/<ścieżka>.
// W mailach adres https://pliki.auraexpert.pl/media/<ścieżka> (ta domena podaje tylko /media — hooks.server.ts).
// Wcześniej leżały w GetResponse, z którego rezygnujemy. Lista jest zamknięta: adres spoza niej to 404,
// więc trasa nie udostępnia żadnych innych obiektów kubełka (pliki polis mają klucze <tenant>/…).
// Przy pierwszym żądaniu pliku, którego jeszcze nie ma w R2, serwer pobiera go jednorazowo ze starego
// adresu w GetResponse i zapisuje w kubełku — potem źródło nie jest już potrzebne.

type PlikPubliczny = { zrodlo: string; typ: string; nazwa: string };

const GR_ZDJECIA = 'https://us-ms.gr-cdn.com/getresponse-VnDsp/photos';
const GR_PLIKI = 'https://us-wbe-img2.gr-cdn.com/user/fbd8f5a9-6595-4640-bd21-ab95d01fa5ca';
const PNG = 'image/png';
const JPG = 'image/jpeg';
const PDF = 'application/pdf';

export const PLIKI_PUBLICZNE: Record<string, PlikPubliczny> = {
	'beautypolisa/baner-beauty-polisa.png': { zrodlo: `${GR_ZDJECIA}/3f6d750e-5f81-4999-80d5-f25d411f8e99.png`, typ: PNG, nazwa: 'baner-beauty-polisa.png' },
	'beautypolisa/beauty-polisa.jpg': { zrodlo: `${GR_ZDJECIA}/86e18830-cc6d-4696-9a77-83ba79bd99a8.jpg`, typ: JPG, nazwa: 'beauty-polisa.jpg' },
	'beautypolisa/agent-aura-expert.png': { zrodlo: `${GR_ZDJECIA}/4fb947e4-c950-467b-9363-5a0493fb2451.png`, typ: PNG, nazwa: 'agent-aura-expert.png' },
	'beautypolisa/facebook.png': { zrodlo: 'https://us-as.gr-cdn.com/images/common/templates/messages/v2/social/facebook1.png', typ: PNG, nazwa: 'facebook.png' },
	'beautypolisa/lista-zabiegow-kosmetyczne-fryzjerskie.pdf': { zrodlo: `${GR_PLIKI}/34ba33fc-299f-4df6-b8ec-eb9ac8543b9e.pdf`, typ: PDF, nazwa: 'Lista zabiegów - kosmetyczne, fryzjerskie.pdf' },
	'beautypolisa/lista-zabiegow-kosmetologiczne-tatuaze.pdf': { zrodlo: `${GR_PLIKI}/3e42aa27-f9ab-4a96-8011-d81c205194cf.pdf`, typ: PDF, nazwa: 'Lista zabiegów - kosmetyczne, kosmetologiczne, tatuaże.pdf' },
	'beautypolisa/lista-zabiegow-podologiczne.pdf': { zrodlo: `${GR_PLIKI}/c507c6c6-b126-4098-a3f6-630164e0f74c.pdf`, typ: PDF, nazwa: 'Lista zabiegów - podologiczne.pdf' },
	'beautypolisa/ankieta-oceny-ryzyka.pdf': { zrodlo: `${GR_PLIKI}/91e7a9d4-4357-4e29-9cc9-2386092033ce.pdf`, typ: PDF, nazwa: 'Ankieta oceny ryzyka.pdf' },
	'beautypolisa/informacja-o-dystrybutorze-aura-expert.pdf': { zrodlo: `${GR_PLIKI}/e8560860-e79c-409e-8ce6-ed85ab666017.pdf`, typ: PDF, nazwa: 'Informacja o dystrybutorze Aura Expert.pdf' },
	'beautypolisa/informacja-rodo-aura-expert.pdf': { zrodlo: `${GR_PLIKI}/3a250c30-f6ee-4fd1-aa01-c2845aa42c41.pdf`, typ: PDF, nazwa: 'Informacja RODO Aura Expert.pdf' },
	// Logo z maila Tax Protect — wcześniej wklejone jako załącznik na GitHubie
	'beautypolisa/logo-colonnade.png': { zrodlo: 'https://github.com/user-attachments/assets/cabd8c8d-1d72-4e25-88b1-f8d98a570a37', typ: PNG, nazwa: 'logo-colonnade.png' }
};

const MAKS = 15 * 1024 * 1024;

/** Treść zgadza się z typem: %PDF-, nagłówek PNG albo JPEG (żeby nie zapisać strony błędu jako pliku). */
export function zgodnyTyp(b: Uint8Array, typ: string): boolean {
	if (typ === PDF) return b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
	if (typ === PNG) return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
	if (typ === JPG) return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
	return false;
}

/** Plik z R2; gdy go nie ma — jednorazowa kopia ze starego adresu. null, gdy ścieżki nie ma na liście albo źródło nie odpowiada. */
export async function plikPubliczny(kubelek: R2Kubelek, sciezka: string): Promise<{ dane: ArrayBuffer; opis: PlikPubliczny } | null> {
	const opis = PLIKI_PUBLICZNE[sciezka];
	if (!opis) return null;
	const klucz = `publiczne/${sciezka}`;
	const zapisany = await kubelek.get(klucz);
	if (zapisany) return { dane: await zapisany.arrayBuffer(), opis };

	const odp = await fetch(opis.zrodlo, { redirect: 'follow' });
	if (!odp.ok) return null;
	const dane = await odp.arrayBuffer();
	if (dane.byteLength === 0 || dane.byteLength > MAKS || !zgodnyTyp(new Uint8Array(dane), opis.typ)) return null;
	await kubelek.put(klucz, dane, { httpMetadata: { contentType: opis.typ }, customMetadata: { zrodlo: opis.zrodlo } });
	return { dane, opis };
}
