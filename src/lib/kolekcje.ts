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

export const wczytajPlatnosci = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_policy_payments').select(PAYMENT_SELECT, licz(l)).order('data_platnosci').order('id').range(od, d));

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

export const wczytajZadania = () =>
	wszystkieWiersze((od, d, l) => sb.from('crm_tasks').select(TASK_SELECT, licz(l)).order('termin', { ascending: true, nullsFirst: false }).order('id').range(od, d));
