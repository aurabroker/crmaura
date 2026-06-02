<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, dateDiffDays, todayStr, policyStatus } from '$lib/utils';
	import Badge from '$lib/components/Badge.svelte';
	import { ArrowLeft } from 'lucide-svelte';

	const clientId = $derived($page.params.id);
	const client = $derived(appState.clients.find((c) => c.id === clientId));
	const clientPolicies = $derived(appState.policies.filter((p) => p.klient_id === clientId));
	const clientVehicles = $derived(appState.vehicles.filter((v) => v.klient_id === clientId));
	const clientClaims = $derived(appState.claims.filter((c) => c.klient_id === clientId));

	const totalPrzyp = $derived(clientPolicies.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0));
	const totalOpl = $derived(clientPolicies.reduce((s, p) => s + Number(p.skladka_zainkasowana ?? 0), 0));
	const totalZal = $derived(totalPrzyp - totalOpl);

	let activeTab = $state<'polisy' | 'pojazdy' | 'szkody' | 'saldo'>('polisy');
</script>

<svelte:head><title>{client?.nazwa ?? 'Klient'} — AuraCRM</title></svelte:head>

{#if !client}
	<p class="text-slate-400">Klient nie istnieje lub nie masz dostępu.</p>
{:else}
	<div class="flex items-center gap-3 mb-2">
		<button onclick={() => goto('/clients')} class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors">
			<ArrowLeft size={16} /> Powrót
		</button>
		<h1 class="text-2xl font-semibold text-slate-900">{client.nazwa}</h1>
	</div>
	<p class="text-sm text-slate-500 mb-6 ml-10">
		NIP: {client.nip ?? 'brak'} | RODO: {client.rodo_zgoda ? 'Aktywna' : 'BRAK'}
	</p>

	<!-- Tabs -->
	<div class="flex gap-6 border-b border-slate-200 mb-6">
		{#each (['polisy', 'pojazdy', 'szkody', 'saldo'] as const) as tab}
			<button
				onclick={() => (activeTab = tab)}
				class="pb-3 text-sm font-medium capitalize border-b-2 transition-colors
					{activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}"
			>
				{tab === 'polisy' ? 'Polisy' : tab === 'pojazdy' ? 'Flota / Pojazdy' : tab === 'szkody' ? 'Rejestr Szkód' : 'Rozliczenia'}
			</button>
		{/each}
	</div>

	{#if activeTab === 'polisy'}
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
						<th class="px-5 py-3">Nr Polisy</th>
						<th class="px-5 py-3">TU</th>
						<th class="px-5 py-3">Rodzaj</th>
						<th class="px-5 py-3">Przedmiot</th>
						<th class="px-5 py-3">Okres</th>
						<th class="px-5 py-3 text-right">Składka</th>
						<th class="px-5 py-3">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each clientPolicies as p}
						{@const st = policyStatus(p.data_do)}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">{p.nr_polisy}</td>
							<td class="px-5 py-3">{p.crm_insurers?.nazwa ?? '—'}</td>
							<td class="px-5 py-3"><Badge variant="neutral">{p.rodzaj}</Badge></td>
							<td class="px-5 py-3 text-slate-500">{p.przedmiot ?? '—'}</td>
							<td class="px-5 py-3 text-xs">{p.data_od}<br/>{p.data_do}</td>
							<td class="px-5 py-3 text-right font-medium">{fmtPln(p.skladka_przypisana)} PLN</td>
							<td class="px-5 py-3">
								<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
							</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="px-5 py-6 text-center text-slate-400">Brak polis</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

	{:else if activeTab === 'pojazdy'}
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
						<th class="px-5 py-3">Nr Rejestracyjny</th>
						<th class="px-5 py-3">Marka / Model</th>
						<th class="px-5 py-3">VIN</th>
						<th class="px-5 py-3">Rok prod.</th>
					</tr>
				</thead>
				<tbody>
					{#each clientVehicles as v}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">{v.nr_rejestracyjny}</td>
							<td class="px-5 py-3">{v.marka_model}</td>
							<td class="px-5 py-3 text-slate-500">{v.vin ?? '—'}</td>
							<td class="px-5 py-3">{v.rok_produkcji ?? '—'}</td>
						</tr>
					{:else}
						<tr><td colspan="4" class="px-5 py-6 text-center text-slate-400">Brak pojazdów</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

	{:else if activeTab === 'szkody'}
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
						<th class="px-5 py-3">Nr Szkody</th>
						<th class="px-5 py-3">Data</th>
						<th class="px-5 py-3">Z polisy</th>
						<th class="px-5 py-3">Opis</th>
						<th class="px-5 py-3 text-right">Wartość</th>
						<th class="px-5 py-3">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each clientClaims as cl}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">{cl.nr_szkody ?? 'Zgłoszenie'}</td>
							<td class="px-5 py-3">{cl.data_szkody}</td>
							<td class="px-5 py-3">{cl.crm_policies?.nr_polisy ?? '—'}</td>
							<td class="px-5 py-3 text-xs text-slate-500">{cl.opis_szkody ?? '—'}</td>
							<td class="px-5 py-3 text-right">{fmtPln(cl.wartosc_roszczenia)} PLN</td>
							<td class="px-5 py-3"><Badge variant="warning">{cl.status}</Badge></td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-5 py-6 text-center text-slate-400">Brak szkód</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

	{:else if activeTab === 'saldo'}
		<div class="grid grid-cols-3 gap-4">
			<div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
				<p class="text-sm font-medium text-slate-500 mb-2">Składka Przypisana</p>
				<p class="text-2xl font-semibold text-slate-900">{fmtPln(totalPrzyp)} PLN</p>
			</div>
			<div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
				<p class="text-sm font-medium text-slate-500 mb-2">Składka Zainkasowana</p>
				<p class="text-2xl font-semibold text-emerald-600">{fmtPln(totalOpl)} PLN</p>
			</div>
			<div class="bg-red-50 border border-red-200 rounded-xl p-5 shadow-sm">
				<p class="text-sm font-medium text-red-500 mb-2">Zaległości Klienta</p>
				<p class="text-2xl font-semibold text-red-600">{fmtPln(totalZal)} PLN</p>
			</div>
		</div>
	{/if}
{/if}
