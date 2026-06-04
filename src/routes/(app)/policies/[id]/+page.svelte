<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import PolicyForm from '$lib/components/PolicyForm.svelte';
	import { ArrowLeft, Pencil, FilePlus2, Users, Trash2 } from 'lucide-svelte';
	import type { PolicyBroker } from '$lib/types/database';

	const policyId = $derived($page.params.id);
	const policy = $derived(appState.policies.find(p => p.id === policyId));
	const annexes = $derived(appState.annexes.filter(a => a.polisa_id === policyId));
	const payments = $derived(appState.payments.filter(p => p.polisa_id === policyId));
	const polisaBrokers = $derived(appState.policyBrokers.filter(pb => pb.polisa_id === policyId));
	// Child policies (certyfikaty) for UG
	const childPolicies = $derived(appState.policies.filter(p => p.parent_id === policyId));
	const childSkladka = $derived(childPolicies.reduce((s, p) => s + (p.skladka_przypisana ?? 0), 0));
	const childProwizja = $derived(childPolicies.reduce((s, p) => s + (p.prowizja_przypisana ?? 0), 0));

	// Policy brokers management
	let showBrokers = $state(false);
	let pbBrokerId = $state('');
	let pbRola = $state<'akwizycja' | 'obsługa' | 'opiekun'>('akwizycja');
	let pbUdzial = $state('100');
	let savingPB = $state(false);
	let pbError = $state('');

	async function reloadPolicyBrokers() {
		const { data } = await sb.from('crm_policy_brokers').select('*, crm_profiles(imie_nazwisko, email)');
		appState.policyBrokers = (data ?? []) as typeof appState.policyBrokers;
	}

	async function addBroker() {
		if (!pbBrokerId) { pbError = 'Wybierz brokera.'; return; }
		savingPB = true; pbError = '';
		const { error } = await sb.from('crm_policy_brokers').insert([{
			tenant_id: appState.profile!.tenant_id,
			polisa_id: policyId,
			broker_id: pbBrokerId,
			rola: pbRola,
			udzial_pct: parseFloat(pbUdzial) || 100
		}]);
		savingPB = false;
		if (error) { pbError = error.message; return; }
		pbBrokerId = ''; pbRola = 'akwizycja'; pbUdzial = '100';
		await reloadPolicyBrokers();
	}

	async function removeBroker(pb: PolicyBroker) {
		await sb.from('crm_policy_brokers').delete().eq('id', pb.id);
		await reloadPolicyBrokers();
	}

	const rolaLabel: Record<string, string> = {
		akwizycja: 'Akwizycja',
		obsługa: 'Obsługa',
		opiekun: 'Opiekun'
	};
	const rolaVariant: Record<string, 'success' | 'info' | 'neutral'> = {
		akwizycja: 'success',
		obsługa: 'info',
		opiekun: 'neutral'
	};

	const st = $derived(policy ? policyStatus(policy.data_do) : null);

	// UG default commission inline edit
	let ugEditOpen = $state(false);
	let ugEditVal = $state('');
	let ugEditSaving = $state(false);
	let ugEditUpdatedCount = $state(0);
	async function saveUgDefault() {
		ugEditSaving = true;
		const pct = parseFloat(ugEditVal) || null;
		// Save default on UG
		await sb.from('crm_policies').update({ ug_default_prowizja_pct: pct }).eq('id', policyId);
		// Apply to child policies that have no commission set (prowizja_pct = 0 or null)
		if (pct) {
			const childrenWithoutProwizja = appState.policies
				.filter(p => p.parent_id === policyId && (!p.prowizja_pct || p.prowizja_pct === 0));
			ugEditUpdatedCount = childrenWithoutProwizja.length;
			for (const child of childrenWithoutProwizja) {
				const prowizja_przypisana = (child.skladka_przypisana * pct) / 100;
				await sb.from('crm_policies').update({ prowizja_pct: pct, prowizja_przypisana }).eq('id', child.id);
			}
		}
		const { data } = await sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot)');
		appState.policies = (data ?? []) as typeof appState.policies;
		ugEditOpen = false; ugEditSaving = false;
	}

	// Edit modal
	let showEdit = $state(false);
	let editForm = $state<ReturnType<typeof PolicyForm> | null>(null);
	let saving = $state(false);
	let formError = $state('');

	async function saveEdit() {
		if (!editForm || !policy) return;
		const err = editForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals = editForm.getValues();
		const { error } = await sb.from('crm_policies').update(vals).eq('id', policy.id);
		saving = false;
		if (error) { formError = error.message; return; }
		showEdit = false;
		const [rP, rA] = await Promise.all([
			sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot)'),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu')
		]);
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rA.data ?? []) as typeof appState.annexes;
	}

	// Annex modal
	let showAnnex = $state(false);
	let axNr = $state(''); let axTyp = $state<'korekta'|'doubezpieczenie'|'zmiana_zakresu'|'inne'>('korekta');
	let axData = $state(''); let axOpis = $state('');
	let axDeltaSkladka = $state('0'); let axNewDataDo = $state('');
	let axNewSkladka = $state(''); let axNewProwizjaPct = $state('');
	let savingAx = $state(false); let axError = $state('');

	async function saveAnnex() {
		if (!policy) return;
		if (!axNr.trim() || !axData) { axError = 'Podaj nr aneksu i datę.'; return; }
		savingAx = true; axError = '';
		const { error } = await sb.from('crm_policy_annexes').insert([{
			tenant_id: appState.profile!.tenant_id,
			polisa_id: policy.id,
			nr_aneksu: axNr.trim(), typ: axTyp, data_aneksu: axData,
			opis: axOpis || null,
			delta_skladka: parseFloat(axDeltaSkladka) || 0,
			delta_prowizja: 0,
			new_data_do: axNewDataDo || null,
			new_skladka_przypisana: axNewSkladka ? parseFloat(axNewSkladka) : null,
			new_prowizja_pct: axNewProwizjaPct ? parseFloat(axNewProwizjaPct) : null
		}]);
		if (!error && axTyp === 'korekta') {
			const updates: Record<string, unknown> = {};
			if (axNewDataDo) updates.data_do = axNewDataDo;
			if (axNewSkladka) updates.skladka_przypisana = parseFloat(axNewSkladka);
			if (axNewProwizjaPct) updates.prowizja_pct = parseFloat(axNewProwizjaPct);
			if (Object.keys(updates).length) await sb.from('crm_policies').update(updates).eq('id', policy.id);
		}
		savingAx = false;
		if (error) { axError = error.message; return; }
		showAnnex = false;
		axNr = ''; axTyp = 'korekta'; axData = ''; axOpis = ''; axDeltaSkladka = '0';
		axNewDataDo = ''; axNewSkladka = ''; axNewProwizjaPct = '';
		const [rP, rA] = await Promise.all([
			sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot)'),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu')
		]);
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rA.data ?? []) as typeof appState.annexes;
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>{policy?.nr_polisy ?? 'Polisa'} — FRANK67 CRM</title></svelte:head>

{#if !policy}
	<p class="text-slate-400">Polisa nie istnieje lub nie masz dostępu.</p>
{:else}
	{@const tuLabel = policy.crm_insurers?.skrot ?? policy.crm_insurers?.nazwa ?? '—'}

	<div class="flex items-center justify-between mb-4">
		<div class="flex items-center gap-3">
			<button onclick={() => goto('/policies')} class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors">
				<ArrowLeft size={16} /> Polisy
			</button>
			<div>
				<h1 class="text-2xl font-semibold text-slate-900">{policy.nr_polisy}</h1>
				<div class="flex items-center gap-2 mt-0.5">
					<a href="/clients/{policy.klient_id}" class="text-sm text-blue-600 hover:underline">{policy.crm_clients?.nazwa ?? '—'}</a>
					<span class="text-slate-300">•</span>
					<span class="text-sm text-slate-500">{tuLabel}</span>
					{#if st}<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>{/if}
				</div>
			</div>
		</div>
		<div class="flex gap-2">
			<button onclick={() => { showBrokers = true; pbError = ''; }} class="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50">
				<Users size={14} /> Podział prowizji {#if polisaBrokers.length > 0}<span class="ml-1 bg-blue-100 text-blue-700 rounded-full px-1.5 text-xs font-semibold">{polisaBrokers.length}</span>{/if}
			</button>
			<button onclick={() => { showAnnex = true; axError = ''; }} class="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50">
				<FilePlus2 size={14} /> Aneks
			</button>
			<button onclick={() => { showEdit = true; formError = ''; }} class="flex items-center gap-1.5 text-sm bg-slate-900 text-white rounded-lg px-3 py-2 hover:bg-slate-700">
				<Pencil size={14} /> Edytuj
			</button>
		</div>
	</div>

	<!-- Dane polisy -->
	<div class="grid grid-cols-4 gap-3 mb-5">
		<div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
			<p class="text-xs text-slate-500 mb-1">Składka</p>
			<p class="text-xl font-semibold text-slate-900">{fmtPln(policy.skladka_przypisana)}</p>
			<p class="text-xs text-slate-400">{policy.typ_umowy === 'generalna' ? 'Zaliczkowa' : `Raty: ${policy.ilosc_rat}`}</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
			<p class="text-xs text-slate-500 mb-1">Okres</p>
			<p class="text-sm font-semibold text-slate-900">{policy.data_od}</p>
			<p class="text-sm text-slate-500">{policy.data_do}</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
			<p class="text-xs text-slate-500 mb-1">Prowizja</p>
			<p class="text-xl font-semibold text-emerald-600">{fmtPln(policy.prowizja_przypisana)}</p>
			<p class="text-xs text-slate-400">{policy.prowizja_pct}%</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
			<p class="text-xs text-slate-500 mb-1">Rodzaj</p>
			<p class="text-sm font-semibold text-slate-900">{policy.rodzaj}</p>
			{#if policy.przedmiot}<p class="text-xs text-slate-400">{policy.przedmiot}</p>{/if}
		</div>
	</div>

	<!-- UG: domyślna prowizja -->
	{#if policy.typ_umowy === 'generalna'}
	<div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 flex items-center justify-between">
		<div>
			<p class="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Domyślna prowizja dla polis w tej UG</p>
			{#if ugEditOpen}
				<div class="flex items-center gap-2">
					<input type="number" step="0.01" bind:value={ugEditVal}
						class="border border-blue-300 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="%" />
					<button onclick={saveUgDefault} disabled={ugEditSaving} class="px-3 py-1 bg-blue-700 text-white text-xs rounded-lg hover:bg-blue-800 disabled:opacity-60">
						{ugEditSaving ? '...' : 'Zapisz'}
					</button>
					<button onclick={() => ugEditOpen = false} class="px-3 py-1 border border-blue-300 text-blue-700 text-xs rounded-lg hover:bg-blue-100">Anuluj</button>
				</div>
			{:else}
				<p class="text-2xl font-bold text-blue-900">{policy.ug_default_prowizja_pct != null ? `${policy.ug_default_prowizja_pct}%` : '— nie ustawiono —'}</p>
				<p class="text-xs text-blue-600 mt-0.5">Automatycznie podpowiadana przy dodawaniu polisy do tej UG</p>
				{#if ugEditUpdatedCount > 0}
					<p class="text-xs text-emerald-700 mt-1">✓ Zaktualizowano {ugEditUpdatedCount} {ugEditUpdatedCount === 1 ? 'polisę' : 'polis'} bez prowizji</p>
				{/if}
			{/if}
		</div>
		{#if !ugEditOpen}
			<button onclick={() => { ugEditVal = policy.ug_default_prowizja_pct?.toString() ?? ''; ugEditOpen = true; }}
				class="flex items-center gap-1 text-xs text-blue-700 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-100">
				<Pencil size={12} /> Ustaw
			</button>
		{/if}
	</div>
	{/if}

	<!-- Podział prowizji (mini-panel jeśli są wpisy) -->
	{#if polisaBrokers.length > 0}
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
		<div class="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
			<p class="text-sm font-semibold text-slate-700 flex items-center gap-2"><Users size={14} /> Podział prowizji</p>
			<button onclick={() => { showBrokers = true; pbError = ''; }} class="text-xs text-slate-500 hover:text-slate-800">Zarządzaj</button>
		</div>
		<div class="divide-y divide-slate-100">
			{#each polisaBrokers as pb}
				<div class="px-5 py-3 flex items-center justify-between">
					<div>
						<span class="font-medium text-sm">{pb.crm_profiles?.imie_nazwisko ?? pb.crm_profiles?.email ?? '—'}</span>
					</div>
					<div class="flex items-center gap-3">
						<Badge variant={rolaVariant[pb.rola]}>{rolaLabel[pb.rola]}</Badge>
						{#if pb.rola !== 'opiekun'}
							<span class="text-sm font-semibold text-slate-700">{pb.udzial_pct}%</span>
							<span class="text-xs text-slate-400">{fmtPln((policy.prowizja_przypisana ?? 0) * pb.udzial_pct / 100)}</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
	{/if}

	<!-- Terminy rat -->
	{#if policy.daty_rat}
	<div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-5">
		<p class="text-xs font-semibold text-slate-500 uppercase mb-2">Terminy płatności rat</p>
		<div class="flex flex-wrap gap-2">
			{#each policy.daty_rat.split(',') as d, i}
				<span class="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-sm">Rata {i+1}: <strong>{d.trim()}</strong></span>
			{/each}
		</div>
	</div>
	{/if}

	<!-- Polisy podrzędne (certyfikaty) UG -->
	{#if childPolicies.length > 0}
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
		<div class="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
			<p class="text-sm font-semibold text-slate-700">Polisy w ramach UG ({childPolicies.length})</p>
			<div class="flex gap-4 text-xs text-slate-500">
				<span>Łączna składka: <strong class="text-slate-900">{fmtPln(childSkladka)}</strong></span>
				<span>Łączna prowizja: <strong class="text-emerald-700">{fmtPln(childProwizja)}</strong></span>
			</div>
		</div>
		<table class="w-full text-sm text-left">
			<thead>
				<tr class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<th class="px-5 py-2">Nr polisy</th>
					<th class="px-5 py-2">Klient</th>
					<th class="px-5 py-2">OD</th>
					<th class="px-5 py-2">DO</th>
					<th class="px-5 py-2 text-right">Składka</th>
					<th class="px-5 py-2 text-right">Prowizja</th>
				</tr>
			</thead>
			<tbody>
				{#each childPolicies as cp}
					{@const cst = policyStatus(cp.data_do)}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-5 py-2">
							<a href="/policies/{cp.id}" class="font-medium text-blue-700 hover:underline">{cp.nr_polisy}</a>
						</td>
						<td class="px-5 py-2 text-slate-600">
							<a href="/clients/{cp.klient_id}" class="hover:text-blue-700 hover:underline">{cp.crm_clients?.nazwa ?? '—'}</a>
						</td>
						<td class="px-5 py-2 text-slate-500">{cp.data_od ?? '—'}</td>
						<td class="px-5 py-2 text-slate-500">{cp.data_do ?? '—'}</td>
						<td class="px-5 py-2 text-right font-medium">{fmtPln(cp.skladka_przypisana)}</td>
						<td class="px-5 py-2 text-right text-emerald-600">{fmtPln(cp.prowizja_przypisana)}</td>
					</tr>
				{/each}
				<tr class="border-t-2 border-slate-200 bg-slate-50 font-semibold">
					<td colspan="4" class="px-5 py-2 text-sm text-slate-600">SUMA</td>
					<td class="px-5 py-2 text-right">{fmtPln(childSkladka)}</td>
					<td class="px-5 py-2 text-right text-emerald-700">{fmtPln(childProwizja)}</td>
				</tr>
			</tbody>
		</table>
	</div>
	{/if}

	<!-- Aneksy -->
	{#if annexes.length > 0}
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
		<div class="px-5 py-3 border-b border-slate-100 bg-slate-50">
			<p class="text-sm font-semibold text-slate-700">Aneksy ({annexes.length})</p>
		</div>
		<table class="w-full text-sm text-left">
			<thead>
				<tr class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<th class="px-5 py-2">Nr</th>
					<th class="px-5 py-2">Data</th>
					<th class="px-5 py-2">Typ</th>
					<th class="px-5 py-2">Opis</th>
					<th class="px-5 py-2 text-right">Delta składki</th>
				</tr>
			</thead>
			<tbody>
				{#each annexes as ax}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-5 py-2 font-medium">{ax.nr_aneksu}</td>
						<td class="px-5 py-2">{ax.data_aneksu}</td>
						<td class="px-5 py-2"><Badge variant="info">{ax.typ}</Badge></td>
						<td class="px-5 py-2 text-slate-500">{ax.opis ?? '—'}</td>
						<td class="px-5 py-2 text-right {ax.delta_skladka >= 0 ? 'text-emerald-600' : 'text-red-500'}">
							{ax.delta_skladka >= 0 ? '+' : ''}{fmtPln(ax.delta_skladka)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{/if}

	<!-- Płatności -->
	{#if payments.length > 0}
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<div class="px-5 py-3 border-b border-slate-100 bg-slate-50">
			<p class="text-sm font-semibold text-slate-700">Płatności ({payments.length})</p>
		</div>
		<table class="w-full text-sm text-left">
			<thead>
				<tr class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<th class="px-5 py-2">Rata</th>
					<th class="px-5 py-2">Termin</th>
					<th class="px-5 py-2 text-right">Kwota</th>
					<th class="px-5 py-2">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each payments as pay}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-5 py-2">{pay.nr_raty}</td>
						<td class="px-5 py-2">{pay.data_platnosci}</td>
						<td class="px-5 py-2 text-right font-medium">{fmtPln(pay.kwota)}</td>
						<td class="px-5 py-2">
							<Badge variant={pay.status === 'Opłacona' ? 'success' : pay.status === 'Zaległa' ? 'error' : 'neutral'}>{pay.status}</Badge>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{/if}
{/if}

<!-- Modal: Edytuj -->
{#if policy}
<Modal title="Edytuj Polisę — {policy.nr_polisy}" open={showEdit} onclose={() => { showEdit = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showEdit = false; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveEdit} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<PolicyForm bind:this={editForm} {policy} />
</Modal>

<!-- Modal: Aneks -->
<Modal title="Aneks do polisy {policy.nr_polisy}" open={showAnnex} onclose={() => { showAnnex = false; axError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showAnnex = false; axError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveAnnex} disabled={savingAx} class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-60">
			{savingAx ? 'Zapisywanie...' : 'Zapisz Aneks'}
		</button>
	{/snippet}
	{#if axError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{axError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Nr Aneksu *</label><input bind:value={axNr} class={inputCls} /></div>
			<div><label class={labelCls}>Data aneksu *</label><input type="date" bind:value={axData} class={inputCls} /></div>
		</div>
		<div>
			<label class={labelCls}>Typ aneksu</label>
			<div class="grid grid-cols-2 gap-2">
				{#each [['korekta','Korekta'],['doubezpieczenie','Doubezpieczenie'],['zmiana_zakresu','Zmiana zakresu'],['inne','Inne']] as [val, lbl]}
					<button type="button" onclick={() => axTyp = val as typeof axTyp}
						class="py-2 px-3 rounded-lg text-sm border text-left transition-colors
							{axTyp === val ? 'bg-blue-50 text-blue-700 border-blue-400' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">
						{lbl}
					</button>
				{/each}
			</div>
		</div>
		<div><label class={labelCls}>Opis</label><input bind:value={axOpis} class={inputCls} /></div>
		<hr class="border-slate-200" />
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Nowa Data Do</label><input type="date" bind:value={axNewDataDo} class={inputCls} /></div>
			<div><label class={labelCls}>Nowa Składka</label><input type="number" step="0.01" bind:value={axNewSkladka} class={inputCls} /></div>
			<div><label class={labelCls}>Delta Składki (+/-)</label><input type="number" step="0.01" bind:value={axDeltaSkladka} class={inputCls} /></div>
			<div><label class={labelCls}>Nowy % Prowizji</label><input type="number" step="0.01" bind:value={axNewProwizjaPct} class={inputCls} /></div>
		</div>
	</div>
</Modal>
{/if}

<!-- Modal: Podział prowizji -->
{#if policy}
<Modal title="Podział prowizji — {policy.nr_polisy}" open={showBrokers} onclose={() => { showBrokers = false; pbError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showBrokers = false; pbError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>
	{/snippet}

	{#if polisaBrokers.length > 0}
	<div class="mb-4 divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
		{#each polisaBrokers as pb}
			<div class="flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50">
				<div class="flex items-center gap-3">
					<Badge variant={rolaVariant[pb.rola]}>{rolaLabel[pb.rola]}</Badge>
					<span class="text-sm font-medium">{pb.crm_profiles?.imie_nazwisko ?? pb.crm_profiles?.email ?? '—'}</span>
				</div>
				<div class="flex items-center gap-4">
					{#if pb.rola !== 'opiekun'}
						<div class="text-right">
							<span class="text-sm font-semibold">{pb.udzial_pct}%</span>
							<span class="text-xs text-slate-400 ml-1">({fmtPln((policy.prowizja_przypisana ?? 0) * pb.udzial_pct / 100)})</span>
						</div>
					{:else}
						<span class="text-xs text-slate-400">bez prowizji</span>
					{/if}
					<button onclick={() => removeBroker(pb)} class="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
						<Trash2 size={13} />
					</button>
				</div>
			</div>
		{/each}
	</div>
	{/if}

	<p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Dodaj osobę</p>
	{#if pbError}<div class="mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pbError}</div>{/if}
	<div class="flex gap-2 items-end">
		<div class="flex-1">
			<label class="block text-xs font-medium text-slate-600 mb-1">Broker / Osoba</label>
			<select bind:value={pbBrokerId} class={inputCls}>
				<option value="">— wybierz —</option>
				{#each appState.brokers as b}
					<option value={b.id}>{b.imie_nazwisko ?? b.email}</option>
				{/each}
			</select>
		</div>
		<div class="w-36">
			<label class="block text-xs font-medium text-slate-600 mb-1">Rola</label>
			<select bind:value={pbRola} class={inputCls}>
				<option value="akwizycja">Akwizycja</option>
				<option value="obsługa">Obsługa</option>
				<option value="opiekun">Opiekun (bez prow.)</option>
			</select>
		</div>
		{#if pbRola !== 'opiekun'}
		<div class="w-24">
			<label class="block text-xs font-medium text-slate-600 mb-1">Udział %</label>
			<input type="number" min="0" max="100" step="1" bind:value={pbUdzial} class={inputCls} />
		</div>
		{/if}
		<button onclick={addBroker} disabled={savingPB} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60 shrink-0">
			{savingPB ? '...' : '+ Dodaj'}
		</button>
	</div>

	{#if polisaBrokers.filter(pb => pb.rola !== 'opiekun').length > 1}
		{@const suma = polisaBrokers.filter(pb => pb.rola !== 'opiekun').reduce((s, pb) => s + pb.udzial_pct, 0)}
		<div class="mt-3 text-xs {Math.abs(suma - 100) > 0.1 ? 'text-red-600 bg-red-50 border-red-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'} border rounded-lg px-3 py-2">
			Suma udziałów: <strong>{suma}%</strong>
			{#if Math.abs(suma - 100) > 0.1} ⚠️ nie sumuje się do 100%{:else} ✓{/if}
		</div>
	{/if}
</Modal>
{/if}
