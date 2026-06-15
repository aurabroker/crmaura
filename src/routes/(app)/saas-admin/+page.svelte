<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { KeyRound, RefreshCw, Plus } from 'lucide-svelte';
	import RegonLookup from '$lib/components/RegonLookup.svelte';

	type Tenant = { id: string; nazwa: string; created_at: string; features?: Record<string, boolean>; resend_api_key?: string | null };
	type ProfileRow = { id: string; email: string; imie_nazwisko: string | null; rola: string; tenant_id: string };

	const OPTIONAL_FEATURES: { key: string; label: string }[] = [
		{ key: 'gwarancje', label: 'Gwarancje ubezpieczeniowe' },
		{ key: 'kalendarz', label: 'Kalendarz / Zadania' },
	];

	function hasFeature(tenant: Tenant, key: string): boolean {
		return !!(tenant.features?.[key]);
	}

	async function toggleFeature(tenant: Tenant, key: string) {
		const current = tenant.features ?? {};
		const next = { ...current, [key]: !current[key] };
		await sb.from('crm_tenants').update({ features: next }).eq('id', tenant.id);
		tenant.features = next;
		tenants = [...tenants]; // trigger reactivity
	}

	let tenants = $state<Tenant[]>([]);
	let allProfiles = $state<ProfileRow[]>([]);
	let loading = $state(true);
	let loadError = $state('');

	// Modal state
	let resetModal = $state(false);
	let resetUserId = $state('');
	let resetUserEmail = $state('');
	let resetPassword = $state('');
	let resetConfirm = $state('');
	let resetLoading = $state(false);
	let resetError = $state('');
	let resetSuccess = $state('');

	// New tenant modal state
	let newTenantModal = $state(false);
	let ntNazwa = $state('');
	let ntTyp = $state<'broker' | 'agent'>('broker');
	let ntEmail = $state('');
	let ntImie = $state('');
	let ntPassword = $state('');
	let ntLoading = $state(false);
	let ntError = $state('');
	let ntSuccess = $state('');

	function openNewTenant() {
		ntNazwa = ''; ntTyp = 'broker'; ntEmail = ''; ntImie = ''; ntPassword = '';
		ntError = ''; ntSuccess = '';
		newTenantModal = true;
	}

	async function createTenant() {
		ntError = '';
		if (!ntNazwa.trim() || !ntEmail.trim() || !ntImie.trim() || !ntPassword) {
			ntError = 'Wszystkie pola są wymagane.';
			return;
		}
		if (ntPassword.length < 8) {
			ntError = 'Hasło musi mieć co najmniej 8 znaków.';
			return;
		}
		ntLoading = true;
		try {
			const res = await fetch('/api/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					nazwa_firmy: ntNazwa.trim(),
					typ: ntTyp,
					email: ntEmail.trim(),
					imie_nazwisko: ntImie.trim(),
					password: ntPassword
				})
			});
			if (!res.ok) {
				const err = await res.json();
				ntError = err.message ?? 'Błąd serwera';
			} else {
				ntSuccess = 'Firma i konto admina zostały utworzone.';
				// Reload tenants list
				const { data: { session } } = await sb.auth.getSession();
				const r = await fetch('/api/saas-admin/tenants', {
					headers: { 'Authorization': `Bearer ${session?.access_token}` }
				});
				if (r.ok) {
					const d = await r.json();
					const { data: tenantData } = await sb.from('crm_tenants').select('id, features, resend_api_key');
					const featuresMap = new Map((tenantData ?? []).map((t: { id: string; features: Record<string,boolean>; resend_api_key?: string | null }) => [t.id, { features: t.features ?? {}, resend_api_key: t.resend_api_key ?? null }]));
					tenants = d.tenants.map((t: Tenant) => ({ ...t, features: featuresMap.get(t.id)?.features ?? {}, resend_api_key: featuresMap.get(t.id)?.resend_api_key ?? null }));
					allProfiles = d.profiles;
				}
			}
		} catch {
			ntError = 'Błąd połączenia';
		} finally {
			ntLoading = false;
		}
	}

	// Selected tenant detail panel
	let selectedTenant = $state<Tenant | null>(null);
	let savingFeature = $state<string | null>(null);
	let localFeatures = $state<Record<string, boolean>>({});
	let savingFeatures = $state(false);
	let featureError = $state('');
	let featureSaved = $state(false);

	$effect(() => {
		if (selectedTenant) {
			localFeatures = { ...(selectedTenant.features ?? {}) };
			featureError = '';
			featureSaved = false;
		}
	});

	async function saveFeatures() {
		if (!selectedTenant) return;
		savingFeatures = true; featureError = '';
		const { error } = await sb.from('crm_tenants')
			.update({ features: localFeatures })
			.eq('id', selectedTenant.id);
		savingFeatures = false;
		if (error) { featureError = error.message; return; }
		selectedTenant = { ...selectedTenant, features: { ...localFeatures } };
		tenants = tenants.map(t => t.id === selectedTenant!.id ? { ...t, features: { ...localFeatures } } : t);
		featureSaved = true;
		setTimeout(() => featureSaved = false, 2000);
	}

	async function setFeature(tenant: Tenant, key: string, value: boolean) {
		savingFeature = key;
		const next = { ...(tenant.features ?? {}), [key]: value };
		await sb.from('crm_tenants').update({ features: next }).eq('id', tenant.id);
		tenant.features = next;
		tenants = [...tenants];
		if (selectedTenant?.id === tenant.id) selectedTenant = { ...tenant, features: next };
		savingFeature = null;
	}

	// Resend API key state
	let editingResend = $state<string | null>(null);
	let resendInput = $state('');
	let savingResend = $state(false);

	async function saveResendKey(tenant: Tenant) {
		savingResend = true;
		const val = resendInput.trim() || null;
		await sb.from('crm_tenants').update({ resend_api_key: val }).eq('id', tenant.id);
		tenant.resend_api_key = val;
		tenants = [...tenants];
		editingResend = null;
		savingResend = false;
	}

	// Sync state
	let syncLoading = $state(false);
	let syncResult = $state('');
	let syncLog = $state<{started_at: string; records_synced: number; status: string; error: string | null}[]>([]);

	onMount(async () => {
		if (appState.profile?.rola !== 'ADMIN GOD') {
			goto('/dashboard');
			return;
		}
		const { data: { session } } = await sb.auth.getSession();
		if (!session) { goto('/login'); return; }

		const res = await fetch('/api/saas-admin/tenants', {
			headers: { 'Authorization': `Bearer ${session.access_token}` }
		});

		if (!res.ok) {
			loadError = 'Brak uprawnień lub błąd serwera';
			loading = false;
			return;
		}

		const data = await res.json();
		// Enrich with features from crm_tenants (direct query since ADMIN GOD)
		const { data: tenantData } = await sb.from('crm_tenants').select('id, features, resend_api_key');
		const featuresMap = new Map((tenantData ?? []).map((t: { id: string; features: Record<string,boolean>; resend_api_key?: string | null }) => [t.id, { features: t.features ?? {}, resend_api_key: t.resend_api_key ?? null }]));
		tenants = data.tenants.map((t: Tenant) => ({ ...t, features: featuresMap.get(t.id)?.features ?? {}, resend_api_key: featuresMap.get(t.id)?.resend_api_key ?? null }));
		allProfiles = data.profiles;
		loading = false;
		loadSyncLog();
	});

	async function loadSyncLog() {
		const { data } = await sb.from('crm_sync_log')
			.select('started_at, records_synced, status, error')
			.eq('source', 'beauty.crm_companies')
			.order('started_at', { ascending: false })
			.limit(5);
		syncLog = (data ?? []) as typeof syncLog;
	}

	async function triggerSync() {
		syncLoading = true; syncResult = '';
		try {
			const { data: { session } } = await sb.auth.getSession();
			const res = await fetch('https://kukvgsjrmrqtzhkszzum.supabase.co/functions/v1/sync-beauty-companies', {
				method: 'POST',
				headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
				body: '{}'
			});
			const json = await res.json();
			if (res.ok) syncResult = `Zsynchronizowano ${json.synced} firm`;
			else syncResult = `Błąd: ${json.error}`;
		} catch (e: any) {
			syncResult = `Błąd połączenia: ${e.message}`;
		} finally {
			syncLoading = false;
			await loadSyncLog();
		}
	}

	function profilesFor(tenantId: string) {
		return allProfiles.filter((p) => p.tenant_id === tenantId);
	}

	function adminFor(tenantId: string) {
		return allProfiles.find((p) => p.tenant_id === tenantId && p.rola === 'ADMIN BROKER');
	}

	function formatDate(d: string) {
		return new Date(d).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	function openResetModal(admin: ProfileRow) {
		resetUserId = admin.id;
		resetUserEmail = admin.email;
		resetPassword = '';
		resetConfirm = '';
		resetError = '';
		resetSuccess = '';
		resetModal = true;
	}

	function closeResetModal() {
		resetModal = false;
	}

	async function submitReset() {
		resetError = '';
		resetSuccess = '';
		if (resetPassword.length < 8) {
			resetError = 'Hasło musi mieć co najmniej 8 znaków';
			return;
		}
		if (resetPassword !== resetConfirm) {
			resetError = 'Hasła nie są zgodne';
			return;
		}
		resetLoading = true;
		try {
			const { data: { session } } = await sb.auth.getSession();
			const res = await fetch('/api/saas-admin/reset-password', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${session?.access_token}`
				},
				body: JSON.stringify({ user_id: resetUserId, password: resetPassword })
			});
			if (!res.ok) {
				const err = await res.json();
				resetError = err.message ?? 'Błąd serwera';
			} else {
				resetSuccess = 'Hasło zostało zresetowane';
			}
		} catch {
			resetError = 'Błąd połączenia';
		} finally {
			resetLoading = false;
		}
	}
</script>

{#if loading}
	<div class="flex items-center justify-center py-20 text-slate-400 text-sm">Ładowanie...</div>
{:else if loadError}
	<div class="flex items-center justify-center py-20 text-red-500 text-sm">{loadError}</div>
{:else}
<div class="space-y-6">
	<h1 class="text-2xl font-bold text-slate-900">SAAS Admin — Wszystkie firmy</h1>

	<div class="grid grid-cols-2 gap-4 max-w-sm">
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
			<div class="text-2xl font-bold text-slate-900">{tenants.length}</div>
			<div class="text-xs text-slate-500 mt-1">Firm łącznie</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
			<div class="text-2xl font-bold text-slate-900">{allProfiles.length}</div>
			<div class="text-xs text-slate-500 mt-1">Użytkowników łącznie</div>
		</div>
	</div>

	<div class="flex gap-6">
		<!-- Tenant list -->
		<div class="w-80 shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden self-start">
			<div class="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
				<span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Firmy ({tenants.length})</span>
				<button onclick={openNewTenant} class="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors">
					<Plus size={13} /> Dodaj
				</button>
			</div>
			{#each tenants as tenant}
				{@const count = profilesFor(tenant.id).length}
				<button
					onclick={() => selectedTenant = selectedTenant?.id === tenant.id ? null : tenant}
					class="w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors
						{selectedTenant?.id === tenant.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}"
				>
					<div class="font-medium text-sm text-slate-900">{tenant.nazwa}</div>
					<div class="text-xs text-slate-400 mt-0.5">{count} użytk. · {formatDate(tenant.created_at)}</div>
				</button>
			{/each}
			{#if tenants.length === 0}
				<p class="px-4 py-6 text-center text-slate-400 text-sm">Brak firm</p>
			{/if}
		</div>

		<!-- Tenant detail panel -->
		{#if selectedTenant}
		{@const st = selectedTenant}
		{@const stAdmin = adminFor(st.id)}
		{@const stProfiles = profilesFor(st.id)}
		<div class="flex-1 space-y-4">
			<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
				<div class="flex items-start justify-between mb-4">
					<div>
						<h2 class="text-lg font-bold text-slate-900">{st.nazwa}</h2>
						<p class="text-xs text-slate-400 mt-0.5">Zarejestrowana: {formatDate(st.created_at)}</p>
					</div>
					<button onclick={() => selectedTenant = null} class="text-slate-400 hover:text-slate-700 text-sm">✕</button>
				</div>

				<!-- Funkcje opcjonalne -->
				<div class="mb-5">
					<p class="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Funkcje opcjonalne</p>
					<div class="space-y-2">
						{#each OPTIONAL_FEATURES as feat}
							<label class="flex items-center gap-3 cursor-pointer py-2 px-3 rounded-lg hover:bg-slate-50">
								<input
									type="checkbox"
									checked={!!(localFeatures[feat.key])}
									onchange={(e) => { localFeatures = { ...localFeatures, [feat.key]: (e.target as HTMLInputElement).checked }; featureSaved = false; }}
									class="w-4 h-4 rounded accent-blue-600"
								/>
								<span class="text-sm text-slate-700">{feat.label}</span>
							</label>
						{/each}
					</div>
					<div class="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
						<button
							onclick={saveFeatures}
							disabled={savingFeatures}
							class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
						>
							{savingFeatures ? 'Zapisuję...' : 'Zapisz funkcje'}
						</button>
						{#if featureSaved}
							<span class="text-sm text-emerald-600 font-medium">✓ Zapisano</span>
						{/if}
						{#if featureError}
							<span class="text-sm text-red-600">{featureError}</span>
						{/if}
					</div>
				</div>

				<!-- Resend API key -->
				<div class="mb-5 border-t border-slate-100 pt-4">
					<p class="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Resend API (email)</p>
					{#if editingResend === st.id}
						<div class="flex items-center gap-2">
							<input type="text" bind:value={resendInput} placeholder="re_..." class="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
							<button onclick={() => saveResendKey(st)} disabled={savingResend} class="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{savingResend ? '…' : 'Zapisz'}</button>
							<button onclick={() => { editingResend = null; }} class="px-3 py-2 text-sm border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-100">Anuluj</button>
						</div>
					{:else}
						<div class="flex items-center gap-3">
							<span class="text-sm text-slate-600 font-mono">{st.resend_api_key ? `re_****…${st.resend_api_key.slice(-4)}` : '— nie ustawiony —'}</span>
							<button onclick={() => { editingResend = st.id; resendInput = st.resend_api_key ?? ''; }} class="text-xs text-blue-600 hover:underline">
								{st.resend_api_key ? 'Zmień' : 'Dodaj'}
							</button>
						</div>
					{/if}
				</div>

				<!-- Użytkownicy -->
				<div class="border-t border-slate-100 pt-4">
					<p class="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Użytkownicy ({stProfiles.length})</p>
					<div class="space-y-1">
						{#each stProfiles as u}
							<div class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
								<div>
									<div class="text-sm font-medium text-slate-800">{u.imie_nazwisko ?? u.email}</div>
									<div class="text-xs text-slate-400">{u.email} · {u.rola}</div>
								</div>
								{#if u.rola === 'ADMIN BROKER'}
									<button
										onclick={() => openResetModal(u)}
										class="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100"
									>
										<KeyRound size={12} /> Reset hasła
									</button>
								{/if}
							</div>
						{:else}
							<p class="text-sm text-slate-400">Brak użytkowników</p>
						{/each}
					</div>
				</div>
			</div>
		</div>
		{:else}
		<div class="flex-1 flex items-center justify-center py-20 text-slate-400 text-sm">
			Wybierz firmę z listy, aby zobaczyć szczegóły i ustawienia
		</div>
		{/if}
	</div>

	<!-- Sync BEAUTY -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
		<div class="flex items-center justify-between mb-3">
			<div>
				<h2 class="text-sm font-semibold text-slate-900">Synchronizacja BEAUTY → Aura Expert</h2>
				<p class="text-xs text-slate-500 mt-0.5">Klienci z crm_companies (BEAUTY) → crm_clients. Automatycznie o 7:00.</p>
			</div>
			<button
				onclick={triggerSync}
				disabled={syncLoading}
				class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
			>
				<RefreshCw size={14} class={syncLoading ? 'animate-spin' : ''} />
				{syncLoading ? 'Synchronizuję...' : 'Aktualizuj teraz'}
			</button>
		</div>
		{#if syncResult}
			<p class="text-sm {syncResult.startsWith('Błąd') ? 'text-red-600' : 'text-emerald-600'} mb-3">{syncResult}</p>
		{/if}
		{#if syncLog.length > 0}
			<table class="w-full text-xs text-slate-600">
				<thead><tr class="text-slate-400 text-left border-b border-slate-100">
					<th class="pb-1">Data</th><th class="pb-1">Rekordów</th><th class="pb-1">Status</th>
				</tr></thead>
				<tbody>
					{#each syncLog as log}
						<tr class="border-b border-slate-50">
							<td class="py-1">{new Date(log.started_at).toLocaleString('pl-PL')}</td>
							<td class="py-1">{log.records_synced ?? '—'}</td>
							<td class="py-1 {log.status === 'error' ? 'text-red-500' : log.status === 'done' ? 'text-emerald-600' : 'text-amber-500'}">
								{log.status}{log.error ? `: ${log.error}` : ''}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
{/if}

<!-- Modal nowej firmy -->
{#if newTenantModal}
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
	<div class="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
		<div class="flex items-start justify-between mb-4">
			<div>
				<h2 class="text-lg font-semibold text-slate-900">Nowa firma / tenant</h2>
				<p class="text-xs text-slate-400 mt-0.5">Zostanie utworzone konto ADMIN BROKER</p>
			</div>
			<button onclick={() => newTenantModal = false} class="text-slate-400 hover:text-slate-700">✕</button>
		</div>

		{#if !ntSuccess}
		<div class="space-y-3">
			<RegonLookup onResult={(d) => { ntNazwa = ntNazwa || d.nazwa; }} />
			<div>
				<label class="block text-xs font-semibold text-slate-600 mb-1.5">Nazwa firmy *</label>
				<input bind:value={ntNazwa} placeholder="np. Broker ABC sp. z o.o." class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
			</div>
			<div>
				<label class="block text-xs font-semibold text-slate-600 mb-1.5">Typ</label>
				<select bind:value={ntTyp} class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
					<option value="broker">Broker</option>
					<option value="agent">Agent</option>
				</select>
			</div>
			<hr class="border-slate-100" />
			<p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Konto ADMIN BROKER</p>
			<div>
				<label class="block text-xs font-semibold text-slate-600 mb-1.5">Imię i nazwisko *</label>
				<input bind:value={ntImie} placeholder="Jan Kowalski" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
			</div>
			<div>
				<label class="block text-xs font-semibold text-slate-600 mb-1.5">E-mail *</label>
				<input bind:value={ntEmail} type="email" placeholder="admin@firma.pl" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
			</div>
			<div>
				<label class="block text-xs font-semibold text-slate-600 mb-1.5">Hasło * (min. 8 znaków)</label>
				<input bind:value={ntPassword} type="password" placeholder="Min. 8 znaków" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
			</div>

			{#if ntError}
				<p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{ntError}</p>
			{/if}
		</div>
		<div class="flex gap-3 mt-5">
			<button
				onclick={createTenant}
				disabled={ntLoading}
				class="flex-1 bg-blue-600 text-white text-sm font-semibold py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
			>
				{ntLoading ? 'Tworzę...' : 'Utwórz firmę'}
			</button>
			<button onclick={() => newTenantModal = false} class="flex-1 border border-slate-200 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50">
				Anuluj
			</button>
		</div>
		{:else}
		<div class="text-center py-4">
			<p class="text-emerald-700 font-semibold mb-1">✓ {ntSuccess}</p>
			<p class="text-xs text-slate-400 mb-5">Firma pojawi się na liście po lewej.</p>
			<button onclick={() => newTenantModal = false} class="px-5 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-700">
				Zamknij
			</button>
		</div>
		{/if}
	</div>
</div>
{/if}

<!-- Modal reset hasła -->
{#if resetModal}
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
	<div class="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
		<h2 class="text-lg font-semibold text-slate-900 mb-1">Reset hasła</h2>
		<p class="text-sm text-slate-500 mb-4">Dla: <span class="font-medium text-slate-700">{resetUserEmail}</span></p>

		<div class="space-y-4">
			<div>
				<label class="block text-xs font-semibold text-slate-600 mb-1.5">Nowe hasło</label>
				<input
					type="password"
					bind:value={resetPassword}
					placeholder="Min. 8 znaków"
					class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>
			<div>
				<label class="block text-xs font-semibold text-slate-600 mb-1.5">Potwierdź hasło</label>
				<input
					type="password"
					bind:value={resetConfirm}
					placeholder="Powtórz hasło"
					class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>

			{#if resetError}
				<p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{resetError}</p>
			{/if}
			{#if resetSuccess}
				<p class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{resetSuccess}</p>
			{/if}
		</div>

		<div class="flex gap-3 mt-6">
			{#if !resetSuccess}
				<button
					onclick={submitReset}
					disabled={resetLoading}
					class="flex-1 bg-blue-600 text-white text-sm font-semibold py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
				>
					{resetLoading ? 'Zapisywanie...' : 'Zmień hasło'}
				</button>
			{/if}
			<button
				onclick={closeResetModal}
				class="flex-1 border border-slate-200 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50 transition-colors"
			>
				{resetSuccess ? 'Zamknij' : 'Anuluj'}
			</button>
		</div>
	</div>
</div>
{/if}
