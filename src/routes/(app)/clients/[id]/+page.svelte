<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb, SB_URL } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus, dateDiffDays, validateVin, assignedPolicyFor } from '$lib/utils';
	import type { Claim, Vehicle, ClientContact, CrmTask } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import TaskModal from '$lib/components/TaskModal.svelte';
	import { ArrowLeft, Pencil, Plus, Car, FileText, AlertTriangle, Coins, Users, UserPlus, Trash2, ClipboardList, Copy, Check, Download, CheckCircle2, Circle, Clock, AlertCircle, Link, RefreshCw, Mail, MailCheck, Send } from 'lucide-svelte';
	import { todayStr } from '$lib/utils';
	import { saveApkPdf } from '$lib/utils/apkPdf';
	import type { ApkForm } from '$lib/types/database';

	let pdfSaving = $state<string | null>(null);
	async function handlePdf(f: ApkForm) {
		pdfSaving = f.id;
		try { await saveApkPdf(f); } finally { pdfSaving = null; }
	}

	const clientId = $derived($page.params.id);
	const client = $derived(appState.clients.find(c => c.id === clientId));
	// Polisy, których klient jest właścicielem (ubezpieczającym) — podstawa rozliczeń finansowych.
	const ownPolicies = $derived(appState.policies.filter(p => p.klient_id === clientId));
	// Wszystkie polisy powiązane z klientem: jako ubezpieczający LUB jako ubezpieczony (Dodaj ubezpieczonego).
	const clientPolicies = $derived(appState.policies.filter(p => p.klient_id === clientId || p.ubezpieczony_id === clientId));
	const clientVehicles = $derived(appState.vehicles.filter(v => v.klient_id === clientId));
	const clientClaims = $derived(appState.claims.filter(c => c.klient_id === clientId));
	const clientContacts = $derived(appState.clientContacts.filter(cc => cc.klient_id === clientId));
	const clientApk = $derived(appState.apkForms.filter(f => f.klient_id === clientId));

	const totalPrzyp = $derived(ownPolicies.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0));
	const totalOpl = $derived(ownPolicies.reduce((s, p) => s + Number(p.skladka_zainkasowana ?? 0), 0));
	const activeClaims = $derived(clientClaims.filter(c => c.status === 'Zgłoszona' || c.status === 'W toku'));

	const renewedPolicyIds = $derived(
		new Set(appState.policies
			.filter(p => p.renewal_of !== null && !p.deleted_at)
			.map(p => p.renewal_of as string))
	);

	const grupowePolicies = $derived(clientPolicies.filter(p =>
		p.rodzaj === 'grupowe_medyczne' || p.rodzaj === 'grupowe_życie'
	));
	const hasGrupowe = $derived(grupowePolicies.length > 0);
	const hasVehicles = $derived(clientVehicles.length > 0);
	const hasClaims = $derived(clientClaims.length > 0);

	const isAuraTenant = $derived(appState.tenantNazwa.toLowerCase().includes('aura'));

	type TabKey = 'polisy' | 'pojazdy' | 'szkody' | 'saldo' | 'kontakty' | 'apk' | 'zadania' | 'mailing';
	let activeTab = $state<TabKey>('polisy');
	const tabs = $derived(
		['polisy', 'pojazdy', 'szkody', 'saldo', 'kontakty', 'apk', 'zadania', ...(isAuraTenant ? ['mailing'] : [])] as TabKey[]
	);

	// ── Mailing GetResponse (tylko Aura Expert) ───────────────────────────────
	type GrMessage = { id: string; subject: string; sentOn: string | null; openedOn: string | null; opened: boolean; openCount: number };
	type GrResult =
		| { matched: true; contact: { contactId: string; email: string | null; name: string | null }; messages: GrMessage[] }
		| { matched: false; reason: 'no_email' | 'not_found'; email?: string };

	let grLoading = $state(false);
	let grError = $state('');
	let grResult = $state<GrResult | null>(null);
	let grLink = $state<{ gr_email: string | null; ignored: boolean } | null>(null);
	let grEditEmail = $state(false);
	let grEmailInput = $state('');
	let grSaving = $state(false);
	// in-memory cache per client (email -> { at, result }) — krótki cache na żywo
	const grCache = new Map<string, { at: number; result: GrResult }>();
	const GR_CACHE_MS = 5 * 60 * 1000;
	let grLoadedFor = '';

	function fmtDateTime(s: string | null): string {
		if (!s) return '—';
		const d = new Date(s);
		if (isNaN(d.getTime())) return s;
		return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	// adres używany do dopasowania w GetResponse: override > email klienta
	const grMatchEmail = $derived((grLink?.gr_email ?? client?.email ?? '').trim());

	async function loadGrLink() {
		if (!clientId) return;
		const { data } = await sb
			.from('crm_getresponse_links')
			.select('gr_email, ignored')
			.eq('klient_id', clientId)
			.maybeSingle();
		grLink = data ?? { gr_email: null, ignored: false };
	}

	async function loadMailing(force = false) {
		if (!isAuraTenant || !clientId) return;
		if (!grLink) await loadGrLink();
		if (grLink?.ignored && !force) { grResult = null; return; }

		const email = grMatchEmail.toLowerCase();
		if (!email) { grResult = { matched: false, reason: 'no_email' }; return; }

		const cached = grCache.get(email);
		if (!force && cached && Date.now() - cached.at < GR_CACHE_MS) {
			grResult = cached.result;
			return;
		}

		grLoading = true;
		grError = '';
		try {
			const { data: { session } } = await sb.auth.getSession();
			const res = await fetch(`${SB_URL}/functions/v1/getresponse-client-activities`, {
				method: 'POST',
				headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});
			const payload = await res.json();
			if (!res.ok) { grError = payload?.error ?? 'Błąd pobierania danych z GetResponse'; grResult = null; return; }
			grResult = payload as GrResult;
			grCache.set(email, { at: Date.now(), result: grResult });
		} catch (e) {
			grError = e instanceof Error ? e.message : String(e);
			grResult = null;
		} finally {
			grLoading = false;
		}
	}

	async function saveGrEmail() {
		if (!clientId) return;
		grSaving = true;
		try {
			const value = grEmailInput.trim() || null;
			await sb.from('crm_getresponse_links').upsert({
				tenant_id: appState.profile?.tenant_id,
				klient_id: clientId,
				gr_email: value,
				ignored: false,
				updated_at: new Date().toISOString()
			}, { onConflict: 'klient_id' });
			grLink = { gr_email: value, ignored: false };
			grEditEmail = false;
			grCache.clear();
			await loadMailing(true);
		} finally {
			grSaving = false;
		}
	}

	async function ignoreMismatch() {
		if (!clientId) return;
		grSaving = true;
		try {
			await sb.from('crm_getresponse_links').upsert({
				tenant_id: appState.profile?.tenant_id,
				klient_id: clientId,
				gr_email: grLink?.gr_email ?? null,
				ignored: true,
				updated_at: new Date().toISOString()
			}, { onConflict: 'klient_id' });
			grLink = { gr_email: grLink?.gr_email ?? null, ignored: true };
			grResult = null;
		} finally {
			grSaving = false;
		}
	}

	async function undoIgnore() {
		if (!clientId) return;
		grSaving = true;
		try {
			await sb.from('crm_getresponse_links').upsert({
				tenant_id: appState.profile?.tenant_id,
				klient_id: clientId,
				gr_email: grLink?.gr_email ?? null,
				ignored: false,
				updated_at: new Date().toISOString()
			}, { onConflict: 'klient_id' });
			grLink = { gr_email: grLink?.gr_email ?? null, ignored: false };
			await loadMailing(true);
		} finally {
			grSaving = false;
		}
	}

	// lazy-load przy wejściu w zakładkę (oszczędza limity API)
	$effect(() => {
		if (activeTab === 'mailing' && isAuraTenant && clientId && grLoadedFor !== clientId) {
			grLoadedFor = clientId;
			loadMailing();
		}
	});

	// APK
	const APK_APP_URL = 'https://crmaura.pages.dev';
	let showNewApk = $state(false);
	let savingApk = $state(false);
	let apkErr = $state('');
	let apkAdvisor = $state('');
	let apkMode = $state<'client'|'advisor'>('client');
	let apkToken = $state('');
	let apkCopied = $state(false);
	const apkLink = $derived(apkToken ? `${APK_APP_URL}?token=${apkToken}` : '');
	let apkLinkPopover = $state<string | null>(null);
	let deletingApk = $state<string | null>(null);

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
		const { data } = await sb.from('apk_forms').select('*, crm_clients(nazwa, nazwa_skrocona), apk_tokens(token, status, used_at)').order('created_at', { ascending: false });
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

	function apkTokenLink(f: typeof clientApk[0]): string {
		const token = f.apk_tokens?.[0]?.token;
		return token ? `${APK_APP_URL}?token=${token}` : `${APK_APP_URL}?form_id=${f.id}`;
	}

	async function deleteApk(id: string) {
		if (!confirm('Na pewno usunąć ten formularz APK? Operacja jest nieodwracalna.')) return;
		deletingApk = id;
		await sb.from('apk_tokens').delete().eq('form_id', id);
		await sb.from('apk_audit').delete().eq('form_id', id);
		await sb.from('apk_forms').delete().eq('id', id);
		const { data } = await sb.from('apk_forms').select('*, crm_clients(nazwa, nazwa_skrocona), apk_tokens(token, status, used_at)').order('created_at', { ascending: false });
		appState.apkForms = (data ?? []) as typeof appState.apkForms;
		deletingApk = null;
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
		const vinErr = validateVin(vVin, true);
		if (vinErr) { vError = vinErr; return; }
		savingV = true; vError = '';
		const payload = { nr_rejestracyjny: vRej.trim(), marka_model: vMarka.trim(), vin: vVin.trim().toUpperCase(), rok_produkcji: vRok ? parseInt(vRok) : null };
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

	// Link vehicle to existing policy
	let linkingVehicleId = $state<string | null>(null);
	let linkPolicyId = $state('');
	let linkingSaving = $state(false);

	async function linkVehicleToPolicy(vehicleId: string) {
		if (!linkPolicyId) return;
		linkingSaving = true;
		await sb.from('crm_policies').update({ pojazd_id: vehicleId }).eq('id', linkPolicyId);
		const { data } = await sb.from('crm_policies').select('*, crm_clients!klient_id(nazwa), ubezpieczony:crm_clients!ubezpieczony_id(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))').is('deleted_at', null);
		appState.policies = (data ?? []) as typeof appState.policies;
		linkingSaving = false;
		linkingVehicleId = null;
		linkPolicyId = '';
	}

	// Tasks
	let clientTasks = $state<CrmTask[]>([]);
	let showTaskModal = $state(false);
	let editingTask = $state<CrmTask | null>(null);

	const todayTask = new Date().toISOString().slice(0, 10);

	async function loadTasks() {
		const { data } = await sb.from('crm_tasks')
			.select('*, assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)')
			.eq('klient_id', clientId)
			.order('termin', { ascending: true, nullsFirst: false });
		clientTasks = (data ?? []) as CrmTask[];
	}

	loadTasks();

	function openNewTask() {
		editingTask = null;
		showTaskModal = true;
	}

	function openEditTask(t: CrmTask) {
		editingTask = t;
		showTaskModal = true;
	}

	async function toggleTaskStatus(t: CrmTask) {
		const next = t.status === 'zakonczone' ? 'otwarte' : 'zakonczone';
		await sb.from('crm_tasks').update({ status: next }).eq('id', t.id);
		await loadTasks();
	}

	async function deleteTask(t: CrmTask) {
		if (!confirm(`Usunąć zadanie: "${t.tytul}"?`)) return;
		await sb.from('crm_tasks').delete().eq('id', t.id);
		await loadTasks();
	}

	function isOverdue(t: CrmTask) {
		return (t.status === 'otwarte' || t.status === 'w_toku') && !!t.termin && t.termin < todayTask;
	}

	const priorityDotMap: Record<CrmTask['priorytet'], string> = {
		pilny: 'bg-red-500', wysoki: 'bg-orange-400', normalny: 'bg-blue-400', niski: 'bg-slate-300'
	};

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	// Opiekun klienta
	let editingOpiekun = $state(false);
	let selectedOpiekun = $state(client?.opiekun_id ?? '');
	let savingOpiekun = $state(false);

	const opiekunNazwa = $derived(() => {
		const id = client?.opiekun_id;
		if (!id) return null;
		const p = appState.brokers.find(b => b.id === id);
		return p?.imie_nazwisko ?? p?.email ?? null;
	});

	async function saveOpiekun() {
		savingOpiekun = true;
		await sb.from('crm_clients').update({ opiekun_id: selectedOpiekun || null }).eq('id', clientId);
		const { data } = await sb.from('crm_clients').select('*').order('created_at', { ascending: false });
		appState.clients = (data ?? []) as typeof appState.clients;
		savingOpiekun = false;
		editingOpiekun = false;
	}
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
				{#if client.email || client.telefon}
				<p class="text-sm text-slate-500 mt-0.5 flex items-center gap-3">
					{#if client.telefon}<a href="tel:{client.telefon}" class="hover:text-blue-600">📞 {client.telefon}</a>{/if}
					{#if client.email}<a href="mailto:{client.email}" class="hover:text-blue-600">✉ {client.email}</a>{/if}
				</p>
				{/if}
				<!-- Opiekun klienta -->
				<div class="flex items-center gap-2 mt-1">
					{#if editingOpiekun}
						<select bind:value={selectedOpiekun} class="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
							<option value="">— brak opiekuna —</option>
							{#each appState.brokers as b}
								<option value={b.id}>{b.imie_nazwisko ?? b.email}</option>
							{/each}
						</select>
						<button onclick={saveOpiekun} disabled={savingOpiekun} class="px-2 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">{savingOpiekun ? '...' : 'Zapisz'}</button>
						<button onclick={() => editingOpiekun = false} class="px-2 py-1 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50">Anuluj</button>
					{:else}
						<span class="text-xs text-slate-400">Opiekun:</span>
						<span class="text-xs font-medium text-slate-700">{opiekunNazwa() ?? '— brak —'}</span>
						<button onclick={() => { selectedOpiekun = client.opiekun_id ?? ''; editingOpiekun = true; }} class="text-xs text-blue-600 hover:underline">zmień</button>
					{/if}
				</div>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<button
				onclick={() => goto(`/clients/${clientId}/edit`)}
				class="flex items-center gap-1.5 bg-white text-slate-700 border border-slate-300 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors"
			>
				<Pencil size={14} /> Edytuj
			</button>
			<button
				onclick={() => goto(`/policies/new?klient=${clientId}`)}
				class="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors"
			>
				<Plus size={14} /> Dodaj Polisę
			</button>
		</div>
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
		{#each tabs as tab}
			<button onclick={() => (activeTab = tab)}
				class="pb-3 text-sm font-medium border-b-2 transition-colors
					{activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}">
				{tab === 'polisy' ? `Polisy (${clientPolicies.length})` : tab === 'pojazdy' ? `Flota (${clientVehicles.length})` : tab === 'szkody' ? `Szkody (${clientClaims.length})` : tab === 'kontakty' ? `Kontakty (${clientContacts.length})` : tab === 'apk' ? `APK (${clientApk.length})` : tab === 'zadania' ? `Zadania (${clientTasks.length})` : tab === 'mailing' ? 'Mailing' : 'Rozliczenia'}
			</button>
		{/each}
	</div>

	{#if activeTab === 'polisy'}
		{@const today = new Date().toISOString().slice(0,10)}
		{@const activePolicies = clientPolicies.filter(p => p.data_do === null || p.data_do >= today)}
		{@const archivedPolicies = clientPolicies.filter(p => p.data_do !== null && p.data_do < today && p.deleted_at === null)}
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
					{#each activePolicies as p}
						{@const st = policyStatus(p.data_do)}
						{@const daysLeft = p.data_do ? dateDiffDays(today, p.data_do) : 999}
						{@const isRenewed = renewedPolicyIds.has(p.id)}
						{@const isPendingRenewal = !!p.renewal_of && p.data_od > today}
						{@const canRenew = !isRenewed && daysLeft >= 0 && daysLeft <= 45}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3">
								<div class="flex items-center gap-1.5 flex-wrap">
									<a href="/policies/{p.id}" class="font-medium text-blue-700 hover:underline">{p.nr_polisy}</a>
									{#if p.klient_id !== clientId && p.ubezpieczony_id === clientId}
										<span class="text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1 py-0.5" title="Klient jest ubezpieczonym; ubezpieczający: {p.crm_clients?.nazwa ?? '—'}">Jako ubezpieczony</span>
									{/if}
									{#if isRenewed}
										<span class="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">Odnowiona</span>
									{:else if isPendingRenewal}
										<span class="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-0.5">Oczekująca</span>
									{/if}
								</div>
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
								<div class="flex flex-col gap-1 items-start">
									<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
									{#if canRenew}
										<a href="/policies/new?klient={p.klient_id}&rodzaj={encodeURIComponent(p.rodzaj)}&przedmiot={encodeURIComponent(p.przedmiot ?? '')}&renewal_of={p.id}{p.pojazd_id ? `&pojazd_id=${p.pojazd_id}` : ''}"
										   class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-amber-50 border border-amber-300 text-amber-700 rounded hover:bg-amber-100 transition-colors">
											<RefreshCw size={10} /> Odnów polisę
										</a>
									{/if}
								</div>
							</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="px-5 py-6 text-center text-slate-400">Brak polis</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if archivedPolicies.length > 0}
		<div class="mt-4">
			<details class="group">
				<summary class="cursor-pointer text-sm font-semibold text-slate-500 flex items-center gap-2 py-2">
					<span class="group-open:rotate-90 transition-transform">▶</span>
					Archiwum polis ({archivedPolicies.length})
				</summary>
				<div class="mt-2 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden opacity-70">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="bg-slate-50 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
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
							{#each archivedPolicies as p}
								{@const st = policyStatus(p.data_do)}
								{@const isRenewed = renewedPolicyIds.has(p.id)}
								<tr class="border-t border-slate-100 hover:bg-slate-50">
									<td class="px-5 py-3">
										<div class="flex items-center gap-1.5">
											<a href="/policies/{p.id}" class="font-medium text-slate-500 hover:underline">{p.nr_polisy}</a>
											{#if p.klient_id !== clientId && p.ubezpieczony_id === clientId}
												<span class="text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1 py-0.5" title="Klient jest ubezpieczonym; ubezpieczający: {p.crm_clients?.nazwa ?? '—'}">Jako ubezpieczony</span>
											{/if}
											{#if isRenewed}
												<span class="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">Odnowiona</span>
											{/if}
										</div>
									</td>
									<td class="px-5 py-3 text-slate-400">
										{#if p.crm_insurers?.skrot}
											<span class="font-mono font-semibold text-slate-400 text-xs" title={p.crm_insurers.nazwa}>{p.crm_insurers.skrot}</span>
										{:else}
											{p.crm_insurers?.nazwa ?? '—'}
										{/if}
									</td>
									<td class="px-5 py-3"><Badge variant="neutral">{p.rodzaj}</Badge></td>
									<td class="px-5 py-3 text-xs text-slate-400">{p.data_od}</td>
									<td class="px-5 py-3 text-xs text-slate-400">{p.data_do}</td>
									<td class="px-5 py-3 text-right font-medium text-slate-400">{fmtPln(p.skladka_przypisana)}</td>
									<td class="px-5 py-3">
										<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		</div>
		{/if}

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
						<th class="px-5 py-3">Status</th>
						<th class="px-5 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each clientVehicles as v}
						{@const assigned = assignedPolicyFor(v.id, appState.policies)}
						{@const unlinkedPolicies = clientPolicies.filter(p => (p.rodzaj === 'komunikacja' || p.rodzaj === 'flota') && !p.pojazd_id && !p.deleted_at)}
						<tr class="border-t border-slate-100 hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">{v.nr_rejestracyjny}</td>
							<td class="px-5 py-3">{v.marka_model}</td>
							<td class="px-5 py-3 text-slate-500">{v.vin ?? '—'}</td>
							<td class="px-5 py-3">{v.rok_produkcji ?? '—'}</td>
							<td class="px-5 py-3">
								{#if assigned}
									<a href="/policies/{assigned.id}" class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5 hover:bg-emerald-100">
										Przypisany: {assigned.nr_polisy}
									</a>
								{:else}
									<span class="text-xs text-slate-400">Wolny</span>
								{/if}
							</td>
							<td class="px-5 py-3">
								<div class="flex items-center gap-2 flex-wrap">
									<button onclick={() => openEditVehicle(v)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
									{#if !assigned}
										<a href="/policies/new?klient={clientId}&rodzaj=komunikacja&przedmiot={encodeURIComponent(v.nr_rejestracyjny + (v.vin ? ' / ' + v.vin : ''))}&pojazd_id={v.id}"
											class="text-xs text-blue-600 hover:underline flex items-center gap-1">
											<FileText size={11} /> Dodaj polisę
										</a>
										{#if unlinkedPolicies.length > 0}
											{#if linkingVehicleId === v.id}
												<div class="flex items-center gap-1.5">
													<select bind:value={linkPolicyId} class="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
														<option value="">— wybierz polisę —</option>
														{#each unlinkedPolicies as p}
															<option value={p.id}>{p.nr_polisy} ({p.rodzaj})</option>
														{/each}
													</select>
													<button onclick={() => linkVehicleToPolicy(v.id)} disabled={!linkPolicyId || linkingSaving} class="px-2 py-1 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
														{linkingSaving ? '...' : 'Przypisz'}
													</button>
													<button onclick={() => { linkingVehicleId = null; linkPolicyId = ''; }} class="px-2 py-1 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50">✕</button>
												</div>
											{:else}
												<button onclick={() => { linkingVehicleId = v.id; linkPolicyId = ''; }}
													class="text-xs text-emerald-600 hover:underline flex items-center gap-1">
													<Link size={11} /> Powiąż z polisą
												</button>
											{/if}
										{/if}
									{/if}
								</div>
							</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-5 py-6 text-center text-slate-400">Brak pojazdów</td></tr>
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
									<div class="flex items-center gap-2 flex-wrap">
										<a href="{APK_APP_URL}?form_id={f.id}" target="_blank"
											class="text-xs text-blue-600 hover:underline flex items-center gap-1">
											<ClipboardList size={12} /> Otwórz
										</a>
										<button
											onclick={() => apkLinkPopover = apkLinkPopover === f.id ? null : f.id}
											title="Pokaż link dla klienta"
											class="flex items-center gap-1 px-2 py-1 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
											<Link size={12} /> Link
										</button>
										<button onclick={() => handlePdf(f)} disabled={pdfSaving === f.id}
											class="flex items-center gap-1 px-2 py-1 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
											<Download size={12} /> {pdfSaving === f.id ? '...' : 'PDF'}
										</button>
										{#if f.pdf_url}
											<a href={f.pdf_url} target="_blank" title="Ostatni zapisany PDF"
												class="text-blue-500 hover:text-blue-700">
												<Download size={12} />
											</a>
										{/if}
										{#if appState.profile?.rola === 'ADMIN GOD'}
											<button onclick={() => deleteApk(f.id)} disabled={deletingApk === f.id}
												class="flex items-center gap-1 px-2 py-1 text-xs border border-red-200 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50">
												<Trash2 size={12} /> {deletingApk === f.id ? '...' : 'Usuń'}
											</button>
										{/if}
									</div>
									{#if apkLinkPopover === f.id}
										{@const link = apkTokenLink(f)}
										<div class="mt-2 flex gap-1.5 items-center">
											<input readonly value={link} class="text-xs font-mono bg-slate-50 border border-slate-200 rounded px-2 py-1 flex-1 min-w-0" />
											<button onclick={async () => { await navigator.clipboard.writeText(link); }}
												class="shrink-0 px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 text-slate-600">
												<Copy size={11} />
											</button>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else if activeTab === 'zadania'}
		<div class="flex justify-end mb-3">
			<button onclick={openNewTask} class="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
				<Plus size={14} /> Nowe zadanie
			</button>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			{#if clientTasks.length === 0}
				<div class="px-5 py-10 text-center text-slate-400 text-sm">Brak zadań dla tego klienta</div>
			{:else}
				<ul class="divide-y divide-slate-100">
					{#each clientTasks as t}
						{@const done = t.status === 'zakonczone'}
						{@const overdue = isOverdue(t)}
						<li class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 group {done ? 'opacity-60' : ''}">
							<button onclick={() => toggleTaskStatus(t)} class="shrink-0 text-slate-400 hover:text-emerald-600 transition-colors">
								{#if done}
									<CheckCircle2 size={16} class="text-emerald-500" />
								{:else if t.status === 'w_toku'}
									<Clock size={16} class="text-blue-400" />
								{:else}
									<Circle size={16} />
								{/if}
							</button>
							<span class="w-2 h-2 rounded-full shrink-0 {priorityDotMap[t.priorytet]}"></span>
							<div class="flex-1 min-w-0">
								<span class="text-sm font-medium text-slate-900 {done ? 'line-through text-slate-400' : ''}">{t.tytul}</span>
								{#if t.opis}<p class="text-xs text-slate-400 truncate">{t.opis}</p>{/if}
								{#if t.postep_pct !== undefined && t.czas_trwania_dni}
									{@const pct = t.postep_pct ?? 0}
									<div class="flex items-center gap-2 mt-1">
										<div class="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
											<div class="h-full rounded-full bg-blue-500" style="width:{pct}%"></div>
										</div>
										<span class="text-[10px] text-slate-400">{pct}%</span>
									</div>
								{/if}
							</div>
							{#if t.termin}
								<span class="text-xs shrink-0 {overdue ? 'text-red-500 font-semibold' : 'text-slate-400'}">
									{#if overdue}<AlertCircle size={11} class="inline mr-0.5" />{/if}
									{t.termin}
								</span>
							{/if}
							{#if t.assigned_profile}
								<span class="text-xs text-slate-400 shrink-0">{t.assigned_profile.imie_nazwisko ?? t.assigned_profile.email}</span>
							{/if}
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
								<button onclick={() => openEditTask(t)} class="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100"><Pencil size={12} /></button>
								<button onclick={() => deleteTask(t)} class="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

	{:else if activeTab === 'mailing'}
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			<div class="flex items-center justify-between px-5 py-3 border-b border-slate-100">
				<div class="flex items-center gap-2">
					<Mail size={16} class="text-slate-400" />
					<span class="text-sm font-semibold text-slate-700">Mailing GetResponse</span>
					<span class="text-xs text-slate-400">— informacyjnie, tylko podgląd</span>
				</div>
				<button onclick={() => loadMailing(true)} disabled={grLoading}
					class="flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-50">
					<RefreshCw size={12} class={grLoading ? 'animate-spin' : ''} /> Odśwież
				</button>
			</div>

			<div class="p-5">
				{#if grLoading}
					<p class="text-sm text-slate-400 text-center py-6">Pobieranie z GetResponse…</p>
				{:else if grError}
					<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{grError}</div>
				{:else if grLink?.ignored}
					<div class="flex items-center justify-between text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
						<span class="text-slate-500">Mailing dla tego klienta jest pominięty (ignorowany).</span>
						<button onclick={undoIgnore} disabled={grSaving} class="text-blue-600 hover:underline">Przywróć</button>
					</div>
				{:else if grResult?.matched}
					<div class="flex items-center gap-2 text-xs text-slate-400 mb-3">
						Kontakt GetResponse: <span class="font-medium text-slate-600">{grResult.contact.email}</span>
						{#if grResult.contact.name}<span>· {grResult.contact.name}</span>{/if}
					</div>
					{#if grResult.messages.length === 0}
						<p class="text-sm text-slate-400 text-center py-6">Brak wysłanych wiadomości w ostatnim okresie.</p>
					{:else}
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
									<th class="px-4 py-2">Temat</th>
									<th class="px-4 py-2">Wysłano</th>
									<th class="px-4 py-2">Otwarcie</th>
								</tr>
							</thead>
							<tbody>
								{#each grResult.messages as m}
									<tr class="border-t border-slate-100">
										<td class="px-4 py-2.5 font-medium text-slate-800">{m.subject}</td>
										<td class="px-4 py-2.5 text-slate-500"><span class="inline-flex items-center gap-1"><Send size={12} class="text-slate-300" />{fmtDateTime(m.sentOn)}</span></td>
										<td class="px-4 py-2.5">
											{#if m.opened}
												<span class="inline-flex items-center gap-1 text-emerald-600"><MailCheck size={13} /> {fmtDateTime(m.openedOn)}{#if m.openCount > 1}<span class="text-xs text-slate-400 ml-1">({m.openCount}×)</span>{/if}</span>
											{:else}
												<span class="text-slate-400">nie otwarto</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				{:else if grResult && !grResult.matched}
					<div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
						<div class="flex items-start gap-2 text-amber-800">
							<AlertTriangle size={15} class="mt-0.5 shrink-0" />
							<div>
								<p class="font-medium">Dane w CRM różne od GetResponse</p>
								{#if grResult.reason === 'no_email'}
									<p class="text-amber-700 mt-0.5">Ten klient nie ma adresu e-mail w CRM, więc nie można dopasować kontaktu w GetResponse.</p>
								{:else}
									<p class="text-amber-700 mt-0.5">Nie znaleziono kontaktu w GetResponse dla adresu <span class="font-mono">{grResult.email ?? grMatchEmail}</span> (rekord klienta: {client.nazwa}).</p>
								{/if}
							</div>
						</div>
						{#if grEditEmail}
							<div class="flex items-center gap-2 mt-3">
								<input type="email" bind:value={grEmailInput} placeholder="adres e-mail w GetResponse" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
								<button onclick={saveGrEmail} disabled={grSaving} class="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">Zapisz</button>
								<button onclick={() => grEditEmail = false} class="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50">Anuluj</button>
							</div>
						{:else}
							<div class="flex items-center gap-3 mt-3">
								<button onclick={() => { grEmailInput = grLink?.gr_email ?? client.email ?? ''; grEditEmail = true; }} class="text-sm font-medium text-blue-600 hover:underline">Uzupełnij adres</button>
								<button onclick={ignoreMismatch} disabled={grSaving} class="text-sm text-slate-500 hover:underline">Ignoruj</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
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
			{@const assigned = assignedPolicyFor(v.id, appState.policies)}
			<div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
				<div>
					<p class="font-medium">{v.nr_rejestracyjny}</p>
					<p class="text-xs text-slate-500">{v.marka_model}{v.rok_produkcji ? ` · ${v.rok_produkcji}` : ''}</p>
				</div>
				<div class="text-right">
					{#if v.vin}<p class="text-xs text-slate-400 font-mono">{v.vin}</p>{/if}
					{#if assigned}
						<p class="text-[11px] text-emerald-700">Przypisany: {assigned.nr_polisy}</p>
					{:else}
						<p class="text-[11px] text-slate-400">Wolny</p>
					{/if}
				</div>
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

<!-- Modal: Zadanie -->
<TaskModal
	open={showTaskModal}
	onclose={() => { showTaskModal = false; }}
	onsaved={loadTasks}
	editingTask={editingTask}
	presetKlientId={clientId}
	presetKlientNazwa={client?.nazwa ?? ''}
/>

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
