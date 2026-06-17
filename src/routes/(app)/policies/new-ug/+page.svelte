<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import UgForm from '$lib/components/UgForm.svelte';
	import { ArrowLeft } from 'lucide-svelte';

	const podtypParam = $page.url.searchParams.get('podtyp') ?? '';
	const klientParam = $page.url.searchParams.get('klient') ?? '';

	let ugForm = $state<ReturnType<typeof UgForm> | null>(null);
	let saving = $state(false);
	let formError = $state('');

	async function save() {
		if (!ugForm) return;
		const err = ugForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals = ugForm.getValues();
		const { data: inserted, error } = await sb.from('crm_policies')
			.insert([{ tenant_id: appState.profile!.tenant_id, ...vals }])
			.select('id')
			.single();
		if (error) { saving = false; formError = error.message; return; }

		const raty = ugForm.shouldCreatePayments() ? ugForm.getDatyRat() : [];
		if (raty.length > 0 && inserted?.id) {
			await sb.from('crm_policy_payments').insert(
				raty.map(r => ({
					tenant_id: appState.profile!.tenant_id,
					polisa_id: inserted.id,
					nr_raty: r.nr,
					data_platnosci: r.data,
					kwota: r.kwota,
					status: 'Oczekująca'
				}))
			);
		}

		const [rP, rA, rPay] = await Promise.all([
			sb.from('crm_policies').select('*, crm_clients!klient_id(nazwa), ubezpieczony:crm_clients!ubezpieczony_id(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))').is('deleted_at', null),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu'),
			sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients!klient_id(nazwa))').order('data_platnosci')
		]);
		saving = false;
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rA.data ?? []) as typeof appState.annexes;
		appState.payments = (rPay.data ?? []) as typeof appState.payments;
		goto('/policies?typ=generalna');
	}
</script>

<svelte:head><title>Nowa Umowa Generalna — FRANK67 CRM</title></svelte:head>

<div class="max-w-5xl">
	<div class="flex items-center gap-3 mb-6">
		<button onclick={() => history.back()} class="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
			<ArrowLeft size={18} />
		</button>
		<div>
			<h1 class="text-2xl font-semibold text-slate-900">Nowa Umowa Generalna</h1>
			<p class="text-sm text-slate-500 mt-0.5">Wypełnij dane i zapisz</p>
		</div>
	</div>

	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
		{#if formError}
			<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>
		{/if}
		<UgForm bind:this={ugForm} policy={{ ug_podtyp: podtypParam } as any} presetKlient={klientParam} />
	</div>

	<div class="flex justify-end gap-3 mt-4">
		<button onclick={() => goto('/policies?typ=generalna')} class="px-5 py-2.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
			Anuluj
		</button>
		<button onclick={save} disabled={saving} class="px-6 py-2.5 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz Umowę Generalną'}
		</button>
	</div>
</div>
