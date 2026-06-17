<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import PolicyForm from '$lib/components/PolicyForm.svelte';
	import { ArrowLeft } from 'lucide-svelte';

	const policyId = $derived($page.params.id);
	const policy = $derived(appState.policies.find(p => p.id === policyId));

	let policyForm = $state<ReturnType<typeof PolicyForm> | null>(null);
	let saving = $state(false);
	let formError = $state('');

	async function save() {
		if (!policyForm || !policy) return;
		const err = policyForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals = policyForm.getValues();

		const { error } = await sb.from('crm_policies').update(vals).eq('id', policy.id);
		if (error) { saving = false; formError = error.message; return; }

		// Regenerate only unpaid installments; preserve Opłacona/Częściowo opłacona
		const raty = policyForm.getDatyRat();
		if (raty.length > 0) {
			const today = new Date().toISOString().split('T')[0];
			// Find which nr_raty are already settled (do not touch them)
			const { data: existingPaid } = await sb
				.from('crm_policy_payments')
				.select('nr_raty')
				.eq('polisa_id', policy.id)
				.in('status', ['Opłacona', 'Częściowo opłacona']);
			const paidNrs = new Set((existingPaid ?? []).map((p: { nr_raty: number }) => p.nr_raty));

			// Delete only unpaid records
			await sb
				.from('crm_policy_payments')
				.delete()
				.eq('polisa_id', policy.id)
				.not('status', 'in', '("Opłacona","Częściowo opłacona")');

			// Insert new records for installment numbers not already settled
			const toInsert = raty
				.filter(r => !paidNrs.has(r.nr))
				.map(r => ({
					tenant_id: appState.profile!.tenant_id,
					polisa_id: policy.id,
					nr_raty: r.nr,
					data_platnosci: r.data,
					kwota: r.kwota,
					status: r.data < today ? 'Zaległa' : 'Oczekująca'
				}));
			if (toInsert.length > 0) {
				await sb.from('crm_policy_payments').insert(toInsert);
			}
		}

		const [rP, rA, rPay] = await Promise.all([
			sb.from('crm_policies').select('*, crm_clients!klient_id(nazwa), ubezpieczony:crm_clients!ubezpieczony_id(nazwa), crm_insurers(nazwa, skrot)'),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu'),
			sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients!klient_id(nazwa))').order('data_platnosci')
		]);
		saving = false;
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rA.data ?? []) as typeof appState.annexes;
		appState.payments = (rPay.data ?? []) as typeof appState.payments;
		goto(`/policies/${policyId}`);
	}
</script>

<svelte:head><title>Edytuj Polisę — FRANK67 CRM</title></svelte:head>

<div class="max-w-5xl">
	<div class="flex items-center gap-3 mb-6">
		<button onclick={() => goto(`/policies/${policyId}`)} class="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
			<ArrowLeft size={18} />
		</button>
		<div>
			<h1 class="text-2xl font-semibold text-slate-900">Edytuj Polisę</h1>
			{#if policy}
				<p class="text-sm text-slate-500 mt-0.5">{policy.nr_polisy} — {policy.crm_clients?.nazwa}</p>
			{/if}
		</div>
	</div>

	{#if !policy}
		<p class="text-slate-400">Polisa nie istnieje lub nie masz dostępu.</p>
	{:else}
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
			{#if formError}
				<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>
			{/if}
			<PolicyForm bind:this={policyForm} {policy} />
		</div>

		<div class="flex justify-end gap-3 mt-4">
			<button onclick={() => goto(`/policies/${policyId}`)} class="px-5 py-2.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
				Anuluj
			</button>
			<button onclick={save} disabled={saving} class="px-6 py-2.5 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
				{saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
			</button>
		</div>
	{/if}
</div>
