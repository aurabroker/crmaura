<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import type { Policy } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import PolicyForm from '$lib/components/PolicyForm.svelte';
	import { Search, Pencil, FilePlus2, ChevronDown, ChevronRight, Plus, Shield } from 'lucide-svelte';
	import { goto } from '$app/navigation';

	let search = $state('');
	let expandedUG = $state(new Set<string>());
	let showEdit = $state(false);
	let editingPolicy = $state<Policy | null>(null);
	let editForm = $state<ReturnType<typeof PolicyForm> | null>(null);
	let saving = $state(false);
	let formError = $state('');

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

	async function reloadPolicies() {
		const [rP, rA] = await Promise.all([
			sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))').is('deleted_at', null),
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

	const totalSkladka = $derived(ugPolicies.reduce((sum, p) => sum + (p.skladka_przypisana ?? 0), 0));
	const activeCount = $derived(ugPolicies.filter(p => policyStatus(p.data_do).label === 'Aktywna').length);
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
<div class="grid grid-cols-3 gap-4 mb-6">
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">UG Gwarancji</div>
		<div class="text-2xl font-bold text-slate-900">{ugPolicies.length}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Aktywne</div>
		<div class="text-2xl font-bold text-emerald-600">{activeCount}</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
		<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Łączna składka</div>
		<div class="text-2xl font-bold text-violet-700">{fmtPln(totalSkladka)}</div>
	</div>
</div>

<!-- Search -->
<div class="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 mb-4">
	<Search size={15} class="text-slate-400" />
	<input bind:value={search} placeholder="Szukaj po nr polisy lub kliencie..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nr Polisy / UG</th>
				<th class="px-5 py-3">Klient</th>
				<th class="px-5 py-3">TU</th>
				<th class="px-5 py-3">OD</th>
				<th class="px-5 py-3">DO</th>
				<th class="px-5 py-3 text-right">Składka</th>
				<th class="px-5 py-3">Prowizja %</th>
				<th class="px-5 py-3">Status</th>
				<th class="px-5 py-3">Akcje</th>
			</tr>
		</thead>
		<tbody>
			{#each ugPolicies as p}
				{@const st = policyStatus(p.data_do)}
				{@const children = childrenOf(p.id)}
				{@const axs = annexesOf(p.id)}
				{@const expanded = expandedUG.has(p.id)}

				<tr class="border-t border-slate-100 hover:bg-violet-50/30 bg-violet-50/10">
					<td class="px-5 py-3">
						<div class="flex items-center gap-2">
							{#if children.length > 0}
								<button onclick={() => toggleUG(p.id)} class="text-slate-400 hover:text-violet-600">
									{#if expanded}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
								</button>
							{:else}
								<span class="w-[14px]"></span>
							{/if}
							<div>
								<a href="/policies/{p.id}" class="font-semibold text-violet-700 hover:underline">{p.nr_polisy}</a>
								{#if children.length > 0}
									<div class="text-[10px] text-violet-400">{children.length} pozycj{children.length === 1 ? 'a' : children.length < 5 ? 'e' : 'i'}</div>
								{/if}
								{#if axs.length > 0}
									<div class="text-[10px] text-amber-500">{axs.length} aneks{axs.length > 1 ? 'ów' : ''}</div>
								{/if}
							</div>
						</div>
					</td>
					<td class="px-5 py-3">
						<a href="/clients/{p.klient_id}" class="hover:text-violet-700 hover:underline">{p.crm_clients?.nazwa ?? '—'}</a>
					</td>
					<td class="px-5 py-3">
						{#if p.crm_insurers?.skrot}
							<span class="font-mono font-semibold text-blue-700" title={p.crm_insurers.nazwa}>{p.crm_insurers.skrot}</span>
						{:else}
							{p.crm_insurers?.nazwa ?? '—'}
						{/if}
					</td>
					<td class="px-5 py-3 text-xs">{p.data_od}</td>
					<td class="px-5 py-3 text-xs">{p.data_do}</td>
					<td class="px-5 py-3 text-right font-medium">{fmtPln(p.skladka_przypisana)}</td>
					<td class="px-5 py-3 text-xs">{p.prowizja_pct ?? p.ug_default_prowizja_pct ?? '—'}%</td>
					<td class="px-5 py-3">
						<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
					</td>
					<td class="px-5 py-3">
						<div class="flex items-center gap-1">
							<button onclick={() => { editingPolicy = p; formError = ''; showEdit = true; }} title="Edytuj" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
								<Pencil size={14} />
							</button>
							<button onclick={() => goto(`/policies/new?typ=jednostkowa&parent=${p.id}`)} title="Dodaj pozycję" class="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors">
								<FilePlus2 size={14} />
							</button>
						</div>
					</td>
				</tr>

				{#if expanded}
					{#each children as ch}
						{@const chSt = policyStatus(ch.data_do)}
						<tr class="border-t border-slate-100 bg-slate-50/60">
							<td class="pl-14 pr-5 py-2.5 text-sm">
								↳ <a href="/policies/{ch.id}" class="font-medium text-blue-700 hover:underline">{ch.nr_polisy}</a>
							</td>
							<td class="px-5 py-2.5 text-sm">
								<a href="/clients/{ch.klient_id}" class="hover:text-blue-700 hover:underline">{ch.crm_clients?.nazwa ?? '—'}</a>
							</td>
							<td class="px-5 py-2.5 text-sm">
								{#if ch.crm_insurers?.skrot}
									<span class="font-mono font-semibold text-blue-700">{ch.crm_insurers.skrot}</span>
								{:else}
									{ch.crm_insurers?.nazwa ?? '—'}
								{/if}
							</td>
							<td class="px-5 py-2.5 text-xs">{ch.data_od}</td>
							<td class="px-5 py-2.5 text-xs">{ch.data_do}</td>
							<td class="px-5 py-2.5 text-right">{fmtPln(ch.skladka_przypisana)}</td>
							<td class="px-5 py-2.5 text-xs">{ch.prowizja_pct ?? '—'}%</td>
							<td class="px-5 py-2.5">
								<Badge variant={chSt.badge === 'badge-error' ? 'error' : chSt.badge === 'badge-warning' ? 'warning' : 'success'}>{chSt.label}</Badge>
							</td>
							<td class="px-5 py-2.5">
								<button onclick={() => { editingPolicy = ch; formError = ''; showEdit = true; }} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
									<Pencil size={14} />
								</button>
							</td>
						</tr>
					{/each}
				{/if}
			{:else}
				<tr><td colspan="9" class="px-5 py-12 text-center text-slate-400">Brak umów generalnych gwarancji</td></tr>
			{/each}
		</tbody>
	</table>
</div>

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
