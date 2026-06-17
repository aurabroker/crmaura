<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import type { Policy } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import PolicyForm from '$lib/components/PolicyForm.svelte';
	import GwarancjaForm from '$lib/components/GwarancjaForm.svelte';
	import { Search, Pencil, FilePlus2, ChevronDown, ChevronRight, Plus, Shield } from 'lucide-svelte';
	import { goto } from '$app/navigation';

	let search = $state('');
	let expandedUG = $state(new Set<string>());
	let showEdit = $state(false);
	let editingPolicy = $state<Policy | null>(null);
	let editForm = $state<ReturnType<typeof PolicyForm> | null>(null);
	let saving = $state(false);
	let formError = $state('');

	// --- Add guarantee modal ---
	let showAddGwarancja = $state(false);
	let addGwarancjaParent = $state<Policy | null>(null);
	let gwarancjaForm = $state<ReturnType<typeof GwarancjaForm> | null>(null);
	let savingGwarancja = $state(false);
	let gwarancjaError = $state('');

	const ugPolicies = $derived(
		appState.policies
			.filter(p => p.typ_umowy === 'generalna' && p.ug_podtyp === 'gwarancje' && !p.deleted_at)
			.filter(p =>
				!search ||
				p.nr_polisy.toLowerCase().includes(search.toLowerCase()) ||
				(p.crm_clients?.nazwa ?? '').toLowerCase().includes(search.toLowerCase())
			)
			.sort((a, b) => a.nr_polisy.localeCompare(b.nr_polisy))
	);

	function childrenOf(id: string) {
		return appState.policies.filter(p => p.parent_id === id && !p.deleted_at);
	}

	function annexesOf(id: string) {
		return appState.annexes.filter(a => a.polisa_id === id);
	}

	function toggleUG(id: string) {
		const s = new Set(expandedUG);
		if (s.has(id)) s.delete(id); else s.add(id);
		expandedUG = s;
	}

	function usedLimit(ugId: string): number {
		return childrenOf(ugId).reduce((sum, ch) => sum + Number(ch.skladka_przypisana ?? 0), 0);
	}

	function freeLimit(ug: Policy): number {
		return (ug.ug_limit ?? 0) - usedLimit(ug.id);
	}

	function daysElapsed(dataOd: string): number {
		return Math.max(0, Math.round((Date.now() - new Date(dataOd).getTime()) / 86400000));
	}

	function daysTotal(dataOd: string, dataDo: string): number {
		return Math.max(1, Math.round((new Date(dataDo).getTime() - new Date(dataOd).getTime()) / 86400000));
	}

	function pctElapsed(dataOd: string, dataDo: string): number {
		const total = daysTotal(dataOd, dataDo);
		const elapsed = daysElapsed(dataOd);
		return Math.min(100, Math.round((elapsed / total) * 100));
	}

	function limitPct(ug: Policy, child: Policy): number {
		if (!ug.ug_limit || ug.ug_limit <= 0) return 0;
		return Math.min(100, Math.round((Number(child.skladka_przypisana ?? 0) / ug.ug_limit) * 100));
	}

	async function reloadPolicies() {
		const [rP, rA] = await Promise.all([
			sb.from('crm_policies').select('*, crm_clients!klient_id(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))').is('deleted_at', null),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu')
		]);
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rA.data ?? []) as typeof appState.annexes;
	}

	async function saveEdit() {
		if (!editForm || !editingPolicy) return;
		const err = editForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals = editForm.getValues();
		const { error } = await sb.from('crm_policies').update(vals).eq('id', editingPolicy.id);
		saving = false;
		if (error) { formError = error.message; return; }
		showEdit = false; editingPolicy = null;
		await reloadPolicies();
	}

	function openAddGwarancja(ug: Policy) {
		addGwarancjaParent = ug;
		gwarancjaError = '';
		showAddGwarancja = true;
	}

	async function saveGwarancja() {
		if (!gwarancjaForm || !addGwarancjaParent) return;
		const err = gwarancjaForm.isValid();
		if (err) { gwarancjaError = err; return; }
		savingGwarancja = true; gwarancjaError = '';
		const vals = gwarancjaForm.getValues();
		const { error } = await sb.from('crm_policies').insert([{
			tenant_id: appState.profile!.tenant_id,
			...vals
		}]);
		savingGwarancja = false;
		if (error) { gwarancjaError = error.message; return; }
		showAddGwarancja = false;
		addGwarancjaParent = null;
		await reloadPolicies();
	}

	const totalSkladka = $derived(ugPolicies.reduce((sum, p) => sum + (p.skladka_przypisana ?? 0), 0));
	const totalLimit = $derived(ugPolicies.reduce((sum, p) => sum + (p.ug_limit ?? 0), 0));
	const activeCount = $derived(ugPolicies.filter(p => policyStatus(p.data_do).label === 'Aktywna').length);

	const TYPY_LABELS: Record<string, string> = {
		wadialna: 'Wadialna',
		nalezytego_wykonania: 'Należytego wykonania',
		usuniecia_wad: 'Usunięcia wad',
		zwrotu_zaliczki: 'Zwrotu zaliczki'
	};
</script>

<svelte:head><title>Gwarancje — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900 flex items-center gap-2">
			<Shield size={22} class="text-violet-500" /> Gwarancje ubezpieczeniowe
		</h1>
		<p class="text-sm text-slate-500 mt-1">Umowy generalne gwarancji z pozycjami</p>
	</div>
	<button
		onclick={() => goto('/bonds/new')}
		class="bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors flex items-center gap-2"
	>
		<Plus size={15} /> Nowa UG Gwarancji
	</button>
</div>

<!-- KPI strip -->
<div class="grid grid-cols-4 gap-4 mb-6">
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">UG Gwarancji</div>
		<div class="text-2xl font-bold text-slate-900">{ugPolicies.length}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Aktywne</div>
		<div class="text-2xl font-bold text-emerald-600">{activeCount}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Łączny limit</div>
		<div class="text-2xl font-bold text-violet-700">{fmtPln(totalLimit)}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Łączna składka</div>
		<div class="text-2xl font-bold text-slate-700">{fmtPln(totalSkladka)}</div>
	</div>
</div>

<!-- Search -->
<div class="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 mb-4">
	<Search size={15} class="text-slate-400" />
	<input bind:value={search} placeholder="Szukaj po nr polisy lub kliencie..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
</div>

<div class="space-y-4">
{#each ugPolicies as p}
	{@const st = policyStatus(p.data_do)}
	{@const children = childrenOf(p.id)}
	{@const axs = annexesOf(p.id)}
	{@const expanded = expandedUG.has(p.id)}
	{@const used = usedLimit(p.id)}
	{@const free = freeLimit(p)}
	{@const limitDefined = (p.ug_limit ?? 0) > 0}
	{@const usedPct = limitDefined ? Math.min(100, Math.round((used / (p.ug_limit ?? 1)) * 100)) : 0}

	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<!-- UG Header -->
		<div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-violet-50/30">
			<div class="flex items-center gap-3">
				{#if children.length > 0}
					<button onclick={() => toggleUG(p.id)} class="text-slate-400 hover:text-violet-600">
						{#if expanded}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}
					</button>
				{:else}
					<span class="w-4"></span>
				{/if}
				<div>
					<a href="/policies/{p.id}" class="font-bold text-violet-700 hover:underline text-base">{p.nr_polisy}</a>
					<div class="flex items-center gap-3 mt-0.5">
						<span class="text-sm text-slate-600">{p.crm_clients?.nazwa ?? '—'}</span>
						<span class="text-xs text-slate-400">|</span>
						{#if p.crm_insurers?.skrot}
							<span class="font-mono text-xs font-semibold text-blue-700">{p.crm_insurers.skrot}</span>
						{:else}
							<span class="text-xs text-slate-400">{p.crm_insurers?.nazwa ?? '—'}</span>
						{/if}
						<span class="text-xs text-slate-400">{p.data_od} — {p.data_do}</span>
						{#if axs.length > 0}
							<span class="text-[10px] text-amber-600">{axs.length} aneks{axs.length > 1 ? 'ów' : ''}</span>
						{/if}
					</div>
				</div>
			</div>
			<div class="flex items-center gap-4">
				<!-- Limit display -->
				{#if limitDefined}
					<div class="text-right">
						<div class="text-xs text-slate-500 mb-0.5">Wolny limit</div>
						<div class="text-sm font-bold {free >= 0 ? 'text-emerald-600' : 'text-red-600'}">{fmtPln(free)} PLN</div>
						<div class="w-32 bg-slate-200 rounded-full h-1.5 mt-1">
							<div class="h-1.5 rounded-full {usedPct > 90 ? 'bg-red-500' : usedPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}" style="width:{usedPct}%"></div>
						</div>
						<div class="text-[10px] text-slate-400 mt-0.5">{usedPct}% wykorzystany ({fmtPln(used)} / {fmtPln(p.ug_limit ?? 0)} PLN)</div>
					</div>
				{/if}
				<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
				<div class="flex items-center gap-1">
					<button onclick={() => { editingPolicy = p; formError = ''; showEdit = true; }} title="Edytuj UG" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
						<Pencil size={14} />
					</button>
					<button onclick={() => openAddGwarancja(p)} title="Dodaj gwarancję" class="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50">
						<FilePlus2 size={14} />
					</button>
				</div>
			</div>
		</div>

		<!-- Children -->
		{#if expanded && children.length > 0}
			<div class="divide-y divide-slate-100">
				{#each children as ch}
					{@const chSt = policyStatus(ch.data_do)}
					{@const elapsed = daysElapsed(ch.data_od)}
					{@const total = daysTotal(ch.data_od, ch.data_do)}
					{@const timePct = pctElapsed(ch.data_od, ch.data_do)}
					{@const lPct = limitPct(p, ch)}
					<div class="px-5 py-3 bg-slate-50/50 hover:bg-slate-50">
						<div class="flex items-start justify-between gap-4">
							<div class="flex items-start gap-3">
								<span class="text-slate-300 mt-0.5">↳</span>
								<div>
									<div class="flex items-center gap-2">
										<a href="/policies/{ch.id}" class="font-medium text-blue-700 hover:underline text-sm">{ch.nr_polisy}</a>
										{#if ch.gwarancja_typ}
											<span class="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">{TYPY_LABELS[ch.gwarancja_typ] ?? ch.gwarancja_typ}</span>
										{/if}
										{#if ch.gwarancja_stawka_pct}
											<span class="text-[10px] text-slate-500">stawka: {ch.gwarancja_stawka_pct}%</span>
										{/if}
									</div>
									{#if ch.gwarancja_kontrakt}
										<div class="text-xs text-slate-500 mt-0.5">Kontrakt: {ch.gwarancja_kontrakt}</div>
									{/if}
									{#if ch.gwarancja_beneficjent_nazwa}
										<div class="text-xs text-slate-500">Beneficjent: {ch.gwarancja_beneficjent_nazwa}{ch.gwarancja_beneficjent_nip ? ` (NIP: ${ch.gwarancja_beneficjent_nip})` : ''}</div>
									{/if}
									<div class="text-xs text-slate-400 mt-0.5">{ch.data_od} — {ch.data_do}</div>
								</div>
							</div>
							<div class="flex items-center gap-6 shrink-0">
								<!-- Suma gwarancyjna -->
								<div class="text-right">
									<div class="text-xs text-slate-400">Suma gwarancyjna</div>
									<div class="text-sm font-semibold text-slate-800">{fmtPln(ch.skladka_przypisana)} PLN</div>
									{#if limitDefined}
										<div class="text-[10px] text-violet-600">{lPct}% limitu UG</div>
									{/if}
								</div>
								<!-- Licznik czasu -->
								<div class="text-right min-w-[80px]">
									<div class="text-xs text-slate-400 mb-1">Upłynęło</div>
									<div class="w-20 bg-slate-200 rounded-full h-1.5">
										<div class="h-1.5 rounded-full {timePct > 90 ? 'bg-red-500' : timePct > 70 ? 'bg-amber-500' : 'bg-blue-500'}" style="width:{timePct}%"></div>
									</div>
									<div class="text-[10px] text-slate-500 mt-0.5">{timePct}% ({elapsed}/{total} dni)</div>
								</div>
								<div class="flex items-center gap-2">
									<Badge variant={chSt.badge === 'badge-error' ? 'error' : chSt.badge === 'badge-warning' ? 'warning' : 'success'}>{chSt.label}</Badge>
									<button onclick={() => { editingPolicy = ch; formError = ''; showEdit = true; }} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
										<Pencil size={14} />
									</button>
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if children.length === 0}
			<div class="px-5 py-3 text-sm text-slate-400 italic">Brak wystawionych gwarancji — kliknij <FilePlus2 size={12} class="inline" /> aby dodać.</div>
		{/if}
	</div>
{:else}
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-slate-400">Brak umów generalnych gwarancji</div>
{/each}
</div>

<!-- Modal: Dodaj gwarancję -->
{#if addGwarancjaParent}
<Modal title="Nowa gwarancja — {addGwarancjaParent.nr_polisy}" open={showAddGwarancja} onclose={() => { showAddGwarancja = false; addGwarancjaParent = null; }}>
	{#snippet footer()}
		<button onclick={() => { showAddGwarancja = false; addGwarancjaParent = null; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveGwarancja} disabled={savingGwarancja} class="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-60">
			{savingGwarancja ? 'Zapisywanie...' : 'Wystaw gwarancję'}
		</button>
	{/snippet}
	{#if gwarancjaError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{gwarancjaError}</div>{/if}
	<GwarancjaForm bind:this={gwarancjaForm} parentUg={addGwarancjaParent} />
</Modal>
{/if}

<!-- Modal: Edytuj -->
{#if editingPolicy}
<Modal title="Edytuj — {editingPolicy.nr_polisy}" open={showEdit} onclose={() => { showEdit = false; editingPolicy = null; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showEdit = false; editingPolicy = null; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveEdit} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<PolicyForm bind:this={editForm} policy={editingPolicy} />
</Modal>
{/if}
