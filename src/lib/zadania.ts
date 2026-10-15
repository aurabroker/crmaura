// Zadania CRM — wspólne dla pulpitu, kalendarza, karty klienta i leada: rodzaje zadania,
// stany, zmiana statusu z wpisem do rejestru i powiązanie z wnioskiem online (crm_tasks.renewal_id).
import { sb } from '$lib/supabase';
import { appState } from '$lib/stores/app.svelte';
import { adresWniosku } from '$lib/components/renewal/crmRenewals';
import type { CrmTask } from '$lib/types/database';

/** Rodzaj zadania (kolumna typy) — checkboxy w formularzu; „wniosek” nadaje serwer zadaniom z wniosków online. */
export const TYPY_ZADAN = [
	{ val: 'spotkanie', label: 'Spotkanie' },
	{ val: 'email', label: 'E-mail' },
	{ val: 'telefon', label: 'Telefon' },
	{ val: 'oferta', label: 'Oferta' },
	{ val: 'wniosek', label: 'Wniosek klienta' }
] as const;
export const TYP_ZADANIA_ETYKIETA: Record<string, string> = Object.fromEntries(TYPY_ZADAN.map((t) => [t.val, t.label]));

export const STATUS_ZADANIA_ETYKIETA: Record<CrmTask['status'], string> = {
	otwarte: 'Otwarte',
	w_toku: 'W toku',
	zakonczone: 'Zakończone',
	anulowane: 'Anulowane'
};

export const zadanieOtwarte = (t: Pick<CrmTask, 'status'>) => t.status === 'otwarte' || t.status === 'w_toku';
export const zadaniePoTerminie = (t: Pick<CrmTask, 'status' | 'termin'>, dzis: string) => zadanieOtwarte(t) && !!t.termin && t.termin < dzis;
/** Zadanie z wniosku online (odnowienie certyfikatu albo pierwsza polisa) — serwer tworzy je po złożeniu wniosku. */
export const zadanieZWniosku = (t: Pick<CrmTask, 'renewal_id'>) => !!t.renewal_id;

/** Dokąd prowadzi wniosek zadania: karta polisy (odnowienie) albo karta klienta → APK (pierwsza polisa). */
export function adresWnioskuZadania(t: Pick<CrmTask, 'renewal_id' | 'klient_id' | 'polisa_id'>): string | null {
	if (!t.renewal_id) return null;
	const w = appState.wnioskiOdnowien.find((x) => x.id === t.renewal_id);
	if (w) return adresWniosku(w);
	return t.polisa_id ? `/policies/${t.polisa_id}` : t.klient_id ? `/clients/${t.klient_id}?tab=apk` : null;
}

/** Wpis do rejestru zadań (crm_task_history). Błąd nie przerywa niczego — rejestr jest pomocniczy. */
export async function zapiszHistorieZadania(t: CrmTask, nowy: CrmTask['status'], autorId: string) {
	const { error } = await sb.from('crm_task_history').insert([
		{
			tenant_id: t.tenant_id,
			task_id: t.id,
			tytul_zadania: t.tytul,
			zmiana: nowy === 'zakonczone' ? 'zakonczone' : nowy === 'anulowane' ? 'anulowane' : 'wznowione',
			stary_status: t.status,
			nowy_status: nowy,
			autor_id: autorId,
			klient_id: t.klient_id,
			prospect_id: t.prospect_id
		}
	] as never);
	if (error) console.error('zadania: rejestr:', error.message);
}

/** Pola zmieniane razem ze statusem: data zakończenia i postęp. */
export function zmianaStatusu(t: Pick<CrmTask, 'postep_pct'>, status: CrmTask['status']) {
	const zakonczone = status === 'zakonczone';
	return {
		status,
		zakonczone_at: zakonczone ? new Date().toISOString() : null,
		postep_pct: zakonczone ? 100 : (t.postep_pct ?? 0) >= 100 ? 0 : (t.postep_pct ?? 0),
		updated_at: new Date().toISOString()
	};
}

/** Zmiana statusu zadania w bazie z wpisem do rejestru. Zwraca komunikat błędu albo '' (sukces). */
export async function ustawStatusZadania(t: CrmTask, status: CrmTask['status'], autorId: string): Promise<string> {
	const { error } = await sb.from('crm_tasks').update(zmianaStatusu(t, status) as never).eq('id', t.id);
	if (error) return error.message;
	await zapiszHistorieZadania(t, status, autorId);
	return '';
}

/** Zadania w pamięci po zmianie statusu jednego z nich (bez ponownego wczytywania listy). */
export const zadaniaPoZmianie = (lista: CrmTask[], id: string, status: CrmTask['status']): CrmTask[] =>
	lista.map((t) => (t.id === id ? { ...t, ...zmianaStatusu(t, status) } : t));
