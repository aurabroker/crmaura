<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus, todayStr } from '$lib/utils';
	import type { Claim, Vehicle } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { ArrowLeft, Pencil, Plus } from 'lucide-svelte';

	const clientId = $derived($page.params.id);
	const client = $derived(appState.clients.find((c) => c.id === clientId));
	const clientPolicies = $derived(appState.policies.filter((p) => p.klient_id === clientId));
	const clientVehicles = $derived(appState.vehicles.filter((v) => v.klient_id === clientId));
	const clientClaims = $derived(appState.claims.filter((c) => c.klient_id === clientId));

	const totalPrzyp = $derived(clientPolicies.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0));
	const totalOpl = $derived(clientPolicies.reduce((s, p) => s + Number(p.skladka_zainkasowana ?? 0), 0));

	let activeTab = $state<'polisy' | 'pojazdy' | 'szkody' | 'saldo'>('polisy');

	// Claim status edit
	let editingClaim = $state<Claim | null>(null);
	let claimStatus = $state('');
	let claimWartosc = $state('');
	let savingClaim = $state(false);

	// Vehicle modal
	let showVehicle = $state(false);
	let editingVehicle = $state<Vehicle | null>(null);
	let vRej = $state('');
	let vMarka = $state('');
	let vVin = $state('');
	let vRok = $state('');
	let savingV = $state(false);
	let vError = $state('');

	const CLAIM_STATUSES = ['Zgłoszona', 'W toku', 'Wypłacona', 'Zakończona', 'Odmowa'];

	function openEditClaim(cl: Claim) {
		editingClaim = cl;
		claimStatus = cl.status;
		claimWartosc = cl.wartosc_roszczenia?.toString() ?? '';
	}

	async function saveClaim() {
		if (!editingClaim) return;
		savingClaim = true;
		await sb.from('crm_claims').update({
			status: claimStatus,
			wartosc_roszczenia: claimWartosc ? parseFloat(claimWartosc) : null
		}).eq('id', editingClaim.id);
		savingClaim = false;
		editingClaim = null;
		const { data } = await sb.from('crm_claims').select('*, crm_clients(nazwa), crm_policies(nr_polisy)');
		appState.claims = (data ?? []) as typeof appState.claims;
	}

	function openNewVehicle() {
		editingVehicle = null;
		vRej = ''; vMarka = ''; vVin = ''; vRok = ''; vError = '';
		showVehicle = true;
	}

	function openEditVehicle(v: Vehicle) {
		editingVehicle = v;
		vRej = v.nr_rejestracyjny; vMarka = v.marka_model;
		vVin = v.vin ?? ''; vRok = v.rok_produkcji?.toString() ?? '';
		vError = '';
		showVehicle = true;
	}

	async function saveVehicle() {
		if (!vRej.trim() || !vMarka.trim()) { vError = 'Nr rejestracyjny i marka są wymagane.'; return; }
		savingV = true; vError = '';
		const payload = {
			nr_rejestracyjny: vRej.trim(), marka_model: vMarka.trim(),
			vin: vVin.trim() || null, rok_produkcji: vRok ? parseInt(vRok) : null
		};
		let error;
		if (editingVehicle) {
			({ error } = await sb.from('crm_vehicles').update(payload).eq('id', editingVehicle.id));
		} else {
			({ error } = await sb.from('crm_vehicles').insert([{
				tenant_id: appState.profile!.tenant_id, klient_id: clientId, ...payload
			}]));
		}
		savingV = false;
		if (error) { vError = error.message; return; }
		showVehicle = false;
		const { data } = await sb.from('crm_vehicles').select('*');
		appState.vehicles = (data ?? []) as typeof appState.vehicles;
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>{client?.nazwa ?? 'Klient'} — FRANK</title></svelte:head>

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

	<div class="flex gap-6 border-b border-slate-200 mb-6">
		{#each (['polisy', 'pojazdy', 'szkody', 'saldo'] as const) as tab}
			<button
				onclick={() => (activeTab = tab)}
				class="pb-3 text-sm font-medium border-b-2 transition-colors
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
		<div class="flex justify-end mb-3">
			<button onclick={openNewVehicle} class="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
				<Plus size={14} /> Dodaj pojazd
			</button>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
						<th class="px-5 py-3">Nr Rejestracyjny</th>
						<th class="px-5 py-3">Marka / Model</th>
						<th class="px-5 py-3">VIN</th>
						<th class="px-5 py-3">Rok prod.</th>
						<th class="px-5 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each clientVehicles as v}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">{v.nr_rejestracyjny}</td>
							<td class="px-5 py-3">{v.marka_model}</td>
							<td class="px-5 py-3 text-slate-500">{v.vin ?? '—'}</td>
							<td class="px-5 py-3">{v.rok_produkcji ?? '—'}</td>
							<td class="px-5 py-3">
								<button onclick={() => openEditVehicle(v)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
									<Pencil size={14} />
								</button>
							</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="px-5 py-6 text-center text-slate-400">Brak pojazdów</td></tr>
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
						<th class="px-5 py-3"></th>
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
							<td class="px-5 py-3">
								{#if editingClaim?.id === cl.id}
									<select bind:value={claimStatus} class="border border-slate-300 rounded-lg px-2 py-1 text-xs">
										{#each CLAIM_STATUSES as s}<option>{s}</option>{/each}
									</select>
								{:else}
									<Badge variant={cl.status === 'Wypłacona' || cl.status === 'Zakończona' ? 'success' : cl.status === 'Odmowa' ? 'error' : 'warning'}>{cl.status}</Badge>
								{/if}
							</td>
							<td class="px-5 py-3">
								{#if editingClaim?.id === cl.id}
									<div class="flex gap-1">
										<button onclick={saveClaim} disabled={savingClaim} class="px-2 py-1 text-xs bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-60">
											{savingClaim ? '...' : 'Zapisz'}
										</button>
										<button onclick={() => editingClaim = null} class="px-2 py-1 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">Anuluj</button>
									</div>
								{:else}
									<button onclick={() => openEditClaim(cl)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
										<Pencil size={14} />
									</button>
								{/if}
							</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="px-5 py-6 text-center text-slate-400">Brak szkód</td></tr>
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
				<p class="text-2xl font-semibold text-red-600">{fmtPln(totalPrzyp - totalOpl)} PLN</p>
			</div>
		</div>
	{/if}
{/if}

<!-- Modal: Pojazd -->
<Modal title={editingVehicle ? 'Edytuj Pojazd' : 'Dodaj Pojazd'} open={showVehicle} onclose={() => { showVehicle = false; editingVehicle = null; }}>
	{#snippet footer()}
		<button onclick={() => { showVehicle = false; editingVehicle = null; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveVehicle} disabled={savingV} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingV ? 'Zapisywanie...' : editingVehicle ? 'Zapisz zmiany' : 'Dodaj pojazd'}
		</button>
	{/snippet}
	{#if vError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{vError}</div>{/if}
	<div class="grid grid-cols-2 gap-3">
		<div><label class={labelCls}>Nr Rejestracyjny *</label><input bind:value={vRej} class={inputCls} /></div>
		<div><label class={labelCls}>Marka i Model *</label><input bind:value={vMarka} class={inputCls} /></div>
		<div><label class={labelCls}>VIN</label><input bind:value={vVin} class={inputCls} /></div>
		<div><label class={labelCls}>Rok Produkcji</label><input type="number" bind:value={vRok} class={inputCls} /></div>
	</div>
</Modal>
