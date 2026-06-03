<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import type { Policy } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import PolicyForm from '$lib/components/PolicyForm.svelte';
	import { Search, Pencil, FilePlus2, ChevronDown, ChevronRight } from 'lucide-svelte';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let search = $state('');
	let filterTyp = $state<'all' | 'jednostkowa' | 'generalna'>('all');

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

	// Expanded UG rows
	let expandedUG = $state(new Set<string>());

	const toplevelPolicies = $derived(
		appState.policies
			.filter((p) => !p.parent_id)
			.filter((p) => filterTyp === 'all' || p.typ_umowy === filterTyp)
			.filter((p) =>
				!search ||
				p.nr_polisy.toLowerCase().includes(search.toLowerCase()) ||
				(p.crm_clients?.nazwa ?? '').toLowerCase().includes(search.toLowerCase())
			)
	);

	function childrenOf(id: string) {
		return appState.policies.filter((p) => p.parent_id === id);
	}

	function annexesOf(id: string) {
		return appState.annexes.filter((a) => a.polisa_id === id);
	}

	async function reloadPolicies() {
		const [rP, rA] = await Promise.all([
			sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot)'),
			sb.from('crm_policy_annexes').select('*').order('data_aneksu')
		]);
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.annexes = (rA.data ?? []) as typeof appState.annexes;
	}

	async function saveNewPolicy() {
		if (!newPolicyForm) return;
		const err = newPolicyForm.isValid();
		if (err) { formError = err; return; }
		saving = true; formError = '';
		const vals = newPolicyForm.getValues();
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
		const vals = editPolicyForm.getValues();
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
		const { data } = await sb.from('crm_claims').select('*, crm_clients(nazwa), crm_policies(nr_polisy)');
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

	function toggleUG(id: string) {
		const s = new Set(expandedUG);
		if (s.has(id)) s.delete(id); else s.add(id);
		expandedUG = s;
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
		showPolicy = true;
	}

	onMount(() => {
		const p = $page.url.searchParams;
		if (p.get('new') === '1') openNewPolicy();
		if (p.get('newguarantee') === '1') openNewPolicy('generalna', 'gwarancje');
	});

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Polisy — FRANK</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Polisy w obsłudze</h1>
		<p class="text-sm text-slate-500 mt-1">Rejestr ubezpieczeń całego portfela</p>
	</div>
	<div class="flex gap-2">
		<button onclick={() => { showClaim = true; formError = ''; }} class="border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
			Zgłoś Szkodę
		</button>
		<button onclick={() => goto('/policies/new')} class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
			+ Nowa Polisa / UG
		</button>
	</div>
</div>

<!-- Filters -->
<div class="flex gap-3 mb-4">
	<div class="flex items-center gap-2 flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2">
		<Search size={15} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po nr polisy lub kliencie..." class="flex-1 text-sm outline-none placeholder:text-slate-400" />
	</div>
	{#each [['all','Wszystkie'],['jednostkowa','Polisy'],['generalna','Umowy Generalne']] as [val, label]}
		<button
			onclick={() => filterTyp = val as typeof filterTyp}
			class="px-4 py-2 rounded-xl text-sm font-medium border transition-colors
				{filterTyp === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}"
		>
			{label}
		</button>
	{/each}
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nr Polisy</th>
				<th class="px-5 py-3">Klient</th>
				<th class="px-5 py-3">TU</th>
				<th class="px-5 py-3">Rodzaj / Typ</th>
				<th class="px-5 py-3">OD</th>
				<th class="px-5 py-3">DO</th>
				<th class="px-5 py-3 text-right">Składka</th>
				<th class="px-5 py-3">Status</th>
				<th class="px-5 py-3">Akcje</th>
			</tr>
		</thead>
		<tbody>
			{#each toplevelPolicies as p}
				{@const st = policyStatus(p.data_do)}
				{@const children = childrenOf(p.id)}
				{@const axs = annexesOf(p.id)}
				{@const isUG = p.typ_umowy === 'generalna'}
				{@const expanded = expandedUG.has(p.id)}

				<!-- Główny wiersz -->
				<tr class="border-t border-slate-100 hover:bg-slate-50 {isUG ? 'bg-blue-50/30' : ''}">
					<td class="px-5 py-3">
						<div class="flex items-center gap-2">
							{#if isUG && (children.length > 0)}
								<button onclick={() => toggleUG(p.id)} class="text-slate-400 hover:text-slate-700">
									{#if expanded}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
								</button>
							{/if}
							<div>
								<a href="/policies/{p.id}" class="font-medium text-blue-700 hover:underline">{p.nr_polisy}</a>
								{#if axs.length > 0}
									<div class="text-[10px] text-blue-500">{axs.length} aneks{axs.length > 1 ? 'ów' : ''}</div>
								{/if}
							</div>
						</div>
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
							<Badge variant="info">UG: {ugLabel[p.ug_podtyp ?? ''] ?? p.ug_podtyp}</Badge>
						{:else}
							<Badge variant="neutral">{p.rodzaj}</Badge>
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
							<button onclick={() => openEdit(p)} title="Edytuj" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
								<Pencil size={14} />
							</button>
							<button onclick={() => openAnnex(p)} title="Dodaj aneks" class="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
								<FilePlus2 size={14} />
							</button>
						</div>
					</td>
				</tr>

				<!-- Aneksy (sub-wiersze) -->
				{#each axs as ax}
					<tr class="border-t border-slate-100 bg-amber-50/40">
						<td class="pl-12 pr-5 py-2 text-xs text-amber-700">
							↳ Aneks {ax.nr_aneksu}
						</td>
						<td colspan="2" class="px-5 py-2 text-xs text-slate-500">{ax.data_aneksu} — {ax.typ}</td>
						<td colspan="2" class="px-5 py-2 text-xs text-slate-500">{ax.opis ?? '—'}</td>
						<td class="px-5 py-2 text-right text-xs {ax.delta_skladka >= 0 ? 'text-emerald-600' : 'text-red-500'}">
							{ax.delta_skladka >= 0 ? '+' : ''}{fmtPln(ax.delta_skladka)}
						</td>
						<td colspan="2"></td>
					</tr>
				{/each}

				<!-- Dzieci UG (pozycje pod UG) -->
				{#if isUG && expanded}
					{#each children as ch}
						{@const chSt = policyStatus(ch.data_do)}
						<tr class="border-t border-slate-100 bg-slate-50/80">
							<td class="pl-12 pr-5 py-2.5 text-sm">↳ <a href="/policies/{ch.id}" class="font-medium text-blue-700 hover:underline">{ch.nr_polisy}</a></td>
							<td class="px-5 py-2.5 text-sm">
								<a href="/clients/{ch.klient_id}" class="hover:text-blue-700 hover:underline">{ch.crm_clients?.nazwa ?? '—'}</a>
							</td>
							<td class="px-5 py-2.5 text-sm">
							{#if ch.crm_insurers?.skrot}
								<span class="font-mono font-semibold text-blue-700" title={ch.crm_insurers.nazwa}>{ch.crm_insurers.skrot}</span>
							{:else}
								{ch.crm_insurers?.nazwa ?? '—'}
							{/if}
						</td>
							<td class="px-5 py-2.5"><Badge variant="neutral">{ch.rodzaj}</Badge></td>
							<td class="px-5 py-2.5 text-xs">{ch.data_od}</td>
							<td class="px-5 py-2.5 text-xs">{ch.data_do}</td>
							<td class="px-5 py-2.5 text-right">{fmtPln(ch.skladka_przypisana)}</td>
							<td class="px-5 py-2.5">
								<Badge variant={chSt.badge === 'badge-error' ? 'error' : chSt.badge === 'badge-warning' ? 'warning' : 'success'}>{chSt.label}</Badge>
							</td>
							<td class="px-5 py-2.5">
								<button onclick={() => openEdit(ch)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
									<Pencil size={14} />
								</button>
							</td>
						</tr>
					{/each}
				{/if}
			{:else}
				<tr><td colspan="9" class="px-5 py-8 text-center text-slate-400">Brak polis</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<!-- Modal: Nowa Polisa -->
<Modal title="Nowa Polisa / Umowa Generalna" open={showPolicy} onclose={() => { showPolicy = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showPolicy = false; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveNewPolicy} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
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
		<button onclick={() => { showEdit = false; editingPolicy = null; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveEditPolicy} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
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
		<button onclick={() => { showAnnex = false; annexingPolicy = null; resetAnnexForm(); formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
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
							{axTyp === val ? 'bg-blue-50 text-blue-700 border-blue-400' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}"
					>{label}</button>
				{/each}
			</div>
		</div>
		<div>
			<label class={labelCls}>Opis zmiany</label>
			<input bind:value={axOpis} class={inputCls} placeholder="Krótki opis..." />
		</div>
		<hr class="border-slate-200" />
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
		<button onclick={() => { showClaim = false; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
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
