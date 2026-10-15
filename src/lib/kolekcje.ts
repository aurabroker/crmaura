// Wczytywanie całych kolekcji CRM do appState. Każda lista idzie stronami (wszystkieWiersze) —
// pojedyncze zapytanie oddaje najwyżej 1000 wierszy, więc np. klienci powyżej tysiąca znikali
// po starcie i po każdym ponownym wczytaniu listy. Ostatni klucz sortowania to zawsze id.
import { sb } from '$lib/supabase';
import { PAYMENT_SELECT, POLICY_SELECT, wszystkieWiersze } from '$lib/queries';
import { APK_FORMS_SELECT } from '$lib/utils/apkLink';

export const CLAIM_SELECT = '*, crm_clients(nazwa), crm_policies(nr_polisy)';
export const TASK_SELECT =
	'*, crm_clients(nazwa), crm_prospects(nazwa), crm_policies(nr_polisy), assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)';

const licz = (l: boolean) => (l ? { count: 'exact' as const } : undefined);

export const wczytajKlientow = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_clients').select('*', licz(l)).order('created_at', { ascending: false }).order('id', { ascending: false }).range(od, d));

export const wczytajPolisy = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_policies').select(POLICY_SELECT, licz(l)).is('deleted_at', null).order('created_at').order('id').range(od, d));

export const wczytajAneksy = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_policy_annexes').select('*', licz(l)).order('data_aneksu').order('id').range(od, d));

// Raty tylko polis spoza kosza (polisa usunięta = jej raty znikają z Płatności, pulpitu i prowizji;
// po przywróceniu z kosza wracają).
const PLATNOSCI_AKTYWNYCH_POLIS = '*, crm_policies!inner(nr_polisy, crm_clients!klient_id(nazwa))';
export const wczytajPlatnosci = () =>
	wszystkieWiersze((od, d, l) =>
		sb.from('crm_policy_payments').select(PLATNOSCI_AKTYWNYCH_POLIS, licz(l)).is('crm_policies.deleted_at', null).order('data_platnosci').order('id').range(od, d)
	);

export const wczytajSzkody = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_claims').select(CLAIM_SELECT, licz(l)).order('created_at').order('id').range(od, d));

export const wczytajPojazdy = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_vehicles').select('*', licz(l)).order('created_at').order('id').range(od, d));

export const wczytajApkLogi = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_apk_logs').select(PAYMENT_SELECT, licz(l)).order('created_at').order('id').range(od, d));

export const wczytajPodzialProwizji = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_policy_brokers').select('*, crm_profiles(imie_nazwisko, email)', licz(l)).order('created_at').order('id').range(od, d));

export const wczytajKontakty = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_client_contacts').select('*', licz(l)).order('created_at').order('id').range(od, d));

// tenantId: przy starcie aplikacji filtrujemy jawnie (jak dotąd); w pozostałych miejscach wystarcza RLS.
export const wczytajFormularzeApk = (tenantId?: string) =>
	wszystkieWiersze((od, d, l) => {
		const q = sb.from('apk_forms').select(APK_FORMS_SELECT, licz(l));
		return (tenantId ? q.eq('tenant_id', tenantId) : q).order('created_at', { ascending: false }).order('id', { ascending: false }).range(od, d);
	});

// Wnioski o odnowienie (program OC beauty) — skrót do pulpitu i zakładki APK; odpowiedzi klienta
// doczytują karta polisy i karta klienta. Przed migracją odnowień zapytanie zwraca błąd → data null.
export const WNIOSKI_ODNOWIEN_KOLUMNY =
	'id, tenant_id, polisa_id, rodzaj, klient_id, status, decyzja, email, nr_polisy, klient_nazwa, okres_do, apk_at, apk_odmowa, pdf_path, wyslano_at, otwarto_at, zlozono_at, przypomniano_at, wazny_do, created_at, podpis_apk_at, podpis_wniosku_at';
export const wczytajWnioskiOdnowien = () =>
	wszystkieWiersze((od, d, l) =>
		sb.from('crm_renewals').select(WNIOSKI_ODNOWIEN_KOLUMNY, licz(l)).order('created_at', { ascending: false }).order('id', { ascending: false }).range(od, d)
	);

export const wczytajZadania = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_tasks').select(TASK_SELECT, licz(l)).order('termin', { ascending: true, nullsFirst: false }).order('id').range(od, d));
