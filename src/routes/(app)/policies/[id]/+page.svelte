<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { ArrowLeft, Pencil, FilePlus2, Users, Trash2, UserRound, RefreshCw } from 'lucide-svelte';
	import { dateDiffDays, todayStr } from '$lib/utils';
	import { logAudit } from '$lib/utils/audit';
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

	const today = todayStr();
	const renewalPolicy = $derived(
		policy ? appState.policies.find(q => q.renewal_of === policy!.id && !q.deleted_at) : undefined
	);
	const daysLeft = $derived(policy?.data_do ? dateDiffDays(today, policy.data_do) : 999);
	const canRenew = $derived(!!policy && !renewalPolicy && daysLeft >= 0 && daysLeft <= 45);
	const isPendingRenewal = $derived(!!policy?.renewal_of && policy.data_od > today);
	const renewalUrl = $derived(policy
		? `/policies/new?klient=${policy.klient_id}&rodzaj=${encodeURIComponent(policy.rodzaj)}&przedmiot=${encodeURIComponent(policy.przedmiot ?? '')}&renewal_of=${policy.id}`
		: '');

	// UG default commission inline edit
	let ugEditOpen = $state(false);
	let ugEditVal = $state('');
	let ugEditSaving = $state(false);
	let ugEditUpdatedCount = $state(0);
	async function saveUgDefault() {
		ugEditSaving = true;
		const pct = parseFloat(ugEditVal) || null;
		const currentPolicyId = policyId; // capture derived value

		// Save default on UG
		await sb.from('crm_policies').update({ ug_default_prowizja_pct: pct }).eq('id', currentPolicyId);

		// Apply to child policies without commission — query from DB directly
		if (pct) {
			const { data: children } = await sb.from('crm_policies')
				.select('id, skladka_przypisana, prowizja_pct')
				.eq('parent_id', currentPolicyId);

			const toUpdate = (children ?? []).filter(c => !c.prowizja_pct || parseFloat(String(c.prowizja_pct)) === 0);
			ugEditUpdatedCount = toUpdate.length;

			for (const child of toUpdate) {
				const prowizja_przypisana = (Number(child.skladka_przypisana) * pct) / 100;
				await sb.from('crm_policies').update({ prowizja_pct: pct, prowizja_przypisana }).eq('id', child.id);
			}
		} else {
			ugEditUpdatedCount = 0;
		}

		const { data } = await sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot)');
		appState.policies = (data ?? []) as typeof appState.policies;
		ugEditOpen = false; ugEditSaving = false;
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

	// --- Delete (soft) ---
	let showDelete = $state(false);
	let deletionReason = $state('');
	let deleting = $state(false);
	let deleteError = $state('');

	async function softDelete() {
		if (!deletionReason.trim()) { deleteError = 'Podaj uzasadnienie usunięcia.'; return; }
		deleting = true; deleteError = '';
		const { error } = await sb.from('crm_policies')
			.update({ deleted_at: new Date().toISOString(), deletion_reason: deletionReason.trim() })
			.eq('id', policyId);
		deleting = false;
		if (error) { deleteError = error.message; return; }
		await logAudit('policy_deleted', 'policy', policyId, policy?.nr_polisy, { reason: deletionReason.trim() });
		// Remove from local state
		appState.policies = appState.policies.filter(p => p.id !== policyId);
		goto('/policies');
	}

	// --- TU Contact ---
	let showContact = $state(false);
	let contactBranchId = $state('');
	let contactPersonId = $state('');
	let savingContact = $state(false);
	let contactError = $state('');

	const tuBranches = $derived(
		appState.insurerBranches.filter(b => b.tu_id === policy?.tu_id)
	);
	const branchContacts = $derived(
		contactBranchId
			? appState.insurerContacts.filter(c => c.branch_id === contactBranchId)
			: appState.insurerContacts.filter(c => c.tu_id === policy?.tu_id && !c.branch_id)
	);

	async function saveContact() {
		if (!contactPersonId) { contactError = 'Wybierz osobę.'; return; }
		savingContact = true; contactError = '';
		const { error } = await sb.from('crm_policies')
			.update({ tu_contact_id: contactPersonId })
			.eq('id', policyId);
		savingContact = false;
		if (error) { contactError = error.message; return; }
		const { data } = await sb.from('crm_policies')
			.select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))')
			.is('deleted_at', null);
		appState.policies = (data ?? []) as typeof appState.policies;
		showContact = false;
		contactBranchId = ''; contactPersonId = '';
	}

	async function removeContact() {
		await sb.from('crm_policies').update({ tu_contact_id: null }).eq('id', policyId);
		const { data } = await sb.from('crm_policies')
			.select('*, crm_clients(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))')
			.is('deleted_at', null);
		appState.policies = (data ?? []) as typeof appState.policies;
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	// Płatności: live sum + edit/add
	const sumaPlatnosci = $derived(payments.reduce((s, p) => s + (p.kwota ?? 0), 0));

	let showEditPayment = $state(false);
	let editingPayment = $state<typeof payments[number] | null>(null);
	let epData = $state(''); let epKwota = $state(''); let epStatus = $state<'Oczekująca'|'Opłacona'|'Zaległa'|'Częściowo opłacona'>('Oczekująca');
	let savingEp = $state(false); let epError = $state('');

	function openEditPayment(pay: typeof payments[number]) {
		editingPayment = pay;
		epData = pay.data_platnosci;
		epKwota = String(pay.kwota);
		epStatus = pay.status;
		epError = '';
		showEditPayment = true;
	}

	async function reloadPayments() {
		const { data } = await sb.from('crm_policy_payments')
			.select('*, crm_policies(nr_polisy, crm_clients(nazwa))')
			.order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
	}

	async function saveEditPayment() {
		if (!editingPayment) return;
		if (!epData || epKwota === '') { epError = 'Podaj datę i kwotę.'; return; }
		savingEp = true; epError = '';
		const { error } = await sb.from('crm_policy_payments')
			.update({ data_platnosci: epData, kwota: parseFloat(epKwota), status: epStatus })
			.eq('id', editingPayment.id);
		savingEp = false;
		if (error) { epError = error.message; return; }
		showEditPayment = false; editingPayment = null;
		await reloadPayments();
	}

	let showAddPayment = $state(false);
	let apData = $state(''); let apKwota = $state(''); let apPowod = $state('');
	let savingAp = $state(false); let apError = $state('');

	function openAddPayment() {
		apData = ''; apKwota = ''; apPowod = ''; apError = '';
		showAddPayment = true;
	}

	async function saveAddPayment() {
		if (!policy) return;
		if (!apData || apKwota === '') { apError = 'Podaj datę i kwotę.'; return; }
		if (!apPowod.trim()) { apError = 'Podaj powód nowej płatności.'; return; }
		savingAp = true; apError = '';
		const nextNr = payments.length > 0 ? Math.max(...payments.map(p => p.nr_raty)) + 1 : 1;
		const { error } = await sb.from('crm_policy_payments').insert([{
			tenant_id: appState.profile!.tenant_id,
			polisa_id: policy.id,
			nr_raty: nextNr,
			data_platnosci: apData,
			kwota: parseFloat(apKwota),
			status: 'Oczekująca',
			powod: apPowod.trim()
		}]);
		savingAp = false;
		if (error) { apError = error.message; return; }
		showAddPayment = false;
		await reloadPayments();
	}
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
					{#if renewalPolicy}
						<Badge variant="warning">Odnowiona</Badge>
					{:else if isPendingRenewal}
						<Badge variant="info">Oczekująca</Badge>
					{/if}
				</div>
			</div>
		</div>
		<div class="flex gap-2">
			{#if canRenew}
				<a href={renewalUrl} class="flex items-center gap-1.5 text-sm border border-amber-300 bg-amber-50 text-amber-700 rounded-lg px-3 py-2 hover:bg-amber-100 transition-colors">
					<RefreshCw size={14} /> Odnów polisę
				</a>
			{/if}
			<button onclick={() => { showBrokers = true; pbError = ''; }} class="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50">
				<Users size={14} /> Podział prowizji {#if polisaBrokers.length > 0}<span class="ml-1 bg-blue-100 text-blue-700 rounded-full px-1.5 text-xs font-semibold">{polisaBrokers.length}</span>{/if}
			</button>
			<button onclick={() => { showAnnex = true; axError = ''; }} class="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50">
				<FilePlus2 size={14} /> Aneks
			</button>
			<a href="/policies/{policyId}/edit" class="flex items-center gap-1.5 text-sm bg-slate-900 text-white rounded-lg px-3 py-2 hover:bg-slate-700">
				<Pencil size={14} /> Edytuj
			</a>
			<button onclick={() => { showDelete = true; deletionReason = ''; deleteError = ''; }} class="flex items-center gap-1.5 text-sm border border-red-200 text-red-600 rounded-lg px-3 py-2 hover:bg-red-50">
				<Trash2 size={14} /> Usuń
			</button>
		</div>
	</div>

	<!-- Dane polisy -->
	<div class="grid gap-3 mb-5" style="grid-template-columns: repeat({policy.typ_umowy === 'generalna' ? 6 : 5}, minmax(0,1fr))">
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">{policy.typ_umowy === 'generalna' ? 'Łączna składka polis' : 'Składka'}</p>
			<p class="text-base font-semibold text-slate-900">{fmtPln(policy.typ_umowy === 'generalna' ? childSkladka : policy.skladka_przypisana)}</p>
			<p class="text-xs text-slate-400">{policy.typ_umowy === 'generalna' ? `${childPolicies.length} polis` : `Raty: ${policy.ilosc_rat}`}</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">Okres</p>
			<p class="text-sm font-semibold text-slate-900">{policy.data_od}</p>
			<p class="text-xs text-slate-400">{policy.data_do}</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">{policy.typ_umowy === 'generalna' ? 'Łączna prowizja' : 'Prowizja'}</p>
			<p class="text-base font-semibold text-emerald-600">{fmtPln(policy.typ_umowy === 'generalna' ? childProwizja : policy.prowizja_przypisana)}</p>
			<p class="text-xs text-slate-400">{policy.prowizja_pct}%</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">Rodzaj</p>
			<p class="text-sm font-semibold text-slate-900">{policy.rodzaj}</p>
			{#if policy.przedmiot}
					{@const _ud = (() => { try { const _p = JSON.parse(policy.przedmiot!); return _p.__ud ? _p : null; } catch { return null; } })()}
					{#if _ud}
						<div class="text-xs text-slate-400 space-y-0.5 mt-0.5">
							{#if _ud.ctn}<p>CTN: <span class="font-semibold text-slate-600">{Number(_ud.ctn).toLocaleString('pl-PL')} zł</span></p>{/if}
							{#if _ud.ctc}<p>CTC: <span class="font-semibold text-slate-600">{Number(_ud.ctc).toLocaleString('pl-PL')} zł</span></p>{/if}
							{#if _ud.si}<p>SI: <span class="font-semibold text-slate-600">{Number(_ud.si).toLocaleString('pl-PL')} zł</span></p>{/if}
						</div>
					{:else}
						<p class="text-xs text-slate-400 truncate">{policy.przedmiot}</p>
					{/if}
				{/if}
		</div>
		<!-- Osoba kontaktowa TU — kafelka inline -->
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5 flex items-center justify-between">
				<span>Kontakt TU</span>
				<button onclick={() => { showContact = true; contactBranchId = ''; contactPersonId = ''; contactError = ''; }}
					class="text-[10px] text-slate-400 hover:text-blue-600 transition-colors">
					{policy.tu_contact_id ? 'Zmień' : '+ Przypisz'}
				</button>
			</p>
			{#if policy.crm_insurer_contacts}
				{@const c = policy.crm_insurer_contacts}
				<p class="text-sm font-semibold text-slate-900 truncate">{c.imie_nazwisko}</p>
				{#if c.stanowisko}<p class="text-xs text-slate-400 truncate">{c.stanowisko}</p>{/if}
				{#if c.crm_insurer_branches}<p class="text-xs text-blue-600 truncate">{c.crm_insurer_branches.nazwa}</p>{/if}
			{:else}
				<p class="text-sm text-slate-400">—</p>
			{/if}
		</div>
		{#if policy.typ_umowy === 'generalna'}
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">Liczba polis</p>
			<p class="text-base font-semibold text-slate-900">{childPolicies.length}</p>
			<p class="text-xs text-slate-400">certyfikatów</p>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl py-2.5 px-3 shadow-sm">
			<p class="text-xs text-slate-500 mb-0.5">Śr. prowizja</p>
			<p class="text-base font-semibold text-emerald-600">{childPolicies.length > 0 ? fmtPln(childProwizja / childPolicies.length) : '—'}</p>
			<p class="text-xs text-slate-400">na polisę</p>
		</div>
		{/if}
	</div>

	<!-- UG: domyślna prowizja (compact inline) -->
	{#if policy.typ_umowy === 'generalna'}
	<div class="inline-flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 mb-5">
		<p class="text-xs font-semibold text-blue-600 uppercase tracking-wide whitespace-nowrap">Domyślna prowizja UG:</p>
		{#if ugEditOpen}
			<input type="number" step="0.01" bind:value={ugEditVal}
				class="border border-blue-300 rounded-lg px-2 py-1 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="%" />
			<button onclick={saveUgDefault} disabled={ugEditSaving} class="px-3 py-1 bg-blue-700 text-white text-xs rounded-lg hover:bg-blue-800 disabled:opacity-60">
				{ugEditSaving ? '...' : 'Zapisz'}
			</button>
			<button onclick={() => ugEditOpen = false} class="px-2 py-1 border border-blue-300 text-blue-700 text-xs rounded-lg hover:bg-blue-100">✕</button>
		{:else}
			<span class="text-base font-bold text-blue-900">{policy.ug_default_prowizja_pct != null ? `${policy.ug_default_prowizja_pct}%` : '—'}</span>
			{#if ugEditUpdatedCount > 0}
				<span class="text-xs text-emerald-700">✓ zaktualizowano {ugEditUpdatedCount} polis</span>
			{/if}
			<button onclick={() => { ugEditVal = policy.ug_default_prowizja_pct?.toString() ?? ''; ugEditOpen = true; }}
				class="flex items-center gap-1 text-xs text-blue-700 border border-blue-300 rounded-lg px-2 py-1 hover:bg-blue-100">
				<Pencil size={11} /> Zmień
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
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden w-1/2 min-w-[480px]">
		<div class="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
			<p class="text-sm font-semibold text-slate-700">Płatności ({payments.length})</p>
			<div class="flex items-center gap-3">
				<span class="text-xs text-slate-500">Suma: <strong class="text-slate-900">{fmtPln(sumaPlatnosci)}</strong></span>
				<button onclick={openAddPayment} class="flex items-center gap-1 text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-50">
					<FilePlus2 size={12} /> Dodaj płatność
				</button>
			</div>
		</div>
		{#if payments.length > 0}
		<table class="w-full text-sm text-left">
			<tbody>
				{#each payments as pay}
					<tr class="border-t border-slate-100 hover:bg-slate-50">
						<td class="px-5 py-2.5 text-slate-500 font-medium w-16">Rata {pay.nr_raty}</td>
						<td class="px-5 py-2.5">
							<div class="flex items-center justify-between gap-3">
								<span class="text-slate-700">{pay.data_platnosci}</span>
								<span class="font-semibold text-slate-900 {pay.kwota < 0 ? 'text-red-600' : ''}">{fmtPln(pay.kwota)}</span>
								<Badge variant={pay.status === 'Opłacona' ? 'success' : pay.status === 'Zaległa' ? 'error' : 'neutral'}>{pay.status}</Badge>
								<button onclick={() => openEditPayment(pay)} title="Edytuj" class="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0">
									<Pencil size={13} />
								</button>
							</div>
							{#if pay.powod}<p class="text-xs text-slate-400 mt-0.5">{pay.powod}</p>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{:else}
			<p class="px-5 py-6 text-sm text-slate-400">Brak płatności.</p>
		{/if}
	</div>
{/if}

{#if policy}
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

<!-- Modal: Usuń polisę -->
<Modal title="Usuń polisę — {policy?.nr_polisy}" open={showDelete} onclose={() => showDelete = false}>
	{#snippet footer()}
		<button onclick={() => showDelete = false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={softDelete} disabled={deleting} class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-60">
			{deleting ? 'Usuwanie...' : 'Przenieś do Kosza'}
		</button>
	{/snippet}
	{#if deleteError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{deleteError}</div>{/if}
	<div class="space-y-3">
		<div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
			Polisa zostanie przeniesiona do Kosza. Administrator może ją przywrócić lub trwale usunąć.
		</div>
		<div>
			<label class={labelCls}>Uzasadnienie usunięcia *</label>
			<textarea bind:value={deletionReason} rows="3" placeholder="Podaj powód usunięcia polisy..." class={inputCls}></textarea>
		</div>
	</div>
</Modal>

<!-- Modal: Osoba kontaktowa TU -->
{#if policy}
<Modal title="Osoba kontaktowa TU — {policy.crm_insurers?.skrot ?? policy.crm_insurers?.nazwa ?? ''}" open={showContact} onclose={() => showContact = false}>
	{#snippet footer()}
		<button onclick={() => showContact = false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveContact} disabled={savingContact} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingContact ? 'Zapisywanie...' : 'Przypisz osobę'}
		</button>
	{/snippet}
	{#if contactError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{contactError}</div>{/if}
	<div class="space-y-3">
		<div>
			<label class={labelCls}>Oddział</label>
			<select bind:value={contactBranchId} onchange={() => contactPersonId = ''} class={inputCls}>
				<option value="">— bez oddziału (centrala) —</option>
				{#each tuBranches as b}
					<option value={b.id}>{b.nazwa}</option>
				{/each}
			</select>
		</div>
		<div>
			<label class={labelCls}>Osoba *</label>
			<select bind:value={contactPersonId} class={inputCls}>
				<option value="">— wybierz osobę —</option>
				{#each branchContacts as c}
					<option value={c.id}>{c.imie_nazwisko}{c.stanowisko ? ` — ${c.stanowisko}` : ''}</option>
				{/each}
			</select>
			{#if branchContacts.length === 0}
				<p class="text-xs text-slate-400 mt-1">Brak osób przypisanych do wybranego oddziału.</p>
			{/if}
		</div>
	</div>
</Modal>
{/if}

<!-- Modal: Edytuj płatność -->
{#if editingPayment}
<Modal title="Edytuj płatność — Rata {editingPayment.nr_raty}" open={showEditPayment} onclose={() => { showEditPayment = false; editingPayment = null; }}>
	{#snippet footer()}
		<button onclick={() => { showEditPayment = false; editingPayment = null; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveEditPayment} disabled={savingEp} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingEp ? 'Zapisywanie...' : 'Zapisz zmiany'}
		</button>
	{/snippet}
	{#if epError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{epError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Data płatności *</label><input type="date" bind:value={epData} class={inputCls} /></div>
			<div><label class={labelCls}>Kwota * (może być ujemna)</label><input type="number" step="0.01" bind:value={epKwota} class={inputCls} /></div>
		</div>
		<div>
			<label class={labelCls}>Status</label>
			<select bind:value={epStatus} class={inputCls}>
				<option value="Oczekująca">Oczekująca</option>
				<option value="Opłacona">Opłacona</option>
				<option value="Zaległa">Zaległa</option>
				<option value="Częściowo opłacona">Częściowo opłacona</option>
			</select>
		</div>
	</div>
</Modal>
{/if}

<!-- Modal: Dodaj płatność -->
{#if policy}
<Modal title="Dodaj płatność — {policy.nr_polisy}" open={showAddPayment} onclose={() => showAddPayment = false}>
	{#snippet footer()}
		<button onclick={() => showAddPayment = false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveAddPayment} disabled={savingAp} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingAp ? 'Zapisywanie...' : 'Dodaj płatność'}
		</button>
	{/snippet}
	{#if apError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{apError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Data płatności *</label><input type="date" bind:value={apData} class={inputCls} /></div>
			<div><label class={labelCls}>Kwota * (może być ujemna)</label><input type="number" step="0.01" bind:value={apKwota} class={inputCls} /></div>
		</div>
		<div>
			<label class={labelCls}>Powód nowej płatności *</label>
			<input bind:value={apPowod} placeholder="np. aneks, rozliczenie składki..." class={inputCls} />
		</div>
	</div>
</Modal>
{/if}
