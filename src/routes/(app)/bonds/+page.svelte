<script lang="ts">
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { appState, isFinance } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus, dateDiffDays } from '$lib/utils';
	import { bondRodzajLabel, bondRodzajCls, calcBondSkladka, effectiveStawka } from '$lib/utils/bonds';
	import type { Bond, BondInsurer, BondLimitView, BondTenant, BondTuDict, BondAuditLog } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import BondForm from '$lib/components/BondForm.svelte';
	import UlForm from '$lib/components/UlForm.svelte';
	import { Search, Pencil, Plus, Shield, FileText, History, Building2 } from 'lucide-svelte';

	const isAdmin = $derived(isFinance(appState.profile));

	let activeTab = $state<'gwarancje' | 'ul' | 'audit'>('gwarancje');
	let search = $state('');
	let loading = $state(true);
	let loadError = $state('');

	let bonds = $state<Bond[]>([]);
	let uls = $state<BondInsurer[]>([]);
	let limitViews = $state<BondLimitView[]>([]);
	let tenants = $state<BondTenant[]>([]);
	let tuDict = $state<BondTuDict[]>([]);
	let audit = $state<BondAuditLog[]>([]);

	async function loadAll() {
		loading = true; loadError = '';
		const [rB, rU, rL, rT, rD] = await Promise.all([
			sb.from('bond_bonds').select('*, bond_insurers(bond_nazwa, bond_ul_nr), bond_tenants(bond_nazwa)').order('bond_created_at', { ascending: false }),
			sb.from('bond_insurers').select('*').order('bond_nazwa'),
			sb.from('bond_limits_view').select('*'),
			sb.from('bond_tenants').select('*').order('bond_nazwa'),
			sb.from('bond_tu_dict').select('*').eq('is_active', true).order('name')
		]);
		if (rB.error) loadError = rB.error.message;
		bonds = (rB.data ?? []) as Bond[];
		uls = (rU.data ?? []) as BondInsurer[];
		limitViews = (rL.data ?? []) as BondLimitView[];
		tenants = (rT.data ?? []) as BondTenant[];
		tuDict = (rD.data ?? []) as BondTuDict[];
		if (isAdmin) {
			const rA = await sb.from('bond_audit_log').select('*').order('occurred_at', { ascending: false }).limit(200);
			audit = (rA.data ?? []) as BondAuditLog[];
		}
		loading = false;
	}
	onMount(loadAll);

	function ulById(id: string | null): BondInsurer | null {
		return id ? uls.find((u) => u.bond_id === id) ?? null : null;
	}
	function viewById(id: string | null): BondLimitView | null {
		return id ? limitViews.find((v) => v.bond_insurer_id === id) ?? null : null;
	}
	function tenantName(b: Bond): string {
		return b.bond_tenants?.bond_nazwa ?? tenants.find((t) => t.bond_id === b.bond_tenant_id)?.bond_nazwa ?? '—';
	}
	// Składka: zapisana, a gdy brak — wyliczona z UL
	function skladkaOf(b: Bond): number | null {
		if (b.bond_skladka != null) return Number(b.bond_skladka);
		const ul = ulById(b.bond_insurer_id);
		const stawka = effectiveStawka(b.bond_stawka_override, b.bond_stawka, ul?.bond_stawka_bazowa);
		return calcBondSkladka(b.bond_suma, stawka, b.bond_data_od, b.bond_data_do, ul?.bond_skladka_min);
	}
	function pctElapsed(od: string, doo: string): number {
		const total = Math.max(1, dateDiffDays(od, doo));
		const elapsed = Math.max(0, dateDiffDays(od, new Date().toISOString().slice(0, 10)));
		return Math.min(100, Math.round((elapsed / total) * 100));
	}

	const filteredBonds = $derived(
		bonds.filter((b) => {
			if (!search) return true;
			const q = search.toLowerCase();
			return (
				b.bond_nr.toLowerCase().includes(q) ||
				(b.bond_kontrakt ?? '').toLowerCase().includes(q) ||
				(b.bond_beneficjent ?? '').toLowerCase().includes(q) ||
				tenantName(b).toLowerCase().includes(q)
			);
		})
	);

	const kpiCount = $derived(filteredBonds.length);
	const kpiActive = $derived(filteredBonds.filter((b) => policyStatus(b.bond_data_do).label === 'Aktywna').length);
	const kpiSuma = $derived(filteredBonds.reduce((s, b) => s + Number(b.bond_suma ?? 0), 0));
	const kpiSkladka = $derived(filteredBonds.reduce((s, b) => s + (skladkaOf(b) ?? 0), 0));
	const totalLimit = $derived(limitViews.reduce((s, v) => s + Number(v.bond_limit ?? 0), 0));
	const totalWolny = $derived(limitViews.reduce((s, v) => s + Number(v.bond_wolny_limit ?? 0), 0));

	// ── Modale: gwarancja ──
	let showBond = $state(false);
	let editingBond = $state<Bond | null>(null);
	let bondForm = $state<ReturnType<typeof BondForm> | null>(null);
	let savingBond = $state(false);
	let bondError = $state('');

	function openBond(b: Bond | null) {
		editingBond = b; bondError = ''; showBond = true;
	}
	async function saveBond() {
		if (!bondForm) return;
		const err = bondForm.isValid();
		if (err) { bondError = err; return; }
		savingBond = true; bondError = '';
		const vals = bondForm.getValues();
		const res = editingBond
			? await sb.from('bond_bonds').update(vals).eq('bond_id', editingBond.bond_id)
			: await sb.from('bond_bonds').insert([vals]);
		savingBond = false;
		if (res.error) { bondError = res.error.message; return; }
		showBond = false; editingBond = null;
		await loadAll();
	}

	// ── Modale: UL ──
	let showUl = $state(false);
	let editingUl = $state<BondInsurer | null>(null);
	let ulForm = $state<ReturnType<typeof UlForm> | null>(null);
	let savingUl = $state(false);
	let ulError = $state('');

	function openUl(u: BondInsurer | null) {
		editingUl = u; ulError = ''; showUl = true;
	}
	async function saveUl() {
		if (!ulForm) return;
		const err = ulForm.isValid();
		if (err) { ulError = err; return; }
		savingUl = true; ulError = '';
		const vals = ulForm.getValues();
		const res = editingUl
			? await sb.from('bond_insurers').update(vals).eq('bond_id', editingUl.bond_id)
			: await sb.from('bond_insurers').insert([vals]);
		savingUl = false;
		if (res.error) { ulError = res.error.message; return; }
		showUl = false; editingUl = null;
		await loadAll();
	}

	// ── Modal: podmiot (powiąż klienta CRM jako bond_tenant) ──
	let showTenant = $state(false);
	let tenantClientId = $state('');
	let savingTenant = $state(false);
	let tenantError = $state('');

	function slugify(s: string): string {
		return s.toLowerCase()
			.normalize('NFD').replace(/[̀-ͯ]/g, '')
			.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `p-${Date.now().toString(36)}`;
	}
	// Klienci CRM nie powiązani jeszcze jako podmiot bond
	const linkableClients = $derived(
		appState.clients.filter((c) => !tenants.some((t) => t.crm_client_id === c.id))
	);
	async function saveTenant() {
		if (!tenantClientId) { tenantError = 'Wybierz klienta CRM'; return; }
		const client = appState.clients.find((c) => c.id === tenantClientId);
		if (!client) { tenantError = 'Nie znaleziono klienta'; return; }
		savingTenant = true; tenantError = '';
		const res = await sb.from('bond_tenants').insert([{
			bond_nazwa: client.nazwa,
			bond_slug: slugify(client.nazwa_skrocona ?? client.nazwa),
			bond_nip: client.nip ?? null,
			bond_regon: client.regon ?? null,
			bond_krs: client.krs ?? null,
			bond_aktywny: true,
			crm_client_id: client.id
		}]);
		savingTenant = false;
		if (res.error) { tenantError = res.error.message; return; }
		showTenant = false; tenantClientId = '';
		await loadAll();
	}

	function ulsForTenant(tid: string): BondInsurer[] {
		return uls.filter((u) => u.bond_tenant_id === tid);
	}
	function bondsCountForUl(ulId: string): number {
		return bonds.filter((b) => b.bond_insurer_id === ulId).length;
	}
</script>

<svelte:head><title>Gwarancje — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900 flex items-center gap-2">
			<Shield size={22} class="text-violet-500" /> Gwarancje ubezpieczeniowe
		</h1>
		<p class="text-sm text-slate-500 mt-1">Gwarancje, umowy limitowe (UL) i historia zmian</p>
	</div>
	<div class="flex gap-2">
		{#if activeTab === 'gwarancje'}
			<button onclick={() => openBond(null)} class="bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors flex items-center gap-2">
				<Plus size={15} /> Dodaj gwarancję
			</button>
		{:else if activeTab === 'ul'}
			<button onclick={() => { showTenant = true; tenantError = ''; tenantClientId = ''; }} class="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center gap-2">
				<Building2 size={15} /> Dodaj podmiot
			</button>
			<button onclick={() => openUl(null)} class="bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors flex items-center gap-2">
				<Plus size={15} /> Dodaj UL
			</button>
		{/if}
	</div>
</div>

<!-- Tabs -->
<div class="flex items-center gap-1 border-b border-slate-200 mb-5">
	<button onclick={() => (activeTab = 'gwarancje')}
		class="px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 {activeTab === 'gwarancje' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'}">
		<FileText size={15} /> Gwarancje
	</button>
	<button onclick={() => (activeTab = 'ul')}
		class="px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 {activeTab === 'ul' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'}">
		<Shield size={15} /> Umowy limitowe (UL)
	</button>
	{#if isAdmin}
		<button onclick={() => (activeTab = 'audit')}
			class="px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 {activeTab === 'audit' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'}">
			<History size={15} /> Audit log
		</button>
	{/if}
</div>

{#if loadError}
	<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</div>
{/if}

{#if loading}
	<div class="text-slate-400 text-sm py-12 text-center">Ładowanie…</div>

{:else if activeTab === 'gwarancje'}
	<!-- KPI -->
	<div class="grid grid-cols-4 gap-4 mb-5">
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
			<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Gwarancje</div>
			<div class="text-2xl font-bold text-slate-900">{kpiCount}</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
			<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Aktywne</div>
			<div class="text-2xl font-bold text-emerald-600">{kpiActive}</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
			<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Suma gwarancyjna</div>
			<div class="text-2xl font-bold text-violet-700">{fmtPln(kpiSuma)}</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
			<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Składka</div>
			<div class="text-2xl font-bold text-slate-700">{fmtPln(kpiSkladka)}</div>
		</div>
	</div>

	<!-- Search -->
	<div class="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 mb-4">
		<Search size={15} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po nr, kontrakcie, beneficjencie, podmiocie…" class="flex-1 text-sm outline-none placeholder:text-slate-400" />
	</div>

	{#if filteredBonds.length === 0}
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-slate-400">Brak gwarancji</div>
	{:else}
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<table class="w-full text-sm text-left">
			<thead>
				<tr class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100 bg-slate-50">
					<th class="px-4 py-2.5">Nr / Typ</th>
					<th class="px-4 py-2.5">Podmiot / TU</th>
					<th class="px-4 py-2.5">Kontrakt / Beneficjent</th>
					<th class="px-4 py-2.5 text-right">Suma</th>
					<th class="px-4 py-2.5 text-right">Składka</th>
					<th class="px-4 py-2.5">Okres</th>
					<th class="px-4 py-2.5">Status</th>
					<th class="px-4 py-2.5"></th>
				</tr>
			</thead>
			<tbody>
				{#each filteredBonds as b}
					{@const st = policyStatus(b.bond_data_do)}
					{@const tp = pctElapsed(b.bond_data_od, b.bond_data_do)}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-4 py-2.5">
							<div class="font-medium text-slate-800">{b.bond_nr}</div>
							<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold {bondRodzajCls(b.bond_rodzaj)}">{bondRodzajLabel[b.bond_rodzaj] ?? b.bond_rodzaj}</span>
							{#if b.bond_bez_limitu}<span class="text-[10px] text-amber-600 ml-1">poza limitem</span>{/if}
						</td>
						<td class="px-4 py-2.5">
							<div class="text-slate-700">{tenantName(b)}</div>
							<div class="text-xs text-slate-400">{b.bond_insurers?.bond_nazwa ?? '—'}{b.bond_insurers?.bond_ul_nr ? ` · ${b.bond_insurers.bond_ul_nr}` : ''}</div>
						</td>
						<td class="px-4 py-2.5">
							<div class="text-slate-600 truncate max-w-[220px]">{b.bond_kontrakt}</div>
							{#if b.bond_beneficjent}<div class="text-xs text-slate-400 truncate max-w-[220px]">{b.bond_beneficjent}</div>{/if}
						</td>
						<td class="px-4 py-2.5 text-right font-medium text-slate-800">{fmtPln(b.bond_suma)}</td>
						<td class="px-4 py-2.5 text-right text-slate-600">{skladkaOf(b) != null ? fmtPln(skladkaOf(b)) : '—'}</td>
						<td class="px-4 py-2.5">
							<div class="text-xs text-slate-500">{b.bond_data_od} → {b.bond_data_do}</div>
							<div class="w-24 bg-slate-200 rounded-full h-1 mt-1">
								<div class="h-1 rounded-full {tp > 90 ? 'bg-red-500' : tp > 70 ? 'bg-amber-500' : 'bg-blue-500'}" style="width:{tp}%"></div>
							</div>
						</td>
						<td class="px-4 py-2.5">
							<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
						</td>
						<td class="px-4 py-2.5 text-right">
							<button onclick={() => openBond(b)} title="Edytuj" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
								<Pencil size={14} />
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{/if}

{:else if activeTab === 'ul'}
	<!-- KPI limitów -->
	<div class="grid grid-cols-3 gap-4 mb-5">
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
			<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Umowy limitowe</div>
			<div class="text-2xl font-bold text-slate-900">{uls.length}</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
			<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Łączny limit</div>
			<div class="text-2xl font-bold text-violet-700">{fmtPln(totalLimit)}</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-4">
			<div class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">Wolny limit</div>
			<div class="text-2xl font-bold text-emerald-600">{fmtPln(totalWolny)}</div>
		</div>
	</div>

	{#if tenants.length === 0}
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-slate-400">Brak podmiotów — dodaj podmiot, aby utworzyć UL.</div>
	{/if}

	<div class="space-y-5">
		{#each tenants as t}
			{@const tUls = ulsForTenant(t.bond_id)}
			<div>
				<div class="flex items-center gap-2 mb-2">
					<Building2 size={15} class="text-slate-400" />
					<span class="font-semibold text-slate-800">{t.bond_nazwa}</span>
					{#if t.bond_nip}<span class="text-xs text-slate-400">NIP {t.bond_nip}</span>{/if}
					{#if !t.bond_aktywny}<Badge variant="neutral">nieaktywny</Badge>{/if}
				</div>
				{#if tUls.length === 0}
					<div class="text-xs text-slate-400 pl-7 mb-2">Brak UL dla tego podmiotu.</div>
				{:else}
				<div class="grid grid-cols-2 gap-4">
					{#each tUls as u}
						{@const v = viewById(u.bond_id)}
						{@const limit = Number(u.bond_limit ?? 0)}
						{@const zaang = Number(v?.bond_zaangazowane ?? 0)}
						{@const wolny = v?.bond_wolny_limit != null ? Number(v.bond_wolny_limit) : limit - zaang}
						{@const pct = limit > 0 ? Math.min(100, Math.round((zaang / limit) * 100)) : 0}
						<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
							<div class="flex items-start justify-between">
								<div>
									<div class="font-semibold text-slate-800">{u.bond_nazwa}</div>
									<div class="text-xs text-slate-400">{u.bond_ul_nr ?? '—'}{u.bond_ul_data_do ? ` · do ${u.bond_ul_data_do}` : ''}</div>
								</div>
								<div class="flex items-center gap-2">
									<span class="text-xs text-slate-400">{bondsCountForUl(u.bond_id)} gwar.</span>
									<button onclick={() => openUl(u)} title="Edytuj UL" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
										<Pencil size={14} />
									</button>
								</div>
							</div>
							<div class="mt-3">
								<div class="flex items-center justify-between text-xs mb-1">
									<span class="text-slate-500">Wykorzystanie</span>
									<span class="font-semibold {wolny >= 0 ? 'text-emerald-600' : 'text-red-600'}">wolne {fmtPln(wolny)} PLN</span>
								</div>
								<div class="w-full bg-slate-200 rounded-full h-2">
									<div class="h-2 rounded-full {pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}" style="width:{pct}%"></div>
								</div>
								<div class="flex items-center justify-between text-[11px] text-slate-400 mt-1">
									<span>{pct}% · {fmtPln(zaang)} / {fmtPln(limit)} PLN</span>
									<span>stawka {u.bond_stawka_bazowa ?? '—'}%{u.bond_stawka_negocjowana ? ' (neg.)' : ''} · min {u.bond_skladka_min != null ? fmtPln(u.bond_skladka_min) : '—'}</span>
								</div>
							</div>
						</div>
					{/each}
				</div>
				{/if}
			</div>
		{/each}
	</div>

{:else if activeTab === 'audit'}
	{#if audit.length === 0}
		<div class="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-slate-400">Brak wpisów w dzienniku.</div>
	{:else}
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<table class="w-full text-sm text-left">
			<thead>
				<tr class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100 bg-slate-50">
					<th class="px-4 py-2.5">Kiedy</th>
					<th class="px-4 py-2.5">Operacja</th>
					<th class="px-4 py-2.5">Tabela</th>
					<th class="px-4 py-2.5">Rekord</th>
					<th class="px-4 py-2.5">Rola</th>
				</tr>
			</thead>
			<tbody>
				{#each audit as a}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-4 py-2.5 text-slate-500 whitespace-nowrap">{new Date(a.occurred_at).toLocaleString('pl-PL')}</td>
						<td class="px-4 py-2.5">
							<Badge variant={a.operation === 'INSERT' ? 'success' : a.operation === 'DELETE' ? 'error' : 'info'}>{a.operation}</Badge>
						</td>
						<td class="px-4 py-2.5 font-mono text-xs text-slate-600">{a.table_name}</td>
						<td class="px-4 py-2.5 font-mono text-[11px] text-slate-400">{a.record_id ?? '—'}</td>
						<td class="px-4 py-2.5 text-slate-500">{a.actor_role ?? '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{/if}
{/if}

<!-- Modal: gwarancja -->
<Modal title={editingBond ? `Edytuj gwarancję — ${editingBond.bond_nr}` : 'Nowa gwarancja'} open={showBond} onclose={() => { showBond = false; editingBond = null; }}>
	{#snippet footer()}
		<button onclick={() => { showBond = false; editingBond = null; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveBond} disabled={savingBond} class="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-60">
			{savingBond ? 'Zapisywanie…' : editingBond ? 'Zapisz zmiany' : 'Wystaw gwarancję'}
		</button>
	{/snippet}
	{#if bondError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{bondError}</div>{/if}
	{#if uls.length === 0}
		<div class="text-sm text-slate-500">Najpierw dodaj Umowę Limitową (zakładka „Umowy limitowe (UL)").</div>
	{:else}
		<BondForm bind:this={bondForm} bond={editingBond} {uls} {limitViews} />
	{/if}
</Modal>

<!-- Modal: UL -->
<Modal title={editingUl ? `Edytuj UL — ${editingUl.bond_nazwa}` : 'Nowa Umowa Limitowa'} open={showUl} onclose={() => { showUl = false; editingUl = null; }}>
	{#snippet footer()}
		<button onclick={() => { showUl = false; editingUl = null; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveUl} disabled={savingUl} class="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-60">
			{savingUl ? 'Zapisywanie…' : editingUl ? 'Zapisz zmiany' : 'Dodaj UL'}
		</button>
	{/snippet}
	{#if ulError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{ulError}</div>{/if}
	{#if tenants.length === 0}
		<div class="text-sm text-slate-500">Najpierw dodaj podmiot.</div>
	{:else}
		<UlForm bind:this={ulForm} ul={editingUl} {tenants} {tuDict} />
	{/if}
</Modal>

<!-- Modal: podmiot -->
<Modal title="Dodaj podmiot (powiąż klienta CRM)" open={showTenant} onclose={() => { showTenant = false; }}>
	{#snippet footer()}
		<button onclick={() => { showTenant = false; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveTenant} disabled={savingTenant} class="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-60">
			{savingTenant ? 'Zapisywanie…' : 'Dodaj podmiot'}
		</button>
	{/snippet}
	{#if tenantError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{tenantError}</div>{/if}
	<label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Klient CRM *</label>
	<select bind:value={tenantClientId} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
		<option value="">— wybierz klienta —</option>
		{#each linkableClients as c}
			<option value={c.id}>{c.nazwa_skrocona ?? c.nazwa}{c.nip ? ` · NIP ${c.nip}` : ''}</option>
		{/each}
	</select>
	<p class="text-[11px] text-slate-400 mt-2">Podmiot zostanie utworzony z danych klienta i powiązany przez <code>crm_client_id</code>.</p>
</Modal>
