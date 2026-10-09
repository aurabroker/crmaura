// Kontrakt panelu CRM z serwerem dla odnowień (nagłówek Authorization: Bearer <sesja pracownika>).
//
// POST   /api/renewals        { polisa_id, tryb: 'email' | 'link', zastap?: true }
//        → 200 OdnowienieUtworzone
//        → 409 { message, aktywny: true }   gdy polisa ma aktywny wniosek, a nie podano zastap
//        → 400 { message }                  np. polisa spoza programu OC beauty, już odnowiona,
//                                           brak e-maila klienta (tryb email), brak klucza Resend
// POST   /api/renewals/link   { id }   → 200 { link }   link do istniejącego, aktywnego wniosku
// DELETE /api/renewals        { id }   → 200 { ok: true }  anulowanie (link przestaje działać)
//
// Listę i szczegóły odnowień panel czyta wprost z tabel crm_renewals i crm_renewal_events
// (RLS: tylko własna firma, tylko odczyt). Pliki z bucketu renewal-files otwiera przez
// storageLink.openStoredFile('renewal-files', ...): PDF wniosku to pdf_path, załączniki klienta
// to zalaczniki[].path (każdy: { id, path, typ, nazwa, rozmiar, mime, at }).

export type TrybWyslania = 'email' | 'link';

export type OdnowienieUtworzone = {
	id: string;
	link: string;
	status: 'utworzony' | 'wyslany';
	wyslano: boolean;
	/** Adres, na który poszedł e-mail (w trybie testowym — adres testowy). */
	adres?: string | null;
	/** Wniosek testowy: e-maile idą na adres testowy, nie do klienta. */
	test?: boolean;
};

/** Domyślny adres trybu testowego odnowień (serwer: RENEWAL_TEST_EMAIL). */
export const ADRES_TESTOWY = 'zarzad@auraexpert.pl';

export const STATUS_ODNOWIENIA_ETYKIETA: Record<string, string> = {
	utworzony: 'Link utworzony',
	wyslany: 'Wysłano do klienta',
	otwarty: 'Klient otworzył',
	apk: 'APK wypełniona',
	zlozony: 'Wniosek złożony',
	wygasl: 'Wygasł',
	anulowany: 'Anulowany'
};

export const DECYZJA_ETYKIETA: Record<string, string> = {
	bez_zmian: 'Odnowienie bez zmian',
	zmiany: 'Odnowienie ze zmianami',
	nie: 'Rezygnacja z odnowienia'
};
