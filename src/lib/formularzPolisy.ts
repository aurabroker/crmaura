// Formularz polisy: które towarzystwa pasują do rodzaju polisy. Polisy majątkowe (techniczna, OC,
// komunikacja…) oferują TU działu II (majątkowe), życiowe i grupowe na życie — działu I. TU bez
// przypisanego działu zostaje na liście, a użytkownik może zawsze pokazać wszystkie.
import type { Insurer, Policy } from '$lib/types/database';
import { plusDni } from '$lib/statusPolisy';

type Dzial = Insurer['dzial'];

const ZYCIOWE = new Set(['życie', 'grupowe_życie']);
/** Rodzaje, które sprzedają oba działy (pakiety medyczne, polisa obca). */
const OBA_DZIALY = new Set(['grupowe_medyczne', 'polisa_obca']);
/** Utrata dochodu: program CEU / Leadenhall — osobna, wąska lista. */
const TU_UTRATY_DOCHODU = ['ceu', 'leadenhall'];

export function dzialDlaRodzaju(rodzaj: string | null | undefined): Dzial | null {
	if (!rodzaj || OBA_DZIALY.has(rodzaj)) return null;
	return ZYCIOWE.has(rodzaj) ? 'Życiowy' : 'Majątkowy';
}

export const ETYKIETA_DZIALU: Record<string, string> = { Majątkowy: 'majątkowe', Życiowy: 'życiowe' };

/** Towarzystwa pasujące do rodzaju polisy (TU bez działu zawsze na liście). */
export function towarzystwaDlaRodzaju<T extends Pick<Insurer, 'nazwa' | 'skrot' | 'dzial'>>(insurers: T[], rodzaj: string | null | undefined): T[] {
	if (rodzaj === 'utrata_dochodu') {
		return insurers.filter((t) => TU_UTRATY_DOCHODU.some((k) => t.nazwa.toLowerCase().includes(k) || (t.skrot ?? '').toLowerCase().includes(k)));
	}
	const dzial = dzialDlaRodzaju(rodzaj);
	if (!dzial) return insurers;
	return insurers.filter((t) => !t.dzial || t.dzial === dzial);
}

/** Opis zawężenia listy TU do podpisu pod wyszukiwarką; '' gdy lista jest pełna. */
export function opisZawezeniaTU(rodzaj: string | null | undefined): string {
	if (rodzaj === 'utrata_dochodu') return 'tylko TU programu utraty dochodu (CEU, Leadenhall)';
	const dzial = dzialDlaRodzaju(rodzaj);
	return dzial ? `tylko TU ${ETYKIETA_DZIALU[dzial]}` : '';
}

// ── Odnowienie ręczne: formularz nowej polisy z przeniesionymi danymi ──
// Klient, rodzaj, przedmiot i pojazd jak dotąd, a do tego okres na kolejny rok (od dnia po końcu ochrony;
// „data do” dolicza się w formularzu), towarzystwo, stawka prowizji, liczba rat i suma gwarancyjna.
// Składki nie przenosimy — zmienia się co rok.
export function adresOdnowieniaRecznego(
	p: Pick<Policy, 'id' | 'klient_id' | 'rodzaj' | 'przedmiot' | 'pojazd_id' | 'data_do' | 'tu_id' | 'prowizja_pct' | 'ilosc_rat'> & Partial<Pick<Policy, 'suma_gwarancyjna' | 'bez_info_platnosci'>>,
	opcje: { parentId?: string | null } = {}
): string {
	const q = new URLSearchParams();
	q.set('klient', p.klient_id);
	q.set('rodzaj', p.rodzaj ?? '');
	q.set('przedmiot', p.przedmiot ?? '');
	q.set('renewal_of', p.id);
	if (p.pojazd_id) q.set('pojazd_id', p.pojazd_id);
	if (opcje.parentId) q.set('parent_id', opcje.parentId);
	if (p.data_do) q.set('data_od', plusDni(p.data_do, 1));
	if (p.tu_id) q.set('tu', p.tu_id);
	if (Number(p.prowizja_pct) > 0) q.set('prowizja_pct', String(p.prowizja_pct));
	if (p.ilosc_rat) q.set('raty', String(p.ilosc_rat));
	if (p.suma_gwarancyjna != null && Number(p.suma_gwarancyjna) > 0) q.set('suma', String(p.suma_gwarancyjna));
	if (p.bez_info_platnosci) q.set('bez_info', '1');
	return `/policies/new?${q.toString()}`;
}
