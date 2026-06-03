<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';

	type Tenant = { id: string; nazwa: string; created_at: string };
	type ProfileRow = { id: string; email: string; imie_nazwisko: string | null; rola: string; tenant_id: string };

	let tenants = $state<Tenant[]>([]);
	let allProfiles = $state<ProfileRow[]>([]);
	let loading = $state(true);

	onMount(async () => {
		if (appState.profile?.rola !== 'ADMIN GOD') {
			goto('/dashboard');
			return;
		}
		const [tRes, pRes] = await Promise.all([
			sb.from('crm_tenants').select('*').order('created_at', { ascending: false }),
			sb.from('crm_profiles').select('*')
		]);
		tenants = (tRes.data ?? []) as Tenant[];
		allProfiles = (pRes.data ?? []) as ProfileRow[];
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
</script>

{#if loading}
	<div class="flex items-center justify-center py-20 text-slate-400 text-sm">Ładowanie...</div>
{:else}
<div class="space-y-6">
	<h1 class="text-2xl font-bold text-slate-900">SAAS Admin — Wszystkie firmy</h1>

	<!-- Summary -->
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

	<!-- Table -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
		<table class="w-full text-sm">
			<thead class="bg-slate-50 border-b border-slate-200">
				<tr>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nazwa firmy</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Data rejestracji</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Użytkownicy</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Admin</th>
					<th class="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
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
					</tr>
				{/each}
				{#if tenants.length === 0}
					<tr>
						<td colspan="5" class="px-4 py-8 text-center text-slate-400">Brak firm</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>
{/if}
