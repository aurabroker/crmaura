// Zbiorowe uzupełnianie klientów z GUS. Jedno wywołanie = paczka klientów firmy administratora, którzy mają
// NIP, a brakuje im adresu albo REGON, i nie byli jeszcze sprawdzani. Uzupełniamy tylko puste pola —
// rekord w CRM jest nadrzędny (jak przy synchronizacji z BEAUTY). Każdy sprawdzony klient dostaje wynik
// w gus_wynik / gus_dane, więc kolejne wywołania idą dalej, a przerwane uzupełnianie można wznowić.
// Paczka jest mała, bo Cloudflare ogranicza liczbę zapytań wychodzących w jednym żądaniu.
import type { SupabaseClient } from '@supabase/supabase-js';
import { czystyNip, poprawnyNip, type PodmiotGus, type SzukajGus } from './gus';
import type { ProfilFirmy } from './pliki';

export const PACZKA = 10;
export type GusWynik = 'uzupelniono' | 'bez_zmian' | 'nie_znaleziono' | 'zakonczona' | 'zly_nip';
export const WYNIKI: GusWynik[] = ['uzupelniono', 'bez_zmian', 'nie_znaleziono', 'zakonczona', 'zly_nip'];

type Klient = { id: string; nazwa: string; nip: string | null; regon: string | null; ulica: string | null };
export type WynikKlienta = { id: string; nazwa: string; wynik: GusWynik; zmiany: string[]; gus_nazwa: string | null; data_zakonczenia: string | null };

const pusty = (v: string | null | undefined) => !v || !v.trim();

// Kolejka: NIP jest, brakuje adresu albo REGON, jeszcze bez wyniku z GUS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kolejka(q: any, tenantId: string) {
	return q
		.eq('tenant_id', tenantId)
		.not('nip', 'is', null)
		.neq('nip', '')
		.is('gus_sprawdzono_at', null)
		.or('ulica.is.null,ulica.eq.,regon.is.null,regon.eq.');
}

export async function stanUzupelniania(admin: SupabaseClient, tenantId: string) {
	const baza = () => admin.from('crm_clients').select('id', { count: 'exact', head: true });
	const licz = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
	const [doSprawdzenia, ...wyniki] = await Promise.all([
		licz(kolejka(baza(), tenantId)),
		...WYNIKI.map((w) => licz(baza().eq('tenant_id', tenantId).eq('gus_wynik', w)))
	]);
	return { do_sprawdzenia: doSprawdzenia, wyniki: Object.fromEntries(WYNIKI.map((w, i) => [w, wyniki[i]])) as Record<GusWynik, number> };
}

/** Dane zapisywane przy kliencie (bez nazwy pliku XML, tylko to, co przydaje się w CRM). */
function daneDoZapisu(p: PodmiotGus) {
	return {
		nazwa: p.nazwa,
		regon: p.regon,
		typ: p.typ,
		adres: p.adres,
		wojewodztwo: p.wojewodztwo,
		powiat: p.powiat,
		gmina: p.gmina,
		miejscowosc: p.miejscowosc,
		data_zakonczenia: p.dataZakonczenia,
		status_nip: p.statusNip
	};
}

export async function uzupelnijPaczke(
	admin: SupabaseClient,
	profil: ProfilFirmy,
	szukaj: SzukajGus,
	o: { limit?: number; przerwa?: number } = {}
): Promise<{ wyniki: WynikKlienta[]; pozostalo: number; przerwano: string | null }> {
	const limit = Math.min(Math.max(o.limit ?? PACZKA, 1), PACZKA);
	const { data } = await kolejka(admin.from('crm_clients').select('id, nazwa, nip, regon, ulica'), profil.tenant_id)
		.order('created_at', { ascending: true })
		.order('id', { ascending: true })
		.limit(limit);
	const klienci = (data ?? []) as Klient[];
	const wyniki: WynikKlienta[] = [];
	let przerwano: string | null = null;
	const teraz = new Date().toISOString();

	for (const [i, k] of klienci.entries()) {
		let wynik: GusWynik;
		const zmiany: Record<string, string> = {};
		let p: PodmiotGus | null = null;
		if (!poprawnyNip(k.nip)) {
			wynik = 'zly_nip';
		} else {
			if (i > 0 && o.przerwa !== 0) await new Promise((r) => setTimeout(r, o.przerwa ?? 150));
			try {
				p = await szukaj({ nip: czystyNip(k.nip) });
			} catch (e) {
				// GUS nie odpowiada albo zwrócił błąd — klient zostaje w kolejce, paczka się kończy.
				przerwano = `GUS nie odpowiada (${(e as Error).message}). Spróbuj ponownie za chwilę.`;
				break;
			}
			if (!p) {
				wynik = 'nie_znaleziono';
			} else {
				if (pusty(k.ulica) && p.adres) zmiany.ulica = p.adres;
				if (pusty(k.regon) && p.regon) zmiany.regon = p.regon;
				wynik = p.dataZakonczenia ? 'zakonczona' : Object.keys(zmiany).length ? 'uzupelniono' : 'bez_zmian';
			}
		}
		const { error } = await admin
			.from('crm_clients')
			.update({ ...zmiany, gus_sprawdzono_at: teraz, gus_wynik: wynik, gus_dane: p ? daneDoZapisu(p) : null })
			.eq('id', k.id)
			.eq('tenant_id', profil.tenant_id);
		if (error) {
			przerwano = `Nie udało się zapisać klienta ${k.nazwa}: ${error.message}`;
			break;
		}
		wyniki.push({
			id: k.id,
			nazwa: k.nazwa,
			wynik,
			zmiany: [zmiany.ulica ? 'adres' : '', zmiany.regon ? 'REGON' : ''].filter(Boolean),
			gus_nazwa: p?.nazwa ?? null,
			data_zakonczenia: p?.dataZakonczenia ?? null
		});
	}

	// Ślad w historii klientów (oś zdarzeń Panelu 360°): zmienione dane i firmy wykreślone.
	const doAudytu = wyniki.filter((w) => w.zmiany.length || w.wynik === 'zakonczona');
	if (doAudytu.length) {
		await admin.from('crm_audit_log').insert(
			doAudytu.map((w) => ({
				tenant_id: profil.tenant_id,
				user_id: profil.id,
				user_email: profil.email ?? null,
				user_name: profil.imie_nazwisko ?? null,
				action: 'client_gus_enriched',
				entity_type: 'client',
				entity_id: w.id,
				entity_label: w.nazwa,
				details: { zmiany: w.zmiany, wynik: w.wynik, data_zakonczenia: w.data_zakonczenia }
			}))
		);
	}

	const { count } = await kolejka(admin.from('crm_clients').select('id', { count: 'exact', head: true }), profil.tenant_id);
	return { wyniki, pozostalo: count ?? 0, przerwano };
}
