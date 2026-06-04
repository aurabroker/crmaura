<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import type { Claim, Vehicle, ClientContact } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { ArrowLeft, Pencil, Plus, Car, FileText, AlertTriangle, Coins, Users, UserPlus, Trash2, ClipboardList, Copy, Check } from 'lucide-svelte';
	import { todayStr } from '$lib/utils';

	const clientId = $derived($page.params.id);
	const client = $derived(appState.clients.find(c => c.id === clientId));
	const clientPolicies = $derived(appState.policies.filter(p => p.klient_id === clientId));
	const clientVehicles = $derived(appState.vehicles.filter(v => v.klient_id === clientId));
	const clientClaims = $derived(appState.claims.filter(c => c.klient_id === clientId));
	const clientContacts = $derived(appState.clientContacts.filter(cc => cc.klient_id === clientId));
	const clientApk = $derived(appState.apkForms.filter(f => f.klient_id === clientId));

	const totalPrzyp = $derived(clientPolicies.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0));
	const totalOpl = $derived(clientPolicies.reduce((s, p) => s + Number(p.skladka_zainkasowana ?? 0), 0));
	const activeClaims = $derived(clientClaims.filter(c => c.status === 'Zgłoszona' || c.status === 'W toku'));

	const grupowePolicies = $derived(clientPolicies.filter(p =>
		p.rodzaj === 'grupowe_medyczne' || p.rodzaj === 'grupowe_życie'
	));
	const hasGrupowe = $derived(grupowePolicies.length > 0);
	const hasVehicles = $derived(clientVehicles.length > 0);
	const hasClaims = $derived(clientClaims.length > 0);

	let activeTab = $state<'polisy' | 'pojazdy' | 'szkody' | 'saldo' | 'kontakty' | 'apk'>('polisy');

	// APK
	const APK_APP_URL = 'https://apk.aurabroker.pl';
	let showNewApk = $state(false);
	let savingApk = $state(false);
	let apkErr = $state('');
	let apkAdvisor = $state('');
	let apkMode = $state<'client'|'advisor'>('client');
	let apkToken = $state('');
	let apkCopied = $state(false);
	const apkLink = $derived(apkToken ? `${APK_APP_URL}?token=${apkToken}` : '');

	function genRef() { return 'APK-' + Math.random().toString(36).slice(2,10).toUpperCase(); }
	function genToken() { return Math.random().toString(36).slice(2,8).toUpperCase() + Math.random().toString(36).slice(2,8).toUpperCase(); }

	async function createApk() {
		savingApk = true; apkErr = '';
		const ref = genRef(); const token = genToken();
		const { data: form, error: e1 } = await sb.from('apk_forms').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: clientId,
			ref_number: ref,
			client_name: client!.nazwa,
			advisor_name: apkAdvisor || null,
			form_date: todayStr(),
			mode: apkMode,
			status: 'draft',
			form_data: {}
		}]).select('id').single();
		if (e1) { savingApk = false; apkErr = e1.message; return; }
		const expires = new Date(); expires.setDate(expires.getDate() + 30);
		await sb.from('apk_tokens').insert([{
			tenant_id: appState.profile!.tenant_id,
			token, form_id: form!.id,
			advisor_name: apkAdvisor || null,
			status: 'pending', expires_at: expires.toISOString()
		}]);
		await sb.from('apk_audit').insert([{ form_id: form!.id, event: 'created', actor: apkAdvisor || 'system' }]);
		const { data } = await sb.from('apk_forms').select('*, crm_clients(nazwa, nazwa_skrocona)').order('created_at', { ascending: false });
		appState.apkForms = (data ?? []) as typeof appState.apkForms;
		savingApk = false; apkToken = token;
	}

	async function copyApkLink() {
		await navigator.clipboard.writeText(apkLink);
		apkCopied = true; setTimeout(() => apkCopied = false, 2000);
	}

	function closeApkModal() {
		showNewApk = false; apkToken = ''; apkErr = '';
		apkAdvisor = appState.profile?.imie_nazwisko ?? ''; apkMode = 'client';
	}

	// Contact persons
	let showContact = $state(false);
	let editingContact = $state<ClientContact | null>(null);
	let ccImie = $state(''); let ccStanowisko = $state('');
	let ccTelefon = $state(''); let ccEmail = $state('');
	let ccNotatki = $state(''); let savingCC = $state(false); let ccError = $state('');

	function openNewContact() { editingContact = null; ccImie = ''; ccStanowisko = ''; ccTelefon = ''; ccEmail = ''; ccNotatki = ''; ccError = ''; showContact = true; }
	function openEditContact(cc: ClientContact) { editingContact = cc; ccImie = cc.imie_nazwisko; ccStanowisko = cc.stanowisko ?? ''; ccTelefon = cc.telefon ?? ''; ccEmail = cc.email ?? ''; ccNotatki = cc.notatki ?? ''; ccError = ''; showContact = true; }

	async function saveContact() {
		if (!ccImie.trim()) { ccError = 'Imię i nazwisko jest wymagane.'; return; }
		savingCC = true; ccError = '';
		const payload = { imie_nazwisko: ccImie.trim(), stanowisko: ccStanowisko.trim() || null, telefon: ccTelefon.trim() || null, email: ccEmail.trim() || null, notatki: ccNotatki.trim() || null };
		let error;
		if (editingContact) {
			({ error } = await sb.from('crm_client_contacts').update(payload).eq('id', editingContact.id));
		} else {
			({ error } = await sb.from('crm_client_contacts').insert([{ tenant_id: appState.profile!.tenant_id, klient_id: clientId, ...payload }]));
		}
		savingCC = false;
		if (error) { ccError = error.message; return; }
		showContact = false;
		const { data } = await sb.from('crm_client_contacts').select('*');
		appState.clientContacts = (data ?? []) as typeof appState.clientContacts;
	}

	async function deleteContact(cc: ClientContact) {
		await sb.from('crm_client_contacts').delete().eq('id', cc.id);
		const { data } = await sb.from('crm_client_contacts').select('*');
		appState.clientContacts = (data ?? []) as typeof appState.clientContacts;
	}

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

<svelte:head><title>{client?.nazwa ?? 'Klient'} — FRANK67 CRM</title></svelte:head>

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
				<h1 class="text-2xl font-semibold text-slate-900">{client.nazwa_skrocona ?? client.nazwa}</h1>
				{#if client.nazwa_skrocona}<p class="text-xs text-slate-400">{client.nazwa}</p>{/if}
				<p class="text-sm text-slate-500 mt-0.5">
					{#if client.nip}NIP: {client.nip} · {/if}{#if client.pesel}PESEL: {client.pesel} · {/if}{#if client.rodo_zgoda}<span class="text-emerald-600">RODO ✓</span>{:else}<span class="text-red-500">BRAK RODO</span>{/if}
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
		{#each (['polisy', 'pojazdy', 'szkody', 'saldo', 'kontakty', 'apk'] as const) as tab}
			<button onclick={() => (activeTab = tab)}
				class="pb-3 text-sm font-medium border-b-2 transition-colors
					{activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}">
				{tab === 'polisy' ? `Polisy (${clientPolicies.length})` : tab === 'pojazdy' ? `Flota (${clientVehicles.length})` : tab === 'szkody' ? `Szkody (${clientClaims.length})` : tab === 'kontakty' ? `Kontakty (${clientContacts.length})` : tab === 'apk' ? `APK (${clientApk.length})` : 'Rozliczenia'}
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
			<button onclick={() => goto(`/vehicles/new?klient=${clientId}`)} class="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
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

	{:else if activeTab === 'kontakty'}
		<div class="flex justify-end mb-3">
			<button onclick={openNewContact} class="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
				<UserPlus size={14} /> Dodaj osobę kontaktową
			</button>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
						<th class="px-5 py-3">Imię i Nazwisko</th>
						<th class="px-5 py-3">Stanowisko</th>
						<th class="px-5 py-3">Telefon</th>
						<th class="px-5 py-3">E-mail</th>
						<th class="px-5 py-3">Notatki</th>
						<th class="px-5 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each clientContacts as cc}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">{cc.imie_nazwisko}</td>
							<td class="px-5 py-3 text-slate-500">{cc.stanowisko ?? '—'}</td>
							<td class="px-5 py-3">{cc.telefon ?? '—'}</td>
							<td class="px-5 py-3">{cc.email ?? '—'}</td>
							<td class="px-5 py-3 text-xs text-slate-400">{cc.notatki ?? ''}</td>
							<td class="px-5 py-3">
								<div class="flex gap-1">
									<button onclick={() => openEditContact(cc)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
									<button onclick={() => deleteContact(cc)} class="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
								</div>
							</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-5 py-6 text-center text-slate-400">Brak osób kontaktowych</td></tr>
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

	{:else if activeTab === 'apk'}
		<div class="flex items-center justify-between mb-4">
			<p class="text-sm text-slate-500">Formularze APK dla tego klienta</p>
			<button onclick={() => { apkAdvisor = appState.profile?.imie_nazwisko ?? ''; showNewApk = true; }}
				class="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700">
				<Plus size={14} /> Nowy APK
			</button>
		</div>

		{#if clientApk.length === 0}
			<div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
				<ClipboardList size={28} class="mx-auto mb-2 opacity-30" />
				Brak formularzy APK dla tego klienta
			</div>
		{:else}
			<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
				<table class="w-full text-sm text-left">
					<thead class="bg-slate-50 border-b border-slate-200">
						<tr>
							<th class="px-5 py-3 font-semibold text-slate-600">Ref</th>
							<th class="px-5 py-3 font-semibold text-slate-600">Doradca</th>
							<th class="px-5 py-3 font-semibold text-slate-600">Data</th>
							<th class="px-5 py-3 font-semibold text-slate-600">Status</th>
							<th class="px-5 py-3 font-semibold text-slate-600">Złożony</th>
							<th class="px-5 py-3"></th>
						</tr>
					</thead>
					<tbody>
						{#each clientApk as f}
							<tr class="border-t border-slate-100 hover:bg-slate-50">
								<td class="px-5 py-3 font-mono text-xs text-slate-500">{f.ref_number}</td>
								<td class="px-5 py-3 text-slate-600">{f.advisor_name ?? '—'}</td>
								<td class="px-5 py-3 text-slate-500">{f.form_date}</td>
								<td class="px-5 py-3">
									<Badge variant={f.status === 'submitted' ? 'success' : 'neutral'}>
										{f.status === 'submitted' ? 'Złożony' : 'Szkic'}
									</Badge>
								</td>
								<td class="px-5 py-3 text-slate-400 text-xs">{f.submitted_at ? f.submitted_at.slice(0,10) : '—'}</td>
								<td class="px-5 py-3">
									<a href="{APK_APP_URL}?form_id={f.id}" target="_blank"
										class="text-xs text-blue-600 hover:underline flex items-center gap-1">
										<ClipboardList size={12} /> Otwórz
									</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
{/if}

<!-- Modal: Osoba kontaktowa -->
<Modal title={editingContact ? 'Edytuj Kontakt' : 'Dodaj Osobę Kontaktową'} open={showContact} onclose={() => { showContact = false; editingContact = null; }}>
	{#snippet footer()}
		<button onclick={() => { showContact = false; editingContact = null; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveContact} disabled={savingCC} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingCC ? 'Zapisywanie...' : editingContact ? 'Zapisz zmiany' : 'Dodaj kontakt'}
		</button>
	{/snippet}
	{#if ccError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{ccError}</div>{/if}
	<div class="grid grid-cols-2 gap-3">
		<div class="col-span-2"><label class={labelCls}>Imię i Nazwisko *</label><input bind:value={ccImie} class={inputCls} /></div>
		<div><label class={labelCls}>Stanowisko</label><input bind:value={ccStanowisko} class={inputCls} /></div>
		<div><label class={labelCls}>Telefon</label><input bind:value={ccTelefon} class={inputCls} /></div>
		<div class="col-span-2"><label class={labelCls}>E-mail</label><input type="email" bind:value={ccEmail} class={inputCls} /></div>
		<div class="col-span-2"><label class={labelCls}>Notatki</label><textarea bind:value={ccNotatki} rows="2" class={inputCls}></textarea></div>
	</div>
</Modal>

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

<!-- Modal: Nowy APK -->
<Modal title="Nowy formularz APK" open={showNewApk} onclose={closeApkModal}>
	{#snippet footer()}
		{#if apkToken}
			<button onclick={closeApkModal} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700">Gotowe</button>
		{:else}
			<button onclick={closeApkModal} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
			<button onclick={createApk} disabled={savingApk} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
				{savingApk ? 'Tworzenie...' : 'Utwórz i wygeneruj link'}
			</button>
		{/if}
	{/snippet}
	{#if apkToken}
		<div class="space-y-4">
			<div class="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
				<Check size={20} class="text-emerald-600 shrink-0" />
				<span class="text-sm text-emerald-700 font-medium">APK utworzone pomyślnie!</span>
			</div>
			<div>
				<label class={labelCls}>Link dla klienta (ważny 30 dni)</label>
				<div class="flex gap-2">
					<input readonly value={apkLink} class="{inputCls} bg-slate-50 font-mono text-xs" />
					<button onclick={copyApkLink}
						class="flex items-center gap-1 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 shrink-0 {apkCopied ? 'text-emerald-600 border-emerald-300' : 'text-slate-600'}">
						{#if apkCopied}<Check size={14} /> Skopiowano{:else}<Copy size={14} /> Kopiuj{/if}
					</button>
				</div>
				<p class="text-xs text-slate-400 mt-1">Wyślij ten link klientowi — wypełni formularz APK online</p>
			</div>
		</div>
	{:else}
		<div class="space-y-4">
			{#if apkErr}<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{apkErr}</div>{/if}
			<div>
				<label class={labelCls}>Doradca</label>
				<input bind:value={apkAdvisor} class={inputCls} placeholder="Imię i nazwisko doradcy" />
			</div>
			<div>
				<label class={labelCls}>Tryb wypełniania</label>
				<div class="flex gap-2">
					{#each [['client','Klient wypełnia sam'],['advisor','Doradca wypełnia z klientem']] as [val, label]}
						<button type="button" onclick={() => apkMode = val as typeof apkMode}
							class="flex-1 py-2 text-sm rounded-lg border transition-colors
								{apkMode === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">
							{label}
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</Modal>
