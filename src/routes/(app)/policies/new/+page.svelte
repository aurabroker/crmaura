<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import PolicyForm from '$lib/components/PolicyForm.svelte';
	import { ArrowLeft } from 'lucide-svelte';

	const typParam = $page.url.searchParams.get('typ') as 'jednostkowa' | 'generalna' | null;
	const podtypParam = $page.url.searchParams.get('podtyp') ?? '';
	const klientParam = $page.url.searchParams.get('klient') ?? '';

	let policyForm = $state<ReturnType<typeof PolicyForm> | null>(null);
	let saving = $state(false);
	let formError = $state('');

	async function save() {
		if (!policyForm) return;
		const err = policyForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals = policyForm.getValues();
		const { error } = await sb.from('crm_policies').insert([{ tenant_id: appState.profile!.tenant_id, ...vals }]);
		saving = false;
		if (error) { formError = error.message; return; }
		const [rP, rA] = await Promise.all([
			sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa)'),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu')
		]);
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rA.data ?? []) as typeof appState.annexes;
		goto('/policies');
	}
</script>

<svelte:head><title>Nowa Polisa — FRANK</title></svelte:head>

<div class="max-w-3xl">
	<div class="flex items-center gap-3 mb-6">
		<button onclick={() => goto('/policies')} class="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
			<ArrowLeft size={18} />
		</button>
		<div>
			<h1 class="text-2xl font-semibold text-slate-900">Nowa Polisa / Umowa Generalna</h1>
			<p class="text-sm text-slate-500 mt-0.5">Wypełnij dane i zapisz</p>
		</div>
	</div>

	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
		{#if formError}
			<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>
		{/if}
		<PolicyForm
			bind:this={policyForm}
			policy={{ typ_umowy: typParam ?? 'jednostkowa', ug_podtyp: podtypParam } as any}
			presetKlient={klientParam}
		/>
	</div>

	<div class="flex justify-end gap-3 mt-4">
		<button onclick={() => goto('/policies')} class="px-5 py-2.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
			Anuluj
		</button>
		<button onclick={save} disabled={saving} class="px-6 py-2.5 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz Polisę'}
		</button>
	</div>
</div>
