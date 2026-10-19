// Wniosek z aplikacji Utrata Dochodu powiązany z leadem CRM (tabela crm_ud_leady, synchronizacja w bazie:
// migracja 20261019000002_ud_leady_do_crm). Tu tylko etykiety i wiersze do pokazania na karcie leada.

export type DaneWnioskuUD = {
	wniosek_at?: string;
	/** form (wniosek online) · direct (dodany przez agenta) · polisa */
	zrodlo_ud?: string;
	polecenie?: string;
	zawod?: string;
	/** b2b · uop · zlecenie */
	zatrudnienie?: string;
	forma_podatku?: string;
	branza?: string;
	zatrudnia?: boolean;
	zakres?: { okresowa?: number; trwala?: number; zgon?: number };
	etap?: string;
	etap_nazwa?: string;
	etap_od?: string;
	opiekun?: string;
	zarchiwizowano_at?: string;
	powod_utraty?: string;
	nastepne_dzialanie?: { typ?: string; at?: string; opis?: string };
	sprzedaz?: {
		sprzedano_at?: string;
		polisa?: string;
		skladka_roczna?: number;
		skladka_mies?: number;
		ochrona_od?: string;
		ochrona_do?: string;
		prowizja_pct?: number;
		swiadczenie_okresowa?: number;
		swiadczenie_trwala?: number;
		swiadczenie_zgon?: number;
	};
	/** Oferty z aplikacji (bez szkiców), najnowsza pierwsza. */
	oferty?: OfertaUD[];
};

export type OfertaUD = {
	id: string;
	nr?: string;
	/** sent · viewed · chosen · bought · rejected */
	status?: string;
	wyslano_at?: string;
	obejrzano_at?: string;
	decyzja_at?: string;
	zarchiwizowano_at?: string;
	warianty?: number;
	skladka_od?: number;
	skladka_do?: number;
	/** Nazwy TU wariantów, np. „Leadenhall”. */
	tu?: string;
	wybor?: { tu?: string; nr?: string; at?: string };
};

export const STATUS_OFERTY_UD: Record<string, string> = {
	sent: 'wysłana do klienta',
	viewed: 'obejrzana przez klienta',
	chosen: 'klient wybrał wariant',
	bought: 'zakupiona',
	rejected: 'odrzucona przez klienta'
};

const odmianaWariantow = (n: number) => (n === 1 ? 'wariant' : n >= 2 && n <= 4 ? 'warianty' : 'wariantów');

/** Jedna oferta w jednym wierszu: numer, stan z datą, wysyłka, wybór klienta, warianty, widełki składki, TU. */
export function opisOfertyUD(o: OfertaUD, fmt: (iso: string) => string = dataPL): string {
	const st = o.status ?? '';
	const dataStanu = st === 'viewed' ? o.obejrzano_at : st === 'sent' ? o.wyslano_at : (o.decyzja_at ?? o.wybor?.at ?? null);
	return zlacz([
		o.nr,
		`${STATUS_OFERTY_UD[st] ?? st}${dataStanu ? ` ${fmt(dataStanu)}` : ''}`,
		st !== 'sent' && o.wyslano_at ? `wysłana ${fmt(o.wyslano_at)}` : null,
		o.wybor && (o.wybor.tu || o.wybor.nr) ? [o.wybor.tu, o.wybor.nr].filter(Boolean).join(' ') : null,
		o.warianty ? `${o.warianty} ${odmianaWariantow(o.warianty)}` : null,
		o.skladka_od ? `składka ${kwotaUD(o.skladka_od)}${o.skladka_do && o.skladka_do > o.skladka_od ? ` – ${kwotaUD(o.skladka_do)}` : ''}/rok` : null,
		o.tu,
		o.zarchiwizowano_at ? 'zarchiwizowana' : null
	]);
}

export type WniosekUD = {
	ud_klient_id: string;
	etap: string | null;
	status_crm: string | null;
	sprzedano_at: string | null;
	zarchiwizowano_at: string | null;
	synced_at: string;
	dane: DaneWnioskuUD;
};

export const ZATRUDNIENIE_UD: Record<string, string> = { b2b: 'działalność (B2B)', uop: 'umowa o pracę', zlecenie: 'umowa zlecenie' };
export const FORMA_PODATKU_UD: Record<string, string> = { zasady_ogolne: 'zasady ogólne', ryczalt: 'ryczałt', liniowy: 'podatek liniowy', karta_podatkowa: 'karta podatkowa' };
export const ZRODLO_WNIOSKU_UD: Record<string, string> = { form: 'wniosek online', direct: 'dodany przez agenta', polisa: 'z polisy' };

/** 6528 → „6 528 zł”, 1234.5 → „1 234,50 zł” (tak samo jak w notatkach z bazy). */
export function kwotaUD(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return '';
	const [calk, gr] = Math.abs(n).toFixed(2).split('.');
	const grupy = calk.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	return `${n < 0 ? '-' : ''}${grupy}${gr === '00' ? '' : `,${gr}`} zł`;
}

function dataPL(iso: string): string {
	const [r, m, d] = iso.slice(0, 10).split('-');
	return d && m && r ? `${d}.${m}.${r}` : iso;
}

const zlacz = (czesci: (string | null | undefined | false)[]) => czesci.filter(Boolean).join(' · ');

/**
 * Wiersze „etykieta — wartość” na kartę leada. Puste pomijane; `fmt` formatuje daty (domyślnie DD.MM.RRRR,
 * karta leada podaje swój format).
 */
export function wierszeWnioskuUD(w: Pick<WniosekUD, 'dane'>, fmt: (iso: string) => string = dataPL): [string, string][] {
	const d = w.dane ?? {};
	const z = d.zakres ?? {};
	const s = d.sprzedaz;
	const nd = d.nastepne_dzialanie;
	const oferty = d.oferty ?? [];
	const wiersze: [string, string | undefined][] = [
		['Wniosek', d.wniosek_at ? zlacz([fmt(d.wniosek_at), d.zrodlo_ud ? ZRODLO_WNIOSKU_UD[d.zrodlo_ud] ?? d.zrodlo_ud : null, d.polecenie ? `kod polecenia ${d.polecenie}` : null]) : undefined],
		['Zawód', zlacz([d.zawod, d.zatrudnienie ? ZATRUDNIENIE_UD[d.zatrudnienie] ?? d.zatrudnienie : null, d.forma_podatku ? FORMA_PODATKU_UD[d.forma_podatku] ?? d.forma_podatku : null, d.branza, d.zatrudnia ? 'zatrudnia pracowników' : null])],
		['Zakres', zlacz([z.okresowa ? `niezdolność czasowa ${kwotaUD(z.okresowa)}/mies.` : null, z.trwala ? `trwała ${kwotaUD(z.trwala)}` : null, z.zgon ? `śmierć NW ${kwotaUD(z.zgon)}` : null])],
		['Etap w aplikacji', zlacz([d.etap_nazwa, d.etap_od ? `od ${fmt(d.etap_od)}` : null, d.zarchiwizowano_at ? `zarchiwizowany ${fmt(d.zarchiwizowano_at)}` : null])],
		// Oferty wysłane z aplikacji — każda w swoim wierszu (etykiety muszą być różne: klucz wiersza na karcie leada).
		...oferty.map((o, i): [string, string | undefined] => [oferty.length > 1 ? `Oferta ${i + 1}` : 'Oferta', opisOfertyUD(o, fmt)]),
		['Powód', d.powod_utraty],
		['Następne działanie', nd ? zlacz([nd.typ, nd.at ? fmt(nd.at) : null, nd.opis]) : undefined],
		['Opiekun w aplikacji', d.opiekun],
		['Sprzedaż', s ? zlacz([s.polisa ? `polisa ${s.polisa}` : null, s.sprzedano_at ? fmt(s.sprzedano_at) : null, s.skladka_roczna ? `składka roczna ${kwotaUD(s.skladka_roczna)}${s.skladka_mies ? ` (${kwotaUD(s.skladka_mies)}/mies.)` : ''}` : null, s.ochrona_od ? `ochrona ${fmt(s.ochrona_od)}${s.ochrona_do ? ` – ${fmt(s.ochrona_do)}` : ''}` : null, s.prowizja_pct != null ? `prowizja ${s.prowizja_pct}%` : null]) : undefined],
		['Świadczenia', s ? zlacz([s.swiadczenie_okresowa ? `okresowe ${kwotaUD(s.swiadczenie_okresowa)}/mies.` : null, s.swiadczenie_trwala ? `trwała niezdolność ${kwotaUD(s.swiadczenie_trwala)}` : null, s.swiadczenie_zgon ? `zgon ${kwotaUD(s.swiadczenie_zgon)}` : null]) : undefined]
	];
	return wiersze.filter((w): w is [string, string] => !!w[1]);
}
