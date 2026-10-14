// Kontrakt między stroną klienta /odnowienie/[token] a serwerem /api/odnowienie/[token].
// Klient nie ma sesji ani dostępu do bazy: wszystko idzie przez te żądania, a klucz z adresu
// (<id odnowienia>-<podpis HMAC>) jest jedynym uprawnieniem.

import type { Apk, Ankieta, Decyzja, TypZalacznika, Wniosek } from './program';
import type { Podpis } from './podpis';
import type { Zgody } from './zgody';

export type StatusOdnowienia = 'utworzony' | 'wyslany' | 'otwarty' | 'apk' | 'zlozony' | 'wygasl' | 'anulowany';

// osoba = id osoby wykonującej zabiegi (dyplom, certyfikat), zabieg = nazwa zabiegu (certyfikat).
// osoba_nazwa — imię i nazwisko osoby w chwili wgrania (odtworzenie osób po powrocie z linku w nowej karcie).
export type Zalacznik = {
	id: string;
	typ: TypZalacznika;
	nazwa: string;
	rozmiar: number;
	mime: string;
	osoba?: string | null;
	osoba_nazwa?: string | null;
	zabieg?: string | null;
};

// GET /api/odnowienie/[token]
export type WidokOdnowienia =
	| { stan: 'nieznany' }
	| { stan: 'wygasl' | 'anulowany' }
	| {
			stan: 'zlozony';
			klient: string;
			nr_polisy: string | null;
			decyzja: Decyzja;
			zlozono_at: string;
	  }
	| {
			stan: 'aktywny';
			status: StatusOdnowienia;
			klient: string;
			nr_polisy: string | null;
			ubezpieczyciel: string | null;
			program: string | null;
			suma: number | null;
			skladka: number | null;
			okres_obecny: { od: string | null; do: string | null };
			okres_nowy: { od: string; do: string };
			wazny_do: string;
			apk_wypelniona: boolean;
			apk_odmowa: boolean;
			// Obecna składka zawiera już klauzulę ochrony prawnej (stawka z tabeli + 92 zł).
			ochrona_prawna_obecnie: boolean;
			apk: Apk | null;
			zalaczniki: Zalacznik[];
			// NIP i REGON klienta z kartoteki CRM (same cyfry) — podpowiedź w ankiecie Ergo Hestii.
			// Wypełnione tylko w odpowiedzi GET; null, gdy w kartotece ich nie ma.
			nip: string | null;
			regon: string | null;
			// Zgody marketingowe do pokazania w formularzu: z tego wniosku (po APK), a przed APK — bieżący stan
			// z kartoteki klienta (null, gdy nigdy nie pytano). Klient może je zmienić przy każdym podpisie APK.
			zgody: Zgody | null;
			// Czas podpisu pod APK (albo odmową) — po podpisie klient podpisuje ponownie tylko przy poprawkach.
			podpis_apk_at: string | null;
	  };

// POST /api/odnowienie/[token] — jedno z działań. APK (albo odmowa) i wniosek idą z podpisem klienta
// (palcem / rysikiem / myszą, format w ./podpis); zgody marketingowe klient podpisuje razem z APK.
export type Dzialanie =
	| { akcja: 'apk'; apk: Apk; zgody: Zgody; podpis: Podpis }
	| { akcja: 'apk_odmowa'; potwierdzenie: true; zgody: Zgody; podpis: Podpis }
	// Jednorazowy adres do wgrania pliku prosto do magazynu (supabase-js: uploadToSignedUrl).
	| { akcja: 'zalacznik_url'; typ: TypZalacznika; nazwa: string; rozmiar: number; mime: string; osoba?: string | null; osoba_nazwa?: string | null; zabieg?: string | null }
	| { akcja: 'zalacznik_usun'; id: string }
	| { akcja: 'zloz'; wniosek: Wniosek; ankieta: Ankieta | null; podpis: Podpis };

export type OdpowiedzZalacznikUrl = { id: string; path: string; token: string; zalacznik: Zalacznik };
export type OdpowiedzZloz = { ok: true; decyzja: Decyzja; skladka_nowa: number | null; wycena_indywidualna: boolean };
export type OdpowiedzBlad = { message: string; bledy?: string[] };
