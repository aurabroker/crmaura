// Zgłoszenia z formularza wypełnione przez bota (np. „wuYtvHnFxWnjZhpV”, kontakt „zkNXIrKUgznyPDha VkeNRWYcYgnYhPCUIF”,
// NIP „hvNoEevJqx”, telefon „+5372266769”): CRM ich nie przyjmuje — nie powstaje klient, lead ani zgłoszenie.
// Dwa miejsca: arkusz zgłoszeń (/api/leady/zgloszenia) i nocna synchronizacja firm z BEAUTY
// (supabase/functions/sync-beauty-companies — ta sama reguła skopiowana, bo funkcja Deno nie widzi $lib).
//
// Reguła ostrożna, żeby nie odrzucić prawdziwej firmy: potrzebny „losowy ciąg” w nazwie albo w kontakcie
// (słowo z samych liter łacińskich, min. 8 znaków, z co najmniej trzema osobnymi wielkimi literami w środku —
// „KamLanTech”, „NovaSkinGlow”, „KAROline” czy „ChrypINK” mają najwyżej dwie) i do tego drugi sygnał:
// losowy ciąg w obu polach, litery w NIP-ie albo telefon spoza Polski.

export type DaneZgloszenia = { firma?: string | null; kontakt?: string | null; nip?: string | null; telefon?: string | null };

/** Słowo wygląda na wygenerowane losowo (przypadkowe wielkie litery w środku). */
export function losoweSlowo(slowo: string): boolean {
	if (slowo.length < 8 || !/^[A-Za-z]+$/.test(slowo) || !/[a-z]/.test(slowo)) return false;
	return (slowo.slice(1).match(/[A-Z]+/g) ?? []).length >= 3;
}

/** Tekst zawiera choć jedno losowe słowo. */
export const losowyTekst = (t: string | null | undefined) => (t ?? '').split(/\s+/).some(losoweSlowo);

/** NIP z literami (w prawdziwym są tylko cyfry, kreski i spacje; prefiks kraju „PL” dopuszczony). */
export const nipZLiterami = (nip: string | null | undefined) => /[A-Za-z]/.test((nip ?? '').trim().replace(/^PL\s*/i, ''));

/** Telefon podany, ale nie polski (9 cyfr, z +48 / 0048 albo bez). */
export function telefonSpozaPolski(tel: string | null | undefined): boolean {
	const t = (tel ?? '').trim();
	if (!t) return false;
	return !/^(?:48|0048)?\d{9}$/.test(t.replace(/\D/g, ''));
}

/** Powód odrzucenia albo null (zgłoszenie wygląda na prawdziwe). */
export function powodSpamu(d: DaneZgloszenia): string | null {
	const firma = losowyTekst(d.firma);
	const kontakt = losowyTekst(d.kontakt);
	if (!firma && !kontakt) return null;
	const sygnaly = [
		firma && kontakt ? 'losowa nazwa i kontakt' : firma ? 'losowa nazwa firmy' : 'losowy kontakt',
		nipZLiterami(d.nip) ? 'litery w NIP' : null,
		telefonSpozaPolski(d.telefon) ? 'telefon spoza Polski' : null
	].filter((s): s is string => !!s);
	return firma && kontakt ? sygnaly.join(', ') : sygnaly.length >= 2 ? sygnaly.join(', ') : null;
}

export const czySpam = (d: DaneZgloszenia) => powodSpamu(d) !== null;
