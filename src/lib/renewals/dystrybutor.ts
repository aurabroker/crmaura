// Dystrybutor ubezpieczeń w programie Beauty❤️Polisa (umowa generalna OC z STU Ergo Hestia SA).
// Stopka wszystkich maili programu z AuraCRM (zaproszenie do wniosku, przypomnienie, APK, potwierdzenia)
// i stopka formularza wniosku wskazują dystrybutora i linkują informację o dystrybutorze (PDF Z001).
// PDF leży w plikach publicznych (plikiPubliczne.ts: beautypolisa/informacja-o-dystrybutorze-aura-expert.pdf),
// ten sam, który HUB dołącza do maili i który linkuje strona rozmowy z asystentką AI.
// Moduł bez importów $lib — używa go też komponent kliencki formularza.

export const DYSTRYBUTOR_NAZWA = 'Aura Expert sp. z o.o.';
export const DYSTRYBUTOR_RPU = '11229690/A';
export const DYSTRYBUTOR_ADRES = 'ul. Bolkowska 2A/28, 01-466 Warszawa';
export const DYSTRYBUTOR_STRONA = 'https://auraexpert.pl/';
export const DYSTRYBUTOR_PDF = 'https://pliki.auraexpert.pl/media/beautypolisa/informacja-o-dystrybutorze-aura-expert.pdf';

const opis = `agent ubezpieczeniowy (RPU ${DYSTRYBUTOR_RPU})`;

export const stopkaHtml = (): string =>
	`Beauty❤️Polisa · Dystrybutor: <a href="${DYSTRYBUTOR_STRONA}" target="_blank" rel="noopener noreferrer" style="color:#64748b;">${DYSTRYBUTOR_NAZWA}</a>, ${opis}, ${DYSTRYBUTOR_ADRES}` +
	` · <a href="${DYSTRYBUTOR_PDF}" target="_blank" rel="noopener noreferrer" style="color:#64748b;">Informacja o dystrybutorze (PDF)</a>`;

export const stopkaTekst = (): string =>
	`Beauty❤️Polisa · Dystrybutor: ${DYSTRYBUTOR_NAZWA}, ${opis}, ${DYSTRYBUTOR_ADRES} · auraexpert.pl\n` +
	`Informacja o dystrybutorze: ${DYSTRYBUTOR_PDF}`;
