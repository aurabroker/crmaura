// Wspólne zapytania o polisy i płatności. crm_policies ma dwa powiązania z crm_clients
// (klient_id i ubezpieczony_id), więc osadzenie klienta musi wskazać kolumnę — samo
// `crm_clients(...)` baza odrzuca jako niejednoznaczne, a lista polis zostaje pusta.

export const POLICY_SELECT =
	'*, crm_clients!klient_id(nazwa), ubezpieczony:crm_clients!ubezpieczony_id(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))';

export const PAYMENT_SELECT = '*, crm_policies(nr_polisy, crm_clients!klient_id(nazwa))';
