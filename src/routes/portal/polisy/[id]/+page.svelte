<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { portalState } from '$lib/stores/portal.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import type { Policy, PolicyPayment } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import { ArrowLeft } from 'lucide-svelte';

	const policyId = $derived($page.params.id);
	let loading = $state(true);
	let policy = $state<Policy | null>(null);
	let payments = $state<PolicyPayment[]>([]);

	onMount(async () => {
		const klientId = portalState.client?.id;
		if (!klientId || !policyId) return;

		const { data: pol } = await sb.from('crm_policies')
			.select('*, crm_insurers(nazwa, skrot), crm_vehicles(nr_rejestracyjny, marka_model, vin)')
			.eq('id', policyId)
			.eq('klient_id', klientId)
			.single();
		policy = pol as Policy | null;

		if (policy) {
			const { data: pay } = await sb.from('crm_policy_payments')
				.select('*')
				.eq('polisa_id', policyId)
				.order('nr_raty');
			payments = (pay ?? []) as PolicyPayment[];
		}

		loading = false;
	});

	const st = $derived(policy ? policyStatus(policy.data_do) : null);

	const paymentStatusVariant: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
		'Opłacona': 'success',
		'Oczekująca': 'info',
		'Zaległa': 'error',
		'Częściowo opłacona': 'warning'
	};
</script>

<svelte:head><title>{policy?.nr_polisy ?? 'Polisa'} — Panel Klienta</title></svelte:head>

{#if loading}
	<div class="text-slate-400 text-sm">Ładowanie...</div>
{:else if !policy}
	<p class="text-slate-400">Polisa nie istnieje lub nie masz do niej dostępu.</p>
{:else}
	{@const tuLabel = policy.crm_insurers?.skrot ?? policy.crm_insurers?.nazwa ?? '—'}

	<button onclick={() => goto('/portal/polisy')} class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-3">
		<ArrowLeft size={16} /> Polisy
	</button>

	<div class="flex items-center gap-3 mb-6">
		<h1 class="text-2xl font-semibold text-slate-900">{policy.nr_polisy}</h1>
		<span class="text-slate-300">•</span>
		<span class="text-sm text-slate-500">{tuLabel}</span>
		{#if st}<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>{/if}
	</div>

	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">Składka</p>
			<p class="text-base font-semibold text-slate-900">{fmtPln(policy.skladka_przypisana)} zł</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">Okres</p>
			<p class="text-sm font-semibold text-slate-900">{policy.data_od}</p>
			<p class="text-xs text-slate-400">{policy.data_do}</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">Rodzaj</p>
			<p class="text-sm font-semibold text-slate-900">{policy.rodzaj}</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">Liczba rat</p>
			<p class="text-sm font-semibold text-slate-900">{policy.ilosc_rat}</p>
		</div>
	</div>

	{#if policy.crm_vehicles}
		<div class="bg-white border border-slate-200 rounded-2xl p-4 mb-6">
			<p class="text-xs text-slate-500 mb-1">Przedmiot ubezpieczenia — pojazd</p>
			<p class="text-sm font-semibold text-slate-900">{policy.crm_vehicles.marka_model} — {policy.crm_vehicles.nr_rejestracyjny}</p>
			{#if policy.crm_vehicles.vin}<p class="text-xs text-slate-400">VIN: {policy.crm_vehicles.vin}</p>{/if}
		</div>
	{:else if policy.przedmiot}
		<div class="bg-white border border-slate-200 rounded-2xl p-4 mb-6">
			<p class="text-xs text-slate-500 mb-1">Przedmiot ubezpieczenia</p>
			<p class="text-sm text-slate-700">{policy.przedmiot}</p>
		</div>
	{/if}

	<h2 class="text-lg font-semibold text-slate-900 mb-3">Płatności</h2>
	{#if payments.length === 0}
		<p class="text-sm text-slate-400">Brak zarejestrowanych płatności.</p>
	{:else}
	<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
		<table class="w-full text-sm">
			<thead class="bg-slate-50 text-slate-500 text-xs uppercase">
				<tr>
					<th class="text-left px-4 py-3">Rata</th>
					<th class="text-left px-4 py-3">Termin</th>
					<th class="text-right px-4 py-3">Kwota</th>
					<th class="text-left px-4 py-3">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each payments as p}
					<tr class="border-t border-slate-100">
						<td class="px-4 py-3 text-slate-600">{p.nr_raty}</td>
						<td class="px-4 py-3 text-slate-600">{p.data_platnosci}</td>
						<td class="px-4 py-3 text-right text-slate-900">{fmtPln(p.kwota)} zł</td>
						<td class="px-4 py-3"><Badge variant={paymentStatusVariant[p.status] ?? 'neutral'}>{p.status}</Badge></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{/if}
{/if}
