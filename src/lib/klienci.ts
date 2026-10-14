// Scalanie zdublowanych klientów — część wspólna listy Klientów (wykryte duplikaty) i karty klienta („Scal z innym”).
// Samo scalenie wykonuje serwer (POST /api/klienci/scal → funkcja crm_scal_klientow w bazie).
import { wywolajApi } from '$lib/components/renewal/crmRenewals';
import {
	wczytajFormularzeApk,
	wczytajKlientow,
	wczytajKontakty,
	wczytajPojazdy,
	wczytajPolisy,
	wczytajSzkody,
	wczytajWnioskiOdnowien,
	wczytajZadania
} from '$lib/kolekcje';
import { appState } from '$lib/stores/app.svelte';
import type { Client } from '$lib/types/database';

export type WynikScalenia = {
	docelowy: string;
	usunieto: number;
	przeniesiono: Record<string, number>;
	beauty_id: number | null;
	beauty_ids_scalone: number[];
	lead: string | null;
};

export const scalKlientow = (docelowy: string, duplikaty: string[]) => wywolajApi<WynikScalenia>('POST', '/api/klienci/scal', { docelowy, duplikaty });

export const cyfry = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '');
export const nipPoprawny = (t: string | null | undefined) => cyfry(t).length === 10;

/** Nazwa do porównań: małe litery, bez ogonków, bez znaków innych niż litery i cyfry. */
export const nazwaDoPorownan = (s: string | null | undefined) =>
	(s ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/ł/g, 'l')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/** Co klient ma w CRM (z wczytanych kolekcji) — do wyboru rekordu docelowego i opisu przed scaleniem. */
export type Powiazania = { polisy: number; ubezpieczony: number; apk: number; wnioski: number; zadania: number; szkody: number; pojazdy: number; kontakty: number };
export function powiazaniaKlienta(id: string): Powiazania {
	return {
		polisy: appState.policies.filter((p) => p.klient_id === id && !p.deleted_at).length,
		ubezpieczony: appState.policies.filter((p) => p.ubezpieczony_id === id && !p.deleted_at).length,
		apk: appState.apkForms.filter((f) => f.klient_id === id).length,
		wnioski: appState.wnioskiOdnowien.filter((w) => w.klient_id === id).length,
		zadania: appState.tasks.filter((t) => t.klient_id === id).length,
		szkody: appState.claims.filter((c) => c.klient_id === id).length,
		pojazdy: appState.vehicles.filter((v) => v.klient_id === id).length,
		kontakty: appState.clientContacts.filter((k) => k.klient_id === id).length
	};
}

const odm = (n: number, j: string, k: string, w: string) => (n === 1 ? j : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? k : w);
export function opisPowiazan(p: Powiazania): string {
	const czesci = [
		p.polisy ? `${p.polisy} ${odm(p.polisy, 'polisa', 'polisy', 'polis')}` : '',
		p.ubezpieczony ? `ubezpieczony w ${p.ubezpieczony}` : '',
		p.wnioski ? `${p.wnioski} ${odm(p.wnioski, 'wniosek', 'wnioski', 'wniosków')}` : '',
		p.apk ? `${p.apk} APK` : '',
		p.zadania ? `${p.zadania} ${odm(p.zadania, 'zadanie', 'zadania', 'zadań')}` : '',
		p.szkody ? `${p.szkody} ${odm(p.szkody, 'szkoda', 'szkody', 'szkód')}` : '',
		p.pojazdy ? `${p.pojazdy} ${odm(p.pojazdy, 'pojazd', 'pojazdy', 'pojazdów')}` : '',
		p.kontakty ? `${p.kontakty} ${odm(p.kontakty, 'kontakt', 'kontakty', 'kontaktów')}` : ''
	].filter(Boolean);
	return czesci.length ? czesci.join(' · ') : 'bez powiązań';
}

/** Domyślny rekord docelowy: z polisami, potem z poprawnym NIP, z logowaniem do panelu, z większą liczbą powiązań, najstarszy. */
export function domyslnyDocelowy(lista: Client[]): Client {
	const waga = (c: Client) => {
		const p = powiazaniaKlienta(c.id);
		return p.polisy * 1000 + (nipPoprawny(c.nip) ? 100 : 0) + (c.auth_user_id ? 50 : 0) + p.wnioski * 10 + p.apk + p.zadania + p.szkody + p.pojazdy + p.kontakty;
	};
	return [...lista].sort((a, b) => waga(b) - waga(a) || (a.created_at ?? '').localeCompare(b.created_at ?? ''))[0];
}

/** Opis wyniku do komunikatu: „usunięto 1 rekord; przeniesiono: 2 polisy, 1 wniosek…”. */
export function opisWyniku(w: WynikScalenia): string {
	const nazwy: Record<string, [string, string, string]> = {
		polisy: ['polisa', 'polisy', 'polis'], polisy_ubezpieczony: ['polisa jako ubezpieczony', 'polisy jako ubezpieczony', 'polis jako ubezpieczony'],
		wnioski: ['wniosek', 'wnioski', 'wniosków'], maile: ['e-mail', 'e-maile', 'e-maili'], maile_kampanii: ['mail kampanii', 'maile kampanii', 'maili kampanii'],
		zgloszenia: ['zgłoszenie', 'zgłoszenia', 'zgłoszeń'], zgody: ['zgoda', 'zgody', 'zgód'], szkody: ['szkoda', 'szkody', 'szkód'],
		pojazdy: ['pojazd', 'pojazdy', 'pojazdów'], wnioski_pojazdow: ['wniosek o pojazd', 'wnioski o pojazd', 'wniosków o pojazd'],
		kontakty: ['kontakt', 'kontakty', 'kontaktów'], zadania: ['zadanie', 'zadania', 'zadań'], apk: ['formularz APK', 'formularze APK', 'formularzy APK'], gwarancje: ['gwarancja', 'gwarancje', 'gwarancji']
	};
	const przen = Object.entries(w.przeniesiono ?? {})
		.filter(([, n]) => n > 0)
		.map(([k, n]) => `${n} ${nazwy[k] ? odm(n, ...nazwy[k]) : k}`);
	return `Usunięto ${w.usunieto} ${odm(w.usunieto, 'rekord', 'rekordy', 'rekordów')}${przen.length ? `; przeniesiono: ${przen.join(', ')}` : ''}.`;
}

/** Po scaleniu: kolekcje w pamięci z bazy (klienci, polisy, szkody, pojazdy, APK, zadania, kontakty, wnioski); leady doczytają się przy wejściu. */
export async function odswiezPoScaleniu() {
	const [rC, rP, rCl, rV, rA, rT, rCc, rW] = await Promise.all([
		wczytajKlientow(), wczytajPolisy(), wczytajSzkody(), wczytajPojazdy(), wczytajFormularzeApk(), wczytajZadania(), wczytajKontakty(), wczytajWnioskiOdnowien()
	]);
	if (!rC.error && rC.data) appState.clients = rC.data as typeof appState.clients;
	if (!rP.error && rP.data) appState.policies = rP.data as typeof appState.policies;
	if (!rCl.error && rCl.data) appState.claims = rCl.data as typeof appState.claims;
	if (!rV.error && rV.data) appState.vehicles = rV.data as typeof appState.vehicles;
	if (!rA.error && rA.data) appState.apkForms = rA.data as typeof appState.apkForms;
	if (!rT.error && rT.data) appState.tasks = rT.data as typeof appState.tasks;
	if (!rCc.error && rCc.data) appState.clientContacts = rCc.data as typeof appState.clientContacts;
	if (!rW.error && rW.data) appState.wnioskiOdnowien = rW.data as typeof appState.wnioskiOdnowien;
	appState.prospectsLoaded = false;
}
