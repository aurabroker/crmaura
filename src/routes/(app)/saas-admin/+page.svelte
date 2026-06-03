<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { KeyRound } from 'lucide-svelte';

	type Tenant = { id: string; nazwa: string; created_at: string };
	type ProfileRow = { id: string; email: string; imie_nazwisko: string | null; rola: string; tenant_id: string };

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
		tenants = data.tenants;
		allProfiles = data.profiles;
		loading = false;
	});

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
						<td colspan="6" class="px-4 py-8 text-center text-slate-400">Brak firm</td>
					</tr>
				{/if}
			</tbody>
		</table>
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
