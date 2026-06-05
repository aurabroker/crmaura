<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { KeyRound, RefreshCw, Mail } from 'lucide-svelte';

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

	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<table class="w-full text-sm">
			<thead class="bg-slate-50 border-b border-slate-200">
				<tr>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nazwa firmy</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Data rejestracji</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Użytkownicy</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Admin</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Funkcje opcjonalne</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Resend API</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Akcje</th>
				</tr>
			</thead>
			<tbody>
				{#each tenants as tenant}
					{@const admin = adminFor(tenant.id)}
					{@const count = profilesFor(tenant.id).length}
					<tr class="border-b border-slate-100 hover:bg-slate-50">
						<td class="px-4 py-3 font-medium text-slate-900">{tenant.nazwa}</td>
						<td class="px-4 py-3 text-slate-500">{formatDate(tenant.created_at)}</td>
						<td class="px-4 py-3 text-slate-700">{count}</td>
						<td class="px-4 py-3 text-slate-600">{admin ? (admin.imie_nazwisko ?? admin.email) : '—'}</td>
						<td class="px-4 py-3">
							<div class="flex flex-wrap gap-1.5">
								{#each OPTIONAL_FEATURES as feat}
									<button
										onclick={() => toggleFeature(tenant, feat.key)}
										class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors
											{hasFeature(tenant, feat.key)
												? 'bg-blue-100 text-blue-700 border-blue-300'
												: 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100'}"
									>
										{#if hasFeature(tenant, feat.key)}✓{:else}○{/if}
										{feat.label}
									</button>
								{/each}
							</div>
						</td>
						<td class="px-4 py-3">
							{#if editingResend === tenant.id}
								<div class="flex items-center gap-1">
									<input
										type="text"
										bind:value={resendInput}
										placeholder="re_..."
										class="border border-slate-200 rounded px-2 py-1 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-blue-400"
									/>
									<button
										onclick={() => saveResendKey(tenant)}
										disabled={savingResend}
										class="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
									>{savingResend ? '…' : 'Zapisz'}</button>
									<button
										onclick={() => { editingResend = null; }}
										class="px-2 py-1 text-xs border border-slate-200 text-slate-600 rounded hover:bg-slate-100"
									>✕</button>
								</div>
							{:else if tenant.resend_api_key}
								<button
									onclick={() => { editingResend = tenant.id; resendInput = tenant.resend_api_key ?? ''; }}
									class="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-600"
									title="Edytuj klucz Resend"
								>
									<Mail size={12} />
									re_****…{tenant.resend_api_key.slice(-4)}
								</button>
							{:else}
								<button
									onclick={() => { editingResend = tenant.id; resendInput = ''; }}
									class="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600"
								>
									<Mail size={12} />
									Dodaj klucz
								</button>
							{/if}
						</td>
						<td class="px-4 py-3">
							<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Aktywny</span>
						</td>
						<td class="px-4 py-3">
							{#if admin}
								<button
									onclick={() => openResetModal(admin)}
									title="Reset hasła admina firmy"
									class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
								>
									<KeyRound size={13} />
									Reset hasła
								</button>
							{/if}
						</td>
					</tr>
				{/each}
				{#if tenants.length === 0}
					<tr>
						<td colspan="8" class="px-4 py-8 text-center text-slate-400">Brak firm</td>
					</tr>
				{/if}
			</tbody>
		</table>
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
