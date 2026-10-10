// Szablony e-maili do klienta (Panel 360° → „Napisz e-mail”). Zwykły tekst — doradca może go dowolnie
// zmienić przed wysyłką; serwer zamienia go na prosty HTML.
import type { Client, Policy, PolicyPayment } from '$lib/types/database';
import { nazwaRodzaju, nazwaTu } from '$lib/statusPolisy';
import { fmtPln } from '$lib/utils';

export type Szablon = 'wlasny' | 'rata' | 'odnowienie' | 'dokumenty' | 'potwierdzenie';
export const SZABLONY: { id: Szablon; nazwa: string; polisa: boolean }[] = [
	{ id: 'wlasny', nazwa: 'Własna wiadomość', polisa: false },
	{ id: 'rata', nazwa: 'Przypomnienie o racie', polisa: true },
	{ id: 'odnowienie', nazwa: 'Odnowienie', polisa: true },
	{ id: 'dokumenty', nazwa: 'Prośba o dokumenty', polisa: false },
	{ id: 'potwierdzenie', nazwa: 'Potwierdzenie zawarcia', polisa: true }
];

export type Nadawca = { imie: string | null; stanowisko: string | null; telefon: string | null; firma: string };
export type Kontekst = {
	klient: Pick<Client, 'nazwa' | 'nazwa_skrocona'>;
	polisa: Policy | null;
	raty: PolicyPayment[]; // raty wybranej polisy
	zalacznikPolisy: boolean;
	nadawca: Nadawca;
	dzis: string;
};

const data = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '—');
const ROZLICZONE = ['Opłacona', 'Częściowo opłacona'];

function podpis(n: Nadawca): string {
	return ['Z poważaniem', n.imie, n.stanowisko, n.firma, n.telefon].filter(Boolean).join('\n');
}

function opisPolisy(p: Policy): string {
	return `polisę nr ${p.nr_polisy} (${nazwaRodzaju(p.rodzaj)}, ${nazwaTu(p)})`;
}

export function zbudujSzablon(s: Szablon, k: Kontekst): { temat: string; tresc: string } {
	const p = k.polisa;
	const koniec = `\n${podpis(k.nadawca)}`;
	switch (s) {
		case 'rata': {
			if (!p) return zbudujSzablon('wlasny', k);
			const otwarte = k.raty.filter((r) => !ROZLICZONE.includes(r.status)).sort((a, b) => a.data_platnosci.localeCompare(b.data_platnosci));
			const r = otwarte[0];
			const ile = Number(p.ilosc_rat) > 1 ? `/${p.ilosc_rat}` : '';
			const linia = r
				? `przypominam o płatności raty ${r.nr_raty}${ile} składki za ${opisPolisy(p)}:\nkwota ${fmtPln(r.kwota)} zł, termin płatności ${data(r.data_platnosci)}${r.data_platnosci < k.dzis ? ' (termin już minął)' : ''}.`
				: `przypominam o płatności składki za ${opisPolisy(p)}.`;
			return {
				temat: `Przypomnienie o płatności składki — polisa ${p.nr_polisy}`,
				tresc: `Dzień dobry,\n\n${linia}\n\nJeśli płatność została już zrealizowana, proszę potraktować tę wiadomość jako nieaktualną.\nW razie pytań pozostaję do dyspozycji.\n${koniec}`
			};
		}
		case 'odnowienie': {
			if (!p) return zbudujSzablon('wlasny', k);
			return {
				temat: `Odnowienie ubezpieczenia — polisa ${p.nr_polisy} kończy się ${data(p.data_do)}`,
				tresc:
					`Dzień dobry,\n\nochrona z polisy nr ${p.nr_polisy} (${nazwaRodzaju(p.rodzaj)}, ${nazwaTu(p)}) kończy się ${data(p.data_do)}.\n` +
					`Chętnie przygotuję propozycję odnowienia. Proszę o informację, czy zmieniło się coś, co może mieć wpływ na ubezpieczenie ` +
					`(np. zakres działalności, wartość mienia, liczba pracowników, pojazdy).\n\nPozostaję do dyspozycji.\n${koniec}`
			};
		}
		case 'dokumenty':
			return {
				temat: `Prośba o dokumenty${p ? ` — polisa ${p.nr_polisy}` : ''}`,
				tresc: `Dzień dobry,\n\ndo dalszej obsługi${p ? ` polisy nr ${p.nr_polisy}` : ''} potrzebuję następujących dokumentów:\n- \n- \n\nDokumenty można przesłać w odpowiedzi na tę wiadomość.\n${koniec}`
			};
		case 'potwierdzenie': {
			if (!p) return zbudujSzablon('wlasny', k);
			const raty = [...k.raty].sort((a, b) => a.nr_raty - b.nr_raty);
			const harmonogram = raty.length > 1
				? `\n\nHarmonogram płatności:\n${raty.map((r) => `- rata ${r.nr_raty}: ${fmtPln(r.kwota)} zł do ${data(r.data_platnosci)}`).join('\n')}`
				: raty.length === 1 ? `\nTermin płatności: ${data(raty[0].data_platnosci)}.` : '';
			return {
				temat: `Potwierdzenie zawarcia ubezpieczenia — polisa ${p.nr_polisy}`,
				tresc:
					`Dzień dobry,\n\npotwierdzam zawarcie ubezpieczenia:\n` +
					`- polisa nr ${p.nr_polisy}, ${p.crm_insurers?.nazwa ?? nazwaTu(p)}\n` +
					`- rodzaj: ${nazwaRodzaju(p.rodzaj)}${p.przedmiot ? `, przedmiot: ${p.przedmiot}` : ''}\n` +
					`- okres ochrony: ${data(p.data_od)} – ${data(p.data_do)}\n` +
					`- składka: ${fmtPln(p.skladka_przypisana)} zł${Number(p.ilosc_rat) > 1 ? ` (${p.ilosc_rat} raty)` : ''}` +
					harmonogram +
					(k.zalacznikPolisy ? '\n\nDokument polisy przesyłam w załączniku.' : '') +
					`\n\nDziękuję za zaufanie i pozostaję do dyspozycji.\n${koniec}`
			};
		}
		default:
			return { temat: '', tresc: `Dzień dobry,\n\n\n${koniec}` };
	}
}
