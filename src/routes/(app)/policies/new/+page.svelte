<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import PolicyForm from '$lib/components/PolicyForm.svelte';
	import { ArrowLeft } from 'lucide-svelte';
	import { logAudit } from '$lib/utils/audit';

	const typParam = $page.url.searchParams.get('typ') as 'jednostkowa' | 'generalna' | null;
	const podtypParam = $page.url.searchParams.get('podtyp') ?? '';
	const klientParam = $page.url.searchParams.get('klient') ?? '';
	const rodzajParam = $page.url.searchParams.get('rodzaj') ?? '';
	const przedmiotParam = $page.url.searchParams.get('przedmiot') ?? '';
	const renewalOfParam = $page.url.searchParams.get('renewal_of') ?? '';

	const isRenewal = !!renewalOfParam;

	let policyForm = $state<ReturnType<typeof PolicyForm> | null>(null);
	let saving = $state(false);
	let formError = $state('');

	async function save() {
		if (!policyForm) return;
		const err = policyForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals = policyForm.getValues();
		const payload: Record<string, unknown> = {
			tenant_id: appState.profile!.tenant_id,
			...vals
		};
		if (isRenewal) payload.renewal_of = renewalOfParam;

		const { data: inserted, error } = await sb.from('crm_policies')
			.insert([payload])
			.select('id')
			.single();
		if (error) { saving = false; formError = error.message; return; }

		// Auto-create payment records (only when not UG without rozliczaj_platnosci)
		const raty = policyForm.shouldCreatePayments() ? policyForm.getDatyRat() : [];
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

		await logAudit(
			isRenewal ? 'policy_renewed' : 'policy_created',
			'policy',
			inserted?.id,
			vals.nr_polisy as string,
			isRenewal ? { renewal_of: renewalOfParam } : undefined
		);

		const [rP, rA, rPay] = await Promise.all([
			sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))').is('deleted_at', null),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu'),
			sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients(nazwa))').order('data_platnosci')
		]);
		saving = false;
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rA.data ?? []) as typeof appState.annexes;
		appState.payments = (rPay.data ?? []) as typeof appState.payments;
		if (isRenewal && inserted?.id) {
			goto(`/policies/${inserted.id}`);
		} else {
			goto('/policies');
		}
	}
</script>

<svelte:head><title>{isRenewal ? 'Odnowienie Polisy' : 'Nowa Polisa'} — FRANK67 CRM</title></svelte:head>

<div class="max-w-5xl">
	<div class="flex items-center gap-3 mb-6">
		<button onclick={() => history.back()} class="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
			<ArrowLeft size={18} />
		</button>
		<div>
			<h1 class="text-2xl font-semibold text-slate-900">{isRenewal ? 'Odnowienie Polisy' : 'Nowa Polisa / Umowa Generalna'}</h1>
			<p class="text-sm text-slate-500 mt-0.5">{isRenewal ? 'Wypełnij dane nowego okresu ubezpieczenia' : 'Wypełnij dane i zapisz'}</p>
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
			presetRodzaj={rodzajParam}
			presetPrzedmiot={przedmiotParam}
		/>
	</div>

	<div class="flex justify-end gap-3 mt-4">
		<button onclick={() => goto('/policies')} class="px-5 py-2.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
			Anuluj
		</button>
		<button onclick={save} disabled={saving} class="px-6 py-2.5 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : isRenewal ? 'Odnawiam polisę' : 'Zapisz Polisę'}
		</button>
	</div>
</div>
