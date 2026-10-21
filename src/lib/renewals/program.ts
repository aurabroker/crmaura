// Program ubezpieczenia OC ERGO Hestia WA50/003353/24/A dla gabinetów kosmetycznych, kosmetologicznych,
// fryzjerskich i podologicznych (umowa generalna przedłużona do 30.09.2027, numer bez zmian).
// Wspólne dla strony klienta (/odnowienie) i serwera (walidacja, PDF) — serwer niczego nie przyjmuje
// bez sprawdzenia tymi samymi regułami.

export const PROGRAM_NR = 'WA50/003353/24/A';
export const PROGRAM_NAZWA = `Program Ubezpieczenia OC nr ${PROGRAM_NR}`;
export const UBEZPIECZYCIEL = 'STU Ergo Hestia SA';
// Nazwa ubezpieczyciela do pokazania klientowi: w kartotece bywa wielkimi literami albo z „S.A.”.
export const nazwaUbezpieczyciela = (n: string | null | undefined): string =>
	!n || /hestia/i.test(n) ? UBEZPIECZYCIEL : n;

// ---------- Taryfa (składka roczna za gabinet do 5 osób) ----------

export type Kategoria = 'kosmetyczny_fryzjerski' | 'kosmetologiczny' | 'pelny';
export type Suma = 100000 | 200000 | 300000;
export const SUMY: Suma[] = [100000, 200000, 300000];
// Wariant oznaczany we wniosku jako „najczęściej wybierany” (informacja, nie rekomendacja).
export const SUMA_NAJCZESCIEJ_WYBIERANA: Suma = 200000;

export const KATEGORIE: Record<Kategoria, { nazwa: string; skladka: Record<Suma, number> }> = {
	kosmetyczny_fryzjerski: { nazwa: 'Gabinety kosmetyczne i fryzjerskie', skladka: { 100000: 400, 200000: 500, 300000: 650 } },
	kosmetologiczny: { nazwa: 'Gabinety kosmetologiczne', skladka: { 100000: 650, 200000: 790, 300000: 950 } },
	pelny: { nazwa: 'Gabinety kosmetyczne, kosmetologiczne, fryzjerskie i podologiczne', skladka: { 100000: 850, 200000: 980, 300000: 1250 } }
};

export const DOPLATA_6_8_OSOB = 0.25;
export const OCHRONA_PRAWNA_SKLADKA = 92;
export const OCHRONA_PRAWNA_LIMIT = 100000;

export const KLAUZULA_OCHRONY_PRAWNEJ =
	'Rozszerzenie zakresu ubezpieczenia o koszty ochrony prawnej poniesione przez Ubezpieczonego, inne niż objęte ' +
	'za pisemną zgodą Ubezpieczyciela ochroną zgodnie z § 6 ust. 3 Warunków Ubezpieczenia (klauzula 7). ' +
	'Limit: 100.000 zł. Składka dodatkowa: 92 zł rocznie.';

export type RodzajGabinetu = 'kosmetyczny' | 'fryzjerski' | 'kosmetologiczny' | 'podologiczny';
export const RODZAJE_GABINETU: { key: RodzajGabinetu; nazwa: string }[] = [
	{ key: 'kosmetyczny', nazwa: 'Gabinet kosmetyczny' },
	{ key: 'fryzjerski', nazwa: 'Salon fryzjerski' },
	{ key: 'kosmetologiczny', nazwa: 'Gabinet kosmetologiczny' },
	{ key: 'podologiczny', nazwa: 'Gabinet podologiczny' }
];

export type LiczbaOsob = '1-5' | '6-8' | '9+';
export const LICZBA_OSOB: { key: LiczbaOsob; nazwa: string }[] = [
	{ key: '1-5', nazwa: 'do 5 osób' },
	{ key: '6-8', nazwa: '6–8 osób' },
	{ key: '9+', nazwa: 'więcej niż 8 osób' }
];

// Kategoria taryfy z rodzajów działalności: podologia albo fryzjerstwo razem z kosmetologią
// to taryfa pełna; kosmetologia (z kosmetyką lub bez) — kosmetologiczna; sama kosmetyka
// i fryzjerstwo — podstawowa.
export function kategoriaZRodzajow(rodzaje: RodzajGabinetu[]): Kategoria | null {
	if (!rodzaje.length) return null;
	const r = new Set(rodzaje);
	if (r.has('podologiczny') || (r.has('kosmetologiczny') && r.has('fryzjerski'))) return 'pelny';
	if (r.has('kosmetologiczny')) return 'kosmetologiczny';
	return 'kosmetyczny_fryzjerski';
}

export type Wycena =
	| { rodzaj: 'kwota'; kwota: number; opis: string }
	| { rodzaj: 'indywidualna'; powod: string };

// Składka wg tabeli programu. Wynik jest orientacyjny: ostateczną składkę potwierdza doradca.
export function skladkaProgramu(o: { kategoria: Kategoria; suma: Suma; osoby: LiczbaOsob; ochronaPrawna: boolean }): Wycena {
	if (o.osoby === '9+') return { rodzaj: 'indywidualna', powod: 'gabinet zatrudnia więcej niż 8 osób' };
	const baza = KATEGORIE[o.kategoria].skladka[o.suma];
	const zDoplata = o.osoby === '6-8' ? baza * (1 + DOPLATA_6_8_OSOB) : baza;
	const kwota = Math.round((zDoplata + (o.ochronaPrawna ? OCHRONA_PRAWNA_SKLADKA : 0)) * 100) / 100;
	const czesci = [`${KATEGORIE[o.kategoria].nazwa}, suma ${formatSuma(o.suma)}: ${baza} zł`];
	if (o.osoby === '6-8') czesci.push('+25% (6–8 osób)');
	if (o.ochronaPrawna) czesci.push(`+${OCHRONA_PRAWNA_SKLADKA} zł ochrona prawna`);
	return { rodzaj: 'kwota', kwota, opis: czesci.join(', ') };
}

// Sumy zawsze w formacie „200.000 zł” (kropka między tysiącami).
export const formatSuma = (s: number) => `${Math.round(s).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} zł`;
export const formatZl = (n: number) =>
	`${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

// ---------- Zabiegi ----------

// Zabiegi wyłączone z programu — objęcie ich ochroną wymaga ankiety ERGO Hestii i oceny ryzyka.
// Te same 8 pozycji i ta sama kolejność co w punkcie 2 formularza ankiety Ergo (PDF ankiety pokazuje wszystkie).
export const ZABIEGI_ANKIETA = [
	'Zabiegi urządzeniami opartymi na technologii HIFU (skupiona wiązka fal ultradźwiękowych o dużym natężeniu)',
	'Zabiegi z użyciem toksyny botulinowej',
	'Zabiegi z użyciem osocza bogatopłytkowego',
	'Zabiegi z użyciem urządzeń wykorzystujących technologię PLASMA',
	'Zabiegi z użyciem wypełniaczy na bazie kwasu hialuronowego',
	'Zabiegi z użyciem nici PDO',
	'Zabiegi lipolizy iniekcyjnej',
	'Zabiegi laserem ablacyjnym'
] as const;

// Załącznik nr 1 do Programu — gabinety kosmetyczne i fryzjerskie.
export const ZABIEGI_LISTA_1 = [
	'Barbering', 'Depilacja pastą cukrową', 'Depilacja woskiem', 'Dermabrazja i peeling skóry głowy',
	'Diagnoza skóry głowy i USG włosa', 'Elektrostymulacja', 'Endermologia – masaż podciśnieniowy', 'Golenie głowy',
	'Henna', 'Koloryzacja i dekoloryzacja włosów', 'Kosmetyczna diagnostyka trychologiczna',
	'Kosmetyczny zabieg trychologiczny', 'Kuracje nawilżające, regenerujące i odbudowujące włosy',
	'Laminowanie brwi i rzęs', 'Laminowanie włosów', 'Makijaż', 'Manicure', 'Manualne oczyszczanie twarzy',
	'Masaż bańką chińską', 'Masaż endodermiczny i drenaż limfatyczny', 'Masaż manualny ciała, w tym masaż głowy i twarzy',
	'Mycie i suszenie włosów', 'Oczyszczanie włosów', 'Pasemka i baleyage', 'Pedicure kosmetyczny',
	'Piercing – przekłuwanie innych części ciała', 'Presoterapia', 'Przekłuwanie uszu',
	'Przedłużanie i zagęszczanie rzęs', 'Przedłużanie włosów', 'Prostowanie włosów na stałe', 'Retusz siwizny',
	'Sauna na włosy', 'Strzyżenie nożyczkami, maszynką, brzytwą oraz metodą Split-ender i Hair-dusting; trymowanie',
	'Trwała ondulacja', 'Wykonywanie zabiegów kosmetycznych z zastosowaniem składników aktywnych',
	'Zabieg pielęgnacyjny włosów z użyciem fal ultradźwiękowych', 'Zabieg rekonstrukcji włosów',
	'Zabieg regeneracyjny włosów z użyciem podczerwieni', 'Zabiegi keratynowe', 'Zabiegi przeciwłupieżowe',
	'Zabiegi wykorzystujące terapeutyczne działanie światła – światło LED', 'Zagęszczanie włosów'
] as const;

// Załącznik nr 2 do Programu — gabinety kosmetyczne i kosmetologiczne.
export const ZABIEGI_LISTA_2 = [
	'Chemiczne usuwanie makijażu permanentnego', 'Cool Lifting', 'Depilacja pastą cukrową', 'Depilacja woskiem',
	'Elektroliza', 'Elektrokoagulacja', 'Elektroporacja', 'Elektrostymulacja',
	'Fala akustyczna i energia wysokiej częstotliwości', 'Henna', 'Infuzja tlenowa', 'Jonoforeza', 'Karboksyterapia',
	'Kawitacja ultradźwiękowa', 'Kriolipoliza', 'Laminowanie brwi i rzęs', 'Makijaż okolicznościowy',
	'Makijaż permanentny', 'Manicure', 'Masaż bańką chińską', 'Masaż endodermiczny', 'Masaż podciśnieniowy',
	'Manualne oczyszczanie twarzy', 'Masaż manualny ciała', 'Masaż Kobido', 'Mezoterapia bezigłowa',
	'Mezoterapia igłowa', 'Mezoterapia mikroigłowa', 'Metaterapia', 'Microblading', 'Mikronakłuwanie',
	'Mikropigmentacja rekonstrukcyjna', 'Mikrodermabrazja korundowa i diamentowa', 'Oczyszczanie wodorowo-tlenowe',
	'Opalanie natryskowe', 'Oxybrazja', 'Pedicure kosmetyczny w zakresie zabiegów niezastrzeżonych dla podologów',
	'Peeling węglowy', 'Piercing – przekłuwanie innych części ciała', 'Przedłużanie i zagęszczanie rzęs',
	'Presoterapia', 'Przekłuwanie uszu', 'Radiofrekwencja mikroigłowa', 'Radiotermoliza zmian skórnych',
	'Różnorodne peelingi chemiczne', 'Sauny infrared', 'Sonoforeza',
	'Wykonywanie zabiegów kosmetycznych z zastosowaniem składników aktywnych',
	'Wykonywanie zabiegów na twarz i ciało z zastosowaniem fali radiowej',
	'Zabiegi wykorzystujące światło IPL: fotoodmładzanie, likwidowanie przebarwień, terapia trądziku, zamykanie naczyń – teleangiektazje, usuwanie zbędnego owłosienia',
	'Zabiegi wykorzystujące terapeutyczne działanie światła – światło LED', 'Zabiegi z zastosowaniem fali radiowej',
	'Zabiegi z zastosowaniem lasera frakcyjnego nieablacyjnego',
	'Zabiegi z wykorzystaniem laserów nieablacyjnych, w tym laserowe zamykanie naczyń – teleangiektazje, usuwanie tatuażu i makijażu permanentnego, usuwanie zbędnego owłosienia',
	'Zabiegi z zastosowaniem podczerwieni', 'Zastosowanie prądów małej i dużej częstotliwości'
] as const;

export const ZABIEGI_LISTY = Array.from(new Set<string>([...ZABIEGI_LISTA_1, ...ZABIEGI_LISTA_2])).sort((a, b) =>
	a.localeCompare(b, 'pl')
);

// ---------- APK (analiza potrzeb) dla OC zawodowego gabinetu ----------

export type Apk = {
	rodzaje: RodzajGabinetu[];
	osoby: LiczbaOsob;
	// Pytania o szkody i o zabiegi spoza list usunięte z APK (zabiegi są częścią wniosku) — pola zostają
	// tylko w starszych wnioskach.
	szkody?: 'nie' | 'tak';
	szkody_opis?: string;
	spoza_listy?: 'nie' | 'tak';
	spoza_listy_opis?: string;
	// Sumę gwarancyjną klient wybiera tylko we wniosku, a pytanie „co najważniejsze” usunięte (agent nie
	// rekomenduje produktu) — oba pola tylko w starszych wnioskach.
	suma_oczekiwana?: '100000' | '200000' | '300000' | 'wiecej';
	ochrona_prawna: 'tak' | 'nie';
	szkolenia: 'tak' | 'nie';
	inne_ubezpieczenia: ('mienie' | 'nnw' | 'oc_najemcy' | 'brak')[];
	priorytet?: 'zakres' | 'cena' | 'suma' | 'obsluga';
	uwagi: string;
	oswiadczenie: boolean;
};

export const APK_PYTANIA = {
	rodzaje: 'Jaką działalność prowadzisz?',
	osoby: 'Ile osób wykonuje zabiegi w gabinecie (łącznie z Tobą)?',
	// Tylko do wyświetlania starszych wniosków (szkody, spoza_listy, suma_oczekiwana, priorytet).
	szkody: 'Czy w ostatnich 3 latach były szkody lub roszczenia klientów z tytułu OC?',
	spoza_listy: 'Czy wykonujesz zabiegi spoza list programu albo z listy zabiegów wymagających ankiety?',
	suma_oczekiwana: 'Jakiej sumy gwarancyjnej oczekujesz?',
	ochrona_prawna: 'Czy chcesz ubezpieczyć koszty ochrony prawnej (np. obrony w sporze z klientem)?',
	szkolenia: 'Czy prowadzisz szkolenia lub uczestniczysz w targach branżowych?',
	inne_ubezpieczenia: 'Jakie inne ubezpieczenia gabinetu posiadasz?',
	priorytet: 'Co jest dla Ciebie najważniejsze w ubezpieczeniu?',
	uwagi: 'Dodatkowe informacje (opcjonalnie)'
} as const;

export const APK_ODPOWIEDZI = {
	suma_oczekiwana: { '100000': '100.000 zł', '200000': '200.000 zł', '300000': '300.000 zł', wiecej: 'więcej niż 300.000 zł' },
	ochrona_prawna: { tak: 'tak', nie: 'nie' },
	inne_ubezpieczenia: { mienie: 'mienie gabinetu (sprzęt, wyposażenie)', nnw: 'NNW', oc_najemcy: 'OC najemcy lokalu', brak: 'nie mam innych' },
	priorytet: { zakres: 'najszerszy zakres ochrony', cena: 'jak najniższa składka', suma: 'wysoka suma gwarancyjna', obsluga: 'pomoc przy szkodzie i obsługa' }
} as const;

// Przykłady tego, czego nie obejmuje ubezpieczenie OC w programie — informacja przy APK i w PDF (nie rekomendacja,
// nie pełna lista wyłączeń: tę mają Warunki Ubezpieczenia). `inne` łączy pozycję z odpowiedzią o inne ubezpieczenia.
export const LUKI_OCHRONY_WU = 'Pełny zakres ochrony i wyłączenia opisują Warunki Ubezpieczenia programu.';
export const LUKI_OCHRONY: { tekst: string; inne?: 'mienie' | 'nnw' }[] = [
	{ tekst: 'mienia gabinetu — sprzętu, urządzeń i wyposażenia (np. pożar, zalanie, kradzież)', inne: 'mienie' },
	{ tekst: 'Twoich własnych obrażeń (to zakres ubezpieczenia NNW)', inne: 'nnw' },
	{ tekst: 'utraty dochodu, gdy gabinet nie może działać' },
	{
		tekst:
			'zabiegów spoza listy zabiegów programu dla Twojego rodzaju gabinetu; zabiegi z listy wymagającej ankiety są chronione dopiero po akceptacji ubezpieczyciela'
	}
];

export const APK_ODMOWA_TRESC =
	'Świadomie odmawiam wypełnienia analizy potrzeb (APK). Rozumiem, że bez tych informacji agent ubezpieczeniowy ' +
	'nie może ocenić, czy proponowane ubezpieczenie odpowiada moim wymaganiom i potrzebom.';

// ---------- Wniosek ----------

// Rodzaj wniosku: odnowienie certyfikatu (decyzje bez_zmian / zmiany / nie) albo pierwsza polisa
// klienta bez certyfikatu (decyzje nowa / nie). Oba idą tym samym linkiem i tą samą stroną.
export type RodzajWniosku = 'odnowienie' | 'nowa';
export type Decyzja = 'bez_zmian' | 'zmiany' | 'nie' | 'nowa';

export type Zmiany = {
	// Nowa suma gwarancyjna — dowolny wariant programu inny niż obecny (także niższy). Nazwa pola z czasów,
	// gdy można było tylko podwyższyć sumę; zostaje dla zgodności z zapisanymi wnioskami.
	wyzsza_suma: Suma | null;
	ochrona_prawna: boolean;
	adres: { ulica: string; kod: string; miasto: string } | null;
	nowe_zabiegi: string[];
	zabiegi_ankieta: string[];
	inne: string;
	// Potrzebne do wyceny, gdy klient odmówił APK (inaczej bierzemy z APK).
	rodzaje: RodzajGabinetu[];
	osoby: LiczbaOsob | null;
	// Osoby wykonujące zabiegi z ankiety i to, które zabiegi wykonują — do nich klient dołącza dyplom
	// i certyfikaty (osobno dla każdej osoby i każdego jej zabiegu).
	wykonawcy: Wykonawca[];
	// Odnowienie: klient dopisuje zabiegi z innej listy programu = zmienia rodzaj działalności na nowy okres
	// (wtedy `rodzaje` to działalność od nowego okresu) i dostaje nową składkę z taryfy. Bez dokumentów:
	// pojedyncze zabiegi dopisuje się tylko z listy ankietowej. Starsze wnioski mają zamiast tego `nowe_zabiegi`
	// (zabiegi z list wybierane pojedynczo) i nie mają tego pola.
	zmiana_dzialalnosci?: boolean;
};

export type Wykonawca = { id: string; imie_nazwisko: string; zabiegi: string[] };
export const MAKS_WYKONAWCOW = 10;

// Ankieta Ergo Hestii (formularz do Programu WA50/003353/24/A). Pola NIP, REGON i „Inny – prosimy opisać”
// doszły później — starsze zapisane ankiety ich nie mają (wyświetlamy „—”).
export type Ankieta = {
	ubezpieczajacy: string;
	ubezpieczony: string;
	data_rozpoczecia: string;
	liczba_zatrudnionych: string;
	// Same cyfry: NIP 10, REGON 9 albo 14 (REGON opcjonalny — pusty tekst).
	nip?: string;
	regon?: string;
	szkodowosc: string;
	// Inne zabiegi wymagające oceny ryzyka (opis klienta, opcjonalnie).
	inne_zabiegi?: string;
	jak_dlugo: string;
	zgoda_klientow: 'tak' | 'nie';
	osoby: { imie_nazwisko: string; kwalifikacje: string; doswiadczenie: string }[];
	oswiadczenie: boolean;
};

// Dane firmy podane przez klienta we wniosku o pierwszą polisę (podpowiedziane z kartoteki, klient poprawia).
export type Firma = { nazwa: string; nip: string; regon: string; ulica: string; kod: string; miasto: string; email: string; telefon: string };
// Wniosek o pierwszą polisę: firma, początek ochrony i oświadczenia. Wybrane warianty (suma, ochrona prawna,
// zabiegi wymagające ankiety, osoby i dokumenty, rodzaj gabinetu i liczba osób przy odmowie APK) są w `zmiany`
// — tak samo jak przy odnowieniu ze zmianami, więc PDF, e-maile i panel CRM czytają je jedną drogą.
export type NowaPolisa = { firma: Firma; ochrona_od: string; oswiadczenia: boolean };
export type Wniosek = { decyzja: Decyzja; zmiany: Zmiany | null; nie_powod: string; potwierdzenie_nie: boolean; nowa?: NowaPolisa | null };

// Pierwsza polisa: ochrona od jutra najwcześniej, najdalej za 90 dni; link ważny 30 dni.
export const NOWA_OCHRONA_OD_MIN_DNI = 1;
export const NOWA_OCHRONA_OD_MAX_DNI = 90;
export const NOWY_LINK_DNI = 30;

// „2026-10-15” + n dni (bez strefy czasowej — same daty kalendarzowe).
export function przesunDate(data: string, dni: number): string {
	const d = new Date(`${data}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + dni);
	return d.toISOString().slice(0, 10);
}
// Okres 12 miesięcy od podanego dnia (jak nowy okres przy odnowieniu).
export function okresOdDaty(od: string): { od: string; do: string } {
	const d = new Date(`${od}T12:00:00Z`);
	d.setUTCFullYear(d.getUTCFullYear() + 1);
	d.setUTCDate(d.getUTCDate() - 1);
	return { od, do: d.toISOString().slice(0, 10) };
}
export const zakresOchronyOd = (dzis: string) => ({ min: przesunDate(dzis, NOWA_OCHRONA_OD_MIN_DNI), max: przesunDate(dzis, NOWA_OCHRONA_OD_MAX_DNI), domyslna: przesunDate(dzis, NOWA_OCHRONA_OD_MIN_DNI) });

export const TYPY_ZALACZNIKOW = {
	dyplom: 'Dyplom kosmetologa (studia licencjackie lub magisterskie)',
	certyfikat: 'Certyfikat ze szkolenia z zabiegu (ukończonego co najmniej 12 miesięcy przed początkiem ochrony)',
	zgoda: 'Wzór formularza zgody na zabieg',
	inny: 'Inny dokument'
} as const;
export type TypZalacznika = keyof typeof TYPY_ZALACZNIKOW;

// Certyfikat ze szkolenia z zabiegu: szkolenie ukończone co najmniej 12 miesięcy przed początkiem ochrony
// (np. ochrona od 1.10.2026 → szkolenie najpóźniej 1.10.2025). Zwraca datę RRRR-MM-DD.
export function terminSzkolenia(poczatekOchrony: string): string {
	const [r, m, d] = poczatekOchrony.split('-').map(Number);
	const t = new Date(Date.UTC(r - 1, m - 1, d));
	// 29 lutego → 28 lutego (bez przeskoku na marzec)
	if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
	return t.toISOString().slice(0, 10);
}

export const ZALACZNIK_MAX_BAJTOW = 10 * 1024 * 1024;
// Limity na cały wniosek — chronią magazyn i skrzynkę przed zasypaniem plikami.
export const ZALACZNIKI_MAX = 40;
export const ZALACZNIKI_MAX_LACZNIE = 60 * 1024 * 1024;
const ZABIEGI_WSZYSTKIE = new Set<string>([...ZABIEGI_LISTA_1, ...ZABIEGI_LISTA_2, ...ZABIEGI_ANKIETA]);
export const czyZabieg = (z: unknown): z is string => typeof z === 'string' && ZABIEGI_WSZYSTKIE.has(z);
export const ID_WYKONAWCY = /^[A-Za-z0-9-]{1,40}$/;

// Zabiegi zgłaszane we wniosku, do których potrzebne są osoby i dokumenty: tylko zabiegi z listy ankietowej.
// Zabiegi z list programu nie wymagają dyplomów ani certyfikatów (inna lista = zmiana działalności i składki).
export const zabiegiWniosku = (z: Pick<Zmiany, 'zabiegi_ankieta'> | null | undefined): string[] =>
	z ? Array.from(new Set(z.zabiegi_ankieta)) : [];

// Opis załącznika dla ludzi: rodzaj + osoba (+ zabieg przy certyfikacie).
export function opisZalacznika(
	z: { typ: string; osoba?: string | null; zabieg?: string | null },
	wykonawcy: Wykonawca[] | null | undefined = []
): string {
	const kto = z.osoba ? (wykonawcy ?? []).find((w) => w.id === z.osoba)?.imie_nazwisko : null;
	if (z.typ === 'certyfikat') return `Certyfikat ze szkolenia${z.zabieg ? `: ${z.zabieg}` : ''}${kto ? ` — ${kto}` : ''}`;
	if (z.typ === 'dyplom') return `Dyplom kosmetologa${kto ? ` — ${kto}` : ''}`;
	return (TYPY_ZALACZNIKOW as Record<string, string>)[z.typ] ?? z.typ;
}

// Braki dokumentów: dyplom dla każdej osoby i certyfikat dla każdej osoby z każdego jej zabiegu.
export function brakiDokumentow(
	wykonawcy: Wykonawca[],
	zalaczniki: { typ: string; osoba?: string | null; zabieg?: string | null }[]
): string[] {
	const braki: string[] = [];
	for (const w of wykonawcy) {
		const kto = w.imie_nazwisko || 'osoba bez imienia';
		if (!zalaczniki.some((z) => z.typ === 'dyplom' && z.osoba === w.id)) braki.push(`Dołącz dyplom kosmetologa: ${kto}.`);
		for (const zab of w.zabiegi) {
			if (!zalaczniki.some((z) => z.typ === 'certyfikat' && z.osoba === w.id && z.zabieg === zab)) {
				braki.push(`Dołącz certyfikat ze szkolenia: ${kto} — ${zab}.`);
			}
		}
	}
	return braki;
}
export const ZALACZNIK_TYPY_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// Oświadczenia pod wnioskiem o pierwszą polisę (klient zaznacza jedno pole; teksty trafiają do PDF).
export const OSWIADCZENIA_NOWEJ = [
	'Oświadczam, że podane informacje są prawdziwe i kompletne, a w gabinecie wykonywane są zabiegi z list programu dla wskazanego rodzaju działalności oraz zabiegi wymagające ankiety wskazane w tym wniosku.',
	'Wnioskuję o objęcie ochroną ubezpieczeniową na warunkach Programu Ubezpieczenia OC (umowa generalna STU Ergo Hestia SA). Wiem, że pełny zakres ochrony i wyłączenia określają Warunki Ubezpieczenia programu, które otrzymam przed wystawieniem certyfikatu, a ostateczną składkę potwierdza doradca.'
] as const;

export const OSWIADCZENIE_ANKIETY =
	'Oświadczam, że udzieliłem/am powyższych informacji zgodnie ze swoją najlepszą wiedzą i że znane mi są sankcje ' +
	'przewidziane w art. 815 § 3 Kodeksu cywilnego za udzielenie Ubezpieczycielowi nieprawdziwych informacji ' +
	'istotnych dla oceny ryzyka.';

// ---------- Walidacja (serwer i strona używają tych samych reguł) ----------

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
	typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
const listOf = <T extends string>(v: unknown, allowed: readonly T[], max = 200): T[] =>
	Array.isArray(v) ? Array.from(new Set(v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x)))).slice(0, max) : [];

const RODZAJE_KEYS = RODZAJE_GABINETU.map((r) => r.key);
const OSOBY_KEYS = LICZBA_OSOB.map((o) => o.key);

export type Wynik<T> = { ok: true; value: T } | { ok: false; bledy: string[] };

export function waliduj_apk(raw: unknown): Wynik<Apk> {
	const r = (raw ?? {}) as Record<string, unknown>;
	const bledy: string[] = [];
	const apk: Apk = {
		rodzaje: listOf(r.rodzaje, RODZAJE_KEYS),
		osoby: oneOf(r.osoby, OSOBY_KEYS) ?? ('' as LiczbaOsob),
		ochrona_prawna: oneOf(r.ochrona_prawna, ['tak', 'nie'] as const) ?? ('' as 'nie'),
		szkolenia: oneOf(r.szkolenia, ['tak', 'nie'] as const) ?? ('' as 'nie'),
		inne_ubezpieczenia: listOf(r.inne_ubezpieczenia, ['mienie', 'nnw', 'oc_najemcy', 'brak'] as const),
		uwagi: str(r.uwagi, 3000),
		oswiadczenie: r.oswiadczenie === true
	};
	if (!apk.rodzaje.length) bledy.push('Zaznacz rodzaj działalności.');
	if (!apk.osoby) bledy.push('Podaj liczbę osób wykonujących zabiegi.');
	if (!apk.ochrona_prawna) bledy.push('Odpowiedz na pytanie o ochronę prawną.');
	if (!apk.szkolenia) bledy.push('Odpowiedz na pytanie o szkolenia i targi.');
	if (!apk.inne_ubezpieczenia.length) bledy.push('Zaznacz inne ubezpieczenia (albo „nie mam innych”).');
	if (!apk.oswiadczenie) bledy.push('Potwierdź, że informacje są zgodne z prawdą.');
	return bledy.length ? { ok: false, bledy } : { ok: true, value: apk };
}

// Osoby wykonujące zgłaszane zabiegi (z żądania klienta) i braki w ich opisie — wspólne dla odnowienia i pierwszej polisy.
function parsujWykonawcow(raw: unknown, zgloszone: string[], bledy: string[]): Wykonawca[] {
	const lista = Array.isArray(raw) ? raw.slice(0, MAKS_WYKONAWCOW + 1) : [];
	if (lista.length > MAKS_WYKONAWCOW) bledy.push(`Można podać najwyżej ${MAKS_WYKONAWCOW} osób.`);
	const ids = new Set<string>();
	const wykonawcy: Wykonawca[] = [];
	for (const o of lista.slice(0, MAKS_WYKONAWCOW)) {
		const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
		const id = typeof x.id === 'string' && ID_WYKONAWCY.test(x.id) && !ids.has(x.id) ? x.id : null;
		if (!id) continue;
		ids.add(id);
		wykonawcy.push({
			id,
			imie_nazwisko: str(x.imie_nazwisko, 200),
			zabiegi: Array.isArray(x.zabiegi) ? Array.from(new Set(x.zabiegi.filter((t): t is string => typeof t === 'string' && zgloszone.includes(t)))) : []
		});
	}
	if (!wykonawcy.length) bledy.push('Podaj osoby, które będą wykonywać zgłaszane zabiegi.');
	for (const w of wykonawcy) {
		if (!w.imie_nazwisko) bledy.push('Podaj imię i nazwisko każdej osoby wykonującej zabiegi.');
		else if (!w.zabiegi.length) bledy.push(`Zaznacz, które zabiegi wykonuje: ${w.imie_nazwisko}.`);
	}
	const bezWykonawcy = zgloszone.filter((t) => !wykonawcy.some((w) => w.zabiegi.includes(t)));
	if (wykonawcy.length && bezWykonawcy.length) bledy.push(`Wskaż, kto wykonuje: ${bezWykonawcy.join('; ')}.`);
	return wykonawcy;
}

// pomijajWykonawcow: krok „Wniosek” na stronie — osoby i dokumenty klient podaje w następnym kroku.
export function waliduj_wniosek(raw: unknown, apk: Apk | null, o: { pomijajWykonawcow?: boolean } = {}): Wynik<Wniosek> {
	const r = (raw ?? {}) as Record<string, unknown>;
	const bledy: string[] = [];
	const decyzja = oneOf(r.decyzja, ['bez_zmian', 'zmiany', 'nie'] as const);
	if (!decyzja) return { ok: false, bledy: ['Wybierz odpowiedź: tak bez zmian, tak ze zmianami albo nie.'] };

	if (decyzja === 'nie') {
		if (r.potwierdzenie_nie !== true) bledy.push('Potwierdź rezygnację z odnowienia.');
		return bledy.length ? { ok: false, bledy } : { ok: true, value: { decyzja, zmiany: null, nie_powod: str(r.nie_powod, 2000), potwierdzenie_nie: true } };
	}
	if (decyzja === 'bez_zmian') return { ok: true, value: { decyzja, zmiany: null, nie_powod: '', potwierdzenie_nie: false } };

	const z = (r.zmiany ?? {}) as Record<string, unknown>;
	const sumaRaw = Number(z.wyzsza_suma);
	const adresRaw = z.adres && typeof z.adres === 'object' ? (z.adres as Record<string, unknown>) : null;
	const zmiany: Zmiany = {
		wyzsza_suma: SUMY.includes(sumaRaw as Suma) ? (sumaRaw as Suma) : null,
		ochrona_prawna: z.ochrona_prawna === true,
		adres: adresRaw ? { ulica: str(adresRaw.ulica, 200), kod: str(adresRaw.kod, 10), miasto: str(adresRaw.miasto, 100) } : null,
		// Pojedyncze zabiegi z list programu nie są już częścią wniosku (patrz zmiana_dzialalnosci).
		nowe_zabiegi: [],
		zabiegi_ankieta: listOf(z.zabiegi_ankieta, ZABIEGI_ANKIETA),
		inne: str(z.inne, 3000),
		rodzaje: listOf(z.rodzaje, RODZAJE_KEYS),
		osoby: oneOf(z.osoby, OSOBY_KEYS),
		wykonawcy: [],
		zmiana_dzialalnosci: z.zmiana_dzialalnosci === true
	};
	const zgloszone = zabiegiWniosku(zmiany);
	if (zgloszone.length && !o.pomijajWykonawcow) zmiany.wykonawcy = parsujWykonawcow(z.wykonawcy, zgloszone, bledy);
	if (zmiany.adres && (!zmiany.adres.ulica || !/^\d{2}-\d{3}$/.test(zmiany.adres.kod) || !zmiany.adres.miasto)) {
		bledy.push('Podaj pełny nowy adres działalności (ulica, kod pocztowy w formacie 00-000, miejscowość).');
	}
	const cokolwiek = zmiany.wyzsza_suma || zmiany.ochrona_prawna || zmiany.adres || zmiany.zmiana_dzialalnosci ||
		zmiany.zabiegi_ankieta.length || zmiany.inne;
	if (!cokolwiek) bledy.push('Zaznacz co najmniej jedną zmianę albo wybierz „tak, bez zmian”.');
	if (zmiany.zmiana_dzialalnosci) {
		if (!zmiany.rodzaje.length) bledy.push('Zaznacz rodzaj działalności na nowy okres.');
		else if (!apk && !zmiany.osoby) bledy.push('Do wyceny nowej składki podaj liczbę osób wykonujących zabiegi.');
	}
	// Wycena nowej sumy wymaga rodzaju gabinetu i liczby osób — z APK albo podanych we wniosku.
	if (zmiany.wyzsza_suma && !apk && !zmiany.zmiana_dzialalnosci) {
		if (!zmiany.rodzaje.length) bledy.push('Do wyceny nowej sumy zaznacz rodzaj działalności.');
		if (!zmiany.osoby) bledy.push('Do wyceny nowej sumy podaj liczbę osób wykonujących zabiegi.');
	}
	return bledy.length ? { ok: false, bledy: Array.from(new Set(bledy)) } : { ok: true, value: { decyzja, zmiany, nie_powod: '', potwierdzenie_nie: false } };
}

// Wniosek o pierwszą polisę (klient bez certyfikatu): decyzja „nowa” (wnioskuję) albo „nie” (rezygnuję).
// dzis: data w czasie polskim (serwer) — początek ochrony musi mieścić się w oknie od jutra do 90 dni.
export function waliduj_wniosek_nowy(raw: unknown, apk: Apk | null, o: { pomijajWykonawcow?: boolean; dzis: string }): Wynik<Wniosek> {
	const r = (raw ?? {}) as Record<string, unknown>;
	const bledy: string[] = [];
	const decyzja = oneOf(r.decyzja, ['nowa', 'nie'] as const);
	if (!decyzja) return { ok: false, bledy: ['Wybierz odpowiedź: wnioskuję o ubezpieczenie albo rezygnuję.'] };
	if (decyzja === 'nie') {
		if (r.potwierdzenie_nie !== true) bledy.push('Potwierdź rezygnację z ubezpieczenia.');
		return bledy.length ? { ok: false, bledy } : { ok: true, value: { decyzja, zmiany: null, nie_powod: str(r.nie_powod, 2000), potwierdzenie_nie: true, nowa: null } };
	}

	const n = (r.nowa && typeof r.nowa === 'object' ? r.nowa : {}) as Record<string, unknown>;
	const f = (n.firma && typeof n.firma === 'object' ? n.firma : {}) as Record<string, unknown>;
	const firma: Firma = {
		nazwa: str(f.nazwa, 300),
		nip: nipBezPrefiksu(f.nip),
		regon: bezSeparatorow(f.regon, 40),
		ulica: str(f.ulica, 200),
		kod: str(f.kod, 10),
		miasto: str(f.miasto, 100),
		email: str(f.email, 320).toLowerCase(),
		telefon: str(f.telefon, 40)
	};
	if (!firma.nazwa) bledy.push('Podaj nazwę firmy (albo imię i nazwisko przy działalności).');
	if (!poprawnyNip(firma.nip)) bledy.push('Podaj poprawny NIP (10 cyfr).');
	if (firma.regon && !/^(\d{9}|\d{14})$/.test(firma.regon)) bledy.push('REGON ma 9 albo 14 cyfr (albo zostaw pole puste).');
	if (!firma.ulica || !/^\d{2}-\d{3}$/.test(firma.kod) || !firma.miasto) bledy.push('Podaj pełny adres gabinetu (ulica, kod pocztowy w formacie 00-000, miejscowość).');
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(firma.email)) bledy.push('Podaj poprawny adres e-mail — na niego wyślemy dokumenty.');
	if (firma.telefon.replace(/\D/g, '').length < 9) bledy.push('Podaj numer telefonu (co najmniej 9 cyfr).');

	const ochrona_od = str(n.ochrona_od, 10);
	const okno = zakresOchronyOd(o.dzis);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(ochrona_od)) bledy.push('Podaj, od kiedy ma zacząć się ochrona.');
	else if (ochrona_od < okno.min || ochrona_od > okno.max) bledy.push(`Ochrona może zacząć się najwcześniej jutro i najpóźniej za ${NOWA_OCHRONA_OD_MAX_DNI} dni.`);

	const z = (r.zmiany ?? {}) as Record<string, unknown>;
	const sumaRaw = Number(z.wyzsza_suma);
	const zmiany: Zmiany = {
		wyzsza_suma: SUMY.includes(sumaRaw as Suma) ? (sumaRaw as Suma) : null,
		ochrona_prawna: z.ochrona_prawna === true,
		adres: null,
		nowe_zabiegi: [],
		zabiegi_ankieta: listOf(z.zabiegi_ankieta, ZABIEGI_ANKIETA),
		inne: str(z.inne, 3000),
		rodzaje: listOf(z.rodzaje, RODZAJE_KEYS),
		osoby: oneOf(z.osoby, OSOBY_KEYS),
		wykonawcy: [],
		zmiana_dzialalnosci: false
	};
	if (!zmiany.wyzsza_suma) bledy.push('Wybierz sumę gwarancyjną.');
	// Rodzaj gabinetu i liczba osób: z APK, a przy odmowie APK — z wniosku (bez nich nie ma wyceny).
	if (!apk) {
		if (!zmiany.rodzaje.length) bledy.push('Zaznacz rodzaj działalności.');
		if (!zmiany.osoby) bledy.push('Podaj liczbę osób wykonujących zabiegi.');
	}
	const zgloszone = zabiegiWniosku(zmiany);
	if (zgloszone.length && !o.pomijajWykonawcow) zmiany.wykonawcy = parsujWykonawcow(z.wykonawcy, zgloszone, bledy);
	const oswiadczenia = n.oswiadczenia === true;
	if (!oswiadczenia) bledy.push('Potwierdź oświadczenia na końcu wniosku.');
	return bledy.length
		? { ok: false, bledy: Array.from(new Set(bledy)) }
		: { ok: true, value: { decyzja, zmiany, nie_powod: '', potwierdzenie_nie: false, nowa: { firma, ochrona_od, oswiadczenia: true } } };
}

// Składka pierwszej polisy wg taryfy programu; ubezpieczyciel wycenia sam przy zabiegach z ankietą i powyżej 8 osób.
export function wycenaNowej(w: Wniosek, apk: Apk | null): Wycena | null {
	const z = w.zmiany;
	const suma = z?.wyzsza_suma;
	if (w.decyzja !== 'nowa' || !z || !suma) return null;
	if (z.zabiegi_ankieta.length) return { rodzaj: 'indywidualna', powod: 'zabiegi wymagające ankiety podlegają ocenie ubezpieczyciela' };
	const rodzaje = apk?.rodzaje.length ? apk.rodzaje : z.rodzaje;
	const osoby = apk?.osoby || z.osoby;
	const kategoria = kategoriaZRodzajow(rodzaje);
	if (!kategoria || !osoby) return { rodzaj: 'indywidualna', powod: 'brak danych do wyceny' };
	return skladkaProgramu({ kategoria, suma, osoby, ochronaPrawna: z.ochrona_prawna });
}

// NIP: 10 cyfr, ostatnia to cyfra kontrolna — suma iloczynów 9 pierwszych cyfr i wag 6,5,7,2,3,4,5,6,7
// modulo 11 (wynik 10 oznacza numer błędny).
const WAGI_NIP = [6, 5, 7, 2, 3, 4, 5, 6, 7];
export function poprawnyNip(nip: string): boolean {
	if (!/^\d{10}$/.test(nip)) return false;
	const k = WAGI_NIP.reduce((s, w, i) => s + w * Number(nip[i]), 0) % 11;
	return k !== 10 && k === Number(nip[9]);
}
// NIP/REGON wpisany ze spacjami albo kreskami („526-025-02-74”) → same znaki bez separatorów.
const bezSeparatorow = (v: unknown, max: number) => str(v, max).replace(/[\s-]+/g, '');
// NIP z faktury bywa z prefiksem kraju („PL 526-025-02-74”) — prefiks pomijamy.
const nipBezPrefiksu = (v: unknown) => bezSeparatorow(v, 40).replace(/^PL/i, '');

export function waliduj_ankiete(raw: unknown): Wynik<Ankieta> {
	const r = (raw ?? {}) as Record<string, unknown>;
	const bledy: string[] = [];
	const osobyRaw = Array.isArray(r.osoby) ? r.osoby.slice(0, 20) : [];
	const a: Ankieta = {
		ubezpieczajacy: str(r.ubezpieczajacy, 300),
		ubezpieczony: str(r.ubezpieczony, 300),
		data_rozpoczecia: str(r.data_rozpoczecia, 10),
		liczba_zatrudnionych: str(r.liczba_zatrudnionych, 20),
		nip: nipBezPrefiksu(r.nip),
		regon: bezSeparatorow(r.regon, 40),
		szkodowosc: str(r.szkodowosc, 3000),
		inne_zabiegi: str(r.inne_zabiegi, 1000),
		jak_dlugo: str(r.jak_dlugo, 1000),
		zgoda_klientow: oneOf(r.zgoda_klientow, ['tak', 'nie'] as const) ?? ('' as 'nie'),
		osoby: osobyRaw
			.map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>) : {}))
			.map((o) => ({ imie_nazwisko: str(o.imie_nazwisko, 200), kwalifikacje: str(o.kwalifikacje, 3000), doswiadczenie: str(o.doswiadczenie, 1000) }))
			.filter((o) => o.imie_nazwisko || o.kwalifikacje || o.doswiadczenie),
		oswiadczenie: r.oswiadczenie === true
	};
	if (!a.ubezpieczajacy) bledy.push('Ankieta: podaj Ubezpieczającego.');
	if (!a.ubezpieczony) bledy.push('Ankieta: podaj Ubezpieczonego.');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(a.data_rozpoczecia)) bledy.push('Ankieta: podaj datę rozpoczęcia działalności.');
	if (!a.liczba_zatrudnionych) bledy.push('Ankieta: podaj liczbę zatrudnionych osób.');
	if (!poprawnyNip(a.nip ?? '')) bledy.push('Ankieta: podaj poprawny NIP (10 cyfr).');
	if (a.regon && !/^(\d{9}|\d{14})$/.test(a.regon)) bledy.push('Ankieta: REGON ma 9 albo 14 cyfr (albo zostaw pole puste).');
	if (!a.szkodowosc) bledy.push('Ankieta: opisz szkodowość z ostatnich 3 lat (albo wpisz „brak”).');
	if (!a.jak_dlugo) bledy.push('Ankieta: podaj, jak długo zabiegi są wykonywane w gabinecie.');
	if (!a.zgoda_klientow) bledy.push('Ankieta: odpowiedz, czy klienci podpisują formularz zgody.');
	if (!a.osoby.length || a.osoby.some((o) => !o.imie_nazwisko || !o.kwalifikacje || !o.doswiadczenie)) {
		bledy.push('Ankieta: podaj dane każdej osoby wykonującej zabiegi (imię i nazwisko, kwalifikacje, doświadczenie).');
	}
	if (!a.oswiadczenie) bledy.push('Ankieta: potwierdź oświadczenie (art. 815 § 3 Kodeksu cywilnego).');
	return bledy.length ? { ok: false, bledy } : { ok: true, value: a };
}

// Wszystkie składki z tabeli programu (bez ochrony prawnej) dla danej sumy albo dla każdej sumy.
function skladkiTabeli(suma: number | null): { suma: Suma; kwota: number }[] {
	const out: { suma: Suma; kwota: number }[] = [];
	for (const k of Object.values(KATEGORIE))
		for (const s of SUMY) {
			if (suma != null && s !== suma) continue;
			const baza = k.skladka[s];
			out.push({ suma: s, kwota: baza }, { suma: s, kwota: Math.round(baza * (1 + DOPLATA_6_8_OSOB) * 100) / 100 });
		}
	return out;
}
const grosze = (n: number) => Math.round(n * 100);

// Czy obecna składka zawiera już ochronę prawną: składka = stawka z tabeli + 92 zł (i nie jest samą stawką).
export function ochronaPrawnaWSkladce(skladka: number | null, suma: number | null): boolean {
	if (skladka == null) return false;
	const t = skladkiTabeli(suma);
	const k = grosze(skladka);
	return t.some((x) => grosze(x.kwota + OCHRONA_PRAWNA_SKLADKA) === k) && !t.some((x) => grosze(x.kwota) === k);
}

// Suma gwarancyjna odczytana ze składki, gdy pasuje do dokładnie jednej sumy w tabeli (z ochroną prawną lub bez).
export function sumaZeSkladki(skladka: number | null): Suma | null {
	if (skladka == null) return null;
	const k = grosze(skladka);
	const sumy = new Set(skladkiTabeli(null).filter((x) => grosze(x.kwota) === k || grosze(x.kwota + OCHRONA_PRAWNA_SKLADKA) === k).map((x) => x.suma));
	return sumy.size === 1 ? [...sumy][0] : null;
}

// Wycena dla wniosku ze zmianami. null = składka bez zmian (np. tylko zmiana adresu).
// opObecnie: obecny certyfikat ma już ochronę prawną (patrz ochronaPrawnaWSkladce) — nie doliczamy jej drugi raz.
// sumaObecna: suma gwarancyjna obecnego certyfikatu — przy zmianie działalności bez zmiany sumy.
export function wycenaWniosku(
	w: Wniosek,
	apk: Apk | null,
	skladkaObecna: number | null,
	opObecnie = false,
	sumaObecna: number | null = null
): Wycena | null {
	if (w.decyzja !== 'zmiany' || !w.zmiany) return null;
	const z = w.zmiany;
	if (z.zabiegi_ankieta.length) return { rodzaj: 'indywidualna', powod: 'zabiegi wymagające ankiety podlegają ocenie ubezpieczyciela' };
	// Zabiegi z innej listy = nowa działalność: składka z taryfy dla nowej kategorii (i nowej albo obecnej sumy).
	if (z.zmiana_dzialalnosci) {
		const kategoria = kategoriaZRodzajow(z.rodzaje);
		const suma = z.wyzsza_suma ?? (SUMY.includes(sumaObecna as Suma) ? (sumaObecna as Suma) : null);
		const osoby = apk?.osoby || z.osoby;
		if (!kategoria || !suma || !osoby) return { rodzaj: 'indywidualna', powod: 'brak danych do wyceny' };
		return skladkaProgramu({ kategoria, suma, osoby, ochronaPrawna: z.ochrona_prawna || opObecnie });
	}
	if (z.wyzsza_suma) {
		const rodzaje = apk?.rodzaje.length ? apk.rodzaje : z.rodzaje;
		const osoby = apk?.osoby || z.osoby;
		const kategoria = kategoriaZRodzajow(rodzaje);
		if (!kategoria || !osoby) return { rodzaj: 'indywidualna', powod: 'brak danych do wyceny' };
		return skladkaProgramu({ kategoria, suma: z.wyzsza_suma, osoby, ochronaPrawna: z.ochrona_prawna || opObecnie });
	}
	if (z.ochrona_prawna && skladkaObecna != null && !opObecnie) {
		return { rodzaj: 'kwota', kwota: Math.round((skladkaObecna + OCHRONA_PRAWNA_SKLADKA) * 100) / 100, opis: `obecna składka + ${OCHRONA_PRAWNA_SKLADKA} zł ochrona prawna` };
	}
	return null;
}
