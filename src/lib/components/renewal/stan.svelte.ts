// Stan formularza odnowienia po stronie klienta. Jedna instancja na otwarty link; kroki
// (APK, wniosek, ankieta, podsumowanie) czytają i zmieniają jej pola.

import type { OdpowiedzZloz, WidokOdnowienia, Zalacznik } from '$lib/renewals/api';
import {
	SUMY,
	waliduj_ankiete,
	waliduj_wniosek,
	wycenaWniosku,
	type Ankieta,
	type Apk,
	type Decyzja,
	type LiczbaOsob,
	type RodzajGabinetu,
	type Suma,
	type TypZalacznika,
	type Wniosek,
	type Wynik
} from '$lib/renewals/program';

export type WidokAktywny = Extract<WidokOdnowienia, { stan: 'aktywny' }>;
export type Krok = 'start' | 'apk' | 'wniosek' | 'ankieta' | 'podsumowanie' | 'wyslano';

// Pola formularza przed walidacją — puste odpowiedzi to ''.
export type ApkForm = Omit<Apk, 'osoby' | 'szkody' | 'szkody_opis' | 'spoza_listy' | 'spoza_listy_opis' | 'suma_oczekiwana' | 'ochrona_prawna' | 'szkolenia' | 'priorytet'> & {
	osoby: Apk['osoby'] | '';
	suma_oczekiwana: Apk['suma_oczekiwana'] | '';
	ochrona_prawna: Apk['ochrona_prawna'] | '';
	szkolenia: Apk['szkolenia'] | '';
	priorytet: Apk['priorytet'] | '';
};

export type AnkietaForm = Omit<Ankieta, 'zgoda_klientow'> & { zgoda_klientow: Ankieta['zgoda_klientow'] | '' };

// Zmiany trzymamy „płasko”: odznaczenie pozycji nie kasuje tego, co klient już wpisał.
export type ZmianyForm = {
	suma: boolean;
	wyzsza_suma: Suma | null;
	ochrona_prawna: boolean;
	adres: boolean;
	ulica: string;
	kod: string;
	miasto: string;
	zabiegi: boolean;
	nowe_zabiegi: string[];
	ankieta: boolean;
	zabiegi_ankieta: string[];
	inne_zaznaczone: boolean;
	inne: string;
	rodzaje: RodzajGabinetu[];
	osoby: LiczbaOsob | '';
};

export type Wgrywany = { tmp: string; typ: TypZalacznika; nazwa: string; rozmiar: number; stan: 'wysylanie' | 'blad'; blad: string };

export const pustaApk = (): ApkForm => ({
	rodzaje: [],
	osoby: '',
	suma_oczekiwana: '',
	ochrona_prawna: '',
	szkolenia: '',
	inne_ubezpieczenia: [],
	priorytet: '',
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
	zabiegi: false,
	nowe_zabiegi: [],
	ankieta: false,
	zabiegi_ankieta: [],
	inne_zaznaczone: false,
	inne: '',
	rodzaje: [],
	osoby: ''
});

export const pustaOsoba = () => ({ imie_nazwisko: '', kwalifikacje: '', doswiadczenie: '' });

const pustaAnkieta = (klient: string): AnkietaForm => ({
	ubezpieczajacy: klient,
	ubezpieczony: klient,
	data_rozpoczecia: '',
	liczba_zatrudnionych: '',
	szkodowosc: '',
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

	// Wniosek
	decyzja = $state<Decyzja | ''>('');
	zm = $state<ZmianyForm>(pusteZmiany());
	niePowod = $state('');
	potwierdzenieNie = $state(false);

	// Ankieta Ergo Hestii i załączniki (zapisane na serwerze oraz wgrywane teraz)
	ankieta = $state<AnkietaForm>(pustaAnkieta(''));
	zalaczniki = $state<Zalacznik[]>([]);
	wgrywane = $state<Wgrywany[]>([]);

	wynik = $state<OdpowiedzZloz | null>(null);

	apkGotowa = $derived(this.apkOdmowa || !!this.apkZapisana);
	// Przy odmowie APK wycena bierze rodzaj gabinetu i liczbę osób z wniosku.
	apkDoWyceny = $derived(this.apkOdmowa ? null : this.apkZapisana);
	wyzszeSumy = $derived(SUMY.filter((s) => this.widok.suma == null || s > this.widok.suma));
	// Rodzaj i liczba osób we wniosku są potrzebne tylko do wyceny wyższej sumy bez APK.
	pytajODaneWyceny = $derived(this.decyzja === 'zmiany' && this.zm.suma && this.apkOdmowa);
	potrzebnaAnkieta = $derived(this.decyzja === 'zmiany' && this.zm.ankieta && this.zm.zabiegi_ankieta.length > 0);
	wniosek = $derived.by((): Wniosek => this.zbudujWniosek());
	wycena = $derived.by(() => wycenaWniosku(this.wniosek, this.apkDoWyceny, this.widok.skladka, this.widok.ochrona_prawna_obecnie));
	kroki = $derived<Krok[]>(this.potrzebnaAnkieta ? ['apk', 'wniosek', 'ankieta', 'podsumowanie'] : ['apk', 'wniosek', 'podsumowanie']);

	constructor(klucz: string, widok: WidokAktywny) {
		this.klucz = klucz;
		this.widok = widok;
		this.apkOdmowa = widok.apk_odmowa;
		this.apkZapisana = widok.apk_wypelniona && widok.apk ? widok.apk : null;
		if (widok.apk) this.apkForm = scal(pustaApk(), widok.apk);
		this.apkEdycja = !this.apkGotowa;
		this.ankieta = pustaAnkieta(widok.klient);
		this.zalaczniki = [...widok.zalaczniki];
		this.wczytajSzkic();
	}

	private zbudujWniosek(): Wniosek {
		const d = this.decyzja;
		if (d === 'nie') return { decyzja: 'nie', zmiany: null, nie_powod: this.niePowod, potwierdzenie_nie: this.potwierdzenieNie };
		if (d !== 'zmiany') return { decyzja: d as Decyzja, zmiany: null, nie_powod: '', potwierdzenie_nie: false };
		const z = this.zm;
		return {
			decyzja: 'zmiany',
			zmiany: {
				wyzsza_suma: z.suma ? z.wyzsza_suma : null,
				// Klauzula, którą certyfikat już ma, nie jest zmianą (stary szkic mógł ją mieć zaznaczoną).
				ochrona_prawna: z.ochrona_prawna && !this.widok.ochrona_prawna_obecnie,
				adres: z.adres ? { ulica: z.ulica, kod: z.kod, miasto: z.miasto } : null,
				nowe_zabiegi: z.zabiegi ? [...z.nowe_zabiegi] : [],
				zabiegi_ankieta: z.ankieta ? [...z.zabiegi_ankieta] : [],
				inne: z.inne_zaznaczone ? z.inne : '',
				rodzaje: this.pytajODaneWyceny ? [...z.rodzaje] : [],
				osoby: this.pytajODaneWyceny ? z.osoby || null : null
			},
			nie_powod: '',
			potwierdzenie_nie: false
		};
	}

	// Reguły programu (waliduj_wniosek) plus braki w zaznaczonych pozycjach — inaczej klient,
	// który zaznaczył „wyższa suma” bez wyboru kwoty, dostałby mylące „zaznacz co najmniej jedną zmianę”.
	sprawdzWniosek(): Wynik<Wniosek> {
		const w = waliduj_wniosek(this.wniosek, this.apkDoWyceny);
		if (this.decyzja !== 'zmiany') return w;
		const z = this.zm;
		const braki: string[] = [];
		if (z.suma && !z.wyzsza_suma) braki.push('Wybierz nową sumę gwarancyjną (albo odznacz „Wyższa suma gwarancyjna”).');
		if (z.zabiegi && !z.nowe_zabiegi.length) braki.push('Zaznacz nowe zabiegi z listy programu (albo odznacz tę pozycję).');
		if (z.ankieta && !z.zabiegi_ankieta.length) braki.push('Zaznacz zabiegi wymagające ankiety (albo odznacz tę pozycję).');
		if (z.inne_zaznaczone && !z.inne.trim()) braki.push('Opisz inne zmiany (albo odznacz tę pozycję).');
		if (!braki.length) return w;
		const reszta = w.ok ? [] : w.bledy.filter((b) => !b.startsWith('Zaznacz co najmniej jedną zmianę'));
		return { ok: false, bledy: [...braki, ...reszta] };
	}

	sprawdzAnkiete(): string[] {
		const w = waliduj_ankiete(this.ankieta);
		const bledy = w.ok ? [] : [...w.bledy];
		if (!this.zalaczniki.some((z) => z.typ === 'dyplom')) bledy.push('Załączniki: dodaj co najmniej jeden dyplom.');
		if (!this.zalaczniki.some((z) => z.typ === 'certyfikat')) {
			bledy.push('Załączniki: dodaj certyfikat ze szkolenia z zabiegu (ukończonego co najmniej 12 miesięcy przed początkiem ochrony).');
		}
		if (this.wgrywane.some((w) => w.stan === 'wysylanie')) bledy.push('Poczekaj, aż wszystkie pliki zostaną wysłane.');
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
			ankieta: { ...this.ankieta, oswiadczenie: false }
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
		if (s.decyzja === 'bez_zmian' || s.decyzja === 'zmiany' || s.decyzja === 'nie') this.decyzja = s.decyzja;
		const zm = scal(pusteZmiany(), s.zm);
		if (zm.wyzsza_suma != null && !this.wyzszeSumy.includes(zm.wyzsza_suma)) zm.wyzsza_suma = null;
		this.zm = zm;
		if (typeof s.niePowod === 'string') this.niePowod = s.niePowod;
		const a = scal(pustaAnkieta(this.widok.klient), s.ankieta);
		a.osoby = a.osoby
			.filter((o) => o && typeof o === 'object')
			.map((o) => scal(pustaOsoba(), o))
			.slice(0, 20);
		if (!a.osoby.length) a.osoby = [pustaOsoba()];
		this.ankieta = { ...a, oswiadczenie: false };
	}
}
