export type Role = 'ADMIN GOD' | 'ADMIN BROKER' | 'BOARD' | 'ADMINISTRACJA' | 'BROKER';

export interface Profile {
	id: string;
	tenant_id: string;
	email: string;
	imie_nazwisko: string | null;
	rola: Role;
	stanowisko: string | null;
	ma_zespol: boolean | null;
}

export interface Tenant {
	id: string;
	nazwa: string;
	created_at?: string;
}

export interface Client {
	id: string;
	tenant_id: string;
	opiekun_id: string | null;
	nazwa: string;
	ulica: string | null;
	nip: string | null;
	pesel: string | null;
	regon: string | null;
	krs: string | null;
	rodo_zgoda: boolean;
	rodo_data: string | null;
	rodo_kanal: string | null;
	created_at?: string;
}

export interface Insurer {
	id: string;
	tenant_id: string;
	nazwa: string;
	dzial: 'Majątkowy' | 'Życiowy';
	ulica: string | null;
	nip: string | null;
	krs: string | null;
}

export type TypUmowy = 'jednostkowa' | 'generalna';
export type UgPodtyp = 'flota' | 'gwarancje' | 'cpm' | 'car_ear';

export interface Policy {
	id: string;
	tenant_id: string;
	klient_id: string;
	tu_id: string;
	nr_polisy: string;
	rodzaj: string;
	przedmiot: string | null;
	data_od: string;
	data_do: string;
	ilosc_rat: string;
	daty_rat: string | null;
	skladka_przypisana: number;
	skladka_zainkasowana: number;
	prowizja_pct: number;
	prowizja_przypisana: number;
	prowizja_zainkasowana: number;
	typ_umowy: TypUmowy;
	ug_podtyp: UgPodtyp | null;
	parent_id: string | null;
	skladka_zaliczkowa: number;
	data_zawarcia: string | null;
	rozliczenie_status: string | null;
	rozliczenie_kwota_tu: number | null;
	rozliczenie_plik: string | null;
	created_at?: string;
	crm_clients?: { nazwa: string } | null;
	crm_insurers?: { nazwa: string } | null;
}

export interface PolicyAnnex {
	id: string;
	tenant_id: string;
	polisa_id: string;
	nr_aneksu: string;
	typ: 'korekta' | 'doubezpieczenie' | 'zmiana_zakresu' | 'inne';
	data_aneksu: string;
	opis: string | null;
	delta_skladka: number;
	delta_prowizja: number;
	new_data_do: string | null;
	new_skladka_przypisana: number | null;
	new_prowizja_pct: number | null;
	created_at?: string;
}

export interface Claim {
	id: string;
	tenant_id: string;
	klient_id: string;
	polisa_id: string | null;
	tu_id: string | null;
	nr_szkody: string | null;
	data_szkody: string;
	opis_szkody: string | null;
	wartosc_roszczenia: number | null;
	status: string;
	created_at?: string;
	crm_clients?: { nazwa: string } | null;
	crm_policies?: { nr_polisy: string } | null;
}

export interface Vehicle {
	id: string;
	tenant_id: string;
	klient_id: string;
	nr_rejestracyjny: string;
	marka_model: string;
	vin: string | null;
	rok_produkcji: number | null;
}

export interface ApkLog {
	id: string;
	tenant_id: string;
	polisa_id: string;
	czy_podpisane: boolean;
	data_podpisu: string | null;
	crm_policies?: { nr_polisy: string; crm_clients?: { nazwa: string } | null } | null;
}

export interface PolicyPayment {
	id: string;
	tenant_id: string;
	polisa_id: string;
	nr_raty: number;
	data_platnosci: string;
	kwota: number;
	status: 'Oczekująca' | 'Opłacona' | 'Zaległa';
	data_oplacenia: string | null;
	notatka: string | null;
	created_at?: string;
	crm_policies?: { nr_polisy: string; crm_clients?: { nazwa: string } | null } | null;
}

export interface Prospect {
	id: string;
	tenant_id: string;
	nazwa: string;
	nip: string | null;
	adres: string | null;
	telefon: string | null;
	email: string | null;
	branza: string | null;
	notatki: string | null;
	broker_id: string | null;
	status: string;
	created_at?: string;
	crm_profiles?: { imie_nazwisko: string | null } | null;
}

export interface CommissionSettlement {
	id: string;
	tenant_id: string;
	broker_id: string;
	miesiac: string;
	kwota_przypisana: number;
	kwota_rozliczona: number;
	status: string;
	zamkniete_at: string | null;
	created_at?: string;
}

export type Database = Record<string, unknown>;
