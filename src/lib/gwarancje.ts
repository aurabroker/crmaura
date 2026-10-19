// Gwarancja z modułu Gwarancje (bond_bonds) jako polisa w CRM: rodzaj „finansowa”, składka z Umowy Limitowej,
// jedna rata 14 dni od początku gwarancji, prowizja wg Umowy Generalnej gwarancyjnej o numerze UL (gdy jest
// w CRM) i TU z tej umowy albo dopasowane po nazwie UL. Dzięki temu gwarancja ma raty, prowizję, rozliczenia
// i miejsce na karcie klienta jak każda polisa. Powiązanie: bond_bonds.crm_policy_id.
import type { Bond, BondInsurer, Insurer, Policy } from '$lib/types/database';
import { sb } from '$lib/supabase';
import { appState } from '$lib/stores/app.svelte';
import { wczytajPlatnosci, wczytajPolisy } from '$lib/kolekcje';
import { bondRodzajLabel, calcBondSkladka, effectiveStawka } from '$lib/utils/bonds';
import { opiekunZUmowy } from '$lib/policyImport/umowaGeneralna';
import { normalizujNrPolisy } from '$lib/duplikatPolisy';
import { plusDni } from '$lib/statusPolisy';
import { logAudit } from '$lib/utils/audit';

/** Rata gwarancji: tyle dni po początku ochrony (jak jednorazowa płatność w formularzu polisy). */
export const DNI_DO_RATY_GWARANCJI = 14;

type PolisaCtx = Pick<Policy, 'id' | 'klient_id' | 'tu_id' | 'tu_contact_id' | 'nr_polisy' | 'typ_umowy' | 'deleted_at' | 'ug_default_prowizja_pct' | 'prowizja_pct'>;
type InsurerCtx = Pick<Insurer, 'id' | 'nazwa' | 'skrot' | 'nip'>;

export type KontekstGwarancji = {
	policies: PolisaCtx[];
	insurers: InsurerCtx[];
	tenantId: string;
	/** Klient CRM podmiotu gwarancji (bond_tenants.crm_client_id); bez niego polisy nie da się założyć. */
	klientId: string | null;
};

/** Umowa Generalna gwarancyjna w CRM o numerze Umowy Limitowej (np. 238/2023) — najpierw tego klienta. */
export function umowaGwarancyjnaDlaUL<P extends PolisaCtx>(ul: Pick<BondInsurer, 'bond_ul_nr'> | null, policies: P[], klientId?: string | null): P | null {
	const nr = normalizujNrPolisy(ul?.bond_ul_nr);
	if (!nr) return null;
	const kandydaci = policies.filter((p) => p.typ_umowy === 'generalna' && !p.deleted_at && normalizujNrPolisy(p.nr_polisy) === nr);
	return kandydaci.find((p) => p.klient_id === klientId) ?? kandydaci[0] ?? null;
}

/** TU po nazwie z Umowy Limitowej („Allianz” → TU Allianz Polska S.A.), w ostateczności po NIP. */
export function towarzystwoDlaUL<I extends InsurerCtx>(ul: Pick<BondInsurer, 'bond_nazwa' | 'bond_nip'> | null, insurers: I[]): I | null {
	const n = (ul?.bond_nazwa ?? '').trim().toLowerCase();
	if (!n) return null;
	const poSkrocie = insurers.find((i) => (i.skrot ?? '').toLowerCase() === n);
	if (poSkrocie) return poSkrocie;
	const poNazwie = insurers.find((i) => i.nazwa.toLowerCase().includes(n) || (!!i.skrot && n.includes(i.skrot.toLowerCase())));
	if (poNazwie) return poNazwie;
	const nip = (ul?.bond_nip ?? '').replace(/\D/g, '');
	return nip ? insurers.find((i) => (i.nip ?? '').replace(/\D/g, '') === nip) ?? null : null;
}

export type PolisaGwarancji = {
	payload: Record<string, unknown>;
	rata: { nr: number; data: string; kwota: number } | null;
	ug: PolisaCtx | null;
	tu: InsurerCtx | null;
	/** Dlaczego polisy nie da się założyć ('' = można). */
	blad: string;
};

/** Rekord crm_policies dla gwarancji (bez zapisu) — do podglądu i testów. */
export function polisaZGwarancji(bond: Bond, ul: BondInsurer | null, ctx: KontekstGwarancji): PolisaGwarancji {
	const ug = umowaGwarancyjnaDlaUL(ul, ctx.policies, ctx.klientId);
	const tu = ug ? (ctx.insurers.find((i) => i.id === ug.tu_id) ?? null) : towarzystwoDlaUL(ul, ctx.insurers);
	const stawka = effectiveStawka(bond.bond_stawka_override, bond.bond_stawka, ul?.bond_stawka_bazowa);
	const skladka = bond.bond_skladka != null
		? Number(bond.bond_skladka)
		: calcBondSkladka(bond.bond_suma, stawka, bond.bond_data_od, bond.bond_data_do, ul?.bond_skladka_min);
	const prowizjaPct = Number(ug?.ug_default_prowizja_pct ?? ug?.prowizja_pct ?? 0) || 0;
	const typ = bondRodzajLabel[bond.bond_rodzaj] ?? bond.bond_rodzaj;
	// Numer gwarancji bywa wspólny dla kilku gwarancji z jednego kontraktu (NWK + UWU) — druga dostaje dopisek rodzaju.
	const zajety = ctx.policies.some((p) => !p.deleted_at && p.id !== bond.crm_policy_id && normalizujNrPolisy(p.nr_polisy) === normalizujNrPolisy(bond.bond_nr));
	const nr = zajety ? `${bond.bond_nr.trim()} / ${bond.bond_rodzaj}` : bond.bond_nr.trim();
	const blad = !ctx.klientId
		? 'Podmiot gwarancji nie jest powiązany z klientem CRM (Umowy limitowe → Dodaj podmiot).'
		: !tu
			? `Nie ma w CRM towarzystwa dla Umowy Limitowej „${ul?.bond_nazwa ?? '—'}” — dodaj je w Administracji albo załóż Umowę Generalną gwarancyjną o numerze ${ul?.bond_ul_nr ?? '—'}.`
			: skladka == null
				? 'Nie da się policzyć składki gwarancji — Umowa Limitowa nie ma stawki bazowej.'
				: '';
	const kwota = Math.round((skladka ?? 0) * 100) / 100;
	const terminRaty = plusDni(bond.bond_data_od, DNI_DO_RATY_GWARANCJI);
	const payload: Record<string, unknown> = {
		tenant_id: ctx.tenantId,
		klient_id: ctx.klientId,
		tu_id: tu?.id ?? null,
		tu_contact_id: opiekunZUmowy(ctx.policies, ug?.id, tu?.id),
		nr_polisy: nr,
		rodzaj: 'finansowa',
		typ_umowy: 'jednostkowa',
		ug_podtyp: null,
		parent_id: ug?.id ?? null,
		przedmiot: [typ, bond.bond_kontrakt].filter(Boolean).join(' · ').slice(0, 500) || null,
		data_od: bond.bond_data_od,
		data_do: bond.bond_data_do,
		ilosc_rat: '1',
		daty_rat: terminRaty,
		kwoty_rat: kwota.toFixed(2),
		rozliczaj_platnosci: null,
		skladka_przypisana: kwota,
		skladka_zaliczkowa: 0,
		skladka_zainkasowana: 0,
		prowizja_pct: prowizjaPct,
		prowizja_przypisana: Math.round(kwota * prowizjaPct) / 100,
		prowizja_zainkasowana: 0,
		suma_gwarancyjna: Number(bond.bond_suma) || null,
		gwarancja_typ: typ,
		gwarancja_beneficjent_nazwa: bond.bond_beneficjent,
		gwarancja_kontrakt: bond.bond_kontrakt,
		gwarancja_stawka_pct: stawka
	};
	return { payload, rata: kwota > 0 ? { nr: 1, data: terminRaty, kwota } : null, ug, tu, blad };
}

async function odswiezPolisyIRaty() {
	const [rP, rPay] = await Promise.all([wczytajPolisy(), wczytajPlatnosci()]);
	if (!rP.error && rP.data) appState.policies = rP.data as typeof appState.policies;
	if (!rPay.error && rPay.data) appState.payments = rPay.data as typeof appState.payments;
}

/**
 * Zakłada polisę CRM dla gwarancji (albo aktualizuje już powiązaną) i zapisuje powiązanie w bond_bonds.
 * Przy aktualizacji nieopłacona rata dostaje nową kwotę i termin; opłaconej nie ruszamy.
 */
export async function rozliczGwarancjeWCrm(bond: Bond, ul: BondInsurer | null, klientId: string | null): Promise<{ blad: string; polisaId?: string }> {
	const ctx: KontekstGwarancji = { policies: appState.policies, insurers: appState.insurers, tenantId: appState.profile!.tenant_id, klientId };
	const { payload, rata, blad } = polisaZGwarancji(bond, ul, ctx);
	if (blad) return { blad };

	const istniejaca = bond.crm_policy_id ? (appState.policies.find((p) => p.id === bond.crm_policy_id && !p.deleted_at) ?? null) : null;
	if (istniejaca) {
		const { tenant_id: _t, klient_id: _k, skladka_zainkasowana: _sz, prowizja_zainkasowana: _pz, ...zmiany } = payload;
		const { error } = await sb.from('crm_policies').update(zmiany as never).eq('id', istniejaca.id);
		if (error) return { blad: error.message };
		if (rata) {
			const { data: raty } = await sb.from('crm_policy_payments').select('id, status').eq('polisa_id', istniejaca.id);
			const lista = (raty ?? []) as { id: string; status: string }[];
			const otwarta = lista.find((r) => r.status === 'Oczekująca' || r.status === 'Zaległa');
			if (otwarta) await sb.from('crm_policy_payments').update({ data_platnosci: rata.data, kwota: rata.kwota } as never).eq('id', otwarta.id);
			else if (!lista.length) await sb.from('crm_policy_payments').insert([{ tenant_id: ctx.tenantId, polisa_id: istniejaca.id, nr_raty: 1, data_platnosci: rata.data, kwota: rata.kwota, status: 'Oczekująca' }] as never);
		}
		await logAudit('policy_updated', 'policy', istniejaca.id, payload.nr_polisy as string, { zrodlo: 'gwarancja', bond_id: bond.bond_id });
		await odswiezPolisyIRaty();
		return { blad: '', polisaId: istniejaca.id };
	}

	const { data, error } = await sb.from('crm_policies').insert([payload] as never).select('id').single();
	if (error || !data) return { blad: error?.message ?? 'Nie udało się zapisać polisy.' };
	const polisaId = (data as { id: string }).id;
	if (rata) {
		const { error: eR } = await sb.from('crm_policy_payments').insert([{ tenant_id: ctx.tenantId, polisa_id: polisaId, nr_raty: 1, data_platnosci: rata.data, kwota: rata.kwota, status: 'Oczekująca' }] as never);
		if (eR) return { blad: `Polisa zapisana, ale bez raty: ${eR.message}`, polisaId };
	}
	const { error: eB } = await sb.from('bond_bonds').update({ crm_policy_id: polisaId } as never).eq('bond_id', bond.bond_id);
	if (eB) return { blad: `Polisa zapisana, ale nie udało się powiązać jej z gwarancją: ${eB.message}`, polisaId };
	await logAudit('policy_created', 'policy', polisaId, payload.nr_polisy as string, { zrodlo: 'gwarancja', bond_id: bond.bond_id });
	await odswiezPolisyIRaty();
	return { blad: '', polisaId };
}
