// Zakończenie polisy decyzją (wypowiedzenie od dnia / brak odnowienia na koniec okresu) i oznaczenie klienta
// jako nieaktywnego (zakończenie działalności). Zapis w bazie, porządki w ratach i wnioskach, pamięć CRM.
import { sb } from '$lib/supabase';
import { appState } from '$lib/stores/app.svelte';
import { ROZLICZONE } from '$lib/platnosci';
import { czyAktywny, wywolajApi } from '$lib/components/renewal/crmRenewals';
import { logAudit } from '$lib/utils/audit';
import { koniecOchrony, nieOdnawiana, plusDni, polisaAktywna, type TrybZakonczenia } from '$lib/statusPolisy';
import type { Client, Policy, PolicyPayment } from '$lib/types/database';

export type OpcjeZakonczenia = {
	tryb: TrybZakonczenia;
	/** Pierwszy dzień bez ochrony (tryb „od dnia”). */
	data?: string;
	powod: string;
	notatka?: string;
	/** Usunąć nieopłacone raty z terminem od dnia zakończenia (nie należą się już TU). */
	usunRaty: boolean;
};

/** Pierwszy dzień bez ochrony dla wybranego trybu: od dnia — podana data; koniec okresu — dzień po data_do. */
export function dataZakonczenia(p: Pick<Policy, 'data_do'>, o: Pick<OpcjeZakonczenia, 'tryb' | 'data'>): string | null {
	if (o.tryb === 'koniec_okresu') return p.data_do ? plusDni(p.data_do, 1) : null;
	return o.data ? o.data.slice(0, 10) : null;
}

/** Błąd walidacji albo '' (ok). */
export function walidujZakonczenie(p: Pick<Policy, 'data_od' | 'data_do' | 'typ_umowy'>, o: Pick<OpcjeZakonczenia, 'tryb' | 'data' | 'powod'>): string {
	if (!o.powod) return 'Wybierz powód zakończenia.';
	if (o.tryb === 'koniec_okresu') return p.data_do ? '' : 'Polisa bezterminowa nie ma końca okresu — wybierz zakończenie od dnia.';
	if (!o.data) return 'Podaj dzień, od którego polisa jest zakończona.';
	if (p.data_od && o.data <= p.data_od) return 'Dzień zakończenia musi być późniejszy niż początek ochrony.';
	if (p.data_do && o.data > p.data_do) return 'Ten dzień jest po końcu okresu — wybierz „na koniec okresu ubezpieczenia”.';
	return '';
}

/** Nieopłacone raty z terminem od dnia zakończenia (do usunięcia przy wypowiedzeniu). */
export const ratyPoZakonczeniu = (raty: PolicyPayment[], polisaId: string, zakonczonaOd: string) =>
	raty.filter((r) => r.polisa_id === polisaId && !ROZLICZONE.includes(r.status) && r.data_platnosci >= zakonczonaOd);

export type WynikZakonczenia = { ok: true; polisa: Policy; usunieteRaty: number; anulowaneWnioski: number } | { ok: false; message: string };

/** Zakańcza polisę: zapis decyzji, porządek w ratach i aktywnych wnioskach o odnowienie, pamięć CRM. */
export async function zakonczPolise(p: Policy, o: OpcjeZakonczenia): Promise<WynikZakonczenia> {
	const blad = walidujZakonczenie(p, o);
	if (blad) return { ok: false, message: blad };
	const zakonczonaOd = dataZakonczenia(p, o)!;
	const zmiany = {
		zakonczona_od: zakonczonaOd,
		zakonczenie_tryb: o.tryb,
		zakonczenie_powod: o.powod,
		zakonczenie_notatka: o.notatka?.trim() || null,
		zakonczono_at: new Date().toISOString(),
		zakonczono_przez: appState.profile?.id ?? null
	};
	const { error } = await sb.from('crm_policies').update(zmiany as never).eq('id', p.id);
	if (error) return { ok: false, message: error.message };

	let usunieteRaty = 0;
	if (o.usunRaty) {
		const raty = ratyPoZakonczeniu(appState.payments, p.id, zakonczonaOd);
		if (raty.length) {
			const ids = raty.map((r) => r.id);
			const { error: e2 } = await sb.from('crm_policy_payments').delete().in('id', ids);
			if (!e2) {
				usunieteRaty = ids.length;
				appState.payments = appState.payments.filter((r) => !ids.includes(r.id));
			}
		}
	}
	// Aktywny wniosek o odnowienie tej polisy traci sens — link klienta przestaje działać.
	let anulowaneWnioski = 0;
	for (const w of appState.wnioskiOdnowien.filter((w) => w.polisa_id === p.id && czyAktywny(w.status))) {
		const r = await wywolajApi<{ ok: boolean }>('DELETE', '/api/renewals', { id: w.id });
		if (r.ok) {
			anulowaneWnioski++;
			appState.wnioskiOdnowien = appState.wnioskiOdnowien.map((x) => (x.id === w.id ? { ...x, status: 'anulowany' } : x));
		}
	}
	const polisa: Policy = { ...p, ...zmiany };
	appState.policies = appState.policies.map((x) => (x.id === p.id ? { ...x, ...zmiany } : x));
	await logAudit('policy_ended', 'policy', p.id, p.nr_polisy, { ...zmiany, usuniete_raty: usunieteRaty, anulowane_wnioski: anulowaneWnioski });
	return { ok: true, polisa, usunieteRaty, anulowaneWnioski };
}

/** Cofa decyzję o zakończeniu (usunięte raty nie wracają — trzeba je dopisać ręcznie). Zwraca błąd albo ''. */
export async function cofnijZakonczenie(p: Policy): Promise<string> {
	const zmiany = { zakonczona_od: null, zakonczenie_tryb: null, zakonczenie_powod: null, zakonczenie_notatka: null, zakonczono_at: null, zakonczono_przez: null };
	const { error } = await sb.from('crm_policies').update(zmiany as never).eq('id', p.id);
	if (error) return error.message;
	appState.policies = appState.policies.map((x) => (x.id === p.id ? { ...x, ...zmiany } : x));
	await logAudit('policy_end_reverted', 'policy', p.id, p.nr_polisy);
	return '';
}

/** Aktywne polisy klienta (ubezpieczający), bez umów generalnych, bez zakończonych już decyzją — do zakończenia razem z klientem. */
export const polisyDoZakonczenia = (policies: Policy[], klientId: string, dzis: string) =>
	policies.filter((p) => p.klient_id === klientId && !p.deleted_at && p.typ_umowy !== 'generalna' && !nieOdnawiana(p) && polisaAktywna(p, dzis) && !!koniecOchrony(p));

export type OpcjeNieaktywnosci = {
	powod: string;
	od: string;
	notatka?: string;
	zakonczPolisy: boolean;
	trybPolis: TrybZakonczenia;
	usunRaty: boolean;
	/** Lead klienta w Sprzedaży przechodzi na „przegrany” (zakończenie działalności). */
	zamknijLeada: boolean;
};

export type WynikNieaktywnosci = { ok: true; klient: Client; zakonczonePolisy: number; bledyPolis: string[] } | { ok: false; message: string };

export async function oznaczKlientaNieaktywnego(c: Client, o: OpcjeNieaktywnosci, dzis: string): Promise<WynikNieaktywnosci> {
	if (!o.powod) return { ok: false, message: 'Wybierz powód.' };
	if (!o.od) return { ok: false, message: 'Podaj datę, od której klient jest nieaktywny.' };
	const zmiany = {
		aktywny: false,
		nieaktywny_od: o.od.slice(0, 10),
		nieaktywny_powod: o.powod,
		nieaktywny_notatka: o.notatka?.trim() || null,
		nieaktywny_at: new Date().toISOString(),
		nieaktywny_przez: appState.profile?.id ?? null
	};
	const { error } = await sb.from('crm_clients').update(zmiany as never).eq('id', c.id);
	if (error) return { ok: false, message: error.message };
	const klient: Client = { ...c, ...zmiany };
	appState.clients = appState.clients.map((x) => (x.id === c.id ? { ...x, ...zmiany } : x));

	let zakonczonePolisy = 0;
	const bledyPolis: string[] = [];
	if (o.zakonczPolisy) {
		const powodPolisy = o.powod === 'zakonczenie_dzialalnosci' || o.powod === 'zawieszenie_dzialalnosci' ? 'zakonczenie_dzialalnosci' : o.powod === 'rezygnacja' ? 'zmiana_brokera' : 'inne';
		for (const p of polisyDoZakonczenia(appState.policies, c.id, dzis)) {
			// Od dnia: data nieaktywności, ale nie wcześniej niż dzień po początku ochrony i nie później niż koniec okresu.
			let tryb: TrybZakonczenia = o.trybPolis;
			let data = o.od.slice(0, 10);
			if (tryb === 'od_dnia') {
				if (p.data_od && data <= p.data_od) data = plusDni(p.data_od, 1);
				if (p.data_do && data > p.data_do) tryb = 'koniec_okresu';
			}
			const w = await zakonczPolise(p, { tryb, data, powod: powodPolisy, notatka: `Klient nieaktywny: ${o.notatka?.trim() || zmiany.nieaktywny_powod}`, usunRaty: o.usunRaty });
			if (w.ok) zakonczonePolisy++;
			else bledyPolis.push(`${p.nr_polisy}: ${w.message}`);
		}
	}
	if (o.zamknijLeada) {
		await sb.from('crm_prospects').update({ status: 'przegrany', status_zmieniony_at: new Date().toISOString() } as never).eq('klient_id', c.id).not('status', 'in', '(wygrany,przegrany)');
		appState.prospectsLoaded = false;
	}
	await logAudit('client_deactivated', 'client', c.id, c.nazwa, { ...zmiany, zakonczone_polisy: zakonczonePolisy });
	return { ok: true, klient, zakonczonePolisy, bledyPolis };
}

/** Przywraca aktywność klienta (polisy zakończone razem z nim zostają zakończone). Zwraca błąd albo ''. */
export async function przywrocKlienta(c: Client): Promise<string> {
	const zmiany = { aktywny: true, nieaktywny_od: null, nieaktywny_powod: null, nieaktywny_notatka: null, nieaktywny_at: null, nieaktywny_przez: null };
	const { error } = await sb.from('crm_clients').update(zmiany as never).eq('id', c.id);
	if (error) return error.message;
	appState.clients = appState.clients.map((x) => (x.id === c.id ? { ...x, ...zmiany } : x));
	await logAudit('client_reactivated', 'client', c.id, c.nazwa);
	return '';
}
