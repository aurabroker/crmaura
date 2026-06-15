<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState, isAdmin, teamLabel } from '$lib/stores/app.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import type { Insurer, Profile, InsurerBranch, InsurerContact } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Pencil, UserPlus, Mail, Building2, UserRound, ChevronDown, ChevronRight, FileText, Settings, Users, ScrollText } from 'lucide-svelte';
	import { fmtPln } from '$lib/utils';

	onMount(async () => {
		if (!isAdmin(appState.profile)) goto('/dashboard');
	});

	// --- Logi aktywności ---
	let auditLogs = $state<any[]>([]);
	let auditLoading = $state(false);
	let auditSearch = $state('');

	$effect(() => {
		if (activeTab === 'logi') loadAuditLogs();
	});

	async function loadAuditLogs() {
		auditLoading = true;
		const { data } = await sb.from('crm_audit_log')
			.select('*')
			.order('created_at', { ascending: false })
			.limit(500);
		auditLogs = data ?? [];
		auditLoading = false;
	}

	const filteredLogs = $derived(
		auditSearch.trim()
			? auditLogs.filter(l =>
				(l.user_name ?? '').toLowerCase().includes(auditSearch.toLowerCase()) ||
				(l.action ?? '').toLowerCase().includes(auditSearch.toLowerCase()) ||
				(l.entity_label ?? '').toLowerCase().includes(auditSearch.toLowerCase()) ||
				(l.entity_type ?? '').toLowerCase().includes(auditSearch.toLowerCase())
			)
			: auditLogs
	);

	function fmtDate(ts: string) {
		return new Date(ts).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
	}

	const actionLabel: Record<string, string> = {
		login: 'Logowanie', client_created: 'Nowy klient', client_updated: 'Edycja klienta',
		policy_created: 'Nowa polisa', policy_renewed: 'Odnowienie polisy', policy_deleted: 'Usunięcie polisy',
	};

	const activeTab = $derived($page.url.searchParams.get('tab') ?? 'system');

	async function authHeaders(): Promise<Record<string, string>> {
		const { data: { session } } = await sb.auth.getSession();
		return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` };
	}

	// --- TU ---
	let showTU = $state(false);
	let editingTU = $state<Insurer | null>(null);
	let fNazwa = $state(''); let fSkrot = $state(''); let fDzial = $state('Majątkowy');
	let fUlica = $state(''); let fNip = $state(''); let fKrs = $state('');
	let savingTU = $state(false); let tuError = $state('');

	function openNewTU() { editingTU = null; fNazwa=''; fSkrot=''; fDzial='Majątkowy'; fUlica=''; fNip=''; fKrs=''; tuError=''; showTU=true; }
	function openEditTU(t: Insurer) { editingTU=t; fNazwa=t.nazwa; fSkrot=t.skrot??''; fDzial=t.dzial; fUlica=t.ulica??''; fNip=t.nip??''; fKrs=t.krs??''; tuError=''; showTU=true; }

	async function saveTU() {
		if (!fNazwa.trim()) { tuError='Podaj nazwę TU'; return; }
		savingTU=true; tuError='';
		const payload = { nazwa: fNazwa.trim(), skrot: fSkrot.trim()||null, dzial: fDzial, ulica: fUlica||null, nip: fNip||null, krs: fKrs||null };
		let error;
		if (editingTU) ({ error } = await sb.from('crm_insurers').update(payload).eq('id', editingTU.id));
		else ({ error } = await sb.from('crm_insurers').insert([{ tenant_id: appState.profile!.tenant_id, ...payload }]));
		savingTU=false;
		if (error) { tuError=error.message; return; }
		showTU=false;
		const { data } = await sb.from('crm_insurers').select('*').order('nazwa');
		appState.insurers = (data??[]) as typeof appState.insurers;
	}

	// --- UŻYTKOWNICY ---
	let showInvite = $state(false);
	let showEditUser = $state(false);
	let editingUser = $state<Profile | null>(null);

	let iEmail = $state(''); let iNazwa = $state(''); let iRole = $state('BROKER'); let iStanowisko = $state('');
	let inviting = $state(false); let inviteError = $state(''); let inviteSuccess = $state(''); let tempPassword = $state('');

	let uRole = $state('BROKER'); let uNazwa = $state(''); let uStanowisko = $state(''); let uPesel = $state('');
	let savingUser = $state(false); let userError = $state('');
	let iPesel = $state('');

	// Widok polis brokera
	let viewingBroker = $state<Profile | null>(null);

	const ROLES = ['BROKER', 'ADMINISTRACJA', 'BOARD', 'ADMIN BROKER', 'ADMIN GOD'];

	function openEditUser(b: Profile) {
		editingUser=b; uRole=b.rola; uNazwa=b.imie_nazwisko??''; uStanowisko=b.stanowisko??''; uPesel=b.pesel??'';
		userError=''; showEditUser=true;
	}

	async function inviteUser() {
		if (!iEmail.trim()) { inviteError='Podaj email.'; return; }
		inviting=true; inviteError=''; inviteSuccess='';
		const res = await fetch('/api/admin/invite', {
			method: 'POST',
			headers: await authHeaders(),
			body: JSON.stringify({
				email: iEmail.trim(),
				role: iRole,
				imie_nazwisko: iNazwa.trim() || null
			})
		});
		inviting=false;
		if (!res.ok) { const d = await res.json(); inviteError = d.message ?? 'Błąd'; return; }
		const d = await res.json();
		tempPassword = d.tempPassword ?? '';
		inviteSuccess = iEmail;
		// Save PESEL if provided
		if (iPesel.trim() && d.user_id) {
			await sb.from('crm_profiles').update({ pesel: iPesel.trim() }).eq('id', d.user_id);
		}
		iEmail=''; iNazwa=''; iRole='BROKER'; iStanowisko=''; iPesel='';
		const { data } = await sb.from('crm_profiles').select('*');
		appState.brokers = (data??[]) as typeof appState.brokers;
	}

	async function saveUserRole() {
		if (!editingUser) return;
		savingUser=true; userError='';
		const res = await fetch('/api/admin/update-role', {
			method: 'POST',
			headers: await authHeaders(),
			body: JSON.stringify({ user_id: editingUser.id, role: uRole, imie_nazwisko: uNazwa, stanowisko: uStanowisko })
		});
		savingUser=false;
		if (!res.ok) { const d = await res.json(); userError = d.message ?? 'Błąd'; return; }
		// Save PESEL directly
		await sb.from('crm_profiles').update({ pesel: uPesel.trim() || null }).eq('id', editingUser.id);
		showEditUser=false;
		const { data } = await sb.from('crm_profiles').select('*');
		appState.brokers = (data??[]) as typeof appState.brokers;
	}

	const roleVariant = (r: string) =>
		r === 'ADMIN GOD' ? 'error' :
		r === 'ADMIN BROKER' ? 'warning' :
		r === 'BOARD' ? 'info' : 'neutral';

	// --- Oddziały (Branches) ---
	let showBranch = $state(false);
	let editingBranch = $state<InsurerBranch | null>(null);
	let branchTuId = $state('');
	let bNazwa = $state(''); let bAdres = $state(''); let bTelefon = $state(''); let bEmail = $state('');
	let savingBranch = $state(false); let branchError = $state('');
	let expandedTU = $state(new Set<string>());

	function toggleTU(id: string) {
		const s = new Set(expandedTU);
		if (s.has(id)) s.delete(id); else s.add(id);
		expandedTU = s;
	}

	function openNewBranch(tuId: string) {
		editingBranch = null; branchTuId = tuId;
		bNazwa = ''; bAdres = ''; bTelefon = ''; bEmail = '';
		branchError = ''; showBranch = true;
	}
	function openEditBranch(b: InsurerBranch) {
		editingBranch = b; branchTuId = b.tu_id;
		bNazwa = b.nazwa; bAdres = b.adres ?? ''; bTelefon = b.telefon ?? ''; bEmail = b.email ?? '';
		branchError = ''; showBranch = true;
	}
	async function saveBranch() {
		if (!bNazwa.trim()) { branchError = 'Podaj nazwę oddziału'; return; }
		savingBranch = true; branchError = '';
		const payload = { tu_id: branchTuId, nazwa: bNazwa.trim(), adres: bAdres || null, telefon: bTelefon || null, email: bEmail || null };
		let error;
		if (editingBranch) {
			({ error } = await sb.from('crm_insurer_branches').update(payload).eq('id', editingBranch.id));
		} else {
			({ error } = await sb.from('crm_insurer_branches').insert([{ tenant_id: appState.profile!.tenant_id, ...payload }]));
		}
		savingBranch = false;
		if (error) { branchError = error.message; return; }
		showBranch = false;
		const { data } = await sb.from('crm_insurer_branches').select('*').order('nazwa');
		appState.insurerBranches = (data ?? []) as typeof appState.insurerBranches;
	}

	// --- Osoby kontaktowe TU ---
	let showContactModal = $state(false);
	let editingContact = $state<InsurerContact | null>(null);
	let contactTuId = $state('');
	let cBranchId = $state(''); let cNazwa = $state(''); let cStanowisko = $state('');
	let cTelefon = $state(''); let cEmail = $state(''); let cNotatki = $state('');
	let savingContactM = $state(false); let contactMError = $state('');

	function openNewContact(tuId: string, branchId = '') {
		editingContact = null; contactTuId = tuId;
		cBranchId = branchId; cNazwa = ''; cStanowisko = ''; cTelefon = ''; cEmail = ''; cNotatki = '';
		contactMError = ''; showContactModal = true;
	}
	function openEditContact(c: InsurerContact) {
		editingContact = c; contactTuId = c.tu_id;
		cBranchId = c.branch_id ?? ''; cNazwa = c.imie_nazwisko; cStanowisko = c.stanowisko ?? '';
		cTelefon = c.telefon ?? ''; cEmail = c.email ?? ''; cNotatki = c.notatki ?? '';
		contactMError = ''; showContactModal = true;
	}
	async function saveContact() {
		if (!cNazwa.trim()) { contactMError = 'Podaj imię i nazwisko'; return; }
		savingContactM = true; contactMError = '';
		const payload = {
			tu_id: contactTuId, branch_id: cBranchId || null,
			imie_nazwisko: cNazwa.trim(), stanowisko: cStanowisko || null,
			telefon: cTelefon || null, email: cEmail || null, notatki: cNotatki || null
		};
		let error;
		if (editingContact) {
			({ error } = await sb.from('crm_insurer_contacts').update(payload).eq('id', editingContact.id));
		} else {
			({ error } = await sb.from('crm_insurer_contacts').insert([{ tenant_id: appState.profile!.tenant_id, ...payload }]));
		}
		savingContactM = false;
		if (error) { contactMError = error.message; return; }
		showContactModal = false;
		const { data } = await sb.from('crm_insurer_contacts').select('*, crm_insurer_branches(nazwa)').order('imie_nazwisko');
		appState.insurerContacts = (data ?? []) as typeof appState.insurerContacts;
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Administracja — FRANK67 CRM</title></svelte:head>

<div class="flex items-center gap-2 mb-1">
	<h1 class="text-2xl font-semibold text-slate-900">Administracja</h1>
	<span class="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-300 rounded-full">Admin</span>
</div>

<!-- Tabs -->
<div class="flex items-center gap-1 mb-6 border-b border-amber-200">
	<a href="/admin?tab=system"
		class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
			{activeTab === 'system' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}">
		<Settings size={15} /> Ustawienia systemu
	</a>
	<a href="/admin?tab=kancelaria"
		class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
			{activeTab === 'kancelaria' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}">
		<Users size={15} /> Ustawienia Kancelarii
	</a>
	<a href="/admin?tab=logi"
		class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
			{activeTab === 'logi' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}">
		<ScrollText size={15} /> Logi aktywności
	</a>
</div>

{#if activeTab === 'system'}
<!-- ===================== USTAWIENIA SYSTEMU ===================== -->
<div class="space-y-4">
	<p class="text-sm text-slate-500">Towarzystwa ubezpieczeniowe, oddziały i osoby kontaktowe TU</p>
	<div class="grid grid-cols-2 gap-6">
		{#each [['Majątkowy', 'Majątkowe'], ['Życiowy', 'Życiowe']] as [dzial, label]}
			{@const tuDzial = appState.insurers.filter(t => t.dzial === dzial)}
			<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
				<div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
					<h2 class="font-semibold text-slate-900">TU — {label} <span class="text-xs font-normal text-slate-400">({tuDzial.length})</span></h2>
					<button onclick={openNewTU} class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50">+ Dodaj TU</button>
				</div>
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
							<th class="px-5 py-3">Skrót</th>
							<th class="px-5 py-3">Nazwa</th>
							<th class="px-5 py-3">NIP / KRS</th>
							<th class="px-5 py-3"></th>
						</tr>
					</thead>
					<tbody>
						{#each tuDzial as t}
							{@const tBranches = appState.insurerBranches.filter(b => b.tu_id === t.id)}
							{@const tContacts = appState.insurerContacts.filter(c => c.tu_id === t.id)}
							{@const isExpanded = expandedTU.has(t.id)}
							<tr class="border-t border-slate-100 hover:bg-slate-50">
								<td class="px-5 py-3">
									<div class="flex items-center gap-2">
										<button onclick={() => toggleTU(t.id)} class="text-slate-400 hover:text-slate-700">
											{#if isExpanded}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
										</button>
										{#if t.skrot}
											<span class="font-mono font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-xs">{t.skrot}</span>
										{:else}
											<span class="text-slate-300 text-xs">—</span>
										{/if}
									</div>
								</td>
								<td class="px-5 py-3">
									<div class="font-medium">{t.nazwa}</div>
									{#if t.ulica}<div class="text-xs text-slate-400">{t.ulica}</div>{/if}
									<div class="flex items-center gap-3 mt-1">
										{#if tBranches.length > 0}
											<span class="text-[10px] text-slate-400"><Building2 class="inline" size={10} /> {tBranches.length} oddz.</span>
										{/if}
										{#if tContacts.length > 0}
											<span class="text-[10px] text-slate-400"><UserRound class="inline" size={10} /> {tContacts.length} os.</span>
										{/if}
									</div>
								</td>
								<td class="px-5 py-3 text-xs text-slate-500">
									{#if t.nip}NIP: {t.nip}<br/>{/if}
									{#if t.krs}KRS: {t.krs}{/if}
								</td>
								<td class="px-5 py-3">
									<div class="flex items-center gap-1">
										<button onclick={() => openEditTU(t)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Edytuj TU"><Pencil size={14} /></button>
										<button onclick={() => openNewBranch(t.id)} class="p-1.5 rounded-lg text-slate-400 hover:text-blue-700 hover:bg-blue-50" title="Dodaj oddział"><Building2 size={14} /></button>
										<button onclick={() => openNewContact(t.id)} class="p-1.5 rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-emerald-50" title="Dodaj osobę kontaktową"><UserRound size={14} /></button>
									</div>
								</td>
							</tr>
							{#if isExpanded}
								<!-- Oddziały -->
								{#each tBranches as br}
									{@const brContacts = appState.insurerContacts.filter(c => c.branch_id === br.id)}
									<tr class="border-t border-slate-100 bg-blue-50/30">
										<td class="pl-14 pr-5 py-2" colspan="2">
											<div class="flex items-center gap-2">
												<Building2 size={12} class="text-blue-500" />
												<span class="text-sm font-medium text-blue-800">{br.nazwa}</span>
												{#if br.adres}<span class="text-xs text-slate-400">{br.adres}</span>{/if}
											</div>
										</td>
										<td class="px-5 py-2 text-xs text-slate-500">
											{#if br.telefon}{br.telefon}{/if}
											{#if br.email}<br/>{br.email}{/if}
										</td>
										<td class="px-5 py-2">
											<div class="flex items-center gap-1">
												<button onclick={() => openEditBranch(br)} class="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Edytuj oddział"><Pencil size={13} /></button>
												<button onclick={() => openNewContact(t.id, br.id)} class="p-1 rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-emerald-50" title="Dodaj osobę do oddziału"><UserRound size={13} /></button>
											</div>
										</td>
									</tr>
									{#each brContacts as c}
										<tr class="border-t border-slate-50 bg-emerald-50/20">
											<td class="pl-20 pr-5 py-2" colspan="2">
												<div class="flex items-center gap-2">
													<UserRound size={11} class="text-emerald-600" />
													<span class="text-sm text-slate-700">{c.imie_nazwisko}</span>
													{#if c.stanowisko}<span class="text-xs text-slate-400">— {c.stanowisko}</span>{/if}
												</div>
											</td>
											<td class="px-5 py-2 text-xs text-slate-500">
												{#if c.telefon}{c.telefon}{/if}
												{#if c.email}<br/>{c.email}{/if}
											</td>
											<td class="px-5 py-2">
												<button onclick={() => openEditContact(c)} class="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={13} /></button>
											</td>
										</tr>
									{/each}
								{/each}
								<!-- Osoby bez oddziału -->
								{#each appState.insurerContacts.filter(c => c.tu_id === t.id && !c.branch_id) as c}
									<tr class="border-t border-slate-50 bg-emerald-50/20">
										<td class="pl-14 pr-5 py-2" colspan="2">
											<div class="flex items-center gap-2">
												<UserRound size={11} class="text-emerald-600" />
												<span class="text-sm text-slate-700">{c.imie_nazwisko}</span>
												{#if c.stanowisko}<span class="text-xs text-slate-400">— {c.stanowisko}</span>{/if}
												<span class="text-[10px] text-slate-300">(centrala)</span>
											</div>
										</td>
										<td class="px-5 py-2 text-xs text-slate-500">
											{#if c.telefon}{c.telefon}{/if}
											{#if c.email}<br/>{c.email}{/if}
										</td>
										<td class="px-5 py-2">
											<button onclick={() => openEditContact(c)} class="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={13} /></button>
										</td>
									</tr>
								{/each}
							{/if}
						{:else}
							<tr><td colspan="4" class="px-5 py-6 text-center text-slate-400">Brak TU {label.toLowerCase()}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/each}
	</div>
</div>
{:else if activeTab === 'kancelaria'}
<!-- ===================== USTAWIENIA KANCELARII ===================== -->
<div class="space-y-4">
	<p class="text-sm text-slate-500">Zarządzanie brokerami, rolami i dostępami</p>
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
			<h2 class="font-semibold text-slate-900">Zespół ({teamLabel()})</h2>
				<button onclick={() => { showInvite=true; inviteError=''; inviteSuccess=''; tempPassword=''; }} class="flex items-center gap-1.5 text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 hover:bg-slate-700">
					<UserPlus size={13} /> Dodaj użytkownika
				</button>
			</div>
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
						<th class="px-5 py-3">Imię / Email</th>
						<th class="px-5 py-3">Rola</th>
						<th class="px-5 py-3">PESEL</th>
						<th class="px-5 py-3">Stanowisko</th>
						<th class="px-5 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each appState.brokers as b}
						<tr class="border-t border-slate-100 hover:bg-slate-50 {viewingBroker?.id === b.id ? 'bg-blue-50' : ''}">
							<td class="px-5 py-3">
								<div class="font-medium">{b.imie_nazwisko ?? b.email}</div>
								<div class="text-xs text-slate-400">{b.email}</div>
							</td>
							<td class="px-5 py-3"><Badge variant={roleVariant(b.rola)}>{b.rola}</Badge></td>
							<td class="px-5 py-3 text-xs font-mono text-slate-500">{b.pesel ?? '—'}</td>
							<td class="px-5 py-3 text-sm text-slate-500">{b.stanowisko ?? '—'}</td>
							<td class="px-5 py-3">
								<div class="flex items-center gap-1">
									<button
										onclick={() => viewingBroker = viewingBroker?.id === b.id ? null : b}
										class="p-1.5 rounded-lg text-slate-400 hover:text-blue-700 hover:bg-blue-50"
										title="Polisy brokera"
									><FileText size={14} /></button>
									{#if b.id !== appState.profile?.id}
										<button onclick={() => openEditUser(b)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
									{/if}
								</div>
							</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="px-5 py-6 text-center text-slate-400">Brak użytkowników</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Widok polis wybranego brokera -->
		{#if viewingBroker}
		{@const brokerPolicyIds = new Set(appState.policyBrokers.filter(pb => pb.broker_id === viewingBroker!.id).map(pb => pb.polisa_id))}
		{@const brokerPolicies = appState.policies.filter(p => brokerPolicyIds.has(p.id))}
		<div class="bg-white border border-blue-200 rounded-xl shadow-sm overflow-hidden">
			<div class="px-5 py-4 border-b border-blue-200 flex items-center justify-between">
				<h2 class="font-semibold text-blue-800 text-sm">Polisy — {viewingBroker.imie_nazwisko ?? viewingBroker.email} <span class="font-normal text-blue-400">({brokerPolicies.length})</span></h2>
				<button onclick={() => viewingBroker = null} class="text-xs text-blue-400 hover:text-blue-700">Zamknij ✕</button>
			</div>
			{#if brokerPolicies.length === 0}
				<p class="px-5 py-6 text-center text-slate-400 text-sm">Brak przypisanych polis</p>
			{:else}
				<table class="w-full text-left text-xs">
					<thead>
						<tr class="bg-slate-50 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
							<th class="px-4 py-2">Nr Polisy</th>
							<th class="px-4 py-2">Klient</th>
							<th class="px-4 py-2">TU</th>
							<th class="px-4 py-2">Rodzaj</th>
							<th class="px-4 py-2">Data od</th>
							<th class="px-4 py-2">Data do</th>
							<th class="px-4 py-2 text-right">Składka</th>
						</tr>
					</thead>
					<tbody>
						{#each brokerPolicies as p}
							<tr class="border-t border-slate-100 hover:bg-slate-50">
								<td class="px-4 py-2 font-medium text-blue-700">
									<a href="/policies/{p.id}" class="hover:underline">{p.nr_polisy}</a>
								</td>
								<td class="px-4 py-2 text-slate-700 truncate max-w-[120px]">{p.crm_clients?.nazwa ?? '—'}</td>
								<td class="px-4 py-2 text-slate-500">{p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa ?? '—'}</td>
								<td class="px-4 py-2 text-slate-500">{p.rodzaj ?? '—'}</td>
								<td class="px-4 py-2 text-slate-500">{p.data_od ?? '—'}</td>
								<td class="px-4 py-2 text-slate-500">{p.data_do ?? '—'}</td>
								<td class="px-4 py-2 text-right font-semibold">{p.skladka_przypisana ? fmtPln(p.skladka_przypisana) : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
		{/if}
</div>

{:else if activeTab === 'logi'}
<!-- ===================== LOGI AKTYWNOŚCI ===================== -->
<div class="space-y-4">
	<div class="flex items-center justify-between gap-3 flex-wrap">
		<p class="text-sm text-slate-500">Ostatnie 500 zdarzeń w systemie</p>
		<div class="flex items-center gap-3">
			<input bind:value={auditSearch} placeholder="Szukaj po użytkowniku, akcji, encji..." class="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-slate-300" />
			<button onclick={loadAuditLogs} class="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600">↻ Odśwież</button>
		</div>
	</div>
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		{#if auditLoading}
			<div class="px-6 py-10 text-center text-slate-400 text-sm">Ładowanie logów…</div>
		{:else if filteredLogs.length === 0}
			<div class="px-6 py-10 text-center text-slate-400 text-sm">Brak wpisów spełniających kryteria.</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 border-b border-slate-200">
						<tr>
							<th class="px-4 py-2.5 text-left font-medium text-slate-500 whitespace-nowrap">Czas</th>
							<th class="px-4 py-2.5 text-left font-medium text-slate-500">Użytkownik</th>
							<th class="px-4 py-2.5 text-left font-medium text-slate-500">Akcja</th>
							<th class="px-4 py-2.5 text-left font-medium text-slate-500">Encja</th>
							<th class="px-4 py-2.5 text-left font-medium text-slate-500">Szczegóły</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredLogs as log}
							<tr class="border-t border-slate-100 hover:bg-slate-50">
								<td class="px-4 py-2 text-slate-400 whitespace-nowrap text-xs">{fmtDate(log.created_at)}</td>
								<td class="px-4 py-2 text-slate-700">
									<div class="font-medium">{log.crm_users?.imie_nazwisko ?? '—'}</div>
									<div class="text-xs text-slate-400">{log.crm_users?.email ?? ''}</div>
								</td>
								<td class="px-4 py-2">
									<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold {
										log.action === 'CREATE' ? 'bg-emerald-100 text-emerald-700' :
										log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
										log.action === 'DELETE' ? 'bg-red-100 text-red-700' :
										'bg-slate-100 text-slate-600'
									}">{actionLabel[log.action] ?? log.action}</span>
								</td>
								<td class="px-4 py-2 text-slate-600">
									<div class="font-medium">{log.entity_label ?? log.entity_id ?? '—'}</div>
									<div class="text-xs text-slate-400">{log.entity_type ?? ''}</div>
								</td>
								<td class="px-4 py-2 text-slate-500 text-xs max-w-xs truncate" title={log.details ? JSON.stringify(log.details) : ''}>
									{log.details ? JSON.stringify(log.details) : ''}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
{/if}

<!-- Modal: TU -->
<Modal title={editingTU ? `Edytuj TU — ${editingTU.nazwa}` : 'Nowe Towarzystwo (TU)'} open={showTU} onclose={() => { showTU=false; tuError=''; }}>
	{#snippet footer()}
		<button onclick={() => { showTU=false; tuError=''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveTU} disabled={savingTU} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingTU ? 'Zapisywanie...' : editingTU ? 'Zapisz zmiany' : 'Zapisz TU'}
		</button>
	{/snippet}
	{#if tuError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{tuError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-3 gap-3">
			<div class="col-span-2"><label class={labelCls}>Nazwa TU *</label><input bind:value={fNazwa} class={inputCls} /></div>
			<div><label class={labelCls}>Skrót (np. PZU, HDI)</label><input bind:value={fSkrot} class={inputCls} placeholder="np. PZU" /></div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Dział *</label>
				<select bind:value={fDzial} class={inputCls}><option>Majątkowy</option><option>Życiowy</option></select>
			</div>
			<div><label class={labelCls}>Adres</label><input bind:value={fUlica} class={inputCls} /></div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>NIP</label><input bind:value={fNip} class={inputCls} /></div>
			<div><label class={labelCls}>KRS</label><input bind:value={fKrs} class={inputCls} /></div>
		</div>
	</div>
</Modal>

<!-- Modal: Zaproś użytkownika -->
<Modal title="Utwórz konto użytkownika" open={showInvite} onclose={() => { showInvite=false; inviteSuccess=''; tempPassword=''; }}>
	{#snippet footer()}
		<button onclick={() => { showInvite=false; inviteSuccess=''; tempPassword=''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>
		{#if !inviteSuccess}
			<button onclick={inviteUser} disabled={inviting} class="flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
				<UserPlus size={14} /> {inviting ? 'Tworzenie...' : 'Utwórz konto'}
			</button>
		{/if}
	{/snippet}
	{#if inviteError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{inviteError}</div>{/if}
	{#if inviteSuccess}
		<div class="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 space-y-2">
			<div>✓ Konto utworzone dla <strong>{inviteSuccess}</strong></div>
			<div>Tymczasowe hasło (przekaż użytkownikowi):</div>
			<div class="font-mono text-base bg-white border border-emerald-300 rounded px-3 py-2 tracking-widest select-all">{tempPassword}</div>
			<div class="text-xs text-emerald-600">Użytkownik może zmienić hasło po zalogowaniu w ustawieniach konta.</div>
		</div>
	{:else}
		<div class="space-y-3">
			<div><label class={labelCls}>E-mail *</label><input type="email" bind:value={iEmail} class={inputCls} placeholder="broker@firma.pl" /></div>
			<div><label class={labelCls}>Imię i Nazwisko</label><input bind:value={iNazwa} class={inputCls} placeholder="Jan Kowalski" /></div>
			<div>
				<label class={labelCls}>Rola w systemie *</label>
				<select bind:value={iRole} class={inputCls}>
					{#each ROLES as r}<option>{r}</option>{/each}
				</select>
			</div>
			<div><label class={labelCls}>PESEL <span class="text-slate-400 font-normal">(opcjonalnie — dopasowanie w nocie Leadenhall)</span></label><input bind:value={iPesel} class={inputCls} placeholder="11 cyfr" maxlength="11" /></div>
			<p class="text-xs text-slate-400">Konto zostanie utworzone z tymczasowym hasłem.</p>
		</div>
	{/if}
</Modal>

<!-- Modal: Edytuj rolę użytkownika -->
{#if editingUser}
<Modal title="Edytuj użytkownika — {editingUser.imie_nazwisko ?? editingUser.email}" open={showEditUser} onclose={() => { showEditUser=false; }}>
	{#snippet footer()}
		<button onclick={() => showEditUser=false} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveUserRole} disabled={savingUser} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingUser ? 'Zapisywanie...' : 'Zapisz zmiany'}
		</button>
	{/snippet}
	{#if userError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{userError}</div>{/if}
	<div class="space-y-3">
		<div><label class={labelCls}>Imię i Nazwisko</label><input bind:value={uNazwa} class={inputCls} /></div>
		<div>
			<label class={labelCls}>Rola w systemie</label>
			<select bind:value={uRole} class={inputCls}>
				{#each ROLES as r}<option>{r}</option>{/each}
			</select>
		</div>
		<div><label class={labelCls}>Stanowisko</label><input bind:value={uStanowisko} class={inputCls} placeholder="np. Starszy Broker" /></div>
		<div><label class={labelCls}>PESEL <span class="text-slate-400 font-normal">(dopasowanie akwizytora w nocie Leadenhall)</span></label><input bind:value={uPesel} class={inputCls} placeholder="11 cyfr" maxlength="11" /></div>
		<div class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
			Zmiana roli wchodzi w życie przy następnym logowaniu użytkownika.
		</div>
	</div>
</Modal>
{/if}

<!-- Modal: Oddział TU -->
<Modal title={editingBranch ? `Edytuj oddział — ${editingBranch.nazwa}` : 'Nowy Oddział TU'} open={showBranch} onclose={() => { showBranch=false; branchError=''; }}>
	{#snippet footer()}
		<button onclick={() => { showBranch=false; branchError=''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveBranch} disabled={savingBranch} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingBranch ? 'Zapisywanie...' : editingBranch ? 'Zapisz zmiany' : 'Dodaj oddział'}
		</button>
	{/snippet}
	{#if branchError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{branchError}</div>{/if}
	<div class="space-y-3">
		<div><label class={labelCls}>Nazwa oddziału *</label><input bind:value={bNazwa} class={inputCls} placeholder="np. Oddział Warszawa" /></div>
		<div><label class={labelCls}>Adres</label><input bind:value={bAdres} class={inputCls} /></div>
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Telefon</label><input bind:value={bTelefon} class={inputCls} /></div>
			<div><label class={labelCls}>E-mail</label><input type="email" bind:value={bEmail} class={inputCls} /></div>
		</div>
	</div>
</Modal>

<!-- Modal: Osoba kontaktowa TU -->
<Modal title={editingContact ? `Edytuj osobę — ${editingContact.imie_nazwisko}` : 'Nowa Osoba Kontaktowa TU'} open={showContactModal} onclose={() => { showContactModal=false; contactMError=''; }}>
	{#snippet footer()}
		<button onclick={() => { showContactModal=false; contactMError=''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveContact} disabled={savingContactM} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{savingContactM ? 'Zapisywanie...' : editingContact ? 'Zapisz zmiany' : 'Dodaj osobę'}
		</button>
	{/snippet}
	{#if contactMError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{contactMError}</div>{/if}
	<div class="space-y-3">
		<div>
			<label class={labelCls}>Oddział</label>
			<select bind:value={cBranchId} class={inputCls}>
				<option value="">— centrala (bez oddziału) —</option>
				{#each appState.insurerBranches.filter(b => b.tu_id === contactTuId) as b}
					<option value={b.id}>{b.nazwa}</option>
				{/each}
			</select>
		</div>
		<div><label class={labelCls}>Imię i Nazwisko *</label><input bind:value={cNazwa} class={inputCls} /></div>
		<div><label class={labelCls}>Stanowisko</label><input bind:value={cStanowisko} class={inputCls} placeholder="np. Opiekun klienta" /></div>
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Telefon</label><input bind:value={cTelefon} class={inputCls} /></div>
			<div><label class={labelCls}>E-mail</label><input type="email" bind:value={cEmail} class={inputCls} /></div>
		</div>
		<div><label class={labelCls}>Notatki</label><textarea bind:value={cNotatki} rows="2" class={inputCls}></textarea></div>
	</div>
</Modal>
