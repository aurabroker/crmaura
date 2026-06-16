<script lang="ts">
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { portalState } from '$lib/stores/portal.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import { FileText, AlertTriangle, Car, Calculator } from 'lucide-svelte';

	let loading = $state(true);
	let policyCount = $state(0);
	let activePolicyCount = $state(0);
	let claimCount = $state(0);
	let vehicleCount = $state(0);
	let dueAmount = $state(0);

	onMount(async () => {
		const klientId = portalState.client?.id;
		if (!klientId) return;

		const [rP, rCl, rV, rPay] = await Promise.all([
			sb.from('crm_policies').select('id, data_do').eq('klient_id', klientId).is('deleted_at', null),
			sb.from('crm_claims').select('id').eq('klient_id', klientId),
			sb.from('crm_vehicles').select('id').eq('klient_id', klientId),
			sb.from('crm_policy_payments').select('kwota, status')
		]);

		const policies = rP.data ?? [];
		policyCount = policies.length;
		activePolicyCount = policies.filter(p => policyStatus(p.data_do).label === 'Aktywna').length;
		claimCount = (rCl.data ?? []).length;
		vehicleCount = (rV.data ?? []).length;

		const payments = (rPay.data ?? []) as { kwota: number; status: string }[];
		dueAmount = payments
			.filter(p => p.status === 'Oczekująca' || p.status === 'Zaległa')
			.reduce((s, p) => s + Number(p.kwota), 0);

		loading = false;
	});
</script>

<svelte:head><title>Pulpit — Panel Klienta</title></svelte:head>

<h1 class="text-2xl font-bold text-slate-900 mb-1">Witaj, {portalState.client?.nazwa}</h1>
<p class="text-slate-500 text-sm mb-6">Przegląd Twoich polis, szkód, pojazdów i płatności.</p>

{#if loading}
	<div class="text-slate-400 text-sm">Ładowanie...</div>
{:else}
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
	<a href="/portal/polisy" class="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-shadow">
		<div class="flex items-center justify-between mb-3">
			<FileText size={20} class="text-blue-500" />
			<span class="text-xs text-slate-400">{activePolicyCount} aktywnych</span>
		</div>
		<div class="text-2xl font-bold text-slate-900">{policyCount}</div>
		<div class="text-sm text-slate-500">Polisy</div>
	</a>

	<a href="/portal/szkody" class="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-shadow">
		<div class="flex items-center justify-between mb-3">
			<AlertTriangle size={20} class="text-amber-500" />
		</div>
		<div class="text-2xl font-bold text-slate-900">{claimCount}</div>
		<div class="text-sm text-slate-500">Szkody</div>
	</a>

	<a href="/portal/pojazdy" class="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-shadow">
		<div class="flex items-center justify-between mb-3">
			<Car size={20} class="text-indigo-500" />
		</div>
		<div class="text-2xl font-bold text-slate-900">{vehicleCount}</div>
		<div class="text-sm text-slate-500">Pojazdy</div>
	</a>

	<a href="/portal/platnosci" class="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-shadow">
		<div class="flex items-center justify-between mb-3">
			<Calculator size={20} class="text-emerald-500" />
		</div>
		<div class="text-2xl font-bold text-slate-900">{fmtPln(dueAmount)} zł</div>
		<div class="text-sm text-slate-500">Do zapłaty</div>
	</a>
</div>
{/if}
