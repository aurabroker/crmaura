// Stan formularza odnowienia po stronie klienta. Jedna instancja na otwarty link; kroki
// (APK, wniosek, osoby i dokumenty, ankieta, podsumowanie) czytają i zmieniają jej pola.

import type { OdpowiedzZloz, WidokOdnowienia, Zalacznik } from '$lib/renewals/api';
import type { Podpis } from '$lib/renewals/podpis';
import { pusteZgody, type Zgody } from '$lib/renewals/zgody';
import {
	MAKS_WYKONAWCOW,
	NOWA_OCHRONA_OD_MIN_DNI,
	SUMY,
	brakiDokumentow,
	kategoriaZRodzajow,
	okresOdDaty,
	przesunDate,
	skladkaProgramu,
	waliduj_ankiete,
	waliduj_wniosek,
	waliduj_wniosek_nowy,
	wycenaNowej,
	wycenaWniosku,
	type Ankieta,
	type Apk,
	type Decyzja,
	type Firma,
	type LiczbaOsob,
	type RodzajGabinetu,
	type Suma,
	type TypZalacznika,
	type Wniosek,
	type Wykonawca,
	type Wynik
} from '$lib/renewals/program';

export type WidokAktywny = Extract<WidokOdnowienia, { stan: 'aktywny' }>;
export type Krok = 'start' | 'apk' | 'wniosek' | 'kwalifikacje' | 'ankieta' | 'podsumowanie' | 'wyslano';

// Pierwsza polisa: dane firmy (podpowiedziane z kartoteki), początek ochrony, uwagi i oświadczenia.
// Suma, ochrona prawna, zabiegi wymagające ankiety, rodzaj gabinetu i liczba osób są w `zm` (jak przy odnowieniu).
export type NowaForm = { firma: Firma; ochrona_od: string; uwagi: string; oswiadczenia: boolean };
const pustaFirma = (): Firma => ({ nazwa: '', nip: '', regon: '', ulica: '', kod: '', miasto: '', email: '', telefon: '' });
export const pustaNowa = (w: Pick<WidokAktywny, 'firma' | 'ochrona_od'>): NowaForm => ({
	firma: { ...pustaFirma(), ...(w.firma ?? {}) },
	ochrona_od: w.ochrona_od?.domyslna ?? '',
	uwagi: '',
	oswiadczenia: false
});

// Pola formularza przed walidacją — puste odpowiedzi to ''.
// Pola tylko ze starszych wniosków (szkody, zabiegi spoza list, oczekiwana suma, priorytet) nie trafiają do formularza.
export type ApkForm = Omit<Apk, 'osoby' | 'szkody' | 'szkody_opis' | 'spoza_listy' | 'spoza_listy_opis' | 'suma_oczekiwana' | 'ochrona_prawna' | 'szkolenia' | 'priorytet'> & {
	osoby: Apk['osoby'] | '';
	ochrona_prawna: Apk['ochrona_prawna'] | '';
	szkolenia: Apk['szkolenia'] | '';
};

// NIP, REGON i inne zabiegi w typie Ankieta są opcjonalne (starsze ankiety) — w formularzu zawsze tekst.
export type AnkietaForm = Omit<Ankieta, 'zgoda_klientow' | 'nip' | 'regon' | 'inne_zabiegi'> & {
	zgoda_klientow: Ankieta['zgoda_klientow'] | '';
	nip: string;
	regon: string;
	inne_zabiegi: string;
};

// Zmiany trzymamy „płasko”: odznaczenie pozycji nie kasuje tego, co klient już wpisał.
export type ZmianyForm = {
	suma: boolean;
	wyzsza_suma: Suma | null;
	ochrona_prawna: boolean;
	adres: boolean;
	ulica: string;
	kod: string;
	miasto: string;
	// Odnowienie: zabiegi z innej listy programu = zmiana rodzaju działalności (rodzaje na nowy okres w `rodzaje`).
	dzialalnosc: boolean;
	ankieta: boolean;
	zabiegi_ankieta: string[];
	inne_zaznaczone: boolean;
	inne: string;
	rodzaje: RodzajGabinetu[];
	osoby: LiczbaOsob | '';
};

export type Wgrywany = {
	tmp: string;
	typ: TypZalacznika;
	osoba: string | null;
	zabieg: string | null;
	nazwa: string;
	rozmiar: number;
	stan: 'wysylanie' | 'blad';
	blad: string;
};

export const nowyWykonawca = (): Wykonawca => ({ id: crypto.randomUUID(), imie_nazwisko: '', zabiegi: [] });

export const pustaApk = (): ApkForm => ({
	rodzaje: [],
	osoby: '',
	ochrona_prawna: '',
	szkolenia: '',
	inne_ubezpieczenia: [],
	uwagi: '',
	oswiadczenie: false
});

const pusteZmiany = (): ZmianyForm => ({
	suma: false,
	wyzsza_suma: null,
	ochrona_prawna: false,
	adres: false,
	ulica: '',
	kod: '',
	miasto: '',
	dzialalnosc: false,
	ankieta: false,
	zabiegi_ankieta: [],
	inne_zaznaczone: false,
	inne: '',
	rodzaje: [],
	osoby: ''
});

export const pustaOsoba = () => ({ imie_nazwisko: '', kwalifikacje: '', doswiadczenie: '' });

// NIP i REGON podpowiadamy z kartoteki CRM (widok z serwera), klient może je poprawić.
const pustaAnkieta = (w: Pick<WidokAktywny, 'klient' | 'nip' | 'regon'>): AnkietaForm => ({
	ubezpieczajacy: w.klient,
	ubezpieczony: w.klient,
	data_rozpoczecia: '',
	liczba_zatrudnionych: '',
	nip: w.nip ?? '',
	regon: w.regon ?? '',
	szkodowosc: '',
	inne_zabiegi: '',
	jak_dlugo: '',
	zgoda_klientow: '',
	osoby: [pustaOsoba()],
	oswiadczenie: false
});

// Kopiuje ze szkicu tylko pola znanego typu — stary lub uszkodzony szkic nie popsuje formularza.
function scal<T extends Record<string, unknown>>(baza: T, raw: unknown): T {
	if (!raw || typeof raw !== 'object') return baza;
	const r = raw as Record<string, unknown>;
	const out: Record<string, unknown> = { ...baza };
	for (const k of Object.keys(baza)) {
		const v = r[k];
		const b = baza[k];
		if (v === undefined) continue;
		if (Array.isArray(b)) {
			if (Array.isArray(v)) out[k] = v;
		} else if (b === null || typeof v === typeof b) out[k] = v;
	}
	return out as T;
}

const SZKIC_WERSJA = 1;

export class Odnowienie {
	readonly klucz: string;
	readonly widok: WidokAktywny;

	krok = $state<Krok>('start');

	// APK: formularz, zapisana wersja (z serwera) i odmowa
	apkForm = $state<ApkForm>(pustaApk());
	apkZapisana = $state<Apk | null>(null);
	apkOdmowa = $state(false);
	apkEdycja = $state(true);
	// Zgody marketingowe (podpisywane razem z APK) i podpisy klienta. Podpisy nie trafiają do szkicu —
	// po odświeżeniu strony klient podpisuje ponownie; zgody przychodzą z serwera (ten wniosek albo kartoteka).
	zgody = $state<Zgody>(pusteZgody());
	podpisApk = $state<Podpis | null>(null);
	podpisApkAt = $state<string | null>(null);
	podpisWniosku = $state<Podpis | null>(null);

	// Wniosek
	decyzja = $state<Decyzja | ''>('');
	zm = $state<ZmianyForm>(pusteZmiany());
	niePowod = $state('');
	potwierdzenieNie = $state(false);
	// Pierwsza polisa (rodzaj 'nowa'): firma, początek ochrony, uwagi, oświadczenia.
	nw = $state<NowaForm>(pustaNowa({ firma: null, ochrona_od: null }));

	// Osoby wykonujące zgłaszane zabiegi (krok „Osoby i dokumenty”)
	wykonawcy = $state<Wykonawca[]>([]);

	// Ankieta Ergo Hestii i załączniki (zapisane na serwerze oraz wgrywane teraz)
	ankieta = $state<AnkietaForm>(pustaAnkieta({ klient: '', nip: null, regon: null }));
	zalaczniki = $state<Zalacznik[]>([]);
	wgrywane = $state<Wgrywany[]>([]);

	wynik = $state<OdpowiedzZloz | null>(null);

	apkGotowa = $derived(this.apkOdmowa || !!this.apkZapisana);
	// Przy odmowie APK wycena bierze rodzaj gabinetu i liczbę osób z wniosku.
	apkDoWyceny = $derived(this.apkOdmowa ? null : this.apkZapisana);
	// Pierwsza polisa (klient bez certyfikatu) czy odnowienie — ta sama strona, inny krok „Wniosek”.
	nowa = $derived.by(() => this.widok.rodzaj === 'nowa');
	// Dziś w czasie polskim wg serwera (okno początku ochrony zaczyna się jutro) — do walidacji dat na stronie.
	dzis = $derived.by(() => (this.widok.ochrona_od ? przesunDate(this.widok.ochrona_od.min, -NOWA_OCHRONA_OD_MIN_DNI) : new Date().toISOString().slice(0, 10)));
	// Okres ubezpieczenia: po odnowieniu z serwera; przy pierwszej polisie — 12 miesięcy od dnia wybranego we wniosku.
	okresNowy = $derived.by(() => (this.nowa ? okresOdDaty(this.nw.ochrona_od || this.widok.ochrona_od?.domyslna || this.widok.okres_nowy.od) : this.widok.okres_nowy));
	// Suma na nowy okres: każdy wariant programu poza obecnym (także niższy) — bez rekomendacji.
	inneSumy = $derived(SUMY.filter((s) => s !== this.widok.suma));
	// Orientacyjna składka każdego wariantu sumy wg taryfy programu (gdy znamy rodzaj gabinetu i liczbę osób).
	skladkiSum = $derived.by((): Partial<Record<Suma, number>> => {
		// Zabiegi z ankietą: całą składkę wycenia ubezpieczyciel (jak w wycenaWniosku) — bez kwot przy sumach.
		if (this.zm.ankieta && this.zm.zabiegi_ankieta.length) return {};
		const apk = this.apkDoWyceny;
		// Zmiana działalności: składki przy sumach liczone dla działalności od nowego okresu.
		const rodzaje = this.zmianaDzialalnosci && this.zm.rodzaje.length ? this.zm.rodzaje : apk?.rodzaje.length ? apk.rodzaje : this.zm.rodzaje;
		const kategoria = kategoriaZRodzajow(rodzaje);
		const osoby = apk?.osoby || this.zm.osoby;
		if (!kategoria || !osoby) return {};
		const ochronaPrawna = this.zm.ochrona_prawna || this.widok.ochrona_prawna_obecnie;
		const out: Partial<Record<Suma, number>> = {};
		for (const suma of SUMY) {
			const w = skladkaProgramu({ kategoria, suma, osoby, ochronaPrawna });
			if (w.rodzaj === 'kwota') out[suma] = w.kwota;
		}
		return out;
	});
	// Decyzja „z zakresem”: odnowienie ze zmianami albo wniosek o pierwszą polisę (suma, ochrona prawna, zabiegi).
	zZakresem = $derived(this.decyzja === 'zmiany' || this.decyzja === 'nowa');
	// Odnowienie ze zmianą działalności (zabiegi z innej listy programu).
	zmianaDzialalnosci = $derived(!this.nowa && this.decyzja === 'zmiany' && this.zm.dzialalnosc);
	// Rodzaj i liczba osób we wniosku są potrzebne tylko do wyceny (nowej) sumy bez APK — przy zmianie
	// działalności klient podaje je w tamtej pozycji.
	pytajODaneWyceny = $derived(this.zZakresem && this.zm.suma && this.apkOdmowa && !this.zmianaDzialalnosci);
	// Liczba osób przy zmianie działalności — tylko gdy nie ma APK (inaczej z APK).
	pytajOOsobyDzialalnosci = $derived(this.zmianaDzialalnosci && this.apkOdmowa);
	potrzebnaAnkieta = $derived(this.zZakresem && this.zm.ankieta && this.zm.zabiegi_ankieta.length > 0);
	// Zabiegi wymagające ankiety zaznaczone we wniosku (krok „Ankieta Ergo Hestii”).
	zabiegiAnkiety = $derived<string[]>(this.zZakresem && this.zm.ankieta ? this.zm.zabiegi_ankieta : []);
	// Zabiegi, do których potrzebne są osoby i dokumenty: tylko z listy ankietowej (zabiegi z list programu
	// nie wymagają dyplomów ani certyfikatów).
	zabiegiZgloszone = $derived.by((): string[] => (this.zZakresem && this.zm.ankieta ? Array.from(new Set(this.zm.zabiegi_ankieta)) : []));
	potrzebneDokumenty = $derived(this.zabiegiZgloszone.length > 0);
	wniosek = $derived.by((): Wniosek => this.zbudujWniosek());
	wycena = $derived.by(() =>
		this.nowa
			? wycenaNowej(this.wniosek, this.apkDoWyceny)
			: wycenaWniosku(this.wniosek, this.apkDoWyceny, this.widok.skladka, this.widok.ochrona_prawna_obecnie, this.widok.suma)
	);
	kroki = $derived<Krok[]>([
		'apk',
		'wniosek',
		...(this.potrzebneDokumenty ? (['kwalifikacje'] as Krok[]) : []),
		...(this.potrzebnaAnkieta ? (['ankieta'] as Krok[]) : []),
		'podsumowanie'
	]);

	constructor(klucz: string, widok: WidokAktywny) {
		this.klucz = klucz;
		this.widok = widok;
		this.apkOdmowa = widok.apk_odmowa;
		this.apkZapisana = widok.apk_wypelniona && widok.apk ? widok.apk : null;
		if (widok.apk) this.apkForm = scal(pustaApk(), widok.apk);
		this.apkEdycja = !this.apkGotowa;
		if (widok.zgody) this.zgody = { email: widok.zgody.email === true, sms: widok.zgody.sms === true };
		this.podpisApkAt = widok.podpis_apk_at ?? null;
		this.ankieta = pustaAnkieta(widok);
		this.zalaczniki = [...widok.zalaczniki];
		if (widok.rodzaj === 'nowa') {
			this.nw = pustaNowa(widok);
			// Pierwsza polisa: suma zawsze wybierana (nie ma „obecnej”), zabiegi z list — bez osobnej pozycji.
			this.zm.suma = true;
		}
		this.wczytajSzkic();
		this.odtworzWykonawcow();
	}

	private zbudujWniosek(): Wniosek {
		const d = this.decyzja;
		if (d === 'nie') return { decyzja: 'nie', zmiany: null, nie_powod: this.niePowod, potwierdzenie_nie: this.potwierdzenieNie };
		if (d === 'nowa') {
			const z = this.zm;
			const f = this.nw.firma;
			return {
				decyzja: 'nowa',
				zmiany: {
					wyzsza_suma: z.wyzsza_suma,
					ochrona_prawna: z.ochrona_prawna,
					adres: null,
					nowe_zabiegi: [],
					zabiegi_ankieta: z.ankieta ? [...z.zabiegi_ankieta] : [],
					inne: this.nw.uwagi.trim(),
					rodzaje: this.apkOdmowa ? [...z.rodzaje] : [],
					osoby: this.apkOdmowa ? z.osoby || null : null,
					wykonawcy: this.potrzebneDokumenty
						? this.wykonawcy.map((w) => ({ id: w.id, imie_nazwisko: w.imie_nazwisko.trim(), zabiegi: w.zabiegi.filter((t) => this.zabiegiZgloszone.includes(t)) }))
						: [],
					zmiana_dzialalnosci: false
				},
				nie_powod: '',
				potwierdzenie_nie: false,
				nowa: {
					firma: {
						nazwa: f.nazwa.trim(),
						nip: f.nip.trim(),
						regon: f.regon.trim(),
						ulica: f.ulica.trim(),
						kod: f.kod.trim(),
						miasto: f.miasto.trim(),
						email: f.email.trim(),
						telefon: f.telefon.trim()
					},
					ochrona_od: this.nw.ochrona_od,
					oswiadczenia: this.nw.oswiadczenia
				}
			};
		}
		if (d !== 'zmiany') return { decyzja: d as Decyzja, zmiany: null, nie_powod: '', potwierdzenie_nie: false };
		const z = this.zm;
		return {
			decyzja: 'zmiany',
			zmiany: {
				wyzsza_suma: z.suma ? z.wyzsza_suma : null,
				// Klauzula, którą certyfikat już ma, nie jest zmianą (stary szkic mógł ją mieć zaznaczoną).
				ochrona_prawna: z.ochrona_prawna && !this.widok.ochrona_prawna_obecnie,
				adres: z.adres ? { ulica: z.ulica, kod: z.kod, miasto: z.miasto } : null,
				nowe_zabiegi: [],
				zabiegi_ankieta: z.ankieta ? [...z.zabiegi_ankieta] : [],
				inne: z.inne_zaznaczone ? z.inne : '',
				rodzaje: this.pytajODaneWyceny || this.zmianaDzialalnosci ? [...z.rodzaje] : [],
				osoby: this.pytajODaneWyceny || this.pytajOOsobyDzialalnosci ? z.osoby || null : null,
				zmiana_dzialalnosci: this.zmianaDzialalnosci,
				// Tylko zabiegi nadal zgłaszane (klient mógł odznaczyć zabieg po przypisaniu go osobie).
				wykonawcy: this.potrzebneDokumenty
					? this.wykonawcy.map((w) => ({ id: w.id, imie_nazwisko: w.imie_nazwisko.trim(), zabiegi: w.zabiegi.filter((t) => this.zabiegiZgloszone.includes(t)) }))
					: []
			},
			nie_powod: '',
			potwierdzenie_nie: false
		};
	}

	// Te same reguły co serwer: odnowienie (waliduj_wniosek) albo pierwsza polisa (waliduj_wniosek_nowy).
	private walidujWniosek(o: { pomijajWykonawcow?: boolean } = {}): Wynik<Wniosek> {
		return this.nowa
			? waliduj_wniosek_nowy(this.wniosek, this.apkDoWyceny, { ...o, dzis: this.dzis })
			: waliduj_wniosek(this.wniosek, this.apkDoWyceny, o);
	}

	// Reguły programu (waliduj_wniosek) plus braki w zaznaczonych pozycjach — inaczej klient,
	// który zaznaczył „inna suma” bez wyboru kwoty, dostałby mylące „zaznacz co najmniej jedną zmianę”.
	// pelny: także osoby i dokumenty (podsumowanie); bez — sam krok „Wniosek”.
	sprawdzWniosek(pelny = true): Wynik<Wniosek> {
		const w = this.walidujWniosek({ pomijajWykonawcow: !pelny });
		if (!this.zZakresem) return w;
		const z = this.zm;
		const braki: string[] = [];
		if (!this.nowa && z.suma && !z.wyzsza_suma) braki.push('Wybierz nową sumę gwarancyjną (albo odznacz „Inna suma gwarancyjna”).');
		if (z.ankieta && !z.zabiegi_ankieta.length) braki.push('Zaznacz zabiegi wymagające ankiety (albo odznacz tę pozycję).');
		if (!this.nowa && z.inne_zaznaczone && !z.inne.trim()) braki.push('Opisz inne zmiany (albo odznacz tę pozycję).');
		if (!braki.length) return w;
		const reszta = w.ok ? [] : w.bledy.filter((b) => !b.startsWith('Zaznacz co najmniej jedną zmianę'));
		return { ok: false, bledy: [...braki, ...reszta] };
	}

	// Krok „Osoby i dokumenty”: osoby, przypisanie zabiegów, dyplom każdej osoby i certyfikat z każdego jej zabiegu.
	sprawdzKwalifikacje(): string[] {
		const w = this.walidujWniosek();
		const bledy = w.ok ? [] : [...w.bledy];
		if (w.ok && w.value.zmiany) bledy.push(...brakiDokumentow(w.value.zmiany.wykonawcy, this.zalaczniki));
		if (this.wgrywane.some((x) => x.stan === 'wysylanie')) bledy.push('Poczekaj, aż wszystkie pliki zostaną wysłane.');
		return bledy;
	}

	// Osoby są w szkicu tej karty przeglądarki. Po powrocie z linku (nowa karta, inne urządzenie) szkicu nie ma,
	// ale pliki na serwerze mają id osoby i jej imię z chwili wgrania — z nich odtwarzamy osoby i ich zabiegi.
	private odtworzWykonawcow() {
		const znane = new Set(this.wykonawcy.map((w) => w.id));
		for (const z of this.zalaczniki) {
			if ((z.typ !== 'dyplom' && z.typ !== 'certyfikat') || !z.osoba) continue;
			let w = this.wykonawcy.find((x) => x.id === z.osoba);
			if (!w) {
				if (this.wykonawcy.length >= MAKS_WYKONAWCOW || znane.has(z.osoba)) continue;
				w = { id: z.osoba, imie_nazwisko: z.osoba_nazwa ?? '', zabiegi: [] };
				this.wykonawcy.push(w);
			} else if (znane.has(w.id)) continue;
			if (!w.imie_nazwisko && z.osoba_nazwa) w.imie_nazwisko = z.osoba_nazwa;
			if (z.typ === 'certyfikat' && z.zabieg && !w.zabiegi.includes(z.zabieg)) w.zabiegi.push(z.zabieg);
		}
	}

	// Dyplomy i certyfikaty, których nie widać przy żadnej osobie (osoba usunięta, zabieg odznaczony) —
	// liczą się do limitu wniosku, więc klient musi je widzieć i móc usunąć.
	get plikiBezOsoby(): Zalacznik[] {
		return this.zalaczniki.filter((z) => {
			if (z.typ !== 'dyplom' && z.typ !== 'certyfikat') return false;
			const w = this.wykonawcy.find((x) => x.id === z.osoba);
			if (!w) return true;
			return z.typ === 'certyfikat' && (!z.zabieg || !w.zabiegi.includes(z.zabieg) || !this.zabiegiZgloszone.includes(z.zabieg));
		});
	}

	dodajWykonawce(): Wykonawca | null {
		if (this.wykonawcy.length >= MAKS_WYKONAWCOW) return null;
		const w = nowyWykonawca();
		// Jeden zgłoszony zabieg — od razu przypisany, żeby nie klikać.
		if (this.zabiegiZgloszone.length === 1) w.zabiegi = [...this.zabiegiZgloszone];
		this.wykonawcy.push(w);
		return w;
	}

	// Ankieta Ergo Hestii pyta o kwalifikacje osób wykonujących zabiegi z ankiety — te same osoby co w kroku
	// „Osoby i dokumenty”. Wpisane kwalifikacje i doświadczenie zostają przy imieniu i nazwisku.
	synchronizujOsobyAnkiety() {
		const zAnkiety = new Set(this.zm.zabiegi_ankieta);
		const imiona = this.wykonawcy
			.filter((w) => w.imie_nazwisko.trim() && w.zabiegi.some((t) => zAnkiety.has(t)))
			.map((w) => w.imie_nazwisko.trim());
		if (!imiona.length) return;
		const stare = new Map(this.ankieta.osoby.map((o) => [o.imie_nazwisko.trim(), o]));
		this.ankieta.osoby = imiona.map((n) => ({ ...pustaOsoba(), ...stare.get(n), imie_nazwisko: n }));
	}

	sprawdzAnkiete(): string[] {
		const w = waliduj_ankiete(this.ankieta);
		const bledy = w.ok ? [] : [...w.bledy];
		if (this.wgrywane.some((x) => x.stan === 'wysylanie')) bledy.push('Poczekaj, aż wszystkie pliki zostaną wysłane.');
		return bledy;
	}

	// ---------- Szkic w sessionStorage: odświeżenie karty nie kasuje odpowiedzi ----------
	// Zgody i oświadczenia nie są zapisywane — klient potwierdza je za każdym razem.

	private get kluczSzkicu() {
		return `odnowienie-szkic:${this.klucz}`;
	}

	szkic() {
		return {
			v: SZKIC_WERSJA,
			apkForm: this.apkGotowa && !this.apkEdycja ? null : { ...this.apkForm, oswiadczenie: false },
			decyzja: this.decyzja,
			zm: this.zm,
			niePowod: this.niePowod,
			wykonawcy: this.wykonawcy,
			ankieta: { ...this.ankieta, oswiadczenie: false },
			nw: { ...this.nw, oswiadczenia: false }
		};
	}

	zapiszSzkic() {
		try {
			sessionStorage.setItem(this.kluczSzkicu, JSON.stringify(this.szkic()));
		} catch {
			/* tryb prywatny / brak miejsca — formularz działa bez szkicu */
		}
	}

	usunSzkic() {
		try {
			sessionStorage.removeItem(this.kluczSzkicu);
		} catch {
			/* noop */
		}
	}

	private wczytajSzkic() {
		let raw: unknown = null;
		try {
			raw = JSON.parse(sessionStorage.getItem(this.kluczSzkicu) ?? 'null');
		} catch {
			return;
		}
		if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== SZKIC_WERSJA) return;
		const s = raw as Record<string, unknown>;
		if (!this.apkGotowa && s.apkForm) this.apkForm = { ...scal(pustaApk(), s.apkForm), oswiadczenie: false };
		const dozwolone: (Decyzja | '')[] = this.nowa ? ['nowa', 'nie'] : ['bez_zmian', 'zmiany', 'nie'];
		if (typeof s.decyzja === 'string' && (dozwolone as string[]).includes(s.decyzja)) this.decyzja = s.decyzja as Decyzja;
		const zm = scal(pusteZmiany(), s.zm);
		if (zm.wyzsza_suma != null && !this.inneSumy.includes(zm.wyzsza_suma)) zm.wyzsza_suma = null;
		// Szkic sprzed zmiany formularza: pojedyncze zabiegi z list programu trafiają do „Inne zmiany”,
		// żeby doradca je zobaczył (dziś inna lista to zmiana działalności, a nie lista zabiegów).
		const stary = (s.zm ?? {}) as { zabiegi?: unknown; nowe_zabiegi?: unknown };
		const stareZabiegi = stary.zabiegi === true && Array.isArray(stary.nowe_zabiegi) ? stary.nowe_zabiegi.filter((x): x is string => typeof x === 'string') : [];
		if (!this.nowa && stareZabiegi.length) {
			const linia = `Nowe zabiegi z list programu: ${stareZabiegi.join(', ')}`;
			if (!zm.inne.includes(linia)) zm.inne = [zm.inne.trim(), linia].filter(Boolean).join('\n');
			zm.inne_zaznaczone = true;
		}
		if (this.nowa) zm.suma = true;
		this.zm = zm;
		if (this.nowa && s.nw && typeof s.nw === 'object') {
			const nw = scal(pustaNowa(this.widok), s.nw as Record<string, unknown>);
			nw.firma = scal(this.nw.firma, (s.nw as { firma?: unknown }).firma);
			// Data spoza okna (szkic sprzed kilku dni) wraca do domyślnej.
			const okno = this.widok.ochrona_od;
			if (okno && (nw.ochrona_od < okno.min || nw.ochrona_od > okno.max)) nw.ochrona_od = okno.domyslna;
			this.nw = { ...nw, oswiadczenia: false };
		}
		if (typeof s.niePowod === 'string') this.niePowod = s.niePowod;
		if (Array.isArray(s.wykonawcy)) {
			this.wykonawcy = s.wykonawcy
				.filter((w): w is Record<string, unknown> => !!w && typeof w === 'object' && typeof (w as { id?: unknown }).id === 'string')
				.map((w) => ({
					id: String(w.id).slice(0, 40),
					imie_nazwisko: typeof w.imie_nazwisko === 'string' ? w.imie_nazwisko : '',
					zabiegi: Array.isArray(w.zabiegi) ? w.zabiegi.filter((t): t is string => typeof t === 'string') : []
				}))
				.slice(0, MAKS_WYKONAWCOW);
		}
		const a = scal(pustaAnkieta(this.widok), s.ankieta);
		a.osoby = a.osoby
			.filter((o) => o && typeof o === 'object')
			.map((o) => scal(pustaOsoba(), o))
			.slice(0, 20);
		if (!a.osoby.length) a.osoby = [pustaOsoba()];
		this.ankieta = { ...a, oswiadczenie: false };
	}
}
