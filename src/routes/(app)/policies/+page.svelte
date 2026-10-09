<script lang="ts">
	import { wczytajAneksy, wczytajPolisy, wczytajSzkody } from '$lib/kolekcje';
	import { opiekunZUmowy } from '$lib/policyImport/umowaGeneralna';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, odmiana, policyStatus, rodzajCls, ugPodtypCls } from '$lib/utils';
	import type { Policy } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import PolicyForm from '$lib/components/PolicyForm.svelte';
	import {
		Search, Pencil, FilePlus2,
		Eye, ExternalLink, Copy, User, AlertTriangle, Trash2, Plus
	} from 'lucide-svelte';
	import { page } from '$app/stores';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { ctxMenu } from '$lib/actions/ctxMenu';
	import { ctxCopy, ctxToast, type CtxItem } from '$lib/stores/ctxmenu.svelte';
	import { logAudit } from '$lib/utils/audit';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';

	let search = $state('');
	let filterTyp = $state<'all' | 'jednostkowa' | 'generalna'>('all');
	let lockedTyp = $state(false);

	// Modals
	let showPolicy = $state(false);
	let showEdit = $state(false);
	let showAnnex = $state(false);
	let showClaim = $state(false);
	let editingPolicy = $state<Policy | null>(null);
	let annexingPolicy = $state<Policy | null>(null);

	// PolicyForm refs
	let newPolicyForm = $state<ReturnType<typeof PolicyForm> | null>(null);
	let editPolicyForm = $state<ReturnType<typeof PolicyForm> | null>(null);

	// Annex form
	let axNr = $state('');
	let axTyp = $state<'korekta' | 'doubezpieczenie' | 'zmiana_zakresu' | 'inne'>('korekta');
	let axData = $state('');
	let axOpis = $state('');
	let axDeltaSkladka = $state('0');
	let axDeltaProwizja = $state('0');
	let axNewDataDo = $state('');
	let axNewSkladka = $state('');
	let axNewProwizjaPct = $state('');

	// Claim form
	let fclKlient = $state('');
	let fclPolisa = $state('');
	let fclNr = $state('');
	let fclData = $state('');
	let fclOpis = $state('');

	let saving = $state(false);
	let formError = $state('');

	// Wszystkie polisy w jednej liście — Umowa Generalna jest tylko kolumną porządkową,
	// polisy podpięte pod UG są widoczne tak samo jak pozostałe.
	const widoczne = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return appState.policies
			.filter((p) => filterTyp === 'all' || p.typ_umowy === filterTyp)
			.filter((p) =>
				!q ||
				p.nr_polisy.toLowerCase().includes(q) ||
				(p.crm_clients?.nazwa ?? '').toLowerCase().includes(q) ||
				(p.parent_id ? parentNr(p.parent_id).toLowerCase().includes(q) : false)
			);
	});

	// O(1) lookup map instead of O(n) find per row
	const parentNrMap = $derived(new Map(appState.policies.map(p => [p.id, p.nr_polisy])));
	function parentNr(parentId: string | null): string {
		return parentId ? (parentNrMap.get(parentId) ?? '—') : '—';
	}
	const liczbaWUg = $derived.by(() => {
		const m = new Map<string, number>();
		for (const p of appState.policies) if (p.parent_id) m.set(p.parent_id, (m.get(p.parent_id) ?? 0) + 1);
		return m;
	});

	const sort = new Sortowanie<Policy>({
		nr: (p) => p.nr_polisy,
		klient: (p) => p.crm_clients?.nazwa,
		tu: (p) => p.crm_insurers?.skrot || p.crm_insurers?.nazwa,
		rodzaj: (p) => (p.typ_umowy === 'generalna' ? `UG ${p.ug_podtyp ?? ''}` : p.rodzaj),
		ug: (p) => (p.parent_id ? parentNr(p.parent_id) : null),
		od: (p) => p.data_od,
		do: (p) => p.data_do,
		skladka: (p) => Number(p.skladka_przypisana ?? 0),
		status: (p) => p.data_do
	}, { klucz: 'nr' }, 'polisy');
	const wiersze = $derived(sort.sortuj(widoczne));

	function annexesOf(id: string) {
		return appState.annexes.filter((a) => a.polisa_id === id);
	}

	async function reloadPolicies() {
		const [rP, rA] = await Promise.all([
			wczytajPolisy(),
			wczytajAneksy()
		]);
		// Przy błędzie zostaje dotychczasowa lista (pusta lista wyglądałaby jak brak polis).
		if (!rP.error && rP.data) appState.policies = rP.data as typeof appState.policies;
		if (!rA.error && rA.data) appState.annexes = rA.data as typeof appState.annexes;
	}

	async function saveNewPolicy() {
		if (!newPolicyForm) return;
		const err = newPolicyForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals: Record<string, unknown> = newPolicyForm.getValues();
		// Polisa w Umowie Generalnej: opiekun TU domyślnie ten sam co na umowie.
		const opiekun = opiekunZUmowy(appState.policies, vals.parent_id as string | null, vals.tu_id as string | null);
		if (opiekun && !vals.tu_contact_id) vals.tu_contact_id = opiekun;
		const { error } = await sb.from('crm_policies').insert([{ tenant_id: appState.profile!.tenant_id, ...vals }]);
		saving = false;
		if (error) { formError = error.message; return; }
		showPolicy = false;
		await reloadPolicies();
	}

	async function saveEditPolicy() {
		if (!editPolicyForm || !editingPolicy) return;
		const err = editPolicyForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals: Record<string, unknown> = editPolicyForm.getValues();
		// Polisa bez opiekuna TU podpinana właśnie pod Umowę Generalną: opiekun domyślnie z umowy.
		if (!editingPolicy.tu_contact_id && editingPolicy.typ_umowy !== 'generalna' && vals.parent_id && vals.parent_id !== editingPolicy.parent_id) {
			const opiekun = opiekunZUmowy(appState.policies, vals.parent_id as string | null, vals.tu_id as string | null);
			if (opiekun) vals.tu_contact_id = opiekun;
		}
		const { error } = await sb.from('crm_policies').update(vals).eq('id', editingPolicy.id);
		saving = false;
		if (error) { formError = error.message; return; }
		showEdit = false; editingPolicy = null;
		await reloadPolicies();
	}

	async function saveAnnex() {
		if (!annexingPolicy) return;
		if (!axNr.trim() || !axData) { formError = 'Podaj nr aneksu i datę.'; return; }
		saving = true; formError = '';

		const payload: Record<string, unknown> = {
			tenant_id: appState.profile!.tenant_id,
			polisa_id: annexingPolicy.id,
			nr_aneksu: axNr.trim(),
			typ: axTyp,
			data_aneksu: axData,
			opis: axOpis || null,
			delta_skladka: parseFloat(axDeltaSkladka) || 0,
			delta_prowizja: parseFloat(axDeltaProwizja) || 0,
			new_data_do: axNewDataDo || null,
			new_skladka_przypisana: axNewSkladka ? parseFloat(axNewSkladka) : null,
			new_prowizja_pct: axNewProwizjaPct ? parseFloat(axNewProwizjaPct) : null
		};

		const { error: axErr } = await sb.from('crm_policy_annexes').insert([payload]);

		// Jeśli korekta — aktualizuj dane polisy matki
		if (!axErr && axTyp === 'korekta') {
			const updates: Record<string, unknown> = {};
			if (axNewDataDo) updates.data_do = axNewDataDo;
			if (axNewSkladka) updates.skladka_przypisana = parseFloat(axNewSkladka);
			if (axNewProwizjaPct) updates.prowizja_pct = parseFloat(axNewProwizjaPct);
			if (Object.keys(updates).length) {
				await sb.from('crm_policies').update(updates).eq('id', annexingPolicy.id);
			}
		}

		saving = false;
		if (axErr) { formError = axErr.message; return; }
		showAnnex = false; annexingPolicy = null;
		resetAnnexForm();
		await reloadPolicies();
	}

	async function saveClaim() {
		if (!fclKlient || !fclData) { formError = 'Wybierz klienta i datę szkody.'; return; }
		saving = true; formError = '';
		const pol = fclPolisa ? appState.policies.find((p) => p.id === fclPolisa) : null;
		const { error } = await sb.from('crm_claims').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: fclKlient, polisa_id: fclPolisa || null, tu_id: pol?.tu_id ?? null,
			nr_szkody: fclNr || null, data_szkody: fclData, opis_szkody: fclOpis || null, status: 'Zgłoszona'
		}]);
		saving = false;
		if (error) { formError = error.message; return; }
		showClaim = false;
		const { data } = await wczytajSzkody();
		appState.claims = (data ?? []) as typeof appState.claims;
	}

	function openEdit(p: Policy) {
		editingPolicy = p; formError = ''; showEdit = true;
	}

	function openAnnex(p: Policy) {
		annexingPolicy = p; formError = ''; showAnnex = true;
	}

	function resetAnnexForm() {
		axNr = ''; axTyp = 'korekta'; axData = ''; axOpis = '';
		axDeltaSkladka = '0'; axDeltaProwizja = '0';
		axNewDataDo = ''; axNewSkladka = ''; axNewProwizjaPct = '';
	}

	const ugLabel: Record<string, string> = {
		flota: 'Flota', gwarancje: 'Gwarancje', cpm: 'CPM', car_ear: 'CAR/EAR'
	};

	// Preset typ_umowy/ug_podtyp for new policy form
	let presetTyp = $state<'jednostkowa' | 'generalna'>('jednostkowa');
	let presetUgPodtyp = $state('');

	function openNewPolicy(typ: 'jednostkowa' | 'generalna' = 'jednostkowa', ugPodtyp = '') {
		presetTyp = typ;
		presetUgPodtyp = ugPodtyp;
		formError = '';
		if (typ === 'generalna') {
			goto(ugPodtyp ? `/policies/new-ug?podtyp=${ugPodtyp}` : '/policies/new-ug');
		} else {
			showPolicy = true;
		}
	}

	onMount(() => {
		const p = $page.url.searchParams;
		if (p.get('new') === '1') openNewPolicy();
		if (p.get('newguarantee') === '1') openNewPolicy('generalna', 'gwarancje');
	});

	// Tryb z adresu (?typ=generalna — menu „Umowy Generalne”, bez parametru — „Polisy”): przy każdej
	// zmianie adresu, bo przejście między tymi pozycjami menu nie tworzy strony od nowa.
	$effect(() => {
		const typ = $page.url.searchParams.get('typ');
		if (typ === 'generalna' || typ === 'jednostkowa') { filterTyp = typ; lockedTyp = true; }
		else if (untrack(() => lockedTyp)) { filterTyp = 'all'; lockedTyp = false; }
	});

	// --- Menu kontekstowe (prawy przycisk na wierszu) ---
	function openClaimFor(p: Policy) {
		fclKlient = p.klient_id;
		fclPolisa = p.id;
		fclNr = ''; fclData = ''; fclOpis = '';
		formError = '';
		showClaim = true;
	}

	// --- Usuwanie (soft delete, wymaga uzasadnienia) ---
	let deleteTarget = $state<Policy | null>(null);
	let deletionReason = $state('');
	let deleting = $state(false);
	let deleteError = $state('');

	async function softDeletePolicy() {
		if (!deleteTarget) return;
		if (!deletionReason.trim()) { deleteError = 'Podaj uzasadnienie usunięcia.'; return; }
		deleting = true; deleteError = '';
		const target = deleteTarget;
		const { error } = await sb.from('crm_policies')
			.update({ deleted_at: new Date().toISOString(), deletion_reason: deletionReason.trim() })
			.eq('id', target.id);
		deleting = false;
		if (error) { deleteError = error.message; return; }
		await logAudit('policy_deleted', 'policy', target.id, target.nr_polisy, { reason: deletionReason.trim() });
		appState.policies = appState.policies.filter((p) => p.id !== target.id);
		deleteTarget = null;
		ctxToast(`Polisa ${target.nr_polisy} przeniesiona do kosza`);
	}

	function policyMenu(p: Policy): CtxItem[] {
		const isUG = p.typ_umowy === 'generalna';
		return [
			{ label: 'Otwórz polisę', icon: Eye, onSelect: () => goto(`/policies/${p.id}`) },
			{
				label: 'Otwórz w nowej karcie',
				icon: ExternalLink,
				onSelect: () => window.open(`/policies/${p.id}`, '_blank', 'noopener')
			},
			{ separator: true },
			{ label: 'Edytuj', icon: Pencil, onSelect: () => goto(`/policies/${p.id}/edit`) },
			{ label: 'Dodaj aneks', icon: FilePlus2, onSelect: () => openAnnex(p) },
			...(isUG
				? [{
						label: 'Dodaj polisę pod tę UG',
						icon: Plus,
						onSelect: () => goto(`/policies/new?parent_id=${p.id}`)
					} as CtxItem]
				: []),
			{ label: 'Zgłoś szkodę', icon: AlertTriangle, onSelect: () => openClaimFor(p) },
			{ separator: true },
			{
				label: 'Karta klienta',
				icon: User,
				disabled: !p.klient_id,
				onSelect: () => goto(`/clients/${p.klient_id}`)
			},
			{
				label: 'Kopiuj nr polisy',
				icon: Copy,
				onSelect: () => ctxCopy(p.nr_polisy, 'nr polisy')
			},
			{ separator: true },
			{
				label: 'Przenieś do kosza',
				icon: Trash2,
				danger: true,
				onSelect: () => { deleteTarget = p; deletionReason = ''; deleteError = ''; }
			}
		];
	}

	const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>{lockedTyp && filterTyp === 'generalna' ? 'Umowy Generalne' : 'Polisy'} — AuraCRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">{lockedTyp && filterTyp === 'generalna' ? 'Umowy Generalne' : 'Polisy w obsłudze'}</h1>
		<p class="text-sm text-slate-500 mt-1">{lockedTyp && filterTyp === 'generalna' ? 'Rejestr umów generalnych' : 'Rejestr ubezpieczeń całego portfela'}</p>
	</div>
	<div class="flex gap-2">
		<button onclick={() => { showClaim = true; formError = ''; }} class="border border-line text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
			Zgłoś Szkodę
		</button>
		{#if lockedTyp && filterTyp === 'generalna'}
			<button onclick={() => goto('/policies/new-ug')} class="bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors">
				+ Nowa Umowa Generalna
			</button>
		{:else}
			<button onclick={() => goto('/policies/new')} class="bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors">
				+ Nowa Polisa
			</button>
		{/if}
	</div>
</div>

<!-- Filters -->
<div class="flex gap-3 mb-4 flex-wrap">
	<div class="flex items-center gap-2 flex-1 bg-white border border-line rounded-xl px-4 py-2">
		<Search size={15} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po nr polisy lub kliencie..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
	</div>
	{#if !lockedTyp}
		{#each [['all','Wszystkie'],['jednostkowa','Polisy'],['generalna','Umowy Generalne']] as [val, label]}
			<button
				onclick={() => filterTyp = val as typeof filterTyp}
				class="px-4 py-2 rounded-xl text-sm font-medium border transition-colors
					{filterTyp === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-line hover:bg-slate-50'}"
			>
				{label}
			</button>
		{/each}
	{/if}
</div>

<div class="bg-white border border-line rounded-xl shadow-sm overflow-x-auto">
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
				<SortTh s={sort} k="nr">Nr Polisy</SortTh>
				<SortTh s={sort} k="klient">Klient</SortTh>
				<SortTh s={sort} k="tu">TU</SortTh>
				<SortTh s={sort} k="rodzaj">Rodzaj / Typ</SortTh>
				<SortTh s={sort} k="ug">UG</SortTh>
				<SortTh s={sort} k="od">OD</SortTh>
				<SortTh s={sort} k="do">DO</SortTh>
				<SortTh s={sort} k="skladka" class="px-5 py-3 text-right" align="right">Składka</SortTh>
				<SortTh s={sort} k="status">Status</SortTh>
				<th class="px-5 py-3">Akcje</th>
			</tr>
		</thead>
		<tbody>
			{#each wiersze as p (p.id)}
				{@const st = policyStatus(p.data_do)}
				{@const isUG = p.typ_umowy === 'generalna'}
				{@const axs = annexesOf(p.id)}
				<tr use:ctxMenu={{ items: () => policyMenu(p), title: p.nr_polisy }}
					class="border-t border-line-soft hover:bg-slate-50 {isUG ? 'bg-blue-50/30' : ''}">
					<td class="px-5 py-3">
						<a href="/policies/{p.id}" class="font-medium text-blue-700 hover:underline">{p.nr_polisy}</a>
						{#if axs.length > 0}
							<div class="text-xs text-blue-500">{odmiana(axs.length, 'aneks', 'aneksy', 'aneksów')}</div>
						{/if}
					</td>
					<td class="px-5 py-3">
						<a href="/clients/{p.klient_id}" class="hover:text-blue-700 hover:underline">{p.crm_clients?.nazwa ?? '—'}</a>
					</td>
					<td class="px-5 py-3">
						{#if p.crm_insurers?.skrot}
							<span class="font-mono font-semibold text-blue-700" title={p.crm_insurers.nazwa}>{p.crm_insurers.skrot}</span>
						{:else}
							{p.crm_insurers?.nazwa ?? '—'}
						{/if}
					</td>
					<td class="px-5 py-3">
						{#if isUG}
							<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold {ugPodtypCls(p.ug_podtyp ?? '')}">UG: {ugLabel[p.ug_podtyp ?? ''] ?? p.ug_podtyp}</span>
						{:else}
							<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold {rodzajCls(p.rodzaj)}">{p.rodzaj}</span>
						{/if}
					</td>
					<td class="px-5 py-3 text-xs font-mono text-slate-500">
						{#if p.parent_id}
							<a href="/policies/{p.parent_id}" class="hover:text-blue-700 hover:underline">{parentNr(p.parent_id)}</a>
						{:else if isUG}
							<span class="font-sans text-slate-400">{odmiana(liczbaWUg.get(p.id) ?? 0, 'polisa', 'polisy', 'polis')}</span>
						{:else}
							—
						{/if}
					</td>
					<td class="px-5 py-3 text-xs">{p.data_od}</td>
					<td class="px-5 py-3 text-xs">{p.data_do}</td>
					<td class="px-5 py-3 text-right font-medium">{fmtPln(p.skladka_przypisana)}</td>
					<td class="px-5 py-3">
						<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
					</td>
					<td class="px-5 py-3">
						<div class="flex items-center gap-1">
							<a href="/policies/{p.id}/edit" title="Edytuj" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
								<Pencil size={14} />
							</a>
							<button onclick={() => openAnnex(p)} title="Dodaj aneks" class="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
								<FilePlus2 size={14} />
							</button>
						</div>
					</td>
				</tr>
			{:else}
				<tr><td colspan="10" class="px-5 py-8 text-center text-slate-400">Brak polis</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<!-- Modal: Nowa Polisa -->
<Modal title="Nowa Polisa" open={showPolicy} onclose={() => { showPolicy = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showPolicy = false; formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveNewPolicy} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<PolicyForm bind:this={newPolicyForm} policy={{ typ_umowy: presetTyp, ug_podtyp: presetUgPodtyp } as any} />
</Modal>

<!-- Modal: Edytuj Polisę -->
{#if editingPolicy}
<Modal title="Edytuj Polisę — {editingPolicy.nr_polisy}" open={showEdit} onclose={() => { showEdit = false; editingPolicy = null; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showEdit = false; editingPolicy = null; formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveEditPolicy} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<PolicyForm bind:this={editPolicyForm} policy={editingPolicy} />
</Modal>
{/if}

<!-- Modal: Aneks -->
{#if annexingPolicy}
<Modal title="Aneks do polisy {annexingPolicy.nr_polisy}" open={showAnnex} onclose={() => { showAnnex = false; annexingPolicy = null; resetAnnexForm(); formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showAnnex = false; annexingPolicy = null; resetAnnexForm(); formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveAnnex} disabled={saving} class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz Aneks'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Nr Aneksu *</label>
				<input bind:value={axNr} class={inputCls} placeholder="np. 01, A-2025" />
			</div>
			<div>
				<label class={labelCls}>Data aneksu *</label>
				<input type="date" bind:value={axData} class={inputCls} />
			</div>
		</div>
		<div>
			<label class={labelCls}>Typ aneksu</label>
			<div class="grid grid-cols-2 gap-2">
				{#each [['korekta','Korekta danych / warunków'],['doubezpieczenie','Doubezpieczenie (mid-term)'],['zmiana_zakresu','Zmiana zakresu'],['inne','Inne']] as [val, label]}
					<button
						type="button"
						onclick={() => axTyp = val as typeof axTyp}
						class="py-2 px-3 rounded-lg text-sm border text-left transition-colors
							{axTyp === val ? 'bg-blue-50 text-blue-700 border-blue-400' : 'bg-white text-slate-600 border-line hover:bg-slate-50'}"
					>{label}</button>
				{/each}
			</div>
		</div>
		<div>
			<label class={labelCls}>Opis zmiany</label>
			<input bind:value={axOpis} class={inputCls} placeholder="Krótki opis..." />
		</div>
		<hr class="border-line" />
		<p class="text-xs font-semibold text-blue-600 uppercase tracking-wide">Wartości po zmianie (zostaw puste = bez zmiany)</p>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Nowa Data Do</label>
				<input type="date" bind:value={axNewDataDo} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Nowa Składka Przypisana</label>
				<input type="number" step="0.01" bind:value={axNewSkladka} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Delta Składki (+/-)</label>
				<input type="number" step="0.01" bind:value={axDeltaSkladka} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Nowy % Prowizji</label>
				<input type="number" step="0.01" bind:value={axNewProwizjaPct} class={inputCls} />
			</div>
		</div>
		{#if axTyp === 'korekta'}
			<p class="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
				Aneks <strong>Korekta</strong> automatycznie zaktualizuje dane polisy matki po zapisaniu.
			</p>
		{/if}
	</div>
</Modal>
{/if}

<!-- Modal: Szkoda -->
<Modal title="Rejestracja Szkody" open={showClaim} onclose={() => { showClaim = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showClaim = false; formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveClaim} disabled={saving} class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zgłoś Szkodę'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Klient *</label>
				<select bind:value={fclKlient} class={inputCls}>
					<option value="">— wybierz klienta —</option>
					{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Z polisy</label>
				<select bind:value={fclPolisa} class={inputCls}>
					<option value="">— opcjonalnie —</option>
					{#each appState.policies as p}<option value={p.id}>{p.nr_polisy}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Nr Szkody w TU</label>
				<input bind:value={fclNr} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Data szkody *</label>
				<input type="date" bind:value={fclData} class={inputCls} />
			</div>
		</div>
		<div>
			<label class={labelCls}>Opis zdarzenia</label>
			<input bind:value={fclOpis} placeholder="Krótki opis..." class={inputCls} />
		</div>
	</div>
</Modal>

<!-- Modal: Usuń polisę (z menu kontekstowego) -->
{#if deleteTarget}
<Modal title="Usuń polisę — {deleteTarget.nr_polisy}" open={!!deleteTarget} onclose={() => deleteTarget = null}>
	{#snippet footer()}
		<button onclick={() => deleteTarget = null} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={softDeletePolicy} disabled={deleting} class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-60">
			{deleting ? 'Usuwanie...' : 'Przenieś do kosza'}
		</button>
	{/snippet}
	{#if deleteError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{deleteError}</div>{/if}
	<p class="text-sm text-slate-500 mb-3">Polisa trafi do Kosza — można ją przywrócić.</p>
	<label class={labelCls}>Uzasadnienie *</label>
	<input bind:value={deletionReason} placeholder="Powód usunięcia..." class={inputCls} />
</Modal>
{/if}
