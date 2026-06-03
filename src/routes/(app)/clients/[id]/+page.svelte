<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import type { Claim, Vehicle } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { ArrowLeft, Pencil, Plus, Car, FileText, AlertTriangle, Coins, Users } from 'lucide-svelte';

	const clientId = $derived($page.params.id);
	const client = $derived(appState.clients.find(c => c.id === clientId));
	const clientPolicies = $derived(appState.policies.filter(p => p.klient_id === clientId));
	const clientVehicles = $derived(appState.vehicles.filter(v => v.klient_id === clientId));
	const clientClaims = $derived(appState.claims.filter(c => c.klient_id === clientId));

	const totalPrzyp = $derived(clientPolicies.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0));
	const totalOpl = $derived(clientPolicies.reduce((s, p) => s + Number(p.skladka_zainkasowana ?? 0), 0));
	const activeClaims = $derived(clientClaims.filter(c => c.status === 'Zgłoszona' || c.status === 'W toku'));

	const grupowePolicies = $derived(clientPolicies.filter(p =>
		p.rodzaj === 'grupowe_medyczne' || p.rodzaj === 'grupowe_życie'
	));
	const hasGrupowe = $derived(grupowePolicies.length > 0);
	const hasVehicles = $derived(clientVehicles.length > 0);
	const hasClaims = $derived(clientClaims.length > 0);

	let activeTab = $state<'polisy' | 'pojazdy' | 'szkody' | 'saldo'>('polisy');

	// Dashboard modals
	let dashModal = $state<'polisy' | 'pojazdy' | 'szkody' | 'grupowe' | 'skladki' | null>(null);

	// Claim edit
	let editingClaim = $state<Claim | null>(null);
	let claimStatus = $state('');
	let savingClaim = $state(false);
	const CLAIM_STATUSES = ['Zgłoszona', 'W toku', 'Wypłacona', 'Zakończona', 'Odmowa'];

	function openEditClaim(cl: Claim) { editingClaim = cl; claimStatus = cl.status; }

	async function saveClaim() {
		if (!editingClaim) return;
		savingClaim = true;
		await sb.from('crm_claims').update({ status: claimStatus }).eq('id', editingClaim.id);
		savingClaim = false; editingClaim = null;
		const { data } = await sb.from('crm_claims').select('*, crm_clients(nazwa), crm_policies(nr_polisy)');
		appState.claims = (data ?? []) as typeof appState.claims;
	}

	// Vehicle modal
	let showVehicle = $state(false);
	let editingVehicle = $state<Vehicle | null>(null);
	let vRej = $state(''); let vMarka = $state('');
	let vVin = $state(''); let vRok = $state('');
	let savingV = $state(false); let vError = $state('');

	function openNewVehicle() { editingVehicle = null; vRej = ''; vMarka = ''; vVin = ''; vRok = ''; vError = ''; showVehicle = true; }
	function openEditVehicle(v: Vehicle) { editingVehicle = v; vRej = v.nr_rejestracyjny; vMarka = v.marka_model; vVin = v.vin ?? ''; vRok = v.rok_produkcji?.toString() ?? ''; vError = ''; showVehicle = true; }

	async function saveVehicle() {
		if (!vRej.trim() || !vMarka.trim()) { vError = 'Nr rejestracyjny i marka są wymagane.'; return; }
		savingV = true; vError = '';
		const payload = { nr_rejestracyjny: vRej.trim(), marka_model: vMarka.trim(), vin: vVin.trim() || null, rok_produkcji: vRok ? parseInt(vRok) : null };
		let error;
		if (editingVehicle) {
			({ error } = await sb.from('crm_vehicles').update(payload).eq('id', editingVehicle.id));
		} else {
			({ error } = await sb.from('crm_vehicles').insert([{ tenant_id: appState.profile!.tenant_id, klient_id: clientId, ...payload }]));
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
	<!-- Nagłówek -->
	<div class="flex items-start justify-between mb-4">
		<div class="flex items-center gap-3">
			<button onclick={() => goto('/clients')} class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors">
				<ArrowLeft size={16} /> Klienci
			</button>
			<div>
				<h1 class="text-2xl font-semibold text-slate-900">{client.nazwa}</h1>
				<p class="text-sm text-slate-500 mt-0.5">
					{#if client.nip}NIP: {client.nip} · {/if}{#if client.rodo_zgoda}<span class="text-emerald-600">RODO ✓</span>{:else}<span class="text-red-500">BRAK RODO</span>{/if}
				</p>
			</div>
		</div>
		<button
			onclick={() => goto(`/policies/new?klient=${clientId}`)}
			class="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors"
		>
			<Plus size={14} /> Dodaj Polisę
		</button>
	</div>

	<!-- Dashboard KPI cards (tylko jeśli są dane) -->
	<div class="flex flex-wrap gap-3 mb-5">
		<!-- Składki — zawsze jeśli są polisy -->
		{#if clientPolicies.length > 0}
		<button onclick={() => dashModal = 'skladki'}
			class="bg-white border border-slate-200 rounded-xl px-5 py-3 shadow-sm hover:border-blue-300 hover:shadow-md transition-all text-left">
			<div class="flex items-center gap-2 text-slate-500 text-xs mb-1"><Coins size={13} /> Składki</div>
			<div class="text-xl font-bold text-slate-900">{fmtPln(totalPrzyp)}</div>
			<div class="text-xs text-slate-400">{totalPrzyp - totalOpl > 0 ? `Zaległość: ${fmtPln(totalPrzyp - totalOpl)}` : 'Bez zaległości'}</div>
		</button>
		{/if}

		<!-- Polisy — zawsze jeśli są polisy -->
		{#if clientPolicies.length > 0}
		<button onclick={() => dashModal = 'polisy'}
			class="bg-white border border-slate-200 rounded-xl px-5 py-3 shadow-sm hover:border-blue-300 hover:shadow-md transition-all text-left">
			<div class="flex items-center gap-2 text-slate-500 text-xs mb-1"><FileText size={13} /> Polisy</div>
			<div class="text-xl font-bold text-slate-900">{clientPolicies.length}</div>
			<div class="text-xs text-slate-400">
				{clientPolicies.filter(p => policyStatus(p.data_do).label === 'Aktywna').length} aktywnych
			</div>
		</button>
		{/if}

		<!-- Pojazdy — tylko jeśli ma -->
		{#if hasVehicles}
		<button onclick={() => dashModal = 'pojazdy'}
			class="bg-white border border-slate-200 rounded-xl px-5 py-3 shadow-sm hover:border-blue-300 hover:shadow-md transition-all text-left">
			<div class="flex items-center gap-2 text-slate-500 text-xs mb-1"><Car size={13} /> Pojazdy</div>
			<div class="text-xl font-bold text-slate-900">{clientVehicles.length}</div>
			<div class="text-xs text-slate-400">w flocie</div>
		</button>
		{/if}

		<!-- Szkody — tylko jeśli ma -->
		{#if hasClaims}
		<button onclick={() => dashModal = 'szkody'}
			class="bg-white border {activeClaims.length > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200'} rounded-xl px-5 py-3 shadow-sm hover:shadow-md transition-all text-left">
			<div class="flex items-center gap-2 text-slate-500 text-xs mb-1"><AlertTriangle size={13} /> Szkody</div>
			<div class="text-xl font-bold {activeClaims.length > 0 ? 'text-red-600' : 'text-slate-900'}">{clientClaims.length}</div>
			<div class="text-xs text-slate-400">{activeClaims.length} aktywnych</div>
		</button>
		{/if}

		<!-- Grupowe — tylko jeśli ma -->
		{#if hasGrupowe}
		<button onclick={() => dashModal = 'grupowe'}
			class="bg-white border border-slate-200 rounded-xl px-5 py-3 shadow-sm hover:border-blue-300 hover:shadow-md transition-all text-left">
			<div class="flex items-center gap-2 text-slate-500 text-xs mb-1"><Users size={13} /> Grupowe</div>
			<div class="text-xl font-bold text-slate-900">{grupowePolicies.length}</div>
			<div class="text-xs text-slate-400">ubezpieczenia grupowe</div>
		</button>
		{/if}
	</div>

	<!-- Tabs -->
	<div class="flex gap-6 border-b border-slate-200 mb-4">
		{#each (['polisy', 'pojazdy', 'szkody', 'saldo'] as const) as tab}
			<button onclick={() => (activeTab = tab)}
				class="pb-3 text-sm font-medium border-b-2 transition-colors
					{activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}">
				{tab === 'polisy' ? `Polisy (${clientPolicies.length})` : tab === 'pojazdy' ? `Flota (${clientVehicles.length})` : tab === 'szkody' ? `Szkody (${clientClaims.length})` : 'Rozliczenia'}
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
						<th class="px-5 py-3">OD</th>
						<th class="px-5 py-3">DO</th>
						<th class="px-5 py-3 text-right">Składka</th>
						<th class="px-5 py-3">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each clientPolicies as p}
						{@const st = policyStatus(p.data_do)}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3">
								<a href="/policies/{p.id}" class="font-medium text-blue-700 hover:underline">{p.nr_polisy}</a>
							</td>
							<td class="px-5 py-3">
								{#if p.crm_insurers?.skrot}
									<span class="font-mono font-semibold text-blue-700 text-xs" title={p.crm_insurers.nazwa}>{p.crm_insurers.skrot}</span>
								{:else}
									{p.crm_insurers?.nazwa ?? '—'}
								{/if}
							</td>
							<td class="px-5 py-3"><Badge variant="neutral">{p.rodzaj}</Badge></td>
							<td class="px-5 py-3 text-xs">{p.data_od}</td>
							<td class="px-5 py-3 text-xs">{p.data_do}</td>
							<td class="px-5 py-3 text-right font-medium">{fmtPln(p.skladka_przypisana)}</td>
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
						<th class="px-5 py-3">Rok</th>
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
								<button onclick={() => openEditVehicle(v)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
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
										<button onclick={saveClaim} disabled={savingClaim} class="px-2 py-1 text-xs bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-60">{savingClaim ? '...' : 'Zapisz'}</button>
										<button onclick={() => editingClaim = null} class="px-2 py-1 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">Anuluj</button>
									</div>
								{:else}
									<button onclick={() => openEditClaim(cl)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
								{/if}
							</td>
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
				<p class="text-2xl font-semibold text-slate-900">{fmtPln(totalPrzyp)}</p>
			</div>
			<div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
				<p class="text-sm font-medium text-slate-500 mb-2">Składka Zainkasowana</p>
				<p class="text-2xl font-semibold text-emerald-600">{fmtPln(totalOpl)}</p>
			</div>
			<div class="bg-{totalPrzyp - totalOpl > 0 ? 'red-50 border-red-200' : 'white border-slate-200'} border rounded-xl p-5 shadow-sm">
				<p class="text-sm font-medium text-{totalPrzyp - totalOpl > 0 ? 'red-500' : 'slate-500'} mb-2">Zaległości</p>
				<p class="text-2xl font-semibold text-{totalPrzyp - totalOpl > 0 ? 'red-600' : 'slate-900'}">{fmtPln(totalPrzyp - totalOpl)}</p>
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

<!-- Dashboard Modals -->
<Modal title="Składki klienta" open={dashModal === 'skladki'} onclose={() => dashModal = null}>
	{#snippet footer()}<button onclick={() => dashModal = null} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>{/snippet}
	<div class="space-y-3">
		<div class="grid grid-cols-3 gap-3">
			<div class="bg-slate-50 rounded-xl p-4">
				<p class="text-xs text-slate-500 mb-1">Przypisana</p>
				<p class="text-lg font-bold text-slate-900">{fmtPln(totalPrzyp)}</p>
			</div>
			<div class="bg-emerald-50 rounded-xl p-4">
				<p class="text-xs text-slate-500 mb-1">Zainkasowana</p>
				<p class="text-lg font-bold text-emerald-700">{fmtPln(totalOpl)}</p>
			</div>
			<div class="bg-red-50 rounded-xl p-4">
				<p class="text-xs text-slate-500 mb-1">Zaległość</p>
				<p class="text-lg font-bold text-red-600">{fmtPln(totalPrzyp - totalOpl)}</p>
			</div>
		</div>
		<table class="w-full text-sm">
			<thead><tr class="text-[11px] text-slate-500 uppercase"><th class="py-2 text-left">Polisa</th><th class="py-2 text-right">Składka</th></tr></thead>
			<tbody>
				{#each clientPolicies as p}
					<tr class="border-t border-slate-100">
						<td class="py-2"><a href="/policies/{p.id}" class="text-blue-700 hover:underline">{p.nr_polisy}</a></td>
						<td class="py-2 text-right font-medium">{fmtPln(p.skladka_przypisana)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Modal>

<Modal title="Polisy klienta ({clientPolicies.length})" open={dashModal === 'polisy'} onclose={() => dashModal = null}>
	{#snippet footer()}<button onclick={() => dashModal = null} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>{/snippet}
	<div class="space-y-2">
		{#each clientPolicies as p}
			{@const st = policyStatus(p.data_do)}
			<div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
				<div>
					<a href="/policies/{p.id}" class="font-medium text-blue-700 hover:underline">{p.nr_polisy}</a>
					<p class="text-xs text-slate-500">{p.rodzaj} · {p.data_od} – {p.data_do}</p>
				</div>
				<div class="text-right">
					<p class="font-medium text-sm">{fmtPln(p.skladka_przypisana)}</p>
					<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
				</div>
			</div>
		{/each}
	</div>
</Modal>

<Modal title="Flota klienta ({clientVehicles.length} poj.)" open={dashModal === 'pojazdy'} onclose={() => dashModal = null}>
	{#snippet footer()}<button onclick={() => dashModal = null} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>{/snippet}
	<div class="space-y-2">
		{#each clientVehicles as v}
			<div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
				<div>
					<p class="font-medium">{v.nr_rejestracyjny}</p>
					<p class="text-xs text-slate-500">{v.marka_model}{v.rok_produkcji ? ` · ${v.rok_produkcji}` : ''}</p>
				</div>
				{#if v.vin}<p class="text-xs text-slate-400 font-mono">{v.vin}</p>{/if}
			</div>
		{/each}
	</div>
</Modal>

<Modal title="Rejestr szkód ({clientClaims.length})" open={dashModal === 'szkody'} onclose={() => dashModal = null}>
	{#snippet footer()}<button onclick={() => dashModal = null} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>{/snippet}
	<div class="space-y-2">
		{#each clientClaims as cl}
			<div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
				<div>
					<p class="font-medium">{cl.nr_szkody ?? 'Zgłoszenie'}</p>
					<p class="text-xs text-slate-500">{cl.data_szkody} · {cl.opis_szkody ?? '—'}</p>
				</div>
				<Badge variant={cl.status === 'Wypłacona' || cl.status === 'Zakończona' ? 'success' : cl.status === 'Odmowa' ? 'error' : 'warning'}>{cl.status}</Badge>
			</div>
		{/each}
	</div>
</Modal>

<Modal title="Ubezpieczenia grupowe ({grupowePolicies.length})" open={dashModal === 'grupowe'} onclose={() => dashModal = null}>
	{#snippet footer()}<button onclick={() => dashModal = null} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>{/snippet}
	<div class="space-y-2">
		{#each grupowePolicies as p}
			{@const st = policyStatus(p.data_do)}
			<div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
				<div>
					<a href="/policies/{p.id}" class="font-medium text-blue-700 hover:underline">{p.nr_polisy}</a>
					<p class="text-xs text-slate-500">{p.rodzaj} · {p.data_od} – {p.data_do}</p>
				</div>
				<div class="text-right">
					<p class="font-medium text-sm">{fmtPln(p.skladka_przypisana)}</p>
					<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
				</div>
			</div>
		{/each}
	</div>
</Modal>
