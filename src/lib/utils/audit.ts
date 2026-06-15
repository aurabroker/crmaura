import { sb } from '$lib/supabase';
import { appState } from '$lib/stores/app.svelte';

export async function logAudit(
	action: string,
	entityType?: string,
	entityId?: string | null,
	entityLabel?: string | null,
	details?: Record<string, unknown>
): Promise<void> {
	try {
		if (!appState.profile) return;
		await sb.from('crm_audit_log').insert([{
			tenant_id: appState.profile.tenant_id,
			user_id: appState.profile.id,
			user_email: appState.profile.email,
			user_name: appState.profile.imie_nazwisko,
			action,
			entity_type: entityType ?? null,
			entity_id: entityId ?? null,
			entity_label: entityLabel ?? null,
			details: details ?? null
		}]);
	} catch {
		// Audit failures must never crash the application
	}
}
