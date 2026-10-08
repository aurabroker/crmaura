import { sb } from '$lib/supabase';
import type { Policy } from '$lib/types/database';

// Wspólne dla karty polisy i listy odnowień w CRM: rozpoznanie certyfikatu z programu OC beauty,
// stany wniosku i wywołania /api/renewals (kontrakt: $lib/renewals/staffApi).

// Certyfikat należy do programu, gdy jego umowa generalna to UG podtypu oc_beauty.
export function wProgramieOcBeauty(p: Pick<Policy, 'parent_id'> | null | undefined, policies: Policy[]): boolean {
	if (!p?.parent_id) return false;
	const ug = policies.find((q) => q.id === p.parent_id);
	return !!ug && ug.typ_umowy === 'generalna' && ug.ug_podtyp === 'oc_beauty';
}

// Link działa tylko w tych stanach; „zlozony” blokuje nowy wniosek, ale linku już nie ma.
export const STATUSY_Z_LINKIEM = ['utworzony', 'wyslany', 'otwarty', 'apk'];
export const czyLinkDziala = (status: string) => STATUSY_Z_LINKIEM.includes(status);
// Aktywny = każdy poza wygasłym i anulowanym (jak indeks crm_renewals_one_active).
export const czyAktywny = (status: string) => status !== 'wygasl' && status !== 'anulowany';

export type Wariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export function wariantStatusu(status: string): Wariant {
	if (status === 'zlozony') return 'success';
	if (status === 'otwarty' || status === 'apk') return 'warning';
	if (status === 'wyslany' || status === 'utworzony') return 'info';
	return 'neutral';
}

export function wariantDecyzji(decyzja: string | null): Wariant {
	if (decyzja === 'bez_zmian') return 'success';
	if (decyzja === 'zmiany') return 'info';
	if (decyzja === 'nie') return 'error';
	return 'neutral';
}

export type WynikApi<T> = { ok: true; data: T } | { ok: false; status: number; message: string; aktywny: boolean };

// Żądanie do /api/renewals* z sesją pracownika. Nie rzuca — błąd sieci to status 0 z komunikatem.
export async function wywolajApi<T>(method: 'POST' | 'DELETE', url: string, body: unknown): Promise<WynikApi<T>> {
	try {
		const { data: { session } } = await sb.auth.getSession();
		const res = await fetch(url, {
			method,
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
			body: JSON.stringify(body)
		});
		const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		if (res.ok) return { ok: true, data: d as T };
		const bledy = Array.isArray(d.bledy) ? (d.bledy as string[]).join(' ') : '';
		const message = [typeof d.message === 'string' ? d.message : '', bledy].filter(Boolean).join(' ');
		return { ok: false, status: res.status, message: message || `Błąd serwera (${res.status}).`, aktywny: d.aktywny === true };
	} catch {
		return { ok: false, status: 0, message: 'Brak połączenia z serwerem. Spróbuj ponownie.', aktywny: false };
	}
}

export const fmtData = (iso: string | null | undefined) =>
	iso ? new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export const fmtDataCzas = (iso: string | null | undefined) =>
	iso
		? new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
		: '—';
